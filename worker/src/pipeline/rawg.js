import { PLATFORM_MAP, parseSteamDate, mapWithConcurrency } from './utils.js';
import { ADULT_DESCRIPTOR_IDS, fetchSteamAppDetails } from './steam.js';

function mapRawgGame(g, idx, idPrefix) {
  const platforms = (g.platforms || [])
    .map(p => PLATFORM_MAP[p.platform?.slug] || null)
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  if (platforms.length === 0) return null;

  const steamStore = (g.stores || []).find(s => s.store?.slug === "steam");
  const steamId    = steamStore?.url?.match(/\/app\/(\d+)/)?.[1] || null;

  return {
    id:         `${idPrefix}-${g.id ?? idx}`,
    title:      g.name,
    date:       g.released || null,
    platforms,
    genre:      (g.genres || []).map(genre => genre.name).slice(0, 2),
    dev:        "",
    anticipated: (g.added || 0) > 200,
    trailer:    steamId ? `steam:${steamId}` : null,
    steam:      steamId,
    price:      null,
    cover:      g.background_image || g.background_image_additional || null,
  };
}

async function enrichRawgGameWithSteam(rg) {
  if (!rg.steam) return rg;
  const app = await fetchSteamAppDetails(rg.steam);
  if (!app) return rg;

  const steamGenre = (app.genres || []).map(g => g.description).slice(0, 2);
  const steamDate  = parseSteamDate(app.release_date?.date);

  return {
    ...rg,
    date:       steamDate || rg.date,
    platforms:  [...new Set([...rg.platforms, "PC"])],
    genre:      steamGenre.length ? steamGenre : rg.genre,
    dev:        (app.developers || [])[0] || rg.dev,
    anticipated: rg.anticipated || app.release_date?.coming_soon === true,
    price:      app.is_free ? "Free" : (app.price_overview?.final_formatted || rg.price),
    cover:      app.header_image || rg.cover,
  };
}

async function fetchRawg(rawgKey, query) {
  const url = `https://api.rawg.io/api/games?key=${rawgKey}&${query}`;
  try {
    const r = await fetch(url);
    if (!r.ok) { console.error("RAWG request failed", r.status); return []; }
    const data = await r.json();
    return data.results || [];
  } catch (e) {
    console.error("RAWG fetch failed", e.message);
    return [];
  }
}

export async function fetchRawgConsoleGames(rawgKey, dateFrom, dateTo) {
  const results = await fetchRawg(rawgKey,
    `dates=${dateFrom},${dateTo}&ordering=released&page_size=40&exclude_additions=true&parent_platforms=2,3,7`
  );
  const games = results.map((g, idx) => mapRawgGame(g, idx, "rawg")).filter(Boolean);
  return mapWithConcurrency(games, 8, enrichRawgGameWithSteam);
}

export async function fetchRawgTbaGames(rawgKey) {
  const results = await fetchRawg(rawgKey,
    `tba=true&ordering=-added&page_size=40&exclude_additions=true&parent_platforms=2,3,7`
  );
  const games = results
    .filter(g => g.tba === true)
    .map((g, idx) => mapRawgGame(g, idx, "rawg-tba"))
    .filter(Boolean);
  return mapWithConcurrency(games, 8, enrichRawgGameWithSteam);
}

export async function enrichRawgCoverWithScreenshot(rawgKey, game) {
  if (game.cover) return game;
  const rawgNumId = game.id.replace(/^rawg(-tba)?-/, '');
  if (!rawgNumId || !/^\d+$/.test(rawgNumId)) return game;
  try {
    const r = await fetch(
      `https://api.rawg.io/api/games/${rawgNumId}/screenshots?key=${rawgKey}&page_size=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return game;
    const data = await r.json();
    const img  = data.results?.[0]?.image || null;
    return img ? { ...game, cover: img } : game;
  } catch {
    return game;
  }
}
