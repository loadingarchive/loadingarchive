import { PLATFORM_MAP, parseSteamDate, mapWithConcurrency } from './utils.js';
import { ADULT_DESCRIPTOR_IDS, fetchSteamAppDetails } from './steam.js';

// Laag B: client-side 18+ filter op RAWG-velden
const ADULT_ESRB_SLUGS = new Set(['adults-only']);
const ADULT_TAG_SLUGS  = new Set(['nsfw', 'sexual-content', 'nudity']);

function isAdultContent(g) {
  if (ADULT_ESRB_SLUGS.has(g.esrb_rating?.slug)) return true;
  if ((g.tags || []).some(t => ADULT_TAG_SLUGS.has(t.slug))) return true;
  return false;
}

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

  // Laag B: Steam required_age check — drop het spel als Steam het als 18+ markeert
  if (Number(app.required_age) >= 18) {
    console.log(`Steam 18+ filter: dropped "${rg.title}" (required_age=${app.required_age})`);
    return null;
  }

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

async function fetchRawg(rawgKey, query, maxPages = 5) {
  const all = [];
  let url = `https://api.rawg.io/api/games?key=${rawgKey}&${query}`;
  let pages = 0;
  try {
    while (url && pages < maxPages) {
      const r = await fetch(url);
      if (!r.ok) { console.error("RAWG request failed", r.status); break; }
      const data = await r.json();
      all.push(...(data.results || []));
      url = data.next || null;
      pages++;
    }
  } catch (e) {
    console.error("RAWG fetch failed", e.message);
  }
  return all;
}

export async function fetchRawgGames(rawgKey, dateFrom, dateTo) {
  // Laag A: exclude_esrb_ratings=6 filtert "Adults Only" aan RAWG-kant
  const results = await fetchRawg(rawgKey,
    `dates=${dateFrom},${dateTo}&ordering=released&page_size=40&exclude_additions=true&parent_platforms=1,2,3,7&exclude_esrb_ratings=6`
  );

  // Laag B: filter resterende 18+ content op ESRB-slug en tags
  const adultCount = results.filter(isAdultContent).length;
  if (adultCount) console.log(`RAWG 18+ filter: ${adultCount} games verwijderd (${dateFrom}–${dateTo})`);

  const games = results
    .filter(g => !isAdultContent(g))
    .map((g, idx) => mapRawgGame(g, idx, "rawg"))
    .filter(Boolean);

  const enriched = await mapWithConcurrency(games, 8, enrichRawgGameWithSteam);
  return enriched.filter(Boolean); // null = gedropped door Steam 18+ check
}

export async function fetchRawgTbaGames(rawgKey) {
  // Laag A: exclude_esrb_ratings=6, ook PC toegevoegd
  const results = await fetchRawg(rawgKey,
    `tba=true&ordering=-added&page_size=40&exclude_additions=true&parent_platforms=1,2,3,7&exclude_esrb_ratings=6`
  );

  // Laag B
  const adultCount = results.filter(g => g.tba === true && isAdultContent(g)).length;
  if (adultCount) console.log(`RAWG 18+ filter: ${adultCount} TBA games verwijderd`);

  const games = results
    .filter(g => g.tba === true && !isAdultContent(g))
    .map((g, idx) => mapRawgGame(g, idx, "rawg-tba"))
    .filter(Boolean);

  const enriched = await mapWithConcurrency(games, 8, enrichRawgGameWithSteam);
  return enriched.filter(Boolean);
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
