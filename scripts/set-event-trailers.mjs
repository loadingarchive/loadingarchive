/**
 * set-event-trailers.mjs — koppelt handmatig trailer-URLs aan de games van
 * een event in de 'config:events' KV. De pipeline (igdb.js) vult g.trailer
 * inmiddels al automatisch via IGDB's games.videos.video_id, dus dit script
 * is nu vooral een vangnet: games waar IGDB geen video voor heeft, of een
 * verkeerde/ontbrekende match die je met de hand wilt corrigeren.
 *
 * Gebruik:
 *   node scripts/set-event-trailers.mjs <event-slug> <map.json>
 *
 * <map.json> is een simpel { "Exacte game-naam uit de KV": "https://youtube.com/watch?v=...", ... }
 * object. Namen die niet matchen met een game in het event worden gelogd en
 * overgeslagen (typefout-vangnet i.p.v. stilzwijgend niets doen).
 */

import { readFileSync } from 'fs';
import path from 'path';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';
const KV_KEY = 'config:events';

const toml  = readFileSync(path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'), 'utf8');
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
const CF_H  = { 'Authorization': `Bearer ${TOKEN}` };

async function kvGet(key) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`,
    { headers: CF_H });
  if (!r.ok) throw new Error(`KV GET ${key}: ${r.status}`);
  return r.json();
}

async function kvPut(key, value) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: { ...CF_H, 'Content-Type': 'application/json' }, body: value });
  if (!r.ok) throw new Error(`KV PUT ${key}: ${r.status}`);
}

const [slug, mapPath] = process.argv.slice(2);
if (!slug || !mapPath) {
  console.error('Gebruik: node scripts/set-event-trailers.mjs <event-slug> <map.json>');
  process.exit(1);
}

const trailerMap = JSON.parse(readFileSync(mapPath, 'utf8'));

const data = await kvGet(KV_KEY);
const ev = (data.events || []).find(e => e.slug === slug);
if (!ev) {
  console.error(`✗ Event niet gevonden: ${slug}`);
  process.exit(1);
}

const remaining = new Set(Object.keys(trailerMap));
let matched = 0;
for (const g of ev.games || []) {
  if (trailerMap[g.name]) {
    g.trailer = trailerMap[g.name];
    remaining.delete(g.name);
    matched++;
  }
}

await kvPut(KV_KEY, JSON.stringify(data));
console.log(`✓ ${matched} trailer(s) gekoppeld aan "${ev.name}" (${slug})`);
if (remaining.size) {
  console.log(`⚠ Niet gematcht (geen game met die naam in dit event):`);
  for (const n of remaining) console.log(`  - ${n}`);
}
