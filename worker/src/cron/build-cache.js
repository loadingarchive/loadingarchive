import { runMonthPipeline, runTbaPipeline } from '../pipeline/merge.js';
import { scrapeWikipedia } from '../pipeline/wikipedia.js';
import extraGamesBundle from '../../../api/data/extra-games.json';

// ---- helpers ----

function pad(n) { return String(n).padStart(2, '0'); }

function makeMonthEntry(year, month) {
  const y = year;
  const m = pad(month);
  const lastDay = new Date(y, month, 0).getDate();
  return { kvKey: `games:${y}-${m}`, dateFrom: `${y}-${m}-01`, dateTo: `${y}-${m}-${lastDay}`, label: `${y}-${m}` };
}

/** Returns the 4 months around today that get refreshed daily. */
function activeMonths() {
  const today = new Date();
  return [-1, 0, 1, 2].map(delta => {
    const d = new Date(today.getFullYear(), today.getMonth() + delta, 1);
    return makeMonthEntry(d.getFullYear(), d.getMonth() + 1);
  });
}

/** Returns all 12 months of the current year. */
function allYearMonths() {
  const y = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, i) => makeMonthEntry(y, i + 1));
}

/** Load extra-games from KV (updated by weekly Wikipedia cron), fall back to bundle. */
async function loadExtraGames(env) {
  try {
    const cached = await env.GAMES_KV.get('config:extra-games', 'json');
    if (cached?.games?.length) return cached.games;
  } catch { /* fall through */ }
  return extraGamesBundle.games ?? [];
}

async function processMonth(rawgKey, extraGames, env, { kvKey, dateFrom, dateTo, label }) {
  const results = await runMonthPipeline(rawgKey, dateFrom, dateTo, extraGames);
  await env.GAMES_KV.put(kvKey, JSON.stringify({ results, generatedAt: new Date().toISOString() }));
  console.log(`  ${label}: ${results.length} games → KV`);
}

// ---- daily: monthly pipeline ----

export async function runDailyCron(env) {
  const rawgKey    = env.RAWG_API_KEY;
  const extraGames = await loadExtraGames(env);
  const active     = activeMonths();
  const activeKeys = new Set(active.map(m => m.kvKey));

  // Find months of this year not yet cached — seed up to 4 extra per run
  const missing = [];
  for (const m of allYearMonths()) {
    if (activeKeys.has(m.kvKey)) continue;
    const hit = await env.GAMES_KV.get(m.kvKey);
    if (hit === null) missing.push(m);
  }
  const toProcess = [...active, ...missing.slice(0, 4)];

  console.log(`Daily cron: refreshing ${active.map(m => m.label).join(', ')}${missing.length ? `, seeding ${missing.slice(0, 4).map(m => m.label).join(', ')}` : ''}`);

  for (const month of toProcess) {
    try {
      await processMonth(rawgKey, extraGames, env, month);
    } catch (e) {
      console.error(`  ${month.label}: pipeline failed —`, e.message);
    }
  }

  try {
    const tbaResults = await runTbaPipeline(rawgKey, extraGames);
    await env.GAMES_KV.put('games:tba', JSON.stringify({ results: tbaResults, generatedAt: new Date().toISOString() }));
    console.log(`  TBA: ${tbaResults.length} games → KV`);
  } catch (e) {
    console.error('  TBA: pipeline failed —', e.message);
  }
}

// ---- seed specific months (used by temporary seeding endpoint) ----

export async function seedMonths(env, months) {
  const rawgKey    = env.RAWG_API_KEY;
  const extraGames = await loadExtraGames(env);
  for (const month of months) {
    try {
      await processMonth(rawgKey, extraGames, env, month);
    } catch (e) {
      console.error(`  ${month.label}: seed failed —`, e.message);
    }
  }
}

export { makeMonthEntry };

// ---- weekly: Wikipedia scrape ----

export async function runWeeklyWikipediaCron(env) {
  console.log('Weekly cron: Wikipedia scrape');
  const existing = await loadExtraGames(env);
  const updated  = await scrapeWikipedia(existing);
  await env.GAMES_KV.put('config:extra-games', JSON.stringify({ games: updated, updatedAt: new Date().toISOString() }));
  console.log(`Wikipedia cron done: ${updated.length} games in KV`);
}
