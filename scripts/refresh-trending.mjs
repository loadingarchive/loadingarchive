/**
 * refresh-trending.mjs
 * Simuleert de hourly cron: haalt live Steam CCU op, filtert adult games,
 * slaat metadata op in D1 steam_app_meta en schrijft KV trending_steam.
 *
 * Gebruik: node scripts/refresh-trending.mjs
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT  = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
const META_MAX_AGE_DAYS = 14;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtPlayers(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return n.toLocaleString('en-US');
  return String(n);
}

async function d1Query(sql, params = []) {
  const body = params.length ? { sql, params } : { sql };
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify(body) }
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

// ── Stap 0: Zorg dat steam_app_meta bestaat ───────────────────────────────────
console.log('\nStap 0: steam_app_meta tabel aanmaken (IF NOT EXISTS)…');
await d1Exec(`
  CREATE TABLE IF NOT EXISTS steam_app_meta (
    appid INTEGER PRIMARY KEY,
    name TEXT,
    developer TEXT,
    image TEXT,
    required_age INTEGER DEFAULT 0,
    is_adult INTEGER DEFAULT 0,
    updated_at TEXT
  )
`);
console.log('  OK');

// ── Stap 1: Live CCU ranking ──────────────────────────────────────────────────
console.log('\nStap 1: Steam Charts live CCU ophalen…');
const ccuRes = await fetch(
  'https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/',
  { signal: AbortSignal.timeout(10000) }
);
if (!ccuRes.ok) throw new Error(`Steam Charts ${ccuRes.status}`);
const ccuJ  = await ccuRes.json();
console.log('  [raw] rank[0]:', JSON.stringify(ccuJ.response?.ranks?.[0]));

const ranking = (ccuJ.response?.ranks || []).slice(0, 50).map(g => ({
  appid:       String(g.appid),
  players_now: g.concurrent_in_game || 0,
}));
console.log(`  ${ranking.length} games, #1: appid ${ranking[0].appid} (${fmtPlayers(ranking[0].players_now)} spelers)`);

// ── Stap 2: Metadata uit D1-cache lezen ──────────────────────────────────────
console.log('\nStap 2: Bestaande metadatacache lezen uit D1…');
const appids = ranking.map(g => g.appid);
const cacheThreshold = new Date(Date.now() - META_MAX_AGE_DAYS * 86400_000).toISOString().slice(0, 10);

const cacheRows = await d1Query(
  `SELECT appid, name, developer, image, required_age, is_adult, updated_at FROM steam_app_meta WHERE appid IN (${appids.map(a => `'${a}'`).join(',')})`
);
const cached = new Map(cacheRows.map(r => [String(r.appid), r]));
console.log(`  ${cached.size} records gevonden in cache`);

const toFetch = appids.filter(appid => {
  const c = cached.get(appid);
  return !c || c.updated_at < cacheThreshold;
});
console.log(`  ${toFetch.length} appids ophalen (nieuw of verlopen cache)`);

// ── Stap 3: Verse metadata ophalen van Steam appdetails ───────────────────────
console.log('\nStap 3: Steam appdetails ophalen voor verse metadata…');
const freshMeta = new Map();
const CONCURRENCY = 5;

for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
  const batch = toFetch.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(async appid => {
    try {
      const r = await fetch(
        `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!r.ok) return null;
      const j = await r.json();
      const entry = j?.[appid];
      if (!entry?.success || !entry.data) {
        console.log(`    appid ${appid}: success=false → adult/niet beschikbaar`);
        return { appid, is_adult: 1, name: '', developer: '', image: '', required_age: 0 };
      }
      const d = entry.data;
      const required_age = parseInt(d.required_age) || 0;
      const desc_ids     = d.content_descriptors?.ids || [];
      const is_adult     = (required_age >= 18 || desc_ids.some(id => ADULT_DESC_IDS.has(id))) ? 1 : 0;
      if (is_adult) console.log(`    appid ${appid} "${d.name}": adult (age=${required_age}, descs=${JSON.stringify(desc_ids)})`);
      return {
        appid,
        name:         d.name || '',
        developer:    d.developers?.[0] || d.publishers?.[0] || '',
        image:        d.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
        required_age,
        is_adult,
      };
    } catch (e) {
      console.warn(`    appid ${appid}: fout —`, e.message);
      return null;
    }
  }));

  for (const meta of results) {
    if (meta) freshMeta.set(String(meta.appid), meta);
  }
  if (i + CONCURRENCY < toFetch.length) await sleep(300);
}

// ── Stap 4: Upsert verse metadata naar D1 ────────────────────────────────────
if (freshMeta.size > 0) {
  console.log(`\nStap 4: ${freshMeta.size} records opslaan in steam_app_meta…`);
  const today = new Date().toISOString().slice(0, 10);
  for (const [appid, meta] of freshMeta) {
    await d1Exec(`
      INSERT OR REPLACE INTO steam_app_meta (appid, name, developer, image, required_age, is_adult, updated_at)
      VALUES (${Number(appid)}, '${(meta.name||'').replace(/'/g,"''")}', '${(meta.developer||'').replace(/'/g,"''")}', '${(meta.image||'').replace(/'/g,"''")}', ${meta.required_age||0}, ${meta.is_adult||0}, '${today}')
    `);
  }
  console.log('  Opgeslagen.');
}

// ── Stap 5: Filter + top 10 ───────────────────────────────────────────────────
const allMeta = new Map([...cached, ...freshMeta]);
const top10 = ranking
  .filter(g => {
    const m = allMeta.get(g.appid);
    return m && !m.is_adult;
  })
  .slice(0, 20);

console.log(`\nStap 5: ${top10.length} games na adult-filter (${ranking.length - top10.length} gefilterd)`);

// ── Stap 6: Slug-koppeling ────────────────────────────────────────────────────
const filteredAppids = top10.map(g => g.appid);
const slugRows = await d1Query(
  `SELECT steam_appid, slug FROM games WHERE steam_appid IN (${filteredAppids.map(a => `'${a}'`).join(',')}) AND status='active'`
);
const slugByAppid = new Map(slugRows.map(r => [r.steam_appid, r.slug]));
console.log(`  ${slugByAppid.size} games gekoppeld aan Loading Archive`);

// ── Stap 7: Bouw KV payload ───────────────────────────────────────────────────
const games = top10.map(g => {
  const meta = allMeta.get(g.appid);
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

// ── Stap 8: KV schrijven ──────────────────────────────────────────────────────
console.log('\nStap 8: KV trending_steam schrijven…');
const kvUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/trending_steam`;
const kvRes = await fetch(kvUrl, {
  method: 'PUT',
  headers: { 'Authorization': `Bearer ${TOKEN}` },
  body: JSON.stringify(payload),
});
console.log(`  ${kvRes.ok ? 'OK' : 'FOUT ' + kvRes.status}`);

// ── Rapport ───────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════');
console.log('  Most Played on Steam — TOP 10 (nu live in KV)');
console.log('════════════════════════════════════════════════════');
games.forEach((g, i) => {
  const rank = String(i + 1).padStart(2, ' ');
  const pl   = fmtPlayers(g.players_now).padStart(10, ' ');
  const link = g.link.startsWith('/') ? g.link : '(Steam store)';
  console.log(`  ${rank}. ${g.name.padEnd(42)} ${pl}  ${link}`);
});
console.log('════════════════════════════════════════════════════\n');
