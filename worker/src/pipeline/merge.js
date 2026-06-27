import { normalizeTitle, titlesAreCloseEnough, daysBetween, mapWithConcurrency, parseSteamDate, generateSlug } from './utils.js';
import { fetchSteamAppDetails, findExistingSteamAppId, fetchSteamGameDetails } from './steam.js';
import { fetchRawgGames, fetchRawgTbaGames, enrichRawgCoverWithScreenshot } from './rawg.js';

const RERELEASE_GAP_DAYS = 60;

function withoutAlreadyCovered(extraGames, existingResults) {
  const existingKeys = existingResults.map(g => normalizeTitle(g.title));
  return extraGames.filter(eg => {
    const key = normalizeTitle(eg.title);
    return !existingKeys.some(k => titlesAreCloseEnough(key, k));
  });
}

async function backfillFromExistingSteamPage(game) {
  if (game.steam) return game;
  const appid = await findExistingSteamAppId(game.title);
  if (!appid) return game;
  const app   = await fetchSteamAppDetails(appid);
  if (!app)   return game;

  // Laag B: skip Steam-verrijking als Steam het als 18+ markeert (game blijft wel)
  if (Number(app.required_age) >= 18) return game;

  const originalDate = parseSteamDate(app.release_date?.date);
  const isRerelease  = originalDate && game.date && originalDate < game.date
    && daysBetween(originalDate, game.date) >= RERELEASE_GAP_DAYS;

  return {
    ...game,
    steam:     String(appid),
    cover:     game.cover  || app.header_image || null,
    price:     game.price  || (app.is_free ? "Free" : (app.price_overview?.final_formatted || null)),
    genre:     game.genre.length ? game.genre : (app.genres || []).map(g => g.description).slice(0, 2),
    trailer:   game.trailer || (app.movies?.length ? `steam:${appid}` : null),
    platforms: [...new Set([...game.platforms, "PC"])],
    rerelease: isRerelease ? { date: originalDate } : game.rerelease || null,
  };
}

// Genereert unieke slugs voor een lijst games. Bij botsing: voeg jaar toe, dan jaar-maand.
function assignSlugs(games) {
  const used = new Map(); // slug → index van eerste gebruiker
  return games.map(g => {
    const base = generateSlug(g.title);
    const year = g.date ? g.date.slice(0, 4) : "tba";
    const mon  = g.date ? g.date.slice(0, 7).replace("-", "-") : "tba";

    let slug = base;
    if (used.has(slug)) slug = `${base}-${year}`;
    if (used.has(slug)) slug = `${base}-${mon}`;
    if (used.has(slug)) slug = `${base}-${g.id}`; // absolute fallback op RAWG-id

    used.set(slug, true);
    return { ...g, slug };
  });
}

// Haalt Steam-details op en schrijft game:{slug} naar KV.
async function saveGameToKV(game, env) {
  const detail = game.steam ? await fetchSteamGameDetails(game.steam) : null;
  const entry = {
    id:          game.id,
    slug:        game.slug,
    title:       game.title,
    date:        game.date,
    platforms:   game.platforms,
    genre:       game.genre,
    dev:         game.dev,
    anticipated: game.anticipated,
    rerelease:   game.rerelease || null,
    trailer:     game.trailer,
    steam:       game.steam,
    price:       game.price,
    cover:       game.cover,
    // Steam-detailvelden (null als geen Steam-link)
    short_description:    detail?.short_description    || null,
    detailed_description: detail?.detailed_description || null,
    pc_requirements:      detail?.pc_requirements      || null,
    metacritic:           detail?.metacritic           || null,
    screenshots:          detail?.screenshots          || [],
    categories:           detail?.categories           || [],
  };
  await env.GAMES_KV.put(`game:${game.slug}`, JSON.stringify(entry));
}

// RAWG is de enige bron voor game-releases. Steam voegt alleen cover, prijs en trailer toe.
export async function runMonthPipeline(rawgKey, dateFrom, dateTo, extraGames, env) {
  const rawgGames = await fetchRawgGames(rawgKey, dateFrom, dateTo);
  console.log(`  ${dateFrom}–${dateTo}: ${rawgGames.length} games van RAWG`);

  const filtered  = extraGames.filter(g => g.date && g.date >= dateFrom && g.date <= dateTo);
  const newExtras = withoutAlreadyCovered(filtered, rawgGames);
  const all       = [...rawgGames, ...newExtras];

  const backfilled = await mapWithConcurrency(all, 10, backfillFromExistingSteamPage);
  const withCovers = await mapWithConcurrency(backfilled, 6, g => enrichRawgCoverWithScreenshot(rawgKey, g));

  // Slugs toewijzen en game-detailpagina's opslaan in KV
  const withSlugs = assignSlugs(withCovers);
  await mapWithConcurrency(withSlugs, 5, g => saveGameToKV(g, env));
  console.log(`  ${dateFrom}–${dateTo}: ${withSlugs.length} game-slugs opgeslagen in KV`);

  return withSlugs;
}

export async function runTbaPipeline(rawgKey, extraGames, env) {
  const rawgResults = await fetchRawgTbaGames(rawgKey);
  const extraTba    = extraGames.filter(g => !g.date);
  const newExtras   = withoutAlreadyCovered(extraTba, rawgResults);
  const all         = [...rawgResults, ...newExtras];

  const backfilled = await mapWithConcurrency(all, 10, backfillFromExistingSteamPage);
  const withCovers = await mapWithConcurrency(backfilled, 6, g => enrichRawgCoverWithScreenshot(rawgKey, g));

  const withSlugs = assignSlugs(withCovers);
  await mapWithConcurrency(withSlugs, 5, g => saveGameToKV(g, env));

  return withSlugs;
}
