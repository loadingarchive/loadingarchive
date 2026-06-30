/**
 * refresh-trending.mjs
 * Simuleert de hourly cron: haalt live Steam CCU op, filtert adult + non-game apps,
 * slaat metadata op in D1 steam_app_meta en schrijft KV trending_steam.
 *
 * Gebruik: node scripts/refresh-trending.mjs
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';

const toml  = readFileSync(
  path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'),
  'utf8'
);
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
const CF_H  = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const ADULT_DESC_IDS = new Set([1, 3, 4]);
const NON_GAME_APPIDS = new Set([
  '431960',  // Wallpaper Engine
  '3419430', // Bongo Cat
  '3678970', // TBH: Task Bar Hero
]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtPlayers(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return n.toLocaleString('en-US');
  return String(n);
}

async function d1Query(sql) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify({ sql }) }
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results || [];
}

async function d1Exec(sql) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify({ sql }) }
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
}

// ── Stap 0: Tabel + migratie ──────────────────────────────────────────────────
console.log('\nStap 0: steam_app_meta tabel + type-kolom migratie…');
await d1Exec(`
  CREATE TABLE IF NOT EXISTS steam_app_meta (
    appid INTEGER PRIMARY KEY,
    name TEXT,
    developer TEXT,
    image TEXT,
    required_age INTEGER DEFAULT 0,
    is_adult INTEGER DEFAULT 0,
    type TEXT DEFAULT 'game',
    updated_at TEXT
  )
`);
// Voeg type-kolom toe als die nog niet bestaat (tabel was aangemaakt zonder deze kolom)
try {
  await d1Exec(`ALTER TABLE steam_app_meta ADD COLUMN type TEXT DEFAULT 'game'`);
  console.log('  type-kolom toegevoegd via migratie');
} catch { console.log('  type-kolom bestaat al'); }


// ── Stap 1: Live CCU ranking ──────────────────────────────────────────────────
console.log('\nStap 1: Steam Charts live CCU ophalen…');
const ccuRes = await fetch(
  'https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/',
  { signal: AbortSignal.timeout(10000) }
);
if (!ccuRes.ok) throw new Error(`Steam Charts ${ccuRes.status}`);
const ccuJ = await ccuRes.json();
console.log('  [raw] rank[0]:', JSON.stringify(ccuJ.response?.ranks?.[0]));

const ranking = (ccuJ.response?.ranks || []).slice(0, 50).map(g => ({
  appid:       String(g.appid),
  players_now: g.concurrent_in_game || 0,
}));
console.log(`  ${ranking.length} items, #1: appid ${ranking[0].appid} (${fmtPlayers(ranking[0].players_now)} spelers)`);

// ── Stap 2: Appdetails ophalen (alle 50, cache is net geleegd) ─────────────────
console.log('\nStap 2: Steam appdetails ophalen…');
const CONCURRENCY = 5;
const freshMeta = new Map();

for (let i = 0; i < ranking.length; i += CONCURRENCY) {
  const batch = ranking.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(async g => {
    try {
      const r = await fetch(
        `https://store.steampowered.com/api/appdetails?appids=${g.appid}&cc=us&l=en`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!r.ok) return { appid: g.appid, is_adult: 0, type: 'unknown', name: '', developer: '', image: '', required_age: 0 };
      const j = await r.json();
      const entry = j?.[g.appid];
      if (!entry?.success || !entry.data) {
        console.log(`    ${g.appid}: success=false → adult/niet beschikbaar`);
        return { appid: g.appid, is_adult: 1, type: 'unknown', name: '', developer: '', image: '', required_age: 0 };
      }
      const d = entry.data;
      const required_age = parseInt(d.required_age) || 0;
      const desc_ids     = d.content_descriptors?.ids || [];
      const is_adult     = (required_age >= 18 || desc_ids.some(id => ADULT_DESC_IDS.has(id))) ? 1 : 0;
      const type         = d.type || 'game';
      if (type !== 'game') console.log(`    ${g.appid} "${d.name}": type=${type} → gefilterd`);
      if (is_adult)        console.log(`    ${g.appid} "${d.name}": adult (age=${required_age}, descs=${JSON.stringify(desc_ids)})`);
      return {
        appid:     g.appid,
        name:      d.name || '',
        developer: d.developers?.[0] || d.publishers?.[0] || '',
        image:     d.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
        required_age, is_adult, type,
      };
    } catch (e) {
      console.warn(`    ${g.appid}: fout — ${e.message}`);
      return null;
    }
  }));
  for (const meta of results) {
    if (meta) freshMeta.set(String(meta.appid), meta);
  }
  if (i + CONCURRENCY < ranking.length) await sleep(300);
}
console.log(`  ${freshMeta.size}/${ranking.length} opgehaald`);

// ── Stap 3: Upsert naar D1 ───────────────────────────────────────────────────
console.log('\nStap 3: Metadata opslaan in D1…');
const today = new Date().toISOString().slice(0, 10);
for (const [appid, meta] of freshMeta) {
  await d1Exec(`
    INSERT OR REPLACE INTO steam_app_meta (appid, name, developer, image, required_age, is_adult, type, updated_at)
    VALUES (${Number(appid)}, '${(meta.name||'').replace(/'/g,"''")}', '${(meta.developer||'').replace(/'/g,"''")}', '${(meta.image||'').replace(/'/g,"''")}', ${meta.required_age||0}, ${meta.is_adult||0}, '${meta.type||'game'}', '${today}')
  `);
}
console.log(`  ${freshMeta.size} records opgeslagen`);

// ── Stap 4: Filter + top 20 ───────────────────────────────────────────────────
const top20 = ranking
  .filter(g => {
    if (NON_GAME_APPIDS.has(g.appid)) return false;
    const m = freshMeta.get(g.appid);
    if (!m) return false;
    if (m.is_adult) return false;
    return (m.type || 'game') === 'game';
  })
  .slice(0, 20);

console.log(`\nStap 4: ${top20.length} games na filters (${ranking.length - top20.length} gefilterd — adult of non-game)`);

// ── Stap 5: Slug-koppeling ────────────────────────────────────────────────────
const filteredAppids = top20.map(g => g.appid);
const slugRows = await d1Query(
  `SELECT steam_appid, slug FROM games WHERE steam_appid IN (${filteredAppids.map(a => `'${a}'`).join(',')}) AND status='active'`
);
const slugByAppid = new Map(slugRows.map(r => [r.steam_appid, r.slug]));
console.log(`  ${slugByAppid.size} games gekoppeld aan Loading Archive`);

// ── Stap 6: KV payload ────────────────────────────────────────────────────────
const games = top20.map(g => {
  const meta = freshMeta.get(g.appid);
  const slug = slugByAppid.get(g.appid) || null;
  return {
    appid:       g.appid,
    name:        meta.name,
    developer:   meta.developer,
    image:       meta.image,
    players_now: g.players_now,
    link:        slug ? `/game/${slug}` : `https://store.steampowered.com/app/${g.appid}/`,
  };
});

const payload = { generatedAt: new Date().toISOString(), games };

// ── Stap 7: KV schrijven ──────────────────────────────────────────────────────
console.log('\nStap 7: KV trending_steam schrijven…');
const kvRes = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/trending_steam`,
  { method: 'PUT', headers: { 'Authorization': `Bearer ${TOKEN}` }, body: JSON.stringify(payload) }
);
console.log(`  ${kvRes.ok ? 'OK' : 'FOUT ' + kvRes.status}`);

// ── Rapport ───────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════');
console.log('  Most Played on Steam — TOP 20');
console.log('════════════════════════════════════════════════════');
games.forEach((g, i) => {
  const rank = String(i + 1).padStart(2, ' ');
  const pl   = fmtPlayers(g.players_now).padStart(10, ' ');
  const link = g.link.startsWith('/') ? g.link : '(Steam store)';
  console.log(`  ${rank}. ${g.name.padEnd(42)} ${pl}  ${link}`);
});
console.log('════════════════════════════════════════════════════\n');
