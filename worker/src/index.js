import { handleGames }   from './handlers/games.js';
import { handleTrailer } from './handlers/trailer.js';
import { runDailyCron, runWeeklyWikipediaCron } from './cron/build-cache.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === 'loadingarchive.com') {
      return Response.redirect(`https://www.loadingarchive.com${url.pathname}${url.search}`, 301);
    }
    const { pathname } = url;

    if (pathname === '/api/games')   return handleGames(request, env);
    if (pathname === '/api/trailer') return handleTrailer(request, env);

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    // "0 4 * * 7" fires Sundays at 04:00 UTC → Wikipedia scrape
    // All other triggers (daily "0 3 * * *") → monthly pipeline
    if (event.cron === '0 4 * * 7') {
      ctx.waitUntil(runWeeklyWikipediaCron(env));
    } else {
      ctx.waitUntil(runDailyCron(env));
    }
  },
};
