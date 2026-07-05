/**
 * Regressietests voor de duplicaat-preventie in de pipeline:
 * assignSlugs-identiteitsreclaim (merge.js) en het dedupe-vangnet +
 * hideGames-chunking (d1.js). Draaien vóór elke wijziging aan die logica:
 *
 *   node scripts/test-dedupe.mjs
 *
 * Dekt de randgevallen die eerder misgingen: CJK-titels (lege genormaliseerde
 * titel), appid-veto op titel-matches, same-batch dubbeladoptie, cross-month
 * appid-dupes, keeper-keuze (manual > oudste first_seen, null = jongst) en
 * de D1-limiet van 100 bound parameters per statement.
 */
import assert from 'node:assert';
import { dedupeActiveGames, hideGames } from '../worker/src/pipeline/d1.js';
import { assignSlugs } from '../worker/src/pipeline/merge.js';

function mockEnv(rows, calls = { sql: [], bound: [], runs: 0, kvDeleted: [] }) {
  return {
    calls,
    GAMES_D1: {
      prepare(sql) {
        calls.sql.push(sql);
        return {
          all: async () => ({ results: rows }),
          bind: (...args) => ({
            all: async () => ({ results: rows }),
            run: async () => { calls.bound.push(args); calls.runs++; },
          }),
        };
      },
    },
    GAMES_KV: { delete: async k => calls.kvDeleted.push(k) },
  };
}

// ---- Test 1: assignSlugs reclaimt bestaande slug via Steam-appid (Dinoblade-case) ----
{
  const owners = new Map([
    ['dinoblade', { id: 'excel-dinoblade', appid: '3440070', title: 'Dinoblade', date: '2026-07-23', active: true }],
  ]);
  const [g] = assignSlugs(
    [{ id: 'wiki-dinoblade', title: 'Dinoblade', date: '2026-07-23', steam: '3440070' }],
    owners
  );
  assert.strictEqual(g.slug, 'dinoblade', `appid-reclaim faalt: kreeg ${g.slug}`);
  console.log('OK  assignSlugs: appid-reclaim → bestaande slug hergebruikt');
}

// ---- Test 2: assignSlugs reclaimt via titel+maand (geen appid aan beide kanten) ----
{
  const owners = new Map([
    ['dinoblade', { id: 'excel-dinoblade', appid: null, title: 'Dinoblade', date: '2026-07-23', active: true }],
  ]);
  const [g] = assignSlugs(
    [{ id: 'wiki-dinoblade', title: 'Dinoblade', date: '2026-07-10', steam: null }],
    owners
  );
  assert.strictEqual(g.slug, 'dinoblade', `titel+maand-reclaim faalt: kreeg ${g.slug}`);
  console.log('OK  assignSlugs: titel+maand-reclaim → bestaande slug hergebruikt');
}

// ---- Test 3: andere game met zelfde titel in ANDERE maand krijgt wél een suffix ----
{
  const owners = new Map([
    ['dinoblade', { id: 'rawg-1', appid: '111', title: 'Dinoblade', date: '2026-03-01', active: true }],
  ]);
  const [g] = assignSlugs(
    [{ id: 'rawg-2', title: 'Dinoblade', date: '2026-07-23', steam: '222' }],
    owners
  );
  assert.strictEqual(g.slug, 'dinoblade-2026', `verwachtte suffix-slug, kreeg ${g.slug}`);
  console.log('OK  assignSlugs: andere game (andere appid/maand) → suffix-slug blijft werken');
}

// ---- Test 4: hidden records worden NIET gereclaimd ----
{
  const owners = new Map([
    ['dinoblade-2026', { id: 'wiki-dinoblade', appid: '3440070', title: 'Dinoblade', date: '2026-07-23', active: false }],
  ]);
  const [g] = assignSlugs(
    [{ id: 'rawg-99', title: 'Dinoblade', date: '2026-07-23', steam: '3440070' }],
    owners
  );
  assert.strictEqual(g.slug, 'dinoblade', `hidden record mag niet gereclaimd worden: kreeg ${g.slug}`);
  console.log('OK  assignSlugs: hidden records doen niet mee aan reclaim');
}

