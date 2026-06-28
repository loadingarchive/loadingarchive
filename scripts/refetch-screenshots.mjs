/**
 * Herhaalt de Steam-screenshots-fetch voor alle actieve games die
 * een steam_appid hebben maar nog geen screenshots in D1.
 *
 * Reden: games uit de repair-script kregen geen nieuwe Steam-enrichment.
 * Dit script haalt ALLEEN screenshots + short_description + requirements op
 * (geen nieuwe RAWG-calls), zodat het snel en goedkoop is.
 *
 * Gebruik: node scripts/refetch-screenshots.mjs
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT    = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACCT    = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID   = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS   = 'cccc2aea7c3c44379b6fe07a28e06bff';
const DB_NAME = 'loadingarchive_games';

const toml  = readFileSync(path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'), 'utf8');
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];

async function d1(sql) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }) }
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result[0].results;
}

async function kvPut(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`;
  const r = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}` }, body: value });
  if (!r.ok) console.warn(`  KV PUT mislukt voor ${key}: ${r.status}`);
}

async function fetchSteamDetails(appid) {
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const app  = data?.[appid]?.data;
    if (!app) return null;
    return {
      screenshots:   (app.screenshots || []).slice(0, 3).map(s => s.path_full),
      short_description: app.short_description || null,
      requirements: {
        minimum:     app.pc_requirements?.minimum     || null,
        recommended: app.pc_requirements?.recommended || null,
      },
    };
  } catch { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Haal alle games op met Steam maar zonder screenshots
const rows = await d1(`
  SELECT slug, name, steam_appid, raw_json
  FROM games
  WHERE status='active'
    AND steam_appid IS NOT NULL
    AND (screenshots IS NULL OR screenshots = '[]')
  ORDER BY release_date
`);

console.log(`${rows.length} games te verrijken met Steam-screenshots\n`);

let updated = 0, noShots = 0, errors = 0;
const CONCURRENCY = 2;

async function processGame(row) {
  const appid   = row.steam_appid;
  const details = await fetchSteamDetails(appid);
  if (!details) { errors++; return; }
  if (!details.screenshots.length) { noShots++; return; } // Steam heeft nog geen screenshots

  // Bouw bijgewerkte entry
  const entry = JSON.parse(row.raw_json);
  entry.screenshots = details.screenshots;
  if (details.short_description && !entry.short_description) {
    entry.short_description = details.short_description;
  }
  if ((details.requirements.minimum || details.requirements.recommended) && !entry.pc_requirements) {
    entry.pc_requirements = details.requirements;
  }

  const esc  = s => String(s).replace(/'/g, "''");
  const json = JSON.stringify(entry);
  const sql  = `UPDATE games
    SET screenshots = '${esc(JSON.stringify(details.screenshots))}',
        short_description = ${details.short_description ? `'${esc(details.short_description)}'` : 'short_description'},
        raw_json = '${esc(json)}'
    WHERE slug = '${esc(row.slug)}'`;

  // D1 UPDATE via REST API
  await d1(sql);

  // KV update
  await kvPut(`game:${row.slug}`, json);
  updated++;
}

// Verwerk in batches van CONCURRENCY
for (let i = 0; i < rows.length; i += CONCURRENCY) {
  const batch = rows.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(row => processGame(row)));
  await sleep(800); // pauze om Steam rate-limiting te vermijden
  if ((i + CONCURRENCY) % 40 === 0 || i + CONCURRENCY >= rows.length) {
    console.log(`  ${Math.min(i + CONCURRENCY, rows.length)}/${rows.length} verwerkt — ${updated} bijgewerkt, ${noShots} nog coming-soon, ${errors} fouten`);
  }
}

console.log(`\nKlaar:`);
console.log(`  ${updated} games bijgewerkt met screenshots`);
console.log(`  ${noShots} games zijn nog "coming soon" op Steam (geen screenshots beschikbaar)`);
console.log(`  ${errors} fouten (Steam time-out of 404)`);
