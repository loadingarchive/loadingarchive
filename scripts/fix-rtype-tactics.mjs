/**
 * Koppelt steam_appid 2169930 aan beide R-Type Tactics I • II Cosmos entries
 * en haalt cover, screenshots, beschrijving en trailer op van Steam.
 */
import { readFileSync } from 'fs';
import path from 'path';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';
const TOKEN = readFileSync(
  path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'), 'utf8'
).match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];

const APPID = '2169930';
const SLUGS = ['r-type-tactics-i-ii-cosmos-ww', 'r-type-tactics-i-ii-cosmos-jp'];

async function d1(sql, params = []) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }) }
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result[0].results;
}

async function kvPut(key, value) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}` }, body: value }
  );
  if (!r.ok) throw new Error(`KV PUT mislukt: ${r.status}`);
}

// Stap 1: Haal Steam appdetails op
console.log(`Stap 1 — Steam appdetails voor appid ${APPID}…`);
const steamR = await fetch(`https://store.steampowered.com/api/appdetails?appids=${APPID}&cc=us&l=en`);
const steamJ = await steamR.json();
const app = steamJ?.[APPID]?.data;
if (!app) { console.error('Steam appdetails niet gevonden'); process.exit(1); }

const cover       = app.header_image || null;
const screenshots = (app.screenshots || []).slice(0, 3).map(s => s.path_full);
const desc        = app.short_description || null;
const developer   = app.developers?.[0] || null;
const trailer     = app.movies?.[0] ? `steam:${APPID}` : null;

console.log(`  Naam:       ${app.name}`);
console.log(`  Cover:      ${cover?.slice(0, 60)}…`);
console.log(`  Screenshots: ${screenshots.length}`);
console.log(`  Trailer:    ${trailer || 'geen'}`);
console.log(`  Developer:  ${developer}`);

// Stap 2: Haal huidige raw_json op voor beide slugs
console.log(`\nStap 2 — Huidige DB-entries ophalen…`);
const rows = await d1(`SELECT slug, name, raw_json FROM games WHERE slug IN ('${SLUGS.join("','")}') AND status='active'`);
console.log(`  ${rows.length} entries gevonden`);

// Stap 3: Update elke entry
for (const row of rows) {
  console.log(`\nStap 3 — Updaten: ${row.slug}`);
  const entry = JSON.parse(row.raw_json || '{}');

  entry.steam        = APPID;
  entry.cover        = cover;
  entry.screenshots  = screenshots;
  if (desc && !entry.short_description) entry.short_description = desc;
  if (developer && !entry.dev)          entry.dev = developer;
  if (trailer)                          entry.trailer = trailer;

  const esc  = s => String(s).replace(/'/g, "''");
  const json = JSON.stringify(entry);

  await d1(`UPDATE games
    SET steam_appid = '${APPID}',
        cover_image = '${esc(cover)}',
        screenshots = '${esc(JSON.stringify(screenshots))}',
        short_description = ${desc ? `'${esc(desc)}'` : 'short_description'},
        raw_json = '${esc(json)}'
    WHERE slug = '${row.slug}'`);
  console.log(`  D1 bijgewerkt`);

  await kvPut(`game:${row.slug}`, json);
  console.log(`  KV bijgewerkt`);
}

console.log(`\nKlaar! Check https://www.loadingarchive.com/game/${SLUGS[0]}`);
