/**
 * Eenmalige reparatie: maanden waarvan de KV-games GEEN slug hebben.
 * Genereert slugs vanuit de bestaande data, schrijft game:{slug} KV
 * en upsert naar D1 — zonder RAWG/Steam API-aanroepen.
 *
 * Gebruik: node scripts/repair-missing-slugs.mjs
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

const KV_NAMESPACE_ID = 'cccc2aea7c3c44379b6fe07a28e06bff';
const ACCOUNT_ID      = '651cb8c006e468c78e9ba255dd28b7cb';
const D1_DB_NAME      = 'loadingarchive_games';

// Maanden met games zonder slug — bepaald door analyse
const TARGET_MONTHS   = ['2026-02','2026-03','2026-04','2026-09','2026-10','2026-11','2026-12'];

function getWranglerToken() {
  try {
    const cfgPath = path.join(
      process.env.APPDATA || process.env.HOME,
      'xdg.config', '.wrangler', 'config', 'default.toml'
    );
    const toml = readFileSync(cfgPath, 'utf8');
    return toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  } catch { return null; }
}

const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? getWranglerToken();
const CF_HEADERS = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

// Slug-generatie: identiek aan utils.js
function generateSlug(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[®™©''''']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

async function kvGet(key) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  const r = await fetch(url, { headers: CF_HEADERS });
  if (!r.ok) { console.warn(`  KV get mislukt voor "${key}": ${r.status}`); return null; }
  return r.text();
}

async function kvPut(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${TOKEN}` },
    body: value,
  });
  if (!r.ok) console.warn(`  KV put mislukt voor "${key}": ${r.status}`);
}

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function entryToSql(g, now) {
  const platforms   = esc(JSON.stringify(g.platforms    || []));
  const screenshots = esc(JSON.stringify(g.screenshots  || []));
  const metacritic  = g.metacritic ? esc(JSON.stringify(g.metacritic)) : 'NULL';
  const reqs        = (g.pc_requirements?.minimum || g.pc_requirements?.recommended)
    ? esc(JSON.stringify(g.pc_requirements)) : 'NULL';
  const rawJson = esc(JSON.stringify(g));
  return `INSERT INTO games
    (slug, rawg_id, name, release_date, platforms, cover_image, steam_appid,
     short_description, price, metacritic, screenshots, requirements,
     status, first_seen, last_seen, last_updated, raw_json)
  VALUES
    (${esc(g.slug)}, ${esc(g.id ?? null)}, ${esc(g.title)}, ${esc(g.date ?? null)},
     ${platforms}, ${esc(g.cover ?? null)}, ${esc(g.steam ?? null)},
     ${esc(g.short_description ?? null)}, ${esc(g.price ?? null)},
     ${metacritic}, ${screenshots}, ${reqs},
     'active', ${esc(now)}, ${esc(now)}, ${esc(now)}, ${rawJson})
  ON CONFLICT(slug) DO UPDATE SET
    rawg_id           = excluded.rawg_id,
    name              = excluded.name,
    release_date      = excluded.release_date,
    platforms         = excluded.platforms,
    cover_image       = excluded.cover_image,
    steam_appid       = excluded.steam_appid,
    short_description = excluded.short_description,
    price             = excluded.price,
    metacritic        = excluded.metacritic,
    screenshots       = excluded.screenshots,
    requirements      = excluded.requirements,
    status            = 'active',
    last_seen         = excluded.last_seen,
    last_updated      = excluded.last_updated,
    raw_json          = excluded.raw_json;`;
}

function runD1SqlSync(sql) {
  const tmpDir  = path.join(ROOT, '.wrangler', 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `repair-${Date.now()}.sql`);
  writeFileSync(tmpPath, sql, 'utf8');
  try {
    execSync(`npx wrangler d1 execute ${D1_DB_NAME} --remote --file "${tmpPath}"`, {
      cwd: ROOT, stdio: 'pipe'
    });
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}

async function main() {
  const now = new Date().toISOString();
  console.log('=== Reparatie: maanden zonder slug ===\n');

  // Haal bestaande slugs op uit D1 om conflicten te detecteren
  const existingResult = execSync(
    `npx wrangler d1 execute ${D1_DB_NAME} --remote --command "SELECT slug FROM games" --json`,
    { cwd: ROOT }
  );
  const existingJson = JSON.parse(existingResult.toString());
  const existingSlugs = new Set(existingJson[0]?.results?.map(r => r.slug) ?? []);
  console.log(`D1 bevat ${existingSlugs.size} bestaande slugs\n`);

  let totalFixed = 0;
  const usedSlugs = new Set(existingSlugs);

  for (const month of TARGET_MONTHS) {
    console.log(`Verwerk ${month}...`);
    const raw = await kvGet(`games:${month}`);
    if (!raw) { console.log(`  Geen KV-data voor ${month}`); continue; }

    const data = JSON.parse(raw);
    const games = data.results ?? [];
    const noSlug = games.filter(g => !g.slug);
    console.log(`  ${games.length} games, ${noSlug.length} zonder slug`);
    if (noSlug.length === 0) continue;

    const sqlStmts = [];
    const kvPuts   = [];

    for (const g of noSlug) {
      // Genereer unieke slug
      const base = generateSlug(g.title);
      const year = g.date ? g.date.slice(0, 4) : 'tba';
      const mon  = g.date ? g.date.slice(5, 7)  : 'tba';
      let slug = base;
      if (usedSlugs.has(slug)) slug = `${base}-${year}`;
      if (usedSlugs.has(slug)) slug = `${base}-${year}-${mon}`;
      if (usedSlugs.has(slug)) slug = `${base}-${g.id ?? Math.random().toString(36).slice(2)}`;
      usedSlugs.add(slug);

      const entry = { ...g, slug };
      sqlStmts.push(entryToSql(entry, now));
      kvPuts.push({ key: `game:${slug}`, value: JSON.stringify(entry) });
      process.stdout.write(`  + ${slug}\n`);
    }

    // D1 upsert
    if (sqlStmts.length > 0) {
      runD1SqlSync(sqlStmts.join('\n'));
    }

    // KV game:{slug} records
    for (const kv of kvPuts) {
      await kvPut(kv.key, kv.value);
    }

    // Herbouw maand-KV met slugs
    const updated = games.map(g => {
      if (g.slug) return g;
      // Zoek het juist gegenereerde slug terug
      const base = generateSlug(g.title);
      const generated = kvPuts.find(kv => {
        const parsed = JSON.parse(kv.value);
        return parsed.title === g.title && parsed.date === g.date;
      });
      return generated ? JSON.parse(generated.value) : g;
    });
    const monthPayload = JSON.stringify({ results: updated, generatedAt: now });
    await kvPut(`games:${month}`, monthPayload);
    console.log(`  ✓ ${noSlug.length} games gerepareerd → D1 + KV`);
    totalFixed += noSlug.length;
  }

  console.log(`\nKlaar: ${totalFixed} games gerepareerd over ${TARGET_MONTHS.length} maanden.`);

  // Telling
  const count = execSync(
    `npx wrangler d1 execute ${D1_DB_NAME} --remote --command "SELECT status, COUNT(*) as n FROM games GROUP BY status" --json`,
    { cwd: ROOT }
  );
  console.log('\nD1 telling:', JSON.parse(count.toString())[0]?.results);
}

main().catch(e => { console.error(e); process.exit(1); });
