/**
 * Rebuilt de games:2026-07 maand-KV vanuit D1 raw_json.
 */
import { readFileSync } from 'fs';
import path from 'path';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';
const toml  = readFileSync(path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'), 'utf8');
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
const CF_H  = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function d1Query(sql) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify({ sql }) });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results || [];
}

async function kvPut(key, value) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: { 'Authorization': `Bearer ${TOKEN}` }, body: value }
  );
  if (!r.ok) throw new Error(`KV PUT ${key}: ${r.status} ${await r.text()}`);
}

// Lees July games uit D1
const rows = await d1Query(`
  SELECT slug, raw_json FROM games
  WHERE status = 'active' AND release_date >= '2026-07-01' AND release_date <= '2026-07-31'
  ORDER BY release_date ASC
`);

const results = rows.map(r => JSON.parse(r.raw_json));
const ports   = results.filter(g => g.rerelease);
console.log(`${results.length} games geladen, ${ports.length} ports`);

// Rebuild games:2026-07
const payload = JSON.stringify({ results, generatedAt: new Date().toISOString() });
await kvPut('games:2026-07', payload);
console.log('games:2026-07 KV bijgewerkt');

// Rebuild ook elke game:{slug} KV
for (const row of rows) {
  await kvPut(`game:${row.slug}`, row.raw_json);
}
console.log(`${rows.length} game:{slug} KV records bijgewerkt`);
