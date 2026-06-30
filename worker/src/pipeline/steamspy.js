/**
 * Most Played on Steam pipeline — live concurrent players.
 *
 * Databron: ISteamChartsService/GetGamesByConcurrentPlayers/v1/
 * Metadatacache: D1 steam_app_meta tabel
 * Output: KV sleutel 'trending_steam'
 *
 * Filter: alleen type='game', geen adult content.
 * Apps (Wallpaper Engine, FiveM) en desktop-toys hebben type='application'.
 */

const ADULT_DESC_IDS = new Set([1, 3, 4]); // 1=nudity, 3=adult-only, 4=freq. nudity
const META_MAX_AGE_DAYS = 14;

// Apps die Steam als type='game' markeert maar geen games zijn
const NON_GAME_APPIDS = new Set([
  '431960',  // Wallpaper Engine
  '3419430', // Bongo Cat
  '3678970', // TBH: Task Bar Hero
]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ensureMetaTable(db) {
  await db.prepare(`
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
  `).run();
  // Migratie: voeg type-kolom toe als die er nog niet is (tabel bestond al zonder)
  try {
    await db.prepare(`ALTER TABLE steam_app_meta ADD COLUMN type TEXT DEFAULT 'game'`).run();
  } catch { /* kolom bestaat al */ }
}

async function getLiveRanking(count = 50) {
  const r = await fetch(
    'https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/',
    { signal: AbortSignal.timeout(10000) }
  );
  if (!r.ok) throw new Error(`Steam Charts ${r.status}`);
  const j = await r.json();
  console.log('  [raw] rank[0]:', JSON.stringify(j.response?.ranks?.[0]));
  const ranks = j.response?.ranks || [];
  return ranks.slice(0, count).map(g => ({
    appid:       String(g.appid),
    players_now: g.concurrent_in_game || 0,
  }));
}

async function fetchAppMeta(appid) {
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const entry = j?.[appid];
    if (!entry?.success || !entry.data) return { is_adult: 1, type: 'unknown' };
    const d = entry.data;

    const required_age = parseInt(d.required_age) || 0;
    const desc_ids     = d.content_descriptors?.ids || [];
    const is_adult     = required_age >= 18 || desc_ids.some(id => ADULT_DESC_IDS.has(id)) ? 1 : 0;

    return {
      name:         d.name || '',
      developer:    d.developers?.[0] || d.publishers?.[0] || '',
      image:        d.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
      required_age,
      is_adult,
      type:         d.type || 'game',   // 'game', 'application', 'dlc', 'mod', 'video', …
    };
  } catch { return null; }
}

export async function fetchAndStoreTrending(env) {
  const db = env.GAMES_D1;

  await ensureMetaTable(db);

  // Stap 1: Live CCU ranking — top 50 (ruime marge na adult + non-game filter)
  const ranking = await getLiveRanking(50);
  if (!ranking.length) throw new Error('Steam Charts ranking leeg');
  console.log(`  Live ranking: ${ranking.length} items, #1 appid ${ranking[0].appid} (${ranking[0].players_now.toLocaleString()} spelers)`);

  const appids         = ranking.map(g => g.appid);
  const cacheThreshold = new Date(Date.now() - META_MAX_AGE_DAYS * 86400_000).toISOString().slice(0, 10);

  // Stap 2a: Lees bestaande cache — inclusief type-kolom
  const cached = new Map();
  try {
    const ph = appids.map((_, i) => `?${i + 1}`).join(',');
    const { results } = await db
      .prepare(`SELECT appid, name, developer, image, required_age, is_adult, type, updated_at FROM steam_app_meta WHERE appid IN (${ph})`)
      .bind(...appids.map(Number))
      .all();
    for (const row of results) cached.set(String(row.appid), row);
  } catch (e) {
    console.error('  Cache read mislukt:', e.message);
  }

  // Stap 2b: Appids die vers opgehaald moeten worden (nieuw of cache verlopen of type nog NULL)
  const toFetch = appids.filter(appid => {
    const c = cached.get(appid);
    return !c || c.updated_at < cacheThreshold || c.type == null;
  });
  console.log(`  Metadata: ${cached.size} gecached, ${toFetch.length} vers ophalen`);

  // Stap 2c: Haal verse metadata op (max 5 tegelijk)
  const freshMeta = new Map();
  const CONCURRENCY = 5;
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const batch   = toFetch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(fetchAppMeta));
    for (let j = 0; j < batch.length; j++) {
      const appid = batch[j];
      const meta  = results[j];
      if (meta) {
        freshMeta.set(appid, meta);
      } else {
        console.warn(`  Metadata ophalen mislukt voor appid ${appid}`);
      }
    }
    if (i + CONCURRENCY < toFetch.length) await sleep(300);
  }

  // Stap 2d: Upsert verse metadata naar D1 (inclusief type)
  if (freshMeta.size > 0) {
    const today   = new Date().toISOString().slice(0, 10);
    const upserts = [];
    for (const [appid, meta] of freshMeta) {
      if (!meta.name && !meta.is_adult) continue;
      upserts.push(
        db.prepare(
          `INSERT OR REPLACE INTO steam_app_meta (appid, name, developer, image, required_age, is_adult, type, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
        ).bind(Number(appid), meta.name || '', meta.developer || '', meta.image || '', meta.required_age || 0, meta.is_adult || 0, meta.type || 'game', today)
      );
    }
    if (upserts.length) {
      await db.batch(upserts);
      console.log(`  Metadata: ${upserts.length} records opgeslagen`);
    }
  }

  // Stap 3: Samenvoegen, filter op type='game' EN geen adult, neem top 20
  const allMeta = new Map([...cached]);
  for (const [k, v] of freshMeta) allMeta.set(k, v);

  const top20 = ranking
    .filter(g => {
      if (NON_GAME_APPIDS.has(g.appid)) return false;
      const m = allMeta.get(g.appid);
      if (!m) return false;
      if (m.is_adult) return false;
      // Alleen echte games — geen applications, mods, videos, advertising, etc.
      return (m.type || 'game') === 'game';
    })
    .slice(0, 20);

  const filteredCount = ranking.length - top20.length;
  console.log(`  Na filters: ${top20.length} games (${filteredCount} gefilterd — adult of non-game)`);
  if (!top20.length) throw new Error('Geen games na filters');

  // Stap 4: Slug-koppeling met Loading Archive D1
  const filteredAppids = top20.map(g => g.appid);
  const slugByAppid    = new Map();
  try {
    const ph = filteredAppids.map((_, i) => `?${i + 1}`).join(',');
    const { results } = await db
      .prepare(`SELECT steam_appid, slug FROM games WHERE steam_appid IN (${ph}) AND status='active'`)
      .bind(...filteredAppids)
      .all();
    for (const r of results) slugByAppid.set(r.steam_appid, r.slug);
    if (slugByAppid.size) console.log(`  ${slugByAppid.size} games gekoppeld aan Loading Archive`);
  } catch (e) {
    console.error('  Slug-koppeling mislukt:', e.message);
  }

  // Stap 5: Bouw KV payload
  const games = top20.map(g => {
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
  await env.GAMES_KV.put('trending_steam', JSON.stringify(payload), { expirationTtl: 7200 });
  console.log(`  KV trending_steam bijgewerkt: ${games.length} games`);

  return { total: games.length };
}
