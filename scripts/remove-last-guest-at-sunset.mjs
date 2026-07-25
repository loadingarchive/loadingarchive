/**
 * remove-last-guest-at-sunset.mjs
 * Permanente verwijdering van "Last Guest at Sunset" (rawg-1019167, appid
 * 4822430) op gebruikersverzoek — zelfde aanpak als "Royale Battle": hard
 * DELETE uit D1 (niet soft-hide, want upsert checkt status niet en de game
 * zou anders via de volgende RAWG-cron terugkomen), game:{slug} KV
 * verwijderen, juli-KV herbouwen. De blocklist-entry (worker/src/pipeline/
 * blocklist.js) voorkomt dat hij ooit weer wordt opgenomen.
 *
 * Gebruik: node scripts/remove-last-guest-at-sunset.mjs
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

async function kvPut(key, value) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: { 'Authorization': `Bearer ${TOKEN}` }, body: value });
  if (!r.ok) throw new Error(`KV PUT ${key}: ${r.status}`);
}

const SLUG = 'last-guest-at-sunset';

const [row] = await d1Query(`SELECT slug, release_date FROM games WHERE slug = ?`, [SLUG]);
if (!row) {
  console.log(`✗ ${SLUG} niet gevonden in D1 (al verwijderd?)`);
  process.exit(0);
}

await d1Query(`DELETE FROM games WHERE slug = ?`, [SLUG]);
console.log(`✓ ${SLUG} hard verwijderd uit D1`);

const delRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent('game:' + SLUG)}`,
  { method: 'DELETE', headers: { 'Authorization': `Bearer ${TOKEN}` } });
console.log(`✓ game:${SLUG} KV verwijderd (${delRes.status})`);

const month = row.release_date.slice(0, 7);
const rows = await d1Query(
  `SELECT raw_json FROM games WHERE status='active' AND release_date >= ?1 AND release_date <= ?2 ORDER BY release_date`,
  [`${month}-01`, `${month}-31`]);
await kvPut(`games:${month}`, JSON.stringify({ results: rows.map(r => JSON.parse(r.raw_json)), generatedAt: new Date().toISOString() }));
console.log(`✓ games:${month} KV herbouwd (${rows.length} games)`);
