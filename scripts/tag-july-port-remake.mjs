/**
 * tag-july-port-remake.mjs
 * Classificeert July 2026 rerelease/port-achtige games als 'port' (zelfde
 * assets, alleen nieuw platform) of 'remake' (visueel/technisch herbouwd) en
 * zet rerelease.type + manual.rerelease zodat de daily cron dit nooit meer
 * overschrijft (zie merge.js saveGameToD1 manual-override systeem).
 *
 * Gebruik: node scripts/tag-july-port-remake.mjs
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

// slug → { type, date }. date = originele releasedatum van de game/franchise-entry.
const TAGS = {
  // ── REMAKE — visueel/technisch herbouwd, niet alleen een nieuw platform ──
  '70s-style-robot-anime-geppy-x':              { type: 'remake', date: '1999-01-01' }, // "fully remastered... reborn in HD"
  'assassins-creed-back-flag-resynced':         { type: 'remake', date: '2013-10-29' }, // beschrijving noemt expliciet "remake"
  'backyard-baseball':                          { type: 'remake', date: '1997-10-31' }, // volledig herbouwde revival, geen kale port
  'final-fantasy-x-x-2-hd-remaster':            { type: 'remake', date: '2013-12-26' }, // titel: "HD Remaster"
  'halo-campaign-evolved':                      { type: 'remake', date: '2001-11-15' }, // ground-up remake van Halo: Combat Evolved

  // ── PORT — zelfde game, nieuw platform (evt. bundling/QoL, geen remake) ──
  'gunvolt-chronicles-luminous-avenger-ix-1-2-dual-collection': { type: 'port', date: '2020-10-29' }, // compilatie + balans, geen remake
  'palworld':                                   { type: 'port', date: '2024-01-19' },
  'go-go-town':                                 { type: 'port', date: '2024-03-26' },
  'cultic':                                     { type: 'port', date: '2022-10-13' },
  'gothic-classic':                             { type: 'port', date: '2001-03-15' }, // "Classic" = ongewijzigde re-release, geen remake (die bestaat apart)
  'bloodrayne-definitive-collection':           { type: 'port', date: '2002-10-31' }, // Ziggurat-heruitgave, modernisatie geen remake
  'truxton-extreme':                            { type: 'port', date: '1988-01-01' }, // arcade-port met extra content
  'exstetra':                                   { type: 'port', date: '2013-10-31' },
  'xenoblade-chronicles-2-nintendo-switch-2-edition': { type: 'port', date: '2017-12-01' }, // Nintendo's "Switch 2 Edition" = performance-upgrade, geen remake
  'forever-skies':                              { type: 'port', date: '2023-06-22' },
  'blue-reflection-quartet':                    { type: 'port', date: '2017-03-23' }, // trilogie-compilatie, eerste keer op Nintendo
  'granblue-fantasy-relink-endless-ragnarok':   { type: 'port', date: '2024-02-01' }, // eerste keer op Nintendo Switch 2 (was PC/PS4/PS5)
};

const rows = await d1Query(`
  SELECT slug, name, raw_json FROM games
  WHERE status = 'active' AND release_date >= '2026-07-01' AND release_date <= '2026-07-31'
`);
const bySlug = new Map(rows.map(r => [r.slug, r]));

console.log(`\nJuly 2026: port/remake classificatie — ${Object.keys(TAGS).length} games\n`);
let ok = 0, notFound = 0;

for (const [slug, tag] of Object.entries(TAGS)) {
  const row = bySlug.get(slug);
  if (!row) {
    console.log(`  ✗ NIET GEVONDEN: ${slug}`);
    notFound++;
    continue;
  }

  const g = JSON.parse(row.raw_json || '{}');
  g.rerelease = { date: tag.date, type: tag.type };
  g.manual = g.manual || {};
  g.manual.rerelease = true; // overleeft de daily cron vanaf nu

  const json = JSON.stringify(g);
  await d1Query(`UPDATE games SET raw_json = ?1, last_updated = ?2 WHERE slug = ?3`,
    [json, new Date().toISOString(), slug]);
  await kvPut(`game:${slug}`, json);
  console.log(`  ✓ ${(g.title || row.name).padEnd(55)} ${tag.type.toUpperCase().padEnd(7)} orig. ${tag.date}`);
  ok++;
}

// Rebuild games:2026-07 KV
const allRows = await d1Query(`
  SELECT raw_json FROM games
  WHERE status = 'active' AND release_date >= '2026-07-01' AND release_date <= '2026-07-31'
  ORDER BY release_date ASC
`);
const results = allRows.map(r => JSON.parse(r.raw_json));
await kvPut('games:2026-07', JSON.stringify({ results, generatedAt: new Date().toISOString() }));

const ports   = results.filter(g => g.rerelease?.type === 'port').length;
const remakes = results.filter(g => g.rerelease?.type === 'remake').length;
console.log(`\n  Getagd: ${ok}  |  Niet gevonden: ${notFound}`);
console.log(`  games:2026-07 KV herbouwd (${results.length} games, ${ports} ports, ${remakes} remakes)`);
