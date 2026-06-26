const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function handleGames(request, env) {
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

  const cached = await env.GAMES_KV.get(key);
  if (cached === null) {
    return Response.json(
      { error: 'Not cached yet', detail: 'The nightly cron has not run for this period yet.' },
      { status: 503 }
    );
  }

  return new Response(cached, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
