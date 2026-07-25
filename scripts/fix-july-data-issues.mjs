/**
 * fix-july-data-issues.mjs
 * Eenmalige opschoning van twee databugs gevonden tijdens een design-review:
 *
 * 1. call-of-duty-black-ops: genre/dev bevatten een letterlijk
 *    "rowspan=\"2\" | ..." wikitext-artefact (bug in cleanWikitext, los
 *    gefixed in worker/src/pipeline/wikipedia.js + scripts/scrape-wikipedia.mjs).
 *    Dit script strip hetzelfde patroon uit de al opgeslagen D1-rij + de
 *    config:extra-games KV-cache (anders overschrijft de dagelijkse cron het
 *    weer met de nog-vervuilde KV-waarde vóór de eerstvolgende wiki-scrape).
 *
 * 2. assassins-creed-back-flag-resynced / assassins-creed-black-flag-resynced:
 *    hetzelfde spel, twee records. De RAWG-bron heeft de rijkere data (cover,
 *    screenshots, Steam-koppeling, Remake-badge) maar een titel-typo ("Back"
 *    i.p.v. "Black"); de wiki-bron heeft de juiste titel maar is verder leeg.
 *    Titel wordt gefixed + vergrendeld (manual.title), de lege wiki-duplicaat
 *    wordt verborgen én op de blocklist gezet (anders komt hij via de
 *    dagelijkse cron terug, zoals eerder bij "Royale Battle").
 *
 * Gebruik: node scripts/fix-july-data-issues.mjs
 */

import { readFileSync } from 'fs';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';

const toml  = readFileSync(`${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`, 'utf8');
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

async function kvGet(key) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`,
    { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`KV GET ${key}: ${r.status}`);
  return r.json();
}

async function kvPut(key, value) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: { 'Authorization': `Bearer ${TOKEN}` }, body: value });
  if (!r.ok) throw new Error(`KV PUT ${key}: ${r.status}`);
}

async function rebuildMonthKv(month) {
  const rows = await d1Query(
    `SELECT raw_json FROM games WHERE status='active' AND release_date >= ?1 AND release_date <= ?2 ORDER BY release_date`,
    [`${month}-01`, `${month}-31`]);
  await kvPut(`games:${month}`, JSON.stringify({ results: rows.map(r => JSON.parse(r.raw_json)), generatedAt: new Date().toISOString() }));
  console.log(`  games:${month} KV herbouwd (${rows.length} games)`);
}

const stripRowspan = s => (s || '').replace(/rowspan="\d+"\s*\|\s*/g, '').trim();

console.log('Stap 1: Call of Duty: Black Ops — rowspan-artefact uit genre/dev strippen\n');
{
  const [row] = await d1Query(`SELECT slug, raw_json FROM games WHERE slug = 'call-of-duty-black-ops'`);
  if (!row) {
    console.log('  niet gevonden, overslaan');
  } else {
    const game = JSON.parse(row.raw_json);
    game.genre = game.genre.map(stripRowspan);
    game.dev   = stripRowspan(game.dev);
    const json = JSON.stringify(game);
    await d1Query(`UPDATE games SET raw_json = ?1, last_updated = ?2 WHERE slug = ?3`, [json, new Date().toISOString(), row.slug]);
    await kvPut(`game:${row.slug}`, json);
    console.log(`  ✓ genre=${JSON.stringify(game.genre)} dev="${game.dev}"`);
  }

  // Zelfde fix in de config:extra-games KV, anders overschrijft de volgende
  // dagelijkse cron dit record weer vanuit de nog-vervuilde cache.
  const extra = await kvGet('config:extra-games');
  const entry = (extra.games || []).find(g => g.id === 'wiki-call-of-duty-black-ops');
  if (entry) {
    entry.genre = entry.genre.map(stripRowspan);
    entry.dev   = stripRowspan(entry.dev);
    await kvPut('config:extra-games', JSON.stringify(extra));
    console.log('  ✓ config:extra-games KV bijgewerkt');
  }
}

console.log('\nStap 2: Assassin\'s Creed titel-typo + duplicaat\n');
{
  const RICH_SLUG = 'assassins-creed-back-flag-resynced';
  const THIN_SLUG = 'assassins-creed-black-flag-resynced';
  const CORRECT_TITLE = "Assassin's Creed Black Flag Resynced";

  const [rich] = await d1Query(`SELECT slug, raw_json FROM games WHERE slug = ?`, [RICH_SLUG]);
  if (rich) {
    const game = JSON.parse(rich.raw_json);
    game.title = CORRECT_TITLE;
    game.manual = { ...(game.manual || {}), title: true };
    const json = JSON.stringify(game);
    await d1Query(`UPDATE games SET raw_json = ?1, name = ?2, last_updated = ?3 WHERE slug = ?4`,
      [json, CORRECT_TITLE, new Date().toISOString(), RICH_SLUG]);
    await kvPut(`game:${RICH_SLUG}`, json);
    console.log(`  ✓ ${RICH_SLUG}: titel gefixed + vergrendeld (manual.title)`);
  } else {
    console.log(`  ✗ ${RICH_SLUG} niet gevonden`);
  }

  const [thin] = await d1Query(`SELECT slug FROM games WHERE slug = ? AND status = 'active'`, [THIN_SLUG]);
  if (thin) {
    await d1Query(`UPDATE games SET status = 'hidden', last_updated = ?1 WHERE slug = ?2`, [new Date().toISOString(), THIN_SLUG]);
    // KV delete via PUT-with-empty is niet beschikbaar hier; gebruik DELETE endpoint.
    const delRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent('game:' + THIN_SLUG)}`,
      { method: 'DELETE', headers: { 'Authorization': `Bearer ${TOKEN}` } });
    console.log(`  ✓ ${THIN_SLUG}: verborgen (status=hidden) + game:${THIN_SLUG} KV verwijderd (${delRes.status})`);
  } else {
    console.log(`  ${THIN_SLUG} was al niet actief, overslaan`);
  }
}

console.log('\nStap 3: juli-KV herbouwen\n');
await rebuildMonthKv('2026-07');

console.log('\nKlaar.');
