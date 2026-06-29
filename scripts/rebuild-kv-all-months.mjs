/**
 * rebuild-kv-all-months.mjs
 * Herbouwt de KV-maandcaches vanuit D1 voor alle 12 maanden + TBA.
 * Gebruik na bulk-wijzigingen in D1 (bijv. JP-only games verbergen).
 *
 * Gebruik: node scripts/rebuild-kv-all-months.mjs
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT  = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';

const toml  = readFileSync(
  path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'),
  'utf8'
);
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
const CF_H  = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function d1(sql) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify({ sql }) }
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result[0].results;
}

async function kvPut(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`;
  const r = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${TOKEN}` }, body: value });
  if (!r.ok) console.warn(`  KV PUT mislukt voor ${key}: ${r.status}`);
}

const ts = new Date().toISOString();

// Alle 12 maanden van 2026
for (let m = 1; m <= 12; m++) {
  const mm      = String(m).padStart(2, '0');
  const from    = `2026-${mm}-01`;
  const lastDay = new Date(2026, m, 0).getDate();
  const to      = `2026-${mm}-${String(lastDay).padStart(2, '0')}`;
  const kvKey   = `games:2026-${mm}`;

  const rows  = await d1(`SELECT raw_json FROM games WHERE status='active' AND release_date >= '${from}' AND release_date <= '${to}' ORDER BY release_date`);
  const games = rows.map(r => JSON.parse(r.raw_json));
  await kvPut(kvKey, JSON.stringify({ results: games, generatedAt: ts }));
  console.log(`  ${kvKey} → ${games.length} games`);
}

// TBA
const tbaRows  = await d1(`SELECT raw_json FROM games WHERE status='active' AND release_date IS NULL ORDER BY name`);
const tbaGames = tbaRows.map(r => JSON.parse(r.raw_json));
await kvPut('games:tba', JSON.stringify({ results: tbaGames, generatedAt: ts }));
console.log(`  games:tba → ${tbaGames.length} games`);

console.log('\nKlaar — alle KV-maandcaches herbouwd vanuit D1');
