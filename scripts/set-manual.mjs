/**
 * set-manual.mjs — zet een veld handmatig op een game én markeert het als
 * "manual", zodat de dagelijkse pipeline (saveGameToD1 / backfillSteamAppids /
 * updateDailyPrices) het nooit meer overschrijft.
 *
 * Gebruik:
 *   node scripts/set-manual.mjs <slug> <veld> <waarde>
 *   node scripts/set-manual.mjs <slug> <veld> --release    (marker weghalen, pipeline neemt het weer over)
 *
 * Voorbeelden:
 *   node scripts/set-manual.mjs palworld rerelease '{"date":"2024-01-19"}'
 *   node scripts/set-manual.mjs grand-theft-auto-vi cover "https://example.com/gta6.jpg"
 *   node scripts/set-manual.mjs some-game anticipated true
 *   node scripts/set-manual.mjs some-game rerelease null   (waarde wissen én gewist HOUDEN)
 *   node scripts/set-manual.mjs some-game cover --release  (terug naar pipeline-beheer)
 *   node scripts/set-manual.mjs some-game protected true   (game NOOIT soft-deleten,
 *                                                            ook niet als de pipeline 'm nooit meer vindt)
 *
 * De waarde wordt als JSON geparsed (true/false/null/nummers/objecten);
 * lukt dat niet, dan wordt hij als string gebruikt.
 * Werkt D1 + game:{slug} KV + de maand-KV (of games:tba) in één keer bij.
 */

import { readFileSync } from 'fs';
import path from 'path';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';
const toml  = readFileSync(path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'), 'utf8');
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
const CF_H  = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function d1(sql, params = []) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify({ sql, params }) });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results || [];
}

async function kvPut(key, value) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: { 'Authorization': `Bearer ${TOKEN}` }, body: value }
  );
  if (!r.ok) throw new Error(`KV PUT ${key}: ${r.status}`);
}

const [slug, field, rawValue] = process.argv.slice(2);
if (!slug || !field || rawValue === undefined) {
  console.error('Gebruik: node scripts/set-manual.mjs <slug> <veld> <waarde|--release>');
  process.exit(1);
}

const release = rawValue === '--release';
let value;
if (!release) {
  try { value = JSON.parse(rawValue); } catch { value = rawValue; }
}

const [row] = await d1(`SELECT slug, release_date, raw_json FROM games WHERE slug = ?`, [slug]);
if (!row) {
  console.error(`✗ Game niet gevonden: ${slug}`);
  process.exit(1);
}

const game = JSON.parse(row.raw_json || '{}');
game.manual = game.manual || {};

if (release) {
  delete game.manual[field];
  if (Object.keys(game.manual).length === 0) delete game.manual;
  console.log(`✓ Marker verwijderd: "${field}" wordt weer door de pipeline beheerd`);
} else {
  game[field] = value;
  game.manual[field] = true;
  console.log(`✓ ${field} = ${JSON.stringify(value)} (vergrendeld tegen pipeline-overschrijven)`);
}

const json = JSON.stringify(game);
await d1(`UPDATE games SET raw_json = ?, last_updated = ? WHERE slug = ?`,
  [json, new Date().toISOString(), slug]);
await kvPut(`game:${slug}`, json);
console.log(`✓ D1 + game:${slug} KV bijgewerkt`);

// Lijst-KV herbouwen zodat de wijziging ook op de homepage zichtbaar is.
const ts = new Date().toISOString();
if (row.release_date) {
  const month = row.release_date.slice(0, 7);
  const rows  = await d1(
    `SELECT raw_json FROM games WHERE status='active' AND release_date >= ? AND release_date <= ? ORDER BY release_date`,
    [`${month}-01`, `${month}-31`]);
  await kvPut(`games:${month}`, JSON.stringify({ results: rows.map(r => JSON.parse(r.raw_json)), generatedAt: ts }));
  console.log(`✓ games:${month} KV herbouwd (${rows.length} games)`);
} else {
  const rows = await d1(
    `SELECT raw_json FROM games WHERE status='active' AND release_date IS NULL ORDER BY name`, []);
  await kvPut('games:tba', JSON.stringify({ results: rows.map(r => JSON.parse(r.raw_json)), generatedAt: ts }));
  console.log(`✓ games:tba KV herbouwd (${rows.length} games)`);
}
