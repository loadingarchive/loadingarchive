import { normalizeTitle, titlesAreCloseEnough, daysBetween, mapWithConcurrency, parseSteamDate } from './utils.js';
import { fetchSteamAppDetails, findExistingSteamAppId, fetchSteamPcGames } from './steam.js';
import { fetchRawgConsoleGames, fetchRawgTbaGames, enrichRawgCoverWithScreenshot } from './rawg.js';

const RERELEASE_GAP_DAYS = 60;

export function mergeResults(steamGames, rawgGames) {
  const usedSteamIds = new Set();
  const merged = [];

  for (const rg of rawgGames) {
    const key = normalizeTitle(rg.title);
    const candidates = steamGames.filter(
      sg => !usedSteamIds.has(sg.id) && titlesAreCloseEnough(key, normalizeTitle(sg.title))
    );

    let match = null;
    if (candidates.length === 1) {
      match = candidates[0];
    } else if (candidates.length > 1) {
      match = candidates.reduce((best, c) =>
        daysBetween(c.date, rg.date) < daysBetween(best.date, rg.date) ? c : best
      );
    }

    if (match) {
      usedSteamIds.add(match.id);
      merged.push({
        ...match,
        date:        match.date,
        platforms:   [...new Set([...match.platforms, ...rg.platforms])],
        genre:       match.genre.length ? match.genre : rg.genre,
        dev:         match.dev || rg.dev,
        anticipated: match.anticipated || rg.anticipated,
      });
    } else {
      merged.push(rg);
    }
  }

  for (const sg of steamGames) {
    if (!usedSteamIds.has(sg.id)) merged.push(sg);
  }

  return merged;
}

export function withoutAlreadyCovered(extraGames, existingResults) {
  const existingKeys = existingResults.map(g => normalizeTitle(g.title));
  return extraGames.filter(eg => {
    const key = normalizeTitle(eg.title);
    return !existingKeys.some(k => titlesAreCloseEnough(key, k));
  });
}

export async function backfillFromExistingSteamPage(game) {
  if (game.steam) return game;
  const appid = await findExistingSteamAppId(game.title);
  if (!appid) return game;
  const app   = await fetchSteamAppDetails(appid);
  if (!app)   return game;

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

export async function runMonthPipeline(rawgKey, dateFrom, dateTo, extraGames) {
  const [rawgGames, steamGames] = await Promise.all([
    fetchRawgConsoleGames(rawgKey, dateFrom, dateTo),
    fetchSteamPcGames(dateFrom, dateTo),
  ]);

  const claimedSteamIds     = new Set(rawgGames.filter(g => g.steam).map(g => g.steam));
  const unclaimedSteamGames = steamGames.filter(sg => !claimedSteamIds.has(sg.steam));
  const merged              = mergeResults(unclaimedSteamGames, rawgGames);

  const filtered  = extraGames.filter(g => g.date && g.date >= dateFrom && g.date <= dateTo);
  const newExtras = withoutAlreadyCovered(filtered, merged);
  const all       = [...merged, ...newExtras];

  const backfilled = await mapWithConcurrency(all, 10, backfillFromExistingSteamPage);
  return mapWithConcurrency(backfilled, 6, g => enrichRawgCoverWithScreenshot(rawgKey, g));
}

export async function runTbaPipeline(rawgKey, extraGames) {
  const rawgResults = await fetchRawgTbaGames(rawgKey);
  const extraTba    = extraGames.filter(g => !g.date);
  const newExtras   = withoutAlreadyCovered(extraTba, rawgResults);
  const all         = [...rawgResults, ...newExtras];

  const backfilled = await mapWithConcurrency(all, 10, backfillFromExistingSteamPage);
  return mapWithConcurrency(backfilled, 6, g => enrichRawgCoverWithScreenshot(rawgKey, g));
}