// ---- Test 5: titel+maand-match met VERSCHILLENDE appids wordt NIET gereclaimd (appid-veto) ----
{
  const owners = new Map([
    ['foo', { id: 'rawg-1', appid: '111', title: 'Foo', date: '2026-07-01', active: true }],
  ]);
  const [g] = assignSlugs(
    [{ id: 'rawg-2', title: 'Foo', date: '2026-07-15', steam: '222' }],
    owners
  );
  assert.notStrictEqual(g.slug, 'foo', 'ander appid mag bestaand record niet overnemen');
  assert.strictEqual(g.slug, 'foo-2026');
  console.log('OK  assignSlugs: appid-veto — titel-match met ander appid reclaimt niet');
}

// ---- Test 6: twee batch-games die op hetzelfde record matchen krijgen NIET dezelfde slug ----
{
  const owners = new Map([
    ['foo', { id: 'rawg-1', appid: '100', title: 'Foo', date: '2026-07-01', active: true }],
  ]);
  const out = assignSlugs(
    [
      { id: 'rawg-1',  title: 'Foo',                   date: '2026-07-01', steam: '100' },
      { id: 'wiki-foo', title: 'Foo: Complete Edition', date: '2026-07-01', steam: '100' },
    ],
    owners
  );
  assert.strictEqual(out[0].slug, 'foo', 'eerste matcher adopteert de bestaande slug');
  assert.notStrictEqual(out[1].slug, 'foo', 'tweede matcher mag dezelfde slug niet ook adopteren');
  const unique = new Set(out.map(g => g.slug));
  assert.strictEqual(unique.size, 2, 'slugs binnen batch moeten uniek zijn');
  console.log('OK  assignSlugs: same-batch dubbeladoptie voorkomen (geen last-writer-wins race)');
}

// ---- Test 7: CJK-titel reclaimt niet op lege titel-sleutel ----
{
  const owners = new Map([
    ['rawg-1', { id: 'rawg-1', appid: '4062390', title: '梦幻传奇', date: '2026-01-19', active: true }],
  ]);
  const [g] = assignSlugs(
    [{ id: 'rawg-2', title: '蛙爷的进化之路', date: '2026-01-22', steam: '4200940' }],
    owners
  );
  assert.strictEqual(g.slug, 'rawg-2', `CJK-game moet eigen id-slug krijgen, kreeg ${g.slug}`);
  console.log('OK  assignSlugs: CJK-titel reclaimt niet op lege titel-sleutel');
}

// ---- Test 8: dedupe verbergt de jongste dupe, houdt de oudste (Dinoblade-case) ----
{
  const rows = [
    { slug: 'dinoblade',      name: 'Dinoblade',  release_date: '2026-07-23', steam_appid: '3440070', first_seen: '2026-06-30T12:02:32Z', manual_json: null },
    { slug: 'dinoblade-2026', name: 'Dinoblade',  release_date: '2026-07-23', steam_appid: '3440070', first_seen: '2026-07-05T03:46:03Z', manual_json: null },
    { slug: 'other-game',     name: 'Other Game', release_date: '2026-07-01', steam_appid: '999',     first_seen: '2026-06-01T00:00:00Z', manual_json: null },
  ];
  const env = mockEnv(rows);
  const { hidden, months } = await dedupeActiveGames(env);
  assert.deepStrictEqual(hidden, ['dinoblade-2026']);
  assert.deepStrictEqual([...months], ['2026-07']);
  assert.deepStrictEqual(env.calls.kvDeleted, ['game:dinoblade-2026']);
  console.log('OK  dedupe: jongste dupe verborgen, KV opgeruimd, maand gerapporteerd');
}

// ---- Test 9: dedupe — manual-record wint ook als het jonger is ----
{
  const rows = [
    { slug: 'foo',      name: 'Foo Game', release_date: '2026-08-01', steam_appid: null, first_seen: '2026-06-01T00:00:00Z', manual_json: null },
    { slug: 'foo-2026', name: 'Foo Game', release_date: '2026-08-01', steam_appid: null, first_seen: '2026-07-01T00:00:00Z', manual_json: '{"cover":true}' },
  ];
  const { hidden } = await dedupeActiveGames(mockEnv(rows));
  assert.deepStrictEqual(hidden, ['foo'], `manual-record moet winnen; kreeg ${JSON.stringify(hidden)}`);
  console.log('OK  dedupe: manual-record wint van ouder pipeline-record');
}

