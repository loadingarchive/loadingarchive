/**
 * Eenmalige migratie: alle game:{slug} records uit KV → D1.
 * Draait als: node scripts/kv-to-d1.mjs
 *
 * Vereist: CLOUDFLARE_API_TOKEN en CLOUDFLARE_ACCOUNT_ID als env-vars,
 * of leest ze uit wrangler config via --token / --account-id flags.
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

// --- Config ---
const KV_NAMESPACE_ID = 'cccc2aea7c3c44379b6fe07a28e06bff';
const ACCOUNT_ID      = '651cb8c006e468c78e9ba255dd28b7cb';
const D1_DB_NAME      = 'loadingarchive_games';
const BATCH_SIZE      = 50; // D1-inserts per batch

// Haal het OAuth-token op uit de wrangler config.
function getWranglerToken() {
  try {
    const cfgPath = path.join(
      process.env.APPDATA || process.env.HOME,
      'xdg.config', '.wrangler', 'config', 'default.toml'
    );
    const toml = readFileSync(cfgPath, 'utf8');
    const m = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m);
    return m?.[1] ?? null;
  } catch { return null; }
}

const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? getWranglerToken();
if (!TOKEN) {
  console.error('Geen Cloudflare API-token gevonden. Stel CLOUDFLARE_API_TOKEN in.');
  process.exit(1);
}

const CF_HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type':  'application/json',
};

// --- KV helpers ---
async function kvListKeys(cursor = null) {
  const params = new URLSearchParams({ prefix: 'game:', limit: '1000' });
  if (cursor) params.set('cursor', cursor);
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys?${params}`;
  const r = await fetch(url, { headers: CF_HEADERS });
  if (!r.ok) throw new Error(`KV list failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function kvGetValue(key) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  const r = await fetch(url, { headers: CF_HEADERS });
  if (!r.ok) { console.warn(`  KV get mislukt voor "${key}": ${r.status}`); return null; }
  return r.text();
}

// --- SQL helpers ---
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function gameToSql(slug, g, now) {
  const platforms    = esc(JSON.stringify(g.platforms    || []));
  const screenshots  = esc(JSON.stringify(g.screenshots  || []));
  const metacritic   = g.metacritic   ? esc(JSON.stringify(g.metacritic)) : 'NULL';
  const requirements = (g.pc_requirements?.minimum || g.pc_requirements?.recommended)
    ? esc(JSON.stringify(g.pc_requirements))
    : 'NULL';
  const rawJson = esc(JSON.stringify(g));

  return `INSERT INTO games
    (slug, rawg_id, name, release_date, platforms, cover_image, steam_appid,
     short_description, price, metacritic, screenshots, requirements, age_rating,
     status, first_seen, last_seen, last_updated, raw_json)
  VALUES
    (${esc(slug)}, ${esc(g.id ?? null)}, ${esc(g.title)}, ${esc(g.date ?? null)},
     ${platforms}, ${esc(g.cover ?? null)}, ${esc(g.steam ?? null)},
     ${esc(g.short_description ?? null)}, ${esc(g.price ?? null)},
     ${metacritic}, ${screenshots}, ${requirements}, NULL,
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

function runD1Sql(sql) {
  // Schrijf naar temp-bestand zodat we lange SQL-strings veilig kunnen doorgeven.
  const tmpPath = path.join(ROOT, '.wrangler', 'tmp', `migrate-${Date.now()}.sql`);
  import('fs').then(({ writeFileSync, unlinkSync }) => {
    writeFileSync(tmpPath, sql, 'utf8');
    execSync(`npx wrangler d1 execute ${D1_DB_NAME} --remote --file "${tmpPath}"`, {
      cwd: ROOT, stdio: 'pipe'
    });
    try { unlinkSync(tmpPath); } catch {}
  });
}

// Synchrone versie — we gebruiken child_process voor D1-schrijven.
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';

function runD1SqlSync(sql) {
  const tmpDir  = path.join(ROOT, '.wrangler', 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `migrate-${Date.now()}.sql`);
  writeFileSync(tmpPath, sql, 'utf8');
  try {
    execSync(`npx wrangler d1 execute ${D1_DB_NAME} --remote --file "${tmpPath}"`, {
      cwd: ROOT, stdio: 'inherit'
    });
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}

// --- Hoofdprogramma ---
async function main() {
  const now = new Date().toISOString();
  console.log('=== KV → D1 migratie ===');

  // 1. Verzamel alle game:-sleutels uit KV
  const allKeys = [];
  let cursor = null;
  do {
    const resp = await kvListKeys(cursor);
    allKeys.push(...(resp.result ?? []).map(k => k.name));
    cursor = resp.result_info?.cursor ?? null;
  } while (cursor);
  console.log(`Gevonden: ${allKeys.length} game:-sleutels in KV`);

  // 2. Haal waarden op en bouw SQL-batches
  let inserted = 0, skipped = 0;
  const batches = [];
  let batch = [];

  for (let i = 0; i < allKeys.length; i++) {
    const key  = allKeys[i];
    const slug = key.replace(/^game:/, '');
    process.stdout.write(`  [${i + 1}/${allKeys.length}] ${slug} ...`);

    const raw = await kvGetValue(key);
    if (!raw) { process.stdout.write(' SKIP\n'); skipped++; continue; }

    let g;
    try { g = JSON.parse(raw); } catch { process.stdout.write(' PARSE-ERR\n'); skipped++; continue; }

    batch.push(gameToSql(slug, g, now));
    process.stdout.write(' OK\n');
    inserted++;

    if (batch.length >= BATCH_SIZE) {
      batches.push(batch.join('\n'));
      batch = [];
    }
  }
  if (batch.length) batches.push(batch.join('\n'));

  console.log(`\nInsert in D1 (${batches.length} batches)...`);
  for (let b = 0; b < batches.length; b++) {
    console.log(`  Batch ${b + 1}/${batches.length}`);
    runD1SqlSync(batches[b]);
  }

  console.log(`\nKlaar: ${inserted} records → D1, ${skipped} overgeslagen.`);

  // 3. Telcontrole
  console.log('\nTelling uit D1:');
  execSync(`npx wrangler d1 execute ${D1_DB_NAME} --remote --command "SELECT status, COUNT(*) as n FROM games GROUP BY status"`, {
    cwd: ROOT, stdio: 'inherit'
  });
}

main().catch(e => { console.error(e); process.exit(1); });
