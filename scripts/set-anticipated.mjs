import { readFileSync } from 'fs';
const toml = readFileSync(process.env.APPDATA + '/xdg.config/.wrangler/config/default.toml', 'utf8');
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
const CF_H = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const ACCT = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';

async function d1(sql, params = []) {
  const body = params.length ? { sql, params } : { sql };
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`, {method:'POST',headers:CF_H,body:JSON.stringify(body)});
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result[0].results;
}

async function kvPut(key, value) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`, {method:'PUT',headers:{'Authorization':`Bearer ${TOKEN}`},body:value});
  if (!r.ok) throw new Error(`KV PUT failed: ${r.status}`);
}

const slug = 'assassins-creed-back-flag-resynced';
const [row] = await d1(`SELECT slug, name, release_date, raw_json FROM games WHERE slug = ?1`, [slug]);
const game = JSON.parse(row.raw_json);
game.anticipated = true;

const json = JSON.stringify(game);
await d1(`UPDATE games SET raw_json = ?1 WHERE slug = ?2`, [json, slug]);

// Update game:{slug} KV — detail page
await kvPut(`game:${slug}`, json);
console.log(`✓ game:${slug} KV bijgewerkt (detail page)`);

// Update games:2026-07 KV — maandlijst
const ts = new Date().toISOString();
const monthRows = await d1(`SELECT raw_json FROM games WHERE status='active' AND release_date >= '2026-07-01' AND release_date <= '2026-07-31' ORDER BY release_date`);
await kvPut('games:2026-07', JSON.stringify({ results: monthRows.map(r => JSON.parse(r.raw_json)), generatedAt: ts }));
console.log(`✓ games:2026-07 KV herbouwd (${monthRows.length} games)`);