// ---- Test 10: dedupe — zelfde titel+maand maar VERSCHILLENDE appids = geen duplicaat ----
{
  const rows = [
    { slug: 'foo',   name: 'Foo', release_date: '2026-05-01', steam_appid: '111', first_seen: '2026-01-01', manual_json: null },
    { slug: 'foo-b', name: 'Foo', release_date: '2026-05-20', steam_appid: '222', first_seen: '2026-02-01', manual_json: null },
  ];
  const { hidden } = await dedupeActiveGames(mockEnv(rows));
  assert.deepStrictEqual(hidden, [], `verschillende appids mogen niet als dupe gelden: ${JSON.stringify(hidden)}`);
  console.log('OK  dedupe: appid-veto — zelfde titel, verschillende appids blijven beide staan');
}

// ---- Test 11: dedupe — zelfde appid in VERSCHILLENDE maanden is wél een duplicaat ----
{
  const rows = [
    { slug: 'foo',      name: 'Foo',            release_date: '2026-03-01', steam_appid: '100', first_seen: '2026-01-01', manual_json: null },
    { slug: 'foo-2026', name: 'Foo (Remaster)', release_date: '2026-04-01', steam_appid: '100', first_seen: '2026-02-01', manual_json: null },
  ];
  const { hidden, months } = await dedupeActiveGames(mockEnv(rows));
  assert.deepStrictEqual(hidden, ['foo-2026'], `cross-month appid-dupe moet gevangen worden: ${JSON.stringify(hidden)}`);
  assert.deepStrictEqual([...months], ['2026-04']);
  console.log('OK  dedupe: cross-month appid-duplicaat wordt nu wél gevangen');
}

// ---- Test 12: dedupe — null first_seen telt als jongst (wordt verborgen, niet gehouden) ----
{
  const rows = [
    { slug: 'foo-null', name: 'Foo', release_date: '2026-06-01', steam_appid: '100', first_seen: null,        manual_json: null },
    { slug: 'foo',      name: 'Foo', release_date: '2026-06-01', steam_appid: '100', first_seen: '2026-01-01', manual_json: null },
  ];
  const { hidden } = await dedupeActiveGames(mockEnv(rows));
  assert.deepStrictEqual(hidden, ['foo-null'], `null first_seen mag geen houder worden: ${JSON.stringify(hidden)}`);
  console.log('OK  dedupe: null first_seen telt als jongst');
}

// ---- Test 13: dedupe — CJK-titels zijn geen duplicaten van elkaar ----
{
  const rows = [
    { slug: 'rawg-1', name: '梦幻传奇',       release_date: '2026-01-19', steam_appid: '4062390', first_seen: '2026-01-01', manual_json: null },
    { slug: 'rawg-2', name: '蛙爷的进化之路', release_date: '2026-01-22', steam_appid: '4200940', first_seen: '2026-01-02', manual_json: null },
    { slug: 'rawg-3', name: 'みつめ',         release_date: '2026-01-25', steam_appid: null,       first_seen: '2026-01-03', manual_json: null },
  ];
  const { hidden } = await dedupeActiveGames(mockEnv(rows));
  assert.deepStrictEqual(hidden, []);
  console.log('OK  dedupe: CJK-titels botsen niet op lege titel-sleutel');
}

// ---- Test 14: hideGames chunkt de UPDATE bij >90 slugs (D1 100-param-limiet) ----
{
  const slugs = Array.from({ length: 250 }, (_, i) => `game-${i}`);
  const env = mockEnv([]);
  await hideGames(env, slugs);
  assert.strictEqual(env.calls.runs, 3, `verwachtte 3 gechunkte UPDATEs, kreeg ${env.calls.runs}`);
  const maxParams = Math.max(...env.calls.bound.map(a => a.length));
  assert.ok(maxParams <= 91, `chunk overschrijdt parameterlimiet: ${maxParams}`);
  assert.strictEqual(env.calls.kvDeleted.length, 250);
  console.log('OK  hideGames: UPDATE gechunkt (250 slugs → 3 statements, ≤91 params)');
}

console.log('\nAlle 14 tests geslaagd');
