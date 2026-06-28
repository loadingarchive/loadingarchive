import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT  = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB    = 'loadingarchive_games';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';
const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';

const toml  = readFileSync(path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'), 'utf8');
const token = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];

const rawOut  = execSync(
  `npx wrangler d1 execute ${DB} --remote --command "SELECT slug, rawg_id, name, raw_json FROM games WHERE slug = '' OR slug LIKE '-%'" --json`,
  { cwd: ROOT }
).toString();
const records = JSON.parse(rawOut)[0].results;
console.log(`${records.length} records te repareren\n`);

for (const rec of records) {
  const rawSlug = (rec.rawg_id || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+$/, '')
    .replace(/^-+/, '');
  const newSlug = rawSlug || 'unknown';

  const entry  = JSON.parse(rec.raw_json);
  entry.slug   = newSlug;
  const newJson = JSON.stringify(entry);
  const esc     = s => String(s).replace(/'/g, "''");

  console.log(`"${rec.name}" : "${rec.slug}" → "${newSlug}"`);

  // D1 UPDATE
  const sql     = `UPDATE games SET slug = '${esc(newSlug)}', raw_json = '${esc(newJson)}' WHERE slug = '${esc(rec.slug)}';`;
  const tmpDir  = path.join(ROOT, '.wrangler', 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `fix-slug-${Date.now()}.sql`);
  writeFileSync(tmpPath, sql, 'utf8');
  execSync(`npx wrangler d1 execute ${DB} --remote --file "${tmpPath}"`, { cwd: ROOT, stdio: 'pipe' });
  unlinkSync(tmpPath);

  // KV: schrijf nieuw game:{newSlug}
  const putUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent('game:' + newSlug)}`;
  const pr = await fetch(putUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: newJson });
  if (!pr.ok) console.warn(`  KV PUT mislukt: ${pr.status}`);

  // KV: verwijder oud record
  const oldKey  = 'game:' + rec.slug;
  const delUrl  = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(oldKey)}`;
  await fetch(delUrl, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });

  console.log(`  ✓ D1 + KV klaar`);
}

// Verificatie
const v   = execSync(
  `npx wrangler d1 execute ${DB} --remote --command "SELECT slug, name FROM games WHERE slug = '' OR slug LIKE '-%'" --json`,
  { cwd: ROOT }
).toString();
const rem = JSON.parse(v)[0].results;
console.log(`\nResterende slechte slugs: ${rem.length}`);
