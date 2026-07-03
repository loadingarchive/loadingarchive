/**
 * backfill-prices.mjs
 * Vult EUR en GBP prijzen in voor alle actieve games met een steam_appid.
 * Haalt echte Steam regionale prijzen op en schrijft ze naar D1 + KV.
 *
 * Gebruik: node scripts/backfill-prices.mjs
 */

import { readFileSync } from 'fs';
import path from 'path';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';

const toml  = readFileSync(
  path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'),
  'utf8'
);
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
const CF_H  = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function d1Query(sql, params = []) {
  const body = params.length ? { sql, params } : { sql };
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify(body) }
  );
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

// Haalt regionale prijs op via Steam appdetails API
async function fetchRegionalPrice(appid, cc) {
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${cc}&filters=price_overview`,
      { signal: AbortSignal.timeout(7000) }
    );
    if (!r.ok) return null;
    const j = await r.json();
    return j?.[String(appid)]?.data?.price_overview || null;
  } catch { return null; }
}

// ── Stap 1: Lees alle actieve games met steam_appid ────────────────────────────
console.log('Backfill EUR/GBP prijzen\n');
console.log('Stap 1: Games ophalen uit D1…');

const rows = await d1Query(`
  SELECT slug, steam_appid, raw_json
  FROM games
  WHERE status = 'active' AND steam_appid IS NOT NULL
  ORDER BY last_seen DESC
`);

console.log(`  ${rows.length} games gevonden\n`);

// ── Stap 2: Voor elke game EUR + GBP ophalen ───────────────────────────────────
console.log('Stap 2: Regionale prijzen ophalen van Steam…\n');

let updated = 0;
let skipped = 0;
let errors  = 0;

for (let i = 0; i < rows.length; i++) {
  const row   = rows[i];
  const entry = JSON.parse(row.raw_json || '{}');

  // Gratis games: EUR en GBP zijn ook gratis, geen fetch nodig
  if (entry.price === 'Free') {
    if (entry.price_eur === 'Free' && entry.price_gbp === 'Free') {
      skipped++;
      continue;
    }
    entry.price_eur         = 'Free';
    entry.price_initial_eur = null;
    entry.price_gbp         = 'Free';
    entry.price_initial_gbp = null;
    const json = JSON.stringify(entry);
    try {
      await d1Query(`UPDATE games SET raw_json = ?1, last_updated = ?2 WHERE slug = ?3`,
        [json, new Date().toISOString(), row.slug]);
      await kvPut(`game:${row.slug}`, json);
      updated++;
      console.log(`  [${i+1}/${rows.length}] ${entry.title || row.slug}: Free → OK`);
    } catch (e) {
      errors++;
      console.error(`  [${i+1}/${rows.length}] ${row.slug}: schrijffout — ${e.message}`);
    }
    continue;
  }

  // Games zonder prijs (nog niet uitgebracht): sla over
  if (!entry.price) {
    skipped++;
    continue;
  }

  // Al ingevuld? Sla over (tenzij één van beide ontbreekt)
  if (entry.price_eur && entry.price_gbp) {
    skipped++;
    continue;
  }

  // Haal EUR en GBP parallel op
  try {
    const [eur, gbp] = await Promise.all([
      fetchRegionalPrice(row.steam_appid, 'nl'),
      fetchRegionalPrice(row.steam_appid, 'gb'),
    ]);

    const priceEur     = eur?.final_formatted    || null;
    const priceInitEur = eur?.initial_formatted   || null;
    const priceGbp     = gbp?.final_formatted    || null;
    const priceInitGbp = gbp?.initial_formatted   || null;

    if (!priceEur && !priceGbp) {
      console.log(`  [${i+1}/${rows.length}] ${entry.title || row.slug}: geen regionale prijs gevonden`);
      skipped++;
      continue;
    }

    entry.price_eur         = priceEur;
    entry.price_initial_eur = priceInitEur || null;
    entry.price_gbp         = priceGbp;
    entry.price_initial_gbp = priceInitGbp || null;

    const json = JSON.stringify(entry);
    await d1Query(`UPDATE games SET raw_json = ?1, last_updated = ?2 WHERE slug = ?3`,
      [json, new Date().toISOString(), row.slug]);
    await kvPut(`game:${row.slug}`, json);

    updated++;
    const eurStr = priceEur || '—';
    const gbpStr = priceGbp || '—';
    console.log(`  [${i+1}/${rows.length}] ${(entry.title || row.slug).padEnd(40)} USD ${(entry.price||'').padEnd(8)} EUR ${eurStr.padEnd(8)} GBP ${gbpStr}`);
  } catch (e) {
    errors++;
    console.error(`  [${i+1}/${rows.length}] ${row.slug}: fout — ${e.message}`);
  }

  // Even pauze elke 10 games zodat Steam ons niet rate-limit
  if ((i + 1) % 10 === 0) await sleep(1000);
}

console.log(`\n════════════════════════════════════════════`);
console.log(`  Bijgewerkt : ${updated}`);
console.log(`  Overgeslagen: ${skipped} (al ingevuld, gratis of geen prijs)`);
console.log(`  Fouten     : ${errors}`);
console.log(`════════════════════════════════════════════\n`);
