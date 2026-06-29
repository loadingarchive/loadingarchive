/**
 * steam-refresh-july.mjs
 *
 * Loopt door ALLE actieve juli 2026 games één voor één:
 *  - Games zonder steam_appid → zoek via Steam store search op naam
 *  - Alle games met steam_appid → ververs volledige Steam data
 *    (cover, screenshots, beschrijving, prijs, metacritic, requirements)
 *
 * Gebruik: node scripts/steam-refresh-july.mjs
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
if (!TOKEN) { console.error('Geen wrangler OAuth token gevonden — log eerst in via: wrangler login'); process.exit(1); }

const CF_H      = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const ADULT_IDS = new Set([3, 4]);
const DATE_FROM = '2026-07-01';
const DATE_TO   = '2026-07-31';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function esc(s)    { return String(s ?? '').replace(/'/g, "''"); }

// D1 query via Cloudflare REST API
async function d1(sql) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify({ sql }) }
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result[0].results;
}

// KV PUT via Cloudflare REST API
async function kvPut(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`;
  const r = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${TOKEN}` }, body: value });
  if (!r.ok) console.warn(`  ⚠ KV PUT mislukt voor ${key}: ${r.status}`);
}

// Normaliseer titel voor exacte Steam-vergelijking
function normalizeTitle(t) {
  return (t || '').toLowerCase().replace(/[®™©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Steam: zoek appid op naam (exacte match na normalisatie)
async function findSteamAppId(title) {
  const target = normalizeTitle(title);
  if (!target) return null;
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(target)}&cc=us&l=en`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const exact = (data.items || []).find(
      it => it.type === 'app' && normalizeTitle(it.name) === target
    );
    return exact ? String(exact.id) : null;
  } catch { return null; }
}

// Steam: haal volledige app details op — retourneert null bij adult content
async function fetchSteamApp(appid) {
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const app  = data?.[appid]?.data;
    if (!app) return null;
    const descIds = app.content_descriptors?.ids || [];
    if (descIds.some(id => ADULT_IDS.has(id))) return null;
    return app;
  } catch { return null; }
}

// ---- Main ----------------------------------------------------------------

const rows = await d1(`
  SELECT slug, name, release_date, steam_appid, rawg_id, raw_json
  FROM games
  WHERE status = 'active'
    AND release_date >= '${DATE_FROM}'
    AND release_date <= '${DATE_TO}'
  ORDER BY release_date, name
`);

const withSteam    = rows.filter(r => r.steam_appid).length;
const withoutSteam = rows.filter(r => !r.steam_appid).length;

console.log(`\n=== Steam Refresh: Juli 2026 ===`);
console.log(`  ${rows.length} games totaal  |  ${withSteam} met steam_appid  |  ${withoutSteam} zonder\n`);

let foundNew = 0, refreshed = 0, noSteam = 0, adultSkipped = 0, errors = 0;

for (let i = 0; i < rows.length; i++) {
  const row   = rows[i];
  const entry = JSON.parse(row.raw_json || '{}');
  let appid   = row.steam_appid;
  const label = `[${i + 1}/${rows.length}] [${row.release_date}] ${row.name}`;

  // ---- Stap 1: geen steam_appid → zoek via Steam store search ----
  if (!appid) {
    process.stdout.write(`${label}\n  → geen appid, zoeken op Steam… `);
    appid = await findSteamAppId(row.name);
    if (!appid) {
      console.log(`niet gevonden`);
      noSteam++;
      await sleep(400);
      continue;
    }
    console.log(`gevonden: appid ${appid}`);
    foundNew++;
  } else {
    process.stdout.write(`${label}\n  → appid ${appid}, data verversen… `);
  }

  // ---- Stap 2: haal Steam app details op ----
  const app = await fetchSteamApp(appid);
  if (!app) {
    console.log(`mislukt (Steam time-out of game niet beschikbaar)`);
    errors++;
    await sleep(600);
    continue;
  }
  if (!app.name) {
    console.log(`adult content — overgeslagen`);
    adultSkipped++;
    await sleep(400);
    continue;
  }

  // ---- Stap 3: update entry met Steam data ----
  const po = app.price_overview;

  entry.steam    = appid;
  entry.cover    = app.header_image || entry.cover || null;
  entry.trailer  = entry.trailer || (app.movies?.length ? `steam:${appid}` : null);

  // Beschrijvingen (Steam is leading, overschrijf altijd)
  entry.short_description    = app.short_description    || entry.short_description    || null;
  entry.detailed_description = app.detailed_description || entry.detailed_description || null;

  // Screenshots (altijd opnieuw ophalen van Steam — meest actueel)
  entry.screenshots = (app.screenshots || []).slice(0, 3).map(s => s.path_full);

  // PC requirements
  entry.pc_requirements = {
    minimum:     app.pc_requirements?.minimum     || null,
    recommended: app.pc_requirements?.recommended || null,
  };

  // Metacritic
  if (app.metacritic?.score) {
    entry.metacritic = { score: app.metacritic.score, url: app.metacritic.url };
  }

  // Categorieën
  if (app.categories?.length) {
    entry.categories = app.categories.map(c => c.description);
  }

  // Dev/publisher (alleen invullen als leeg)
  if (!entry.dev && app.developers?.length)  entry.dev = app.developers[0];
  if (!entry.genre?.length && app.genres?.length) {
    entry.genre = app.genres.map(g => g.description).slice(0, 2);
  }

  // Prijs
  entry.price            = app.is_free ? 'Free' : (po?.final_formatted    || entry.price || null);
  entry.price_initial    = po?.initial_formatted || null;
  entry.discount_percent = po?.discount_percent ?? 0;

  const json = JSON.stringify(entry);
  const now  = new Date().toISOString();

  // ---- Stap 4: sla op in D1 ----
  await d1(`UPDATE games SET
    steam_appid       = '${esc(appid)}',
    cover_image       = '${esc(entry.cover)}',
    screenshots       = '${esc(JSON.stringify(entry.screenshots))}',
    short_description = '${esc(entry.short_description)}',
    price             = ${entry.price ? `'${esc(entry.price)}'` : 'NULL'},
    metacritic        = ${entry.metacritic ? `'${esc(JSON.stringify(entry.metacritic))}'` : 'metacritic'},
    requirements      = ${(entry.pc_requirements?.minimum || entry.pc_requirements?.recommended) ? `'${esc(JSON.stringify(entry.pc_requirements))}'` : 'requirements'},
    raw_json          = '${esc(json)}',
    last_updated      = '${now}'
    WHERE slug = '${esc(row.slug)}'`);

  // ---- Stap 5: update KV ----
  await kvPut(`game:${row.slug}`, json);

  refreshed++;
  const parts = [];
  if (entry.price)      parts.push(entry.price);
  if (entry.metacritic) parts.push(`Meta ${entry.metacritic.score}`);
  parts.push(`${entry.screenshots.length} screenshots`);
  console.log(`  ✓ ${parts.join(' | ')}`);

  await sleep(700); // Steam rate-limiting voorkomen
}

// ---- Herbouw games:2026-07 maand-cache ----
console.log(`\n--- Maand-cache herbouwen (games:2026-07) ---`);
const allJuly  = await d1(`
  SELECT raw_json FROM games
  WHERE status = 'active'
    AND release_date >= '${DATE_FROM}'
    AND release_date <= '${DATE_TO}'
  ORDER BY release_date
`);
const julyData = allJuly.map(r => JSON.parse(r.raw_json));
await kvPut('games:2026-07', JSON.stringify({ results: julyData, generatedAt: new Date().toISOString() }));

// ---- Samenvatting ----
console.log(`\n=== Klaar ===`);
console.log(`  ${refreshed}      games bijgewerkt met Steam data`);
console.log(`  ${foundNew}      nieuw Steam appid gevonden`);
console.log(`  ${noSteam}      games zonder Steam pagina (console-exclusief o.i.d.)`);
console.log(`  ${adultSkipped}      overgeslagen vanwege adult content`);
console.log(`  ${errors}      fouten (time-out / niet bereikbaar)`);
console.log(`  games:2026-07 KV opgebouwd met ${julyData.length} games`);
