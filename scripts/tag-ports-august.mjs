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

// Titel-fragment → originele releasedatum
const PORTS = {
  'Kynseed':                                  '2022-12-06',
  'Lies of P':                                '2023-09-19',
  "Apidya":                                   '1992-01-01',
  'Metal Gear Solid: Master Collection Vol. 2': '2004-11-17',
  'Elden Ring Tarnished Edition':             '2022-02-25',
};

const rows = await d1Query(`
  SELECT slug, name, release_date, raw_json FROM games
  WHERE status = 'active' AND release_date >= '2026-08-01' AND release_date <= '2026-08-31'
  ORDER BY release_date ASC
`);

console.log(`\nAugust 2026 ports taggen\n`);
let ok = 0, notFound = 0;

for (const [titleFrag, origDate] of Object.entries(PORTS)) {
  const row = rows.find(r => {
    const g = JSON.parse(r.raw_json || '{}');
    return (g.title || r.name || '').includes(titleFrag);
  });

  if (!row) {
    console.log(`  ✗ NIET GEVONDEN: ${titleFrag}`);
    notFound++;
    continue;
  }

  const g = JSON.parse(row.raw_json || '{}');
  g.rerelease = { date: origDate };
  const json = JSON.stringify(g);

  await d1Query(`UPDATE games SET raw_json = ?1, last_updated = ?2 WHERE slug = ?3`,
    [json, new Date().toISOString(), row.slug]);
  await kvPut(`game:${row.slug}`, json);
  console.log(`  ✓ ${(g.title || row.name).padEnd(52)} → orig. ${origDate}`);
  ok++;
}

// Rebuild games:2026-08 KV
const allRows = await d1Query(`
  SELECT slug, raw_json FROM games
  WHERE status = 'active' AND release_date >= '2026-08-01' AND release_date <= '2026-08-31'
  ORDER BY release_date ASC
`);
const results = allRows.map(r => JSON.parse(r.raw_json));
await kvPut('games:2026-08', JSON.stringify({ results, generatedAt: new Date().toISOString() }));

console.log(`\n  Getagd: ${ok}  |  Niet gevonden: ${notFound}`);
console.log(`  games:2026-08 KV herbouwd (${results.length} games, ${results.filter(g=>g.rerelease).length} ports)`);
