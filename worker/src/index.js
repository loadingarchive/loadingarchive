import { handleGames }        from './handlers/games.js';
import { handleTrailer }      from './handlers/trailer.js';
import { handleGamePage }     from './handlers/game.js';
import { handleTrendingPage } from './handlers/trending.js';
import { handleMonthPage }    from './handlers/month.js';
import { runDailyCron, runMonthsCron, runMaintenanceCron, runWeeklyWikipediaCron, runHourlyCron } from './cron/build-cache.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Apex + workers.dev → www: één canonieke host voorkomt duplicate content
    // in Google (de workers.dev-preview serveert exact dezelfde site).
    if (url.hostname === 'loadingarchive.com' || url.hostname.endsWith('.workers.dev')) {
      url.hostname = 'www.loadingarchive.com';
      return Response.redirect(url.toString(), 301);
    }
    const { pathname } = url;

    if (pathname === '/api/games')   return withSecurityHeaders(await handleGames(request, env, ctx));
    if (pathname === '/api/trailer') return withSecurityHeaders(await handleTrailer(request, env));
    if (pathname === '/trending')    return withSecurityHeaders(await handleTrendingPage(env));

    if (pathname.startsWith('/game/')) {
      const slug = pathname.slice(6).replace(/\/$/, '');
      if (slug) return withSecurityHeaders(await handleGamePage(slug, env));
    }

    // SSR maand-overzichten: /releases/2026-07 en /releases/tba
    if (pathname.startsWith('/releases/')) {
      const monthKey = pathname.slice(10).replace(/\/$/, '');
      if (monthKey) return withSecurityHeaders(await handleMonthPage(monthKey, env));
    }

    if (pathname === '/sitemap.xml') {
      const xml = await env.GAMES_KV.get('config:sitemap');
      if (xml) {
        return withSecurityHeaders(new Response(xml, {
          headers: {
            'Content-Type': 'application/xml;charset=UTF-8',
            'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
          },
        }));
      }
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },

  async scheduled(event, env, ctx) {
    // De dagelijkse keten is over drie invocaties gesplitst vanwege het
    // subrequest-budget (~1000 per invocation) — zie build-cache.js.
    switch (event.cron) {
      case '0 * * * *':  ctx.waitUntil(runHourlyCron(env)); break;
      case '0 4 * * 7':  ctx.waitUntil(runWeeklyWikipediaCron(env)); break;
      case '0 3 * * *':  ctx.waitUntil(runMonthsCron(env, 1, 6)); break;
      case '45 3 * * *': ctx.waitUntil(runMonthsCron(env, 7, 12, { withTba: true })); break;
      case '30 4 * * *': ctx.waitUntil(runMaintenanceCron(env)); break;
      // Onbekende trigger (bv. handmatige test): volledige keten als fallback.
      default:           ctx.waitUntil(runDailyCron(env));
    }
  },
};
