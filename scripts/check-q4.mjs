import { readFileSync } from 'fs';
import path from 'path';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
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

for (const [label, from, to] of [
  ['OCTOBER',  '2026-10-01', '2026-10-31'],
  ['NOVEMBER', '2026-11-01', '2026-11-30'],
  ['DECEMBER', '2026-12-01', '2026-12-31'],
]) {
  const rows = await d1Query(`
    SELECT slug, name, release_date, raw_json FROM games
    WHERE status = 'active' AND release_date >= '${from}' AND release_date <= '${to}'
    ORDER BY release_date ASC
  `);
  console.log(`\n${label} 2026 — ${rows.length} games\n`);
  for (const row of rows) {
    const g = JSON.parse(row.raw_json || '{}');
    const plats = (g.platforms || []).join(', ') || '—';
    const port  = g.rerelease ? ` ← PORT` : '';
    console.log(`${(row.release_date||'').slice(5)}  ${(g.title||row.name).padEnd(52)}  [${plats}]${port}`);
  }
}
