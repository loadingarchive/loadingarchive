/**
 * tag-augdec-port-remake.mjs
 * Port/remake-classificatie voor augustus t/m december 2026 — zelfde aanpak
 * als scripts/tag-july-port-remake.mjs. Zet rerelease {date, type} +
 * manual.rerelease zodat de daily cron de tags nooit meer overschrijft,
 * en herbouwt de maand-KV's.
 *
 * Gebruik: node scripts/tag-augdec-port-remake.mjs
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

// slug → { type: 'port'|'remake', date: originele release }
const TAGS = {
  // ── AUGUSTUS ──────────────────────────────────────────────────────────────
  'kynseed':                                    { type: 'port',   date: '2022-12-06' },
  'lies-of-p-complete-edition':                 { type: 'port',   date: '2023-09-19' }, // basis + Overture bundel
  'apidya-special':                             { type: 'remake', date: '1992-01-01' }, // "pixel remake, built from the ground up"
  'metal-gear-solid-master-collection-vol-2':   { type: 'port',   date: '2008-06-12' }, // MGS4 (oudste titel in de bundel)
  'elden-ring-tarnished-edition':               { type: 'port',   date: '2022-02-25' },
  'defender-of-the-crown-the-legend-returns':   { type: 'remake', date: '1986-01-01' }, // Cinemaware-klassieker, "enhanced"

  // ── SEPTEMBER ─────────────────────────────────────────────────────────────
  'hashire-hebereke-ex':                        { type: 'remake', date: '1994-01-01' }, // "modern remake van de 1994 Super Famicom game"
  'wo-long-fallen-dynasty-complete-edition':    { type: 'port',   date: '2023-03-03' },
  'culdcept-the-first-saturn-tribute-ww':       { type: 'port',   date: '1997-01-01' }, // Saturn Tribute = geëmuleerde heruitgave
  'valheim':                                    { type: 'port',   date: '2021-02-02' },
  'touhou-koumakyou-new-classic-the-embodiment-of-scarlet-devil': { type: 'remake', date: '2002-08-11' }, // "fresh music and graphics"
  'trails-in-the-sky-2nd-chapter':              { type: 'remake', date: '2006-03-09' }, // Falcom 3D-remake van Sky SC
  'dragon-quest-xi-s-echoes-of-an-elusive-age-definitive-edition': { type: 'port', date: '2019-09-27' },
  'gothic-ii-complete-classic':                 { type: 'port',   date: '2002-11-29' },
  'dynasty-warriors-3-complete-edition-remastered': { type: 'remake', date: '2001-02-22' }, // "A remake of DYNASTY WARRIORS 3"
  'runescape-dragonwilds':                      { type: 'port',   date: '2025-04-15' }, // 1.0/console na PC early access
  'dune-awakening':                             { type: 'port',   date: '2025-06-10' }, // console-release na PC

  // ── OKTOBER ───────────────────────────────────────────────────────────────
  'rayman-legends-retold':                      { type: 'remake', date: '2013-08-29' },
  'muchi-muchi-pork-pinksweets-boosted':        { type: 'port',   date: '2007-01-01' },
  'earth-defense-force-5':                      { type: 'port',   date: '2017-12-07' },
  'kingdom-hearts-collection-i-iii':            { type: 'port',   date: '2002-03-28' }, // bundel van bestaande remasters
  'dragons-dogma-2-dark-arisen':                { type: 'port',   date: '2024-03-22' }, // uitgebreide heruitgave
  'toy-story-3-complete-edition':               { type: 'port',   date: '2010-06-15' },
  'tales-of-eternia-remastered':                { type: 'remake', date: '2000-11-27' }, // "remastered edition"
  'azure-striker-gunvolt-trilogy-enhanced-nintendo-switch-2-edition': { type: 'port', date: '2014-08-20' },
  'cotton-reboot':                              { type: 'remake', date: '1991-01-01' }, // "completely remastered version of Cotton" (1991)
  'nintendo-switch-sports-resort':              { type: 'port',   date: '2009-06-25' }, // eerdere curatie: Wii Sports Resort
  'steins-gate-re-boot-ww':                     { type: 'remake', date: '2009-10-15' },
  'no-rest-for-the-wicked':                     { type: 'port',   date: '2024-04-18' }, // 1.0/console na PC early access
  'godzilla-destroy-all-monsters-melee-remastered': { type: 'remake', date: '2002-10-08' },

  // ── NOVEMBER ──────────────────────────────────────────────────────────────
  'metaphor-refantazio':                        { type: 'port',   date: '2024-10-11' },
  'gothic-3-classic':                           { type: 'port',   date: '2006-10-13' },

  // ── DECEMBER ──────────────────────────────────────────────────────────────
  'xenoblade-chronicles-3-nintendo-switch-2-edition': { type: 'port', date: '2022-07-29' },
};

const rows = await d1Query(`
  SELECT slug, name, raw_json FROM games
  WHERE status = 'active' AND release_date >= '2026-08-01' AND release_date <= '2026-12-31'
`);
const bySlug = new Map(rows.map(r => [r.slug, r]));

console.log(`\nAug–Dec 2026: port/remake classificatie — ${Object.keys(TAGS).length} games\n`);
let ok = 0, notFound = 0;
const touchedMonths = new Set();

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
  g.manual.rerelease = true;

  const json = JSON.stringify(g);
  await d1Query(`UPDATE games SET raw_json = ?1, last_updated = ?2 WHERE slug = ?3`,
    [json, new Date().toISOString(), slug]);
  await kvPut(`game:${slug}`, json);
  if (g.date) touchedMonths.add(g.date.slice(0, 7));
  console.log(`  ✓ ${(g.title || row.name).padEnd(62)} ${tag.type.toUpperCase().padEnd(7)} orig. ${tag.date}`);
  ok++;
}

// Herbouw de maand-KV's van alle geraakte maanden
for (const month of [...touchedMonths].sort()) {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const monthRows = await d1Query(
    `SELECT raw_json FROM games WHERE status='active' AND release_date >= ?1 AND release_date <= ?2 ORDER BY release_date ASC`,
    [`${month}-01`, `${month}-${String(lastDay).padStart(2, '0')}`]);
  const results = monthRows.map(r => JSON.parse(r.raw_json));
  await kvPut(`games:${month}`, JSON.stringify({ results, generatedAt: new Date().toISOString() }));
  const p = results.filter(g => g.rerelease?.type === 'port').length;
  const r = results.filter(g => g.rerelease?.type === 'remake').length;
  console.log(`  → games:${month} KV herbouwd (${results.length} games, ${p} ports, ${r} remakes)`);
}

console.log(`\n  Getagd: ${ok}  |  Niet gevonden: ${notFound}\n`);
