/**
 * rebuild-kv-game-pages.mjs
 * Herbouwt alle game:{slug} KV-entries vanuit D1 raw_json.
 * Optioneel: --enrich-steam om ook Steam-details op te halen voor games
 * die een steam_appid hebben maar geen screenshots of beschrijving.
 *
 * Gebruik:
 *   node scripts/rebuild-kv-game-pages.mjs
 *   node scripts/rebuild-kv-game-pages.mjs --enrich-steam
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

const ENRICH = process.argv.includes('--enrich-steam');

async function d1(sql) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify({ sql }) }
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result[0].results;
}

async function d1Update(sql) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify({ sql }) }
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j;
}

async function kvPut(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`;
  const r = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${TOKEN}` }, body: value });
  if (!r.ok) console.warn(`  KV PUT mislukt voor ${key}: ${r.status}`);
}

async function fetchSteamDetails(appid) {
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const app = d[appid];
    if (!app?.success) return null;
    return app.data;
  } catch { return null; }
}

// Haal alle actieve games op uit D1
console.log('Laden van alle actieve games uit D1...');
const rows = await d1(`SELECT slug, steam_appid, raw_json FROM games WHERE status='active' ORDER BY name`);
console.log(`  ${rows.length} actieve games gevonden`);

let enriched = 0;
let written  = 0;

for (const row of rows) {
  let entry = JSON.parse(row.raw_json);

  // Enrich met Steam details als gevraagd en game heeft steam_appid maar mist data
  if (ENRICH && row.steam_appid) {
    const needsEnrich = !entry.screenshots?.length || !entry.short_description || !entry.dev;
    if (needsEnrich) {
      const app = await fetchSteamDetails(row.steam_appid);
      if (app) {
        let changed = false;
        if (!entry.screenshots?.length && app.screenshots?.length) {
          entry.screenshots = app.screenshots.slice(0, 5).map(s => s.path_full);
          changed = true;
        }
        if (!entry.short_description && app.short_description) {
          entry.short_description = app.short_description;
          changed = true;
        }
        if (!entry.dev && app.developers?.[0]) {
          entry.dev = app.developers[0];
          changed = true;
        }
        if (!entry.price && !app.is_free && app.price_overview?.final_formatted) {
          entry.price = app.price_overview.final_formatted;
          changed = true;
        }
        if (!entry.price && app.is_free) {
          entry.price = 'Free';
          changed = true;
        }
        if (!entry.cover && app.header_image) {
          entry.cover = app.header_image;
          changed = true;
        }

        if (changed) {
          const json = JSON.stringify(entry);
          const esc  = s => s.replace(/'/g, "''");
          await d1Update(`UPDATE games SET raw_json='${esc(json)}', last_updated=datetime('now') WHERE slug='${esc(row.slug)}'`);
          row.raw_json = json;
          enriched++;
          console.log(`  ✓ Enriched: ${entry.title || row.slug}`);
        }
      }
    }
  }

  await kvPut(`game:${row.slug}`, row.raw_json);
  written++;
}

console.log(`\nKlaar:`);
console.log(`  ${written} game:{slug} KV-entries geschreven`);
if (ENRICH) console.log(`  ${enriched} games verrijkt met Steam-data`);
