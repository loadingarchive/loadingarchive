import { runMonthPipeline, runTbaPipeline } from '../pipeline/merge.js';
import { scrapeWikipedia } from '../pipeline/wikipedia.js';
// Bundled at build time by Wrangler — the bootstrap dataset scraped from Wikipedia.
// The live KV key "config:extra-games" takes precedence once the weekly cron has run.
import extraGamesBundle from '../../../api/data/extra-games.json';

// ---- helpers ----

function pad(n) { return String(n).padStart(2, '0'); }

/** Returns the 4 months the daily cron refreshes: previous, current, and next two. */
function activeMonths() {
  const today = new Date();
  return [-1, 0, 1, 2].map(delta => {
    const d = new Date(today.getFullYear(), today.getMonth() + delta, 1);
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
    return {
      kvKey:    `games:${y}-${m}`,
      dateFrom: `${y}-${m}-01`,
      dateTo:   `${y}-${m}-${lastDay}`,
      label:    `${y}-${m}`,
    };
  });
}

/** Load extra-games from KV (updated by weekly Wikipedia cron), fall back to bundle. */
async function loadExtraGames(env) {
  try {
    const cached = await env.GAMES_KV.get('config:extra-games', 'json');
    if (cached?.games?.length) return cached.games;
  } catch { /* fall through */ }
  return extraGamesBundle.games ?? [];
}

// ---- daily: monthly pipeline ----

export async function runDailyCron(env) {
  const rawgKey   = env.RAWG_API_KEY;
  const months    = activeMonths();
  const extraGames = await loadExtraGames(env);

  console.log(`Daily cron: refreshing ${months.map(m => m.label).join(', ')}`);

  for (const { kvKey, dateFrom, dateTo, label } of months) {
    try {
      const results = await runMonthPipeline(rawgKey, dateFrom, dateTo, extraGames);
      await env.GAMES_KV.put(kvKey, JSON.stringify({
        results,
        generatedAt: new Date().toISOString(),
      }));
      console.log(`  ${label}: ${results.length} games → KV`);
    } catch (e) {
      console.error(`  ${label}: pipeline failed —`, e.message);
    }
  }

  try {
    const tbaResults = await runTbaPipeline(rawgKey, extraGames);
    await env.GAMES_KV.put('games:tba', JSON.stringify({
      results: tbaResults,
      generatedAt: new Date().toISOString(),
    }));
    console.log(`  TBA: ${tbaResults.length} games → KV`);
  } catch (e) {
    console.error("  TBA: pipeline failed —", e.message);
  }
}

// ---- weekly: Wikipedia scrape ----

export async function runWeeklyWikipediaCron(env) {
  console.log("Weekly cron: Wikipedia scrape");
  const existing  = await loadExtraGames(env);
  const updated   = await scrapeWikipedia(existing);

  await env.GAMES_KV.put('config:extra-games', JSON.stringify({
    games:       updated,
    updatedAt:   new Date().toISOString(),
  }));
  console.log(`Wikipedia cron done: ${updated.length} games in KV`);
}
