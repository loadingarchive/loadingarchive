import { normalizeTitle, titlesAreCloseEnough, daysBetween, mapWithConcurrency, parseSteamDate, generateSlug, isJapanOnly } from './utils.js';
import { fetchSteamAppDetails, findExistingSteamAppId, fetchSteamGameDetails } from './steam.js';
import { fetchRawgGames, fetchRawgTbaGames, enrichRawgCoverWithScreenshot } from './rawg.js';
import { upsertGameToD1 } from './d1.js';

const RERELEASE_GAP_DAYS = 60;

function withoutAlreadyCovered(extraGames, existingResults) {
  const existingKeys = existingResults.map(g => normalizeTitle(g.title));
  return extraGames.filter(eg => {
    const key = normalizeTitle(eg.title);
    return !existingKeys.some(k => titlesAreCloseEnough(key, k));
  });
}

async function backfillFromExistingSteamPage(game) {
  const appid = game.steam ?? await findExistingSteamAppId(game.title);
  if (!appid) return game;
  const app   = await fetchSteamAppDetails(appid);
  if (!app)   return game;

  // Laag B: skip Steam-verrijking als Steam het als 18+ markeert (game blijft wel)
  if (Number(app.required_age) >= 18) return game;

  const originalDate = parseSteamDate(app.release_date?.date);
  const isRerelease  = originalDate && game.date && originalDate < game.date
    && daysBetween(originalDate, game.date) >= RERELEASE_GAP_DAYS;

  // Als het een re-release/port is: geen prijs of korting tonen van de oude PC versie.
  // De Steam-prijs hoort bij de originele PC release, niet bij de nieuwe console port.
  const price = isRerelease ? null : (game.price || (app.is_free ? "Free" : (app.price_overview?.final_formatted || null)));

  return {
    ...game,
    steam:     String(appid),
    cover:     game.cover  || app.header_image || null,
    price,
    genre:     game.genre.length ? game.genre : (app.genres || []).map(g => g.description).slice(0, 2),
    trailer:   game.trailer || (app.movies?.length ? `steam:${appid}` : null),
    // Voeg PC alleen toe als het GEEN re-release is (bij port is de PC versie al lang uit)
    platforms: isRerelease ? game.platforms : [...new Set([...game.platforms, "PC"])],
    rerelease: isRerelease ? { date: originalDate } : game.rerelease || null,
  };
}

// Genereert unieke slugs voor een lijst games. Bij botsing: voeg jaar toe, dan jaar-maand.
// Titels in niet-Latijns schrift (Japans, Chinees) leveren een lege base op → val terug op rawg-id.
function assignSlugs(games) {
  const used = new Map();
  return games.map(g => {
    const raw  = generateSlug(g.title);
    const base = raw || String(g.id || "game"); // lege slug → gebruik rawg-id als anker
    const year = g.date ? g.date.slice(0, 4) : "tba";
    const mon  = g.date ? g.date.slice(0, 7) : "tba";

    let slug = base;
    if (used.has(slug)) slug = `${base}-${year}`;
    if (used.has(slug)) slug = `${base}-${mon}`;
    if (used.has(slug)) slug = `${base}-${g.id}`; // absolute fallback op RAWG-id

    used.set(slug, true);
    return { ...g, slug };
  });
}

/**
 * Haalt Steam-details op, bouwt de volledige entry en upsert naar D1.
 * Schrijft niet direct naar KV; dat doet build-cache.js vanuit D1.
 */
async function saveGameToD1(game, env) {
  const detail = game.steam ? await fetchSteamGameDetails(game.steam) : null;
  const entry = {
    id:                   game.id,
    slug:                 game.slug,
    title:                game.title,
    date:                 game.date,
    platforms:            game.platforms,
    genre:                game.genre,
    dev:                  game.dev,
    anticipated:          game.anticipated,
    rerelease:            game.rerelease || null,
    trailer:              game.trailer,
    steam:                game.steam,
    price:                game.price,
    cover:                game.cover,
    short_description:    detail?.short_description    || null,
    detailed_description: detail?.detailed_description || null,
    pc_requirements:      detail?.pc_requirements      || null,
    metacritic:           detail?.metacritic            || null,
    screenshots:          detail?.screenshots           || [],
    categories:           detail?.categories            || [],
  };
  await upsertGameToD1(entry, env);
}

// RAWG is de enige bron voor game-releases. Steam voegt alleen cover, prijs en trailer toe.
export async function runMonthPipeline(rawgKey, dateFrom, dateTo, extraGames, env) {
  const rawgGames = await fetchRawgGames(rawgKey, dateFrom, dateTo);
  console.log(`  ${dateFrom}–${dateTo}: ${rawgGames.length} games van RAWG`);

  const filtered  = extraGames.filter(g => g.date && g.date >= dateFrom && g.date <= dateTo);
  const newExtras = withoutAlreadyCovered(filtered, rawgGames);
  const all       = [...rawgGames, ...newExtras].filter(g => !isJapanOnly(g.title));

  const backfilled = await mapWithConcurrency(all, 10, backfillFromExistingSteamPage);
  const withCovers = await mapWithConcurrency(backfilled, 6, g => enrichRawgCoverWithScreenshot(rawgKey, g));

  // Slugs toewijzen en upserten naar D1
  const withSlugs = assignSlugs(withCovers);
  await mapWithConcurrency(withSlugs, 5, g => saveGameToD1(g, env));
  console.log(`  ${dateFrom}–${dateTo}: ${withSlugs.length} games → D1`);
}

export async function runTbaPipeline(rawgKey, extraGames, env) {
  const rawgResults = await fetchRawgTbaGames(rawgKey);
  const extraTba    = extraGames.filter(g => !g.date);
  const newExtras   = withoutAlreadyCovered(extraTba, rawgResults);
  const all         = [...rawgResults, ...newExtras].filter(g => !isJapanOnly(g.title));

  const backfilled = await mapWithConcurrency(all, 10, backfillFromExistingSteamPage);
  const withCovers = await mapWithConcurrency(backfilled, 6, g => enrichRawgCoverWithScreenshot(rawgKey, g));

  const withSlugs = assignSlugs(withCovers);
  await mapWithConcurrency(withSlugs, 5, g => saveGameToD1(g, env));
  console.log(`  TBA: ${withSlugs.length} games → D1`);
}
