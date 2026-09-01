/**
 * Regressietests voor het hard-delete-beleid: purgeGamesBefore (d1.js)
 * verwijdert games van vóór het venster definitief uit D1 + KV, maar slaat
 * manual.protected-games over. Draaien vóór elke wijziging aan die logica:
 *
 *   node scripts/test-purge.mjs
 */
import assert from 'node:assert';
import { purgeGamesBefore } from '../worker/src/pipeline/d1.js';

function mockEnv(rows, calls = { sql: [], bound: [], runs: 0, kvDeleted: [] }) {
  return {
    calls,
    GAMES_D1: {
      prepare(sql) {
        calls.sql.push(sql);
        return {
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

// ---- Test 1: protected game overleeft de purge, de rest verdwijnt ----
{
  const env = mockEnv([
    { slug: 'old-game',       release_date: '2026-06-15', protected_flag: null },
    { slug: 'hand-added',     release_date: '2026-05-01', protected_flag: 1 },
    { slug: 'old-game-2',     release_date: '2026-05-20', protected_flag: null },
  ]);
  const r = await purgeGamesBefore(env, '2026-07-01');
  assert.deepStrictEqual(r.deleted, ['old-game', 'old-game-2']);
  assert.deepStrictEqual(r.skippedProtected, ['hand-added']);
  assert.ok(env.calls.kvDeleted.includes('game:old-game'));
  assert.ok(env.calls.kvDeleted.includes('game:old-game-2'));
  assert.ok(!env.calls.kvDeleted.includes('game:hand-added'), 'protected game: KV mag niet weg');
  console.log('OK  purge: protected overgeslagen, rest verwijderd (D1 + game:-KV)');
}

// ---- Test 2: maand-KV's van geraakte maanden worden verwijderd ----
{
  const env = mockEnv([
    { slug: 'a', release_date: '2026-06-15', protected_flag: null },
    { slug: 'b', release_date: '2026-06-20', protected_flag: null },
    { slug: 'c', release_date: '2026-05-01', protected_flag: null },
  ]);
  const r = await purgeGamesBefore(env, '2026-07-01');
  assert.deepStrictEqual(r.months.sort(), ['2026-05', '2026-06']);
  assert.ok(env.calls.kvDeleted.includes('games:2026-06'));
  assert.ok(env.calls.kvDeleted.includes('games:2026-05'));
  console.log('OK  purge: maand-KV per geraakte maand verwijderd (gededupliceerd)');
}

// ---- Test 3: DELETE gechunkt op ≤90 slugs per statement (D1-param-limiet) ----
{
  const rows = Array.from({ length: 250 }, (_, i) => ({
    slug: `g${i}`, release_date: '2026-06-01', protected_flag: null,
  }));
  const env = mockEnv(rows);
  const r = await purgeGamesBefore(env, '2026-07-01');
  assert.strictEqual(r.deleted.length, 250);
  const deletes = env.calls.bound.filter(args => args.length > 0 && String(args[0]).startsWith('g'));
  assert.strictEqual(deletes.length, 3, `verwachtte 3 DELETE-chunks, kreeg ${deletes.length}`);
  assert.ok(deletes.every(args => args.length <= 90), 'chunk overschrijdt 90 params');
  console.log('OK  purge: DELETE gechunkt (250 slugs → 3 statements, ≤90 params)');
}

// ---- Test 4: niets te purgen → geen writes, lege uitkomst ----
{
  const env = mockEnv([]);
  const r = await purgeGamesBefore(env, '2026-07-01');
  assert.deepStrictEqual(r, { deleted: [], months: [], skippedProtected: [] });
  assert.strictEqual(env.calls.runs, 0, 'geen DELETE verwacht');
  assert.strictEqual(env.calls.kvDeleted.length, 0, 'geen KV-deletes verwacht');
  console.log('OK  purge: lege selectie → volledige no-op');
}

console.log('\nAlle 4 purge-tests geslaagd');
