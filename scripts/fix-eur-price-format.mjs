/**
 * fix-eur-price-format.mjs
 * Normaliseert bestaande EUR-prijzen in D1 van Steam's NL-notatie "79,99€"
 * naar de symbool-vooraan vorm "€79,99" (zelfde stijl als USD "$69.99" en
 * GBP "£69.99"). Draait dezelfde euroSymbolFirst()-logica als
 * worker/src/cron/build-cache.js, maar dan eenmalig over alle bestaande
 * rijen i.p.v. te wachten tot de dagelijkse price-cron (150/dag, roterend)
 * ze vanzelf opnieuw schrijft.
 *
 * Ververst raw_json in D1 + game:{slug} KV. Draai daarna
 * scripts/rebuild-kv-all-months.mjs om ook de maand/tba-KV (kaartjes op de
 * homepage) bij te werken.
 *
 * Gebruik: node scripts/fix-eur-price-format.mjs
 */

import { readFileSync } from 'fs';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';

const toml  = readFileSync(
  `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`,
  'utf8'
);
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
const CF_H  = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

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

// Zelfde regel als build-cache.js: "79,99€" of "79,99 €" → "€79,99".
// Al-correcte strings ("€79,99") en "Free"/null blijven ongemoeid.
function euroSymbolFirst(str) {
  if (!str) return str;
  const m = String(str).trim().match(/^([^\s€]+)\s*€$/);
  return m ? `€${m[1]}` : str;
}

console.log('Fix EUR-prijsnotatie in D1\n');
console.log('Stap 1: actieve games met een EUR-prijs ophalen…');

const rows = await d1Query(`
  SELECT slug, raw_json
  FROM games
  WHERE status = 'active'
    AND (json_extract(raw_json, '$.price_eur') IS NOT NULL
         OR json_extract(raw_json, '$.price_initial_eur') IS NOT NULL)
`);

console.log(`  ${rows.length} games gevonden\n`);
console.log('Stap 2: normaliseren en terugschrijven…\n');

let fixed = 0;
let skipped = 0;
let errors = 0;

for (let i = 0; i < rows.length; i++) {
  const row   = rows[i];
  const entry = JSON.parse(row.raw_json || '{}');

  const newEur     = euroSymbolFirst(entry.price_eur);
  const newInitEur = euroSymbolFirst(entry.price_initial_eur);

  if (newEur === entry.price_eur && newInitEur === entry.price_initial_eur) {
    skipped++;
    continue;
  }

  entry.price_eur         = newEur;
  entry.price_initial_eur = newInitEur;
  const json = JSON.stringify(entry);

  try {
    await d1Query(`UPDATE games SET raw_json = ?1 WHERE slug = ?2`, [json, row.slug]);
    await kvPut(`game:${row.slug}`, json);
    fixed++;
    console.log(`  [${i + 1}/${rows.length}] ${(entry.title || row.slug).padEnd(40)} → ${newEur}${newInitEur ? ` (was ${newInitEur})` : ''}`);
  } catch (e) {
    errors++;
    console.error(`  [${i + 1}/${rows.length}] ${row.slug}: schrijffout — ${e.message}`);
  }
}

console.log(`\n════════════════════════════════════════════`);
console.log(`  Genormaliseerd: ${fixed}`);
console.log(`  Overgeslagen  : ${skipped} (al correct of geen EUR-prijs)`);
console.log(`  Fouten        : ${errors}`);
console.log(`════════════════════════════════════════════`);
if (fixed > 0) {
  console.log(`\nLet op: draai nu ook 'node scripts/rebuild-kv-all-months.mjs' om de`);
  console.log(`maand/TBA-KV (homepage-kaartjes) bij te werken — deze leest niet uit`);
  console.log(`game:{slug} maar heeft zijn eigen KV-snapshot per maand.`);
}
