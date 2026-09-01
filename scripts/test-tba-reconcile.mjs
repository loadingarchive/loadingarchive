/**
 * Regressietests voor de TBA-datumcheck: reconcileTbaDates (tba-reconcile.js)
 * geeft TBA-games met een dag-precieze Steam-datum hun release_date, laat
 * vage datums ("2026", "Q4 2026") met rust en slaat manual-records over.
 * Draaien vóór elke wijziging aan die logica:
 *
 *   node scripts/test-tba-reconcile.mjs
 */
import assert from 'node:assert';
import { reconcileTbaDates, parseFullSteamDate } from '../worker/src/pipeline/tba-reconcile.js';

// ---- Test 1: parseFullSteamDate accepteert alleen dag-precieze datums ----
{
  assert.strictEqual(parseFullSteamDate('Sep 9, 2024'), '2024-09-09');
  assert.strictEqual(parseFullSteamDate('24 Jun, 2026'), '2026-06-24');
  assert.strictEqual(parseFullSteamDate('August 2026'), null, 'maand-only mag geen dag verzinnen');
  assert.strictEqual(parseFullSteamDate('2026'), null);
  assert.strictEqual(parseFullSteamDate('Q4 2026'), null);
  assert.strictEqual(parseFullSteamDate('Coming soon'), null);
  assert.strictEqual(parseFullSteamDate(''), null);
  console.log('OK  reconcile: parseFullSteamDate alleen dag-precies');
}

// Mock-env: eerste .all() geeft de TBA-selectie, latere .all()'s (KV-rebuilds
// via queryActiveTbaGames/queryActiveMonthGames) een lege lijst.
function mockEnv(rows) {
  const calls = { updates: [], kvPuts: [], allCount: 0 };
  return {
    calls,
    GAMES_D1: {
      prepare(sql) {
        return {
          run: async () => {},                       // ALTER TABLE
          all: async () => ({ results: calls.allCount++ === 0 ? rows : [] }),
          bind: (...args) => ({
            all: async () => ({ results: calls.allCount++ === 0 ? rows : [] }),
            run: async () => { calls.updates.push({ sql, args }); },
          }),
        };
      },
    },
    GAMES_KV: { put: async (k, v) => calls.kvPuts.push({ k, v }) },
  };
}

// Steam-antwoorden per appid faken (fetchSteamReleaseDate gebruikt global fetch)
function mockSteam(byAppid) {
  globalThis.fetch = async (url) => {
    const appid = String(url).match(/appids=(\d+)/)[1];
    const rd = byAppid[appid];
    if (rd === 'FAIL') throw new Error('timeout');
    return {
      ok: true,
      json: async () => ({ [appid]: { success: true, data: { release_date: rd } } }),
    };
  };
}

const row = (slug, appid, extra = {}) => ({
  slug, name: slug, steam_appid: String(appid),
  raw_json: JSON.stringify({ title: slug, date: null, ...extra }),
});

// ---- Test 2: dag-precieze datum → release_date gezet, KV's herbouwd ----
{
  mockSteam({
    '1': { coming_soon: false, date: 'Sep 9, 2024' },   // al uitgebracht (vóór venster)
    '2': { coming_soon: true,  date: 'Sep 17, 2026' },  // concrete datum aangekondigd
    '3': { coming_soon: true,  date: '2026' },          // vaag → blijft TBA
    '4': { coming_soon: true,  date: 'Coming soon' },   // vaag → blijft TBA
  });
  const env = mockEnv([row('released-old', 1), row('dated-soon', 2), row('vague-a', 3), row('vague-b', 4)]);
  const r = await reconcileTbaDates(env);

  assert.strictEqual(r.moved, 2);
  assert.deepStrictEqual(r.months.sort(), ['2024-09', '2026-09']);

  const dateUpdates = env.calls.updates.filter(u => u.sql.includes('release_date'));
  assert.strictEqual(dateUpdates.length, 2);
  assert.ok(dateUpdates.some(u => u.args[0] === '2024-09-09' && u.args[3] === 'released-old'));
  assert.ok(dateUpdates.some(u => u.args[0] === '2026-09-17' && u.args[3] === 'dated-soon'));

  // raw_json.date moet meegeschreven zijn (frontend leest raw_json, niet de kolom)
  const kvGame = env.calls.kvPuts.find(p => p.k === 'game:dated-soon');
  assert.strictEqual(JSON.parse(kvGame.v).date, '2026-09-17');

  // TBA-KV herbouwd; alleen de venstermaand herbouwd, niet 2024-09 (pre-venster)
  assert.ok(env.calls.kvPuts.some(p => p.k === 'games:tba'));
  assert.ok(env.calls.kvPuts.some(p => p.k === 'games:2026-09'));
  assert.ok(!env.calls.kvPuts.some(p => p.k === 'games:2024-09'), 'pre-venster maand-KV mag niet aangemaakt worden');

  // vage games: alleen tba_checked_at aangeraakt
  const touches = env.calls.updates.filter(u => u.sql.includes('tba_checked_at') && !u.sql.includes('release_date'));
  assert.strictEqual(touches.length, 2);
  console.log('OK  reconcile: datums gezet, vaag blijft TBA, juiste KV-rebuilds');
}

// ---- Test 3: manual.date / manual.protected worden overgeslagen ----
{
  mockSteam({ '1': { coming_soon: false, date: 'Jan 5, 2026' }, '2': { coming_soon: false, date: 'Jan 5, 2026' } });
  const env = mockEnv([
    row('hand-dated', 1, { manual: { date: true } }),
    row('protected',  2, { manual: { protected: true } }),
  ]);
  const r = await reconcileTbaDates(env);
  assert.strictEqual(r.moved, 0);
  assert.ok(env.calls.updates.every(u => !u.sql.includes('release_date')), 'manual-records mogen geen datum krijgen');
  assert.strictEqual(env.calls.kvPuts.length, 0, 'geen KV-writes bij 0 verplaatsingen');
  console.log('OK  reconcile: manual.date/protected overgeslagen');
}

// ---- Test 4: Steam-fetch-fout → geen datum, alleen checked_at (rotatie) ----
{
  mockSteam({ '1': 'FAIL' });
  const env = mockEnv([row('flaky', 1)]);
  const r = await reconcileTbaDates(env);
  assert.strictEqual(r.moved, 0);
  const touches = env.calls.updates.filter(u => u.sql.includes('tba_checked_at') && !u.sql.includes('release_date'));
  assert.strictEqual(touches.length, 1, 'fetch-fout moet checked_at wel aanraken');
  console.log('OK  reconcile: fetch-fout → touch, geen datum');
}

console.log('\nAlle 4 reconcile-tests geslaagd');
