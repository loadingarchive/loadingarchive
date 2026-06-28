/**
 * Steam-native trending pipeline — geen SteamSpy meer.
 *
 * Stap 1: ISteamChartsService/GetGamesByConcurrentPlayers  → CCU-dict voor top 100
 * Stap 2: store.steampowered.com/search?filter=trending    → trending game-lijst (met nieuwe releases)
 * Stap 3: appdetails per game                              → naam, developer, cover
 * Stap 4: GetNumberOfCurrentPlayers voor games buiten top 100
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getCcuRankings() {
  try {
    const r = await fetch(
      'https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/',
      { signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) return new Map();
    const j = await r.json();
    const map = new Map();
    for (const g of (j.response?.ranks || [])) {
      map.set(String(g.appid), g.concurrent_in_game || 0);
    }
    return map;
  } catch { return new Map(); }
}

async function getTrendingList(count = 20) {
  const r = await fetch(
    `https://store.steampowered.com/search/results/?filter=trending&count=${count}&json=1&cc=us&l=en`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LoadingArchive/1.0)' },
      signal: AbortSignal.timeout(12000),
    }
  );
  if (!r.ok) throw new Error(`Steam trending ${r.status}`);
  const j = await r.json();
  return (j.items || []).map(item => {
    const m = item.logo?.match(/\/apps\/(\d+)\//);
    return m ? { appid: m[1], name: item.name || '' } : null;
  }).filter(Boolean);
}

async function fetchAppDetails(appid) {
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const j = await r.json();
    return j?.[appid]?.data || null;
  } catch { return null; }
}

async function fetchIndividualCcu(appid) {
  try {
    const r = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return 0;
    const j = await r.json();
    return j?.response?.player_count || 0;
  } catch { return 0; }
}

export async function fetchAndStoreTrending(env) {
  // Stap 1: CCU-dict voor top-100 games (één request)
  const ccuMap = await getCcuRankings();
  console.log(`  CCU rankings: ${ccuMap.size} games`);

  // Stap 2: Trending lijst (mix van nieuwe + populaire games)
  const trending = await getTrendingList(20);
  if (!trending.length) throw new Error('Steam trending lijst leeg');
  console.log(`  Trending lijst: ${trending.length} games (o.a. ${trending.slice(0,3).map(g=>g.name).join(', ')})`);

  // Stap 3: Appdetails per game (4 tegelijk, 400ms pauze)
  const detailsMap = new Map();
  const BATCH = 4;
  for (let i = 0; i < trending.length; i += BATCH) {
    const batch   = trending.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(g => fetchAppDetails(g.appid)));
    results.forEach((d, idx) => { if (d) detailsMap.set(batch[idx].appid, d); });
    if (i + BATCH < trending.length) await sleep(400);
  }
  console.log(`  App details: ${detailsMap.size}/${trending.length} opgehaald`);

  // Stap 4: CCU voor games die niet in top-100 staan (bijv. nieuwe releases)
  const missingCcu = trending.filter(g => !ccuMap.has(g.appid));
  if (missingCcu.length) {
    const results = await Promise.all(missingCcu.map(g => fetchIndividualCcu(g.appid)));
    missingCcu.forEach((g, i) => { if (results[i]) ccuMap.set(g.appid, results[i]); });
    console.log(`  Individuele CCU: ${missingCcu.length} games`);
  }

  // Stap 5: Bouw games array (trending-volgorde behouden)
  const games = trending.map(g => {
    const d   = detailsMap.get(g.appid);
    const ccu = ccuMap.get(g.appid) || 0;
    return {
      appid:     g.appid,
      name:      d?.name || g.name,
      developer: d?.developers?.[0] || '',
      cover:     d?.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
      ccu,
      slug:      null,
    };
  });

  // Stap 6: Slug-koppeling met Loading Archive D1
  try {
    const appids  = games.map(g => g.appid);
    const holders = appids.map((_, i) => `?${i + 1}`).join(',');
    const { results } = await env.GAMES_D1
      .prepare(`SELECT steam_appid, slug FROM games WHERE steam_appid IN (${holders}) AND status='active'`)
      .bind(...appids)
      .all();
    const slugByAppid = Object.fromEntries(results.map(r => [r.steam_appid, r.slug]));
    games.forEach(g => { g.slug = slugByAppid[g.appid] || null; });
    const linked = games.filter(g => g.slug).length;
    if (linked) console.log(`  ${linked} games gekoppeld aan Loading Archive`);
  } catch (e) {
    console.error('  Slug-koppeling mislukt:', e.message);
  }

  // Stap 7: D1 snapshot opslaan
  const today = new Date().toISOString().slice(0, 10);
  const stmts = games.map(g =>
    env.GAMES_D1
      .prepare('INSERT OR REPLACE INTO trending_history (appid, recorded_at, ccu, avg_2weeks, name) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(g.appid, today, g.ccu, 0, g.name)
  );
  await env.GAMES_D1.batch(stmts);

  // Stap 8: KV bijwerken
  await env.GAMES_KV.put(
    'trending:top20',
    JSON.stringify({ games, updatedAt: new Date().toISOString() }),
    { expirationTtl: 86400 * 2 },
  );

  return { total: games.length, withCcu: games.filter(g => g.ccu > 0).length };
}
