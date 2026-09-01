import { handleGames }        from './handlers/games.js';
import { handleTrailer }      from './handlers/trailer.js';
import { handleGamePage }     from './handlers/game.js';
import { handleTrendingPage } from './handlers/trending.js';
import { handleMonthPage }    from './handlers/month.js';
import { handleEventsPage }   from './handlers/events.js';
import { handleEventPage }    from './handlers/event.js';
import { runDailyCron, runMonthsCron, runMaintenanceCron, runWeeklyWikipediaCron, runHourlyCron, seedMonths, makeMonthEntry } from './cron/build-cache.js';
import { fetchAndStoreEvents } from './pipeline/igdb.js';
import { MONTH_RE, windowStartKey } from './months-window.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Eén maand kost tientallen RAWG/Steam/D1/KV-subrequests; de nachtcron is
// juist opgeknipt om onder het budget van ~1000 per invocation te blijven.
const SEED_MAX_MONTHS = 3;

// Secret-vergelijking zonder vroege exit: vergelijk SHA-256-digests met
// timingSafeEqual zodat responstijd niets over een prefix-match verklapt.
async function keysMatch(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function handleSeed(request, env) {
  const key = request.headers.get('x-seed-key');
  if (!env.SEED_KEY || !key || !(await keysMatch(key, env.SEED_KEY))) {
    return new Response('Not found', { status: 404 });
  }
  const months = (new URL(request.url).searchParams.get('months') || '')
    .split(',')
    .filter(m => MONTH_RE.test(m));
  if (!months.length) {
    return Response.json({ error: 'months=YYYY-MM[,YYYY-MM] vereist' }, { status: 400 });
  }
  // Maanden vóór het venster worden door het purge-beleid dezelfde nacht
  // weer verwijderd — seeden daarvan is dus zinloos en verwarrend.
  const tooOld = months.filter(m => m < windowStartKey());
  if (tooOld.length) {
    return Response.json(
      { error: `Maand(en) vóór het venster (${windowStartKey()}) worden 's nachts gepurged: ${tooOld.join(', ')}` },
      { status: 400 }
    );
  }
  if (months.length > SEED_MAX_MONTHS) {
    return Response.json(
      { error: `Max ${SEED_MAX_MONTHS} maanden per aanroep (subrequest-budget) — splits het verzoek op` },
      { status: 400 }
    );
  }
  const entries = months.map(m => {
    const [y, mo] = m.split('-').map(Number);
    return makeMonthEntry(y, mo);
  });
  const outcomes = await seedMonths(env, entries);
  const failed = outcomes.filter(o => !o.ok);
  return Response.json({ outcomes }, { status: failed.length ? 502 : 200 });
}

// Admin: events-KV direct verversen vanuit IGDB (bv. vlak na een deploy of
// als een showcase net is aangekondigd) i.p.v. op de uur-cron te wachten.
// Zelfde sleutelbeleid als het seed-endpoint: zonder geldige key een 404.
async function handleRefreshEvents(request, env) {
  const key = request.headers.get('x-seed-key');
  if (!env.SEED_KEY || !key || !(await keysMatch(key, env.SEED_KEY))) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const { total } = await fetchAndStoreEvents(env);
    return Response.json({ ok: true, total });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 502 });
  }
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
    // Admin: specifieke maanden direct door de pipeline halen (bv. nieuwe
    // venstermaanden na een deploy, zonder op de nachtcron te wachten).
    // Vereist de SEED_KEY-secret; zonder geldige key doet de route alsof
    // hij niet bestaat.
    if (pathname === '/api/admin/seed') return withSecurityHeaders(await handleSeed(request, env));
    if (pathname === '/api/admin/refresh-events') return withSecurityHeaders(await handleRefreshEvents(request, env));
    if (pathname === '/api/trailer') return withSecurityHeaders(await handleTrailer(request, env));
    if (pathname === '/trending')    return withSecurityHeaders(await handleTrendingPage(env));
    if (pathname === '/events')      return withSecurityHeaders(await handleEventsPage(env));

    if (pathname.startsWith('/events/')) {
      const slug = pathname.slice(8).replace(/\/$/, '');
      if (slug) return withSecurityHeaders(await handleEventPage(slug, env));
    }

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
      // Indexen in het rollende 12-maandsvenster (months-window.js), niet
      // kalendermaanden: 0–5 = eerste zes venstermaanden, 6–11 = laatste zes.
      case '0 3 * * *':  ctx.waitUntil(runMonthsCron(env, 0, 5)); break;
      case '45 3 * * *': ctx.waitUntil(runMonthsCron(env, 6, 11, { withTba: true })); break;
      case '30 4 * * *': ctx.waitUntil(runMaintenanceCron(env)); break;
      // Onbekende trigger (bv. handmatige test): volledige keten als fallback.
      default:           ctx.waitUntil(runDailyCron(env));
    }
  },
};
