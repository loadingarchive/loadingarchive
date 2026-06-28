/**
 * Seed/refresh trending data via Steam-native APIs (geen SteamSpy).
 * Gebruik: node scripts/seed-trending.mjs
 */
import { readFileSync } from 'fs';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';
const TOKEN = readFileSync('C:/Users/mohse/AppData/Roaming/xdg.config/.wrangler/config/default.toml', 'utf8')
  .match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!TOKEN) { console.error('Geen token'); process.exit(1); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function d1query(sql, params = []) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }) }
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result[0].results;
}

async function kvPut(key, value) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}` }, body: value }
  );
  if (!r.ok) throw new Error(`KV PUT mislukt: ${r.status}`);
}

// --- Stap 1: CCU rankings (top 100 in één request) ---
console.log('Stap 1 — ISteamChartsService/GetGamesByConcurrentPlayers…');
const ccuR  = await fetch('https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/');
const ccuJ  = await ccuR.json();
const ccuMap = new Map();
for (const g of (ccuJ.response?.ranks || [])) ccuMap.set(String(g.appid), g.concurrent_in_game || 0);
console.log(`  ${ccuMap.size} games in CCU-dict`);

// --- Stap 2: Trending lijst ---
console.log('\nStap 2 — Steam trending lijst…');
const trendR = await fetch(
  'https://store.steampowered.com/search/results/?filter=trending&count=20&json=1&cc=us&l=en',
  { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LoadingArchive/1.0)' } }
);
const trendJ = await trendR.json();
const trending = (trendJ.items || []).map(item => {
  const m = item.logo?.match(/\/apps\/(\d+)\//);
  return m ? { appid: m[1], name: item.name || '' } : null;
}).filter(Boolean);
console.log(`  ${trending.length} games: ${trending.slice(0, 5).map(g => g.name).join(', ')}…`);

// --- Stap 3: Appdetails per game ---
console.log('\nStap 3 — appdetails ophalen (4 tegelijk)…');
const detailsMap = new Map();
const BATCH = 4;
for (let i = 0; i < trending.length; i += BATCH) {
  const batch = trending.slice(i, i + BATCH);
  const results = await Promise.all(batch.map(async g => {
    try {
      const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${g.appid}&cc=us&l=en`);
      const j = await r.json();
      return j?.[g.appid]?.data || null;
    } catch { return null; }
  }));
  results.forEach((d, idx) => {
    if (d) detailsMap.set(batch[idx].appid, d);
  });
  if (i + BATCH < trending.length) await sleep(400);
}
console.log(`  ${detailsMap.size}/${trending.length} appdetails opgehaald`);

// --- Stap 4: Individuele CCU voor games buiten top-100 ---
const missing = trending.filter(g => !ccuMap.has(g.appid));
if (missing.length) {
  console.log(`\nStap 4 — ${missing.length} games buiten top-100, individuele CCU ophalen…`);
  await Promise.all(missing.map(async g => {
    try {
      const r = await fetch(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${g.appid}`);
      const j = await r.json();
      const n = j?.response?.player_count;
      if (typeof n === 'number') ccuMap.set(g.appid, n);
    } catch {}
  }));
} else {
  console.log('\nStap 4 — alle games al in CCU-dict, overgeslagen');
}

// --- Stap 5: Slug-koppeling ---
const appids = trending.map(g => g.appid);
const holders = appids.map(a => `'${a}'`).join(',');
const slugRows = await d1query(`SELECT steam_appid, slug FROM games WHERE steam_appid IN (${holders}) AND status='active'`);
const slugByAppid = Object.fromEntries(slugRows.map(r => [r.steam_appid, r.slug]));
console.log(`\nStap 5 — ${slugRows.length} games gekoppeld aan Loading Archive`);

// --- Stap 6: Samenvoegen + loggen ---
const games = trending.map(g => {
  const d   = detailsMap.get(g.appid);
  const ccu = ccuMap.get(g.appid) || 0;
  return {
    appid:     g.appid,
    name:      d?.name || g.name,
    developer: d?.developers?.[0] || '',
    cover:     d?.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
    ccu,
    slug:      slugByAppid[g.appid] || null,
  };
});

console.log('\nTrending top 20 (Steam-volgorde):');
games.forEach((g, i) => {
  const ccu = g.ccu >= 1_000_000 ? `${(g.ccu/1e6).toFixed(1)}M` : g.ccu >= 1000 ? `${Math.round(g.ccu/1000)}K` : (g.ccu || '—');
  const src = ccuMap.has(g.appid) ? '✓' : '~';
  console.log(`  ${String(i+1).padStart(2)}. ${src} ${g.name.padEnd(40)} CCU: ${String(ccu).padStart(7)}  ${g.slug ? '🔗' : ''}`);
});

// --- Stap 7: D1 opslaan ---
const today = new Date().toISOString().slice(0, 10);
for (const g of games) {
  await d1query(
    'INSERT OR REPLACE INTO trending_history (appid, recorded_at, ccu, avg_2weeks, name) VALUES (?, ?, ?, ?, ?)',
    [g.appid, today, g.ccu, 0, g.name]
  );
}
console.log(`\nD1: ${games.length} snapshots opgeslagen (${today})`);

// --- Stap 8: KV bijwerken ---
await kvPut('trending:top20', JSON.stringify({ games, updatedAt: new Date().toISOString() }));
console.log('KV: trending:top20 bijgewerkt\n');
console.log('Klaar! https://www.loadingarchive.com/trending');
