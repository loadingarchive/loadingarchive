import { handleGames }   from './handlers/games.js';
import { handleTrailer } from './handlers/trailer.js';
import { runDailyCron, runWeeklyWikipediaCron } from './cron/build-cache.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/games')   return handleGames(request, env);
    if (pathname === '/api/trailer') return handleTrailer(request, env);

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    // "0 4 * * 0" fires Sundays at 04:00 UTC → Wikipedia scrape
    // All other triggers (daily "0 3 * * *") → monthly pipeline
    if (event.cron === '0 4 * * 0') {
      ctx.waitUntil(runWeeklyWikipediaCron(env));
    } else {
      ctx.waitUntil(runDailyCron(env));
    }
  },
};
