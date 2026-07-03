/**
 * tag-ports-july.mjs
 * Voegt rerelease tag toe aan July 2026 games die ports zijn.
 * Gebruik: node scripts/tag-ports-july.mjs
 */

import { readFileSync } from 'fs';
import path from 'path';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';
const toml  = readFileSync(path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'), 'utf8');
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
const CF_H  = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function d1Query(sql, params = []) {
  const body = params.length ? { sql, params } : { sql };
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify(body) });
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

// slug → originele release datum
const PORTS = {
  '70s-style-robot-anime-geppy-x':                          '1999-01-01',
  'assassins-creed-back-flag-resynced':                     '2013-10-29',
  'gunvolt-chronicles-luminous-avenger-ix-1-2-dual-collection': '2020-10-29',
  'palworld':                                               '2024-01-19',
  'go-go-town':                                             '2024-03-26',
  'cultic':                                                 '2022-10-13',
  'final-fantasy-x-x-2-hd-remaster':                       '2013-12-26',
  'gothic-classic':                                         '2001-03-15',
  'bloodrayne-definitive-collection':                       '2002-10-31',
  'truxton-extreme':                                        '1988-01-01',
  'exstetra':                                               '2013-10-31',
  'xenoblade-chronicles-2-nintendo-switch-2-edition':       '2017-12-01',
  'forever-skies':                                          '2023-06-22',
};

// Haal alle July games op
const rows = await d1Query(`
  SELECT slug, name, release_date, raw_json
  FROM games
  WHERE status = 'active' AND release_date >= '2026-07-01' AND release_date <= '2026-07-31'
`);

// Bouw een map slug → row
const bySlug = new Map(rows.map(r => [r.slug, r]));

console.log(`\nPort tags toevoegen — ${Object.keys(PORTS).length} games\n`);

let ok = 0, notFound = 0;

for (const [slugPattern, origDate] of Object.entries(PORTS)) {
  // Zoek de slug (exact of gedeeltelijke match)
  let row = bySlug.get(slugPattern);
  if (!row) {
    // Probeer gedeeltelijke match
    row = rows.find(r => r.slug.includes(slugPattern) || slugPattern.includes(r.slug));
  }
  if (!row) {
    // Probeer op naam
    row = rows.find(r => {
      const s = slugPattern.replace(/-/g, ' ').toLowerCase();
      return (r.name || '').toLowerCase().includes(s.slice(0, 10));
    });
  }

  if (!row) {
    console.log(`  ✗ NIET GEVONDEN: ${slugPattern}`);
    notFound++;
    continue;
  }

  const g = JSON.parse(row.raw_json || '{}');
  const was = g.rerelease ? `was al: ${g.rerelease.date}` : 'nieuw';
  g.rerelease = { date: origDate };

  const json = JSON.stringify(g);
  try {
    await d1Query(`UPDATE games SET raw_json = ?1, last_updated = ?2 WHERE slug = ?3`,
      [json, new Date().toISOString(), row.slug]);
    await kvPut(`game:${row.slug}`, json);
    console.log(`  ✓ ${(g.title || row.name).padEnd(55)} orig. ${origDate}  (${was})`);
    ok++;
  } catch (e) {
    console.error(`  ✗ Fout bij ${row.slug}: ${e.message}`);
  }
}

console.log(`\n  Getagd: ${ok}  |  Niet gevonden: ${notFound}\n`);

// Toon eindresultaat
const updated = await d1Query(`
  SELECT slug, name, raw_json FROM games
  WHERE status='active' AND release_date >= '2026-07-01' AND release_date <= '2026-07-31'
`);
const ports = updated.filter(r => JSON.parse(r.raw_json||'{}').rerelease);
console.log(`Juli ports nu getagd: ${ports.length}`);
ports.forEach(r => {
  const g = JSON.parse(r.raw_json);
  console.log(`  • ${(g.title||r.name).padEnd(55)} → orig. ${g.rerelease.date}`);
});
