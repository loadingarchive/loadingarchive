const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Data verandert maar 1× per dag (nightly cron); 5 minuten edge-cache scheelt
// een KV-read per request voor populaire maanden. Zet op Cloudflare's edge via
// de Cache API — alleen een Cache-Control header op de Response zetten doet
// niets, want een Worker-response wordt niet automatisch door Cloudflare
// gecached, en de frontend fetcht zelf met { cache: 'no-store' } (dat is de
// browser-cache, een aparte laag).
const CACHE_TTL_SECONDS = 300;

export async function handleGames(request, env, ctx) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const tba   = searchParams.get('tba');

  let key;
  if (tba) {
    key = 'games:tba';
  } else {
    const target = month ?? currentMonth();
    if (!MONTH_RE.test(target)) {
      return Response.json(
        { error: 'Invalid month', detail: `Expected YYYY-MM, got "${target}"` },
        { status: 400 }
      );
    }
    key = `games:${target}`;
  }

  const cache    = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + '/api/games?key=' + key, request);
  const hit      = await cache.match(cacheKey);
  if (hit) return hit;

  const cached = await env.GAMES_KV.get(key);
  if (cached === null) {
    return Response.json(
      { error: 'Not cached yet', detail: 'The nightly cron has not run for this period yet.' },
      { status: 503 }
    );
  }

  const response = new Response(cached, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `s-maxage=${CACHE_TTL_SECONDS}`,
    },
  });
  if (ctx) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
