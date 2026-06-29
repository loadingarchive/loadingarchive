/**
 * nintendo-cover-backfill.mjs
 * Zoekt Nintendo cover images voor alle NS/NS2 games in D1 die nog geen cover hebben.
 * Gebruikt de Nintendo Europa search API.
 *
 * Gebruik: node scripts/nintendo-cover-backfill.mjs
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';
const EU_SEARCH = "https://search.nintendo-europe.com/en/select";

const toml  = readFileSync(
  path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'),
  'utf8'
);
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
const CF_H  = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

function normalizeTitle(t) {
  return (t || "").toLowerCase().replace(/[®™©]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[b.length];
}

function titlesAreCloseEnough(a, b) {
  if (a === b) return true;
  if (a.length < 10 || b.length < 10) return false;
  const threshold = Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.1));
  return levenshtein(a, b) <= threshold;
}

async function d1(sql) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify({ sql }) }
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result[0].results;
}

async function kvPut(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`;
  const r = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${TOKEN}` }, body: value });
  if (!r.ok) console.warn(`  KV PUT mislukt voor ${key}: ${r.status}`);
}

async function fetchNintendoCover(title) {
  const url = `${EU_SEARCH}?q=${encodeURIComponent(title)}&fq=type%3AGAME&start=0&rows=5&wt=json&fl=title,image_url_h16x9_s,nsuid_txt,system_type`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    const docs = data.response?.docs || [];
    const key = normalizeTitle(title);
    const match = docs.find(d => {
      const k = normalizeTitle(d.title || "");
      return k === key || titlesAreCloseEnough(key, k);
    });
    return match?.image_url_h16x9_s || null;
  } catch {
    return null;
  }
}

// Haal alle actieve NS/NS2 games op zonder cover
const rows = await d1(`
  SELECT slug, name, raw_json FROM games
  WHERE status = 'active'
    AND cover_image IS NULL
    AND (platforms LIKE '%"NS"%' OR platforms LIKE '%"NS2"%')
  ORDER BY release_date
`);

console.log(`${rows.length} NS/NS2 games gevonden zonder cover\n`);

let updated = 0;
const affectedMonths = new Set();

for (const row of rows) {
  const game = JSON.parse(row.raw_json);
  const cover = await fetchNintendoCover(game.title);

  if (!cover) {
    console.log(`  NIET GEVONDEN: ${game.title}`);
    continue;
  }

  console.log(`  ✓ ${game.title}`);
  console.log(`    ${cover}`);

  // Update D1 — cover_image kolom + raw_json met cover veld
  const updatedGame = { ...game, cover };
  const escapedJson = JSON.stringify(updatedGame).replace(/'/g, "''");
  await d1(`UPDATE games SET cover_image = '${cover.replace(/'/g, "''")}', raw_json = '${escapedJson}' WHERE slug = '${row.slug.replace(/'/g, "''")}'`);

  // Bijhouden welke maanden we moeten vernieuwen
  if (game.date) {
    affectedMonths.add(game.date.slice(0, 7));
  } else {
    affectedMonths.add('tba');
  }

  updated++;

  // Kleine vertraging om API niet te overladen
  await new Promise(r => setTimeout(r, 300));
}

console.log(`\n${updated} van ${rows.length} games bijgewerkt met Nintendo cover`);

if (updated === 0) {
  console.log('Geen KV updates nodig.');
  process.exit(0);
}

// Herbouw KV voor de betreffende maanden
console.log('\nKV caches herbouwen...');
const ts = new Date().toISOString();

for (const monthKey of affectedMonths) {
  if (monthKey === 'tba') {
    const tbaRows = await d1(`SELECT raw_json FROM games WHERE status='active' AND release_date IS NULL ORDER BY name`);
    const tbaGames = tbaRows.map(r => JSON.parse(r.raw_json));
    await kvPut('games:tba', JSON.stringify({ results: tbaGames, generatedAt: ts }));
    console.log(`  games:tba → ${tbaGames.length} games`);
  } else {
    const [y, m] = monthKey.split('-');
    const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
    const from = `${monthKey}-01`;
    const to   = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
    const kvKey = `games:${monthKey}`;
    const monthRows = await d1(`SELECT raw_json FROM games WHERE status='active' AND release_date >= '${from}' AND release_date <= '${to}' ORDER BY release_date`);
    const games = monthRows.map(r => JSON.parse(r.raw_json));
    await kvPut(kvKey, JSON.stringify({ results: games, generatedAt: ts }));
    console.log(`  ${kvKey} → ${games.length} games`);
  }
}

console.log('\nKlaar!');
