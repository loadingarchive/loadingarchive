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

// { includes, excludes?, date }
const PORTS = [
  // OCTOBER
  { includes: 'Rayman Legends Retold',                date: '2013-08-29' },
  { includes: 'Muchi Muchi Pork',                     date: '2007-01-01' },
  { includes: 'Earth Defense Force 5',                date: '2017-12-07' },
  { includes: 'Kingdom Hearts Collection',            date: '2002-03-28' },
  { includes: "Dragon's Dogma 2",                     date: '2024-03-22' },
  { includes: 'Toy Story 3',                          date: '2010-06-15' },
  { includes: 'Tales of Eternia',                     date: '2000-11-27' },
  { includes: 'Azure Striker Gunvolt Trilogy',        date: '2014-08-20' },
  { includes: 'Cotton Reboot!', excludes: 'High Tension', date: '2021-07-09' },
  { includes: 'Nintendo Switch Sports Resort',        date: '2009-06-25' },
  { includes: 'Steins;Gate Re:Boot',                  date: '2009-10-15' },
  { includes: 'No Rest for the Wicked',               date: '2024-04-18' },
  // NOVEMBER
  { includes: 'Godzilla: Destroy All Monsters',       date: '2002-10-08' },
  { includes: 'Metaphor: ReFantazio',                 date: '2024-10-11' },
  { includes: 'Gothic 3 Classic',                     date: '2006-10-13' },
  // DECEMBER
  { includes: 'Xenoblade Chronicles 3',               date: '2022-07-29' },
];

const MONTHS = [
  { label: 'OCTOBER',  kvKey: 'games:2026-10', from: '2026-10-01', to: '2026-10-31' },
  { label: 'NOVEMBER', kvKey: 'games:2026-11', from: '2026-11-01', to: '2026-11-30' },
  { label: 'DECEMBER', kvKey: 'games:2026-12', from: '2026-12-01', to: '2026-12-31' },
];

let totalOk = 0, totalNotFound = 0;

for (const { label, kvKey, from, to } of MONTHS) {
  const rows = await d1Query(`
    SELECT slug, name, release_date, raw_json FROM games
    WHERE status = 'active' AND release_date >= '${from}' AND release_date <= '${to}'
    ORDER BY release_date ASC
  `);

  console.log(`\n── ${label} (${rows.length} games) ──`);
  let monthOk = 0;

  for (const port of PORTS) {
    const row = rows.find(r => {
      const title = JSON.parse(r.raw_json || '{}').title || r.name || '';
      if (!title.includes(port.includes)) return false;
      if (port.excludes && title.includes(port.excludes)) return false;
      return true;
    });
    if (!row) continue; // not in this month

    const g = JSON.parse(row.raw_json || '{}');
    g.rerelease = { date: port.date };
    const json = JSON.stringify(g);

    await d1Query(`UPDATE games SET raw_json = ?1, last_updated = ?2 WHERE slug = ?3`,
      [json, new Date().toISOString(), row.slug]);
    await kvPut(`game:${row.slug}`, json);
    console.log(`  ✓ ${(g.title || row.name).padEnd(55)} → orig. ${port.date}`);
    monthOk++;
    totalOk++;
  }

  // Rebuild month KV
  const allRows = await d1Query(`
    SELECT slug, raw_json FROM games
    WHERE status = 'active' AND release_date >= '${from}' AND release_date <= '${to}'
    ORDER BY release_date ASC
  `);
  const results = allRows.map(r => JSON.parse(r.raw_json));
  await kvPut(kvKey, JSON.stringify({ results, generatedAt: new Date().toISOString() }));
  console.log(`  → ${kvKey} herbouwd (${results.length} games, ${results.filter(g => g.rerelease).length} ports)`);
}

console.log(`\n══════════════════════════════`);
console.log(`  Totaal getagd : ${totalOk}`);
console.log(`══════════════════════════════`);
