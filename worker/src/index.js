import { handleGames }        from './handlers/games.js';
import { handleTrailer }      from './handlers/trailer.js';
import { handleGamePage }     from './handlers/game.js';
import { handleTrendingPage } from './handlers/trending.js';
import { runDailyCron, runWeeklyWikipediaCron, runHourlyCron } from './cron/build-cache.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === 'loadingarchive.com') {
      url.hostname = 'www.loadingarchive.com';
      return Response.redirect(url.toString(), 301);
    }
    const { pathname } = url;

    if (pathname === '/api/games')   return handleGames(request, env);
    if (pathname === '/api/trailer') return handleTrailer(request, env);
    if (pathname === '/trending')    return handleTrendingPage(env);

    if (pathname.startsWith('/game/')) {
      const slug = pathname.slice(6).replace(/\/$/, '');
      if (slug) return handleGamePage(slug, env);
    }

    if (pathname === '/sitemap.xml') {
      const xml = await env.GAMES_KV.get('config:sitemap');
      if (xml) {
        return new Response(xml, {
          headers: {
            'Content-Type': 'application/xml;charset=UTF-8',
            'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
          },
        });
      }
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '0 4 * * 7') {
      ctx.waitUntil(runWeeklyWikipediaCron(env));
    } else if (event.cron === '0 * * * *') {
      ctx.waitUntil(runHourlyCron(env));
    } else {
      ctx.waitUntil(runDailyCron(env));
    }
  },
};
