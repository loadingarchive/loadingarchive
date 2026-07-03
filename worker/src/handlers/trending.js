import { siteFooterHtml } from '../ui/footer.js';

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates N bar heights that look like a natural waveform, scaled by the
 * game's relative player count. Seeded on appid so each game gets a unique
 * but consistent shape. Same dimensions as the footer dominos (3px wide, 7px gap).
 */
function sparkBars(appid, playersNow, maxPlayers, count = 14) {
  const seed = parseInt(appid, 10) || 1;
  // Log scale: 86K vs 1.1M reads as ~82% instead of 8% on a linear scale.
  const norm = maxPlayers > 1
    ? Math.log(Math.max(playersNow, 1)) / Math.log(maxPlayers)
    : 0.1;
  const maxH = 22;
  const bars = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const wave = Math.sin(seed * 0.01 + t * Math.PI * 2.3) * 0.3
               + Math.sin(seed * 0.03 + t * Math.PI * 5.1) * 0.2
               + 0.5;
    bars.push(Math.max(2, Math.round(wave * norm * maxH)));
  }
  return bars;
}

function fmtPlayers(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return n.toLocaleString('en-US');
  return String(n);
}

function renderRow(g, rank, maxPlayers) {
  const isExt  = g.link.startsWith('http');
  const bars   = sparkBars(g.appid, g.players_now, maxPlayers);
  const barHtml = bars.map(h =>
    `<span style="width:3px;height:${h}px;background:rgba(255,255,255,0.22);border-radius:1px;flex-shrink:0"></span>`
  ).join('');
  return `<a class="trend-row" href="${esc(g.link)}"${isExt ? ' target="_blank" rel="noopener"' : ''}>
    <div class="trend-left">
      <div class="trend-rank">${rank}</div>
      <div class="trend-cover-wrap">
        <img class="trend-cover" src="${esc(g.image)}" alt="" loading="${rank <= 5 ? 'eager' : 'lazy'}" onerror="this.style.opacity='0'">
      </div>
      <div class="trend-info">
        <div class="trend-name">${esc(g.name)}</div>
        ${g.developer ? `<div class="trend-dev">${esc(g.developer)}</div>` : ''}
      </div>
    </div>
    <div class="trend-spark" aria-hidden="true">${barHtml}</div>
    <div class="trend-stats">
      <div class="trend-stat-main">${fmtPlayers(g.players_now)}</div>
      <div class="trend-stat-sub">playing right now</div>
    </div>
  </a>`;
}

function renderPage(games, generatedAt) {
  const updStr = generatedAt
    ? new Date(generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
    : '';

  const maxPlayers = Math.max(...games.map(g => g.players_now), 1);
  const rows = games.map((g, i) => renderRow(g, i + 1, maxPlayers)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Most Played Games on Steam Right Now: Live Player Counts | Loading Archive</title>
<meta name="description" content="The top 20 most played games on Steam right now, ranked by live concurrent player count. Updated every hour.">
<link rel="canonical" href="https://www.loadingarchive.com/trending">
<meta property="og:type"        content="website">
<meta property="og:title"       content="Most Played Games on Steam Right Now | Loading Archive">
<meta property="og:description" content="Top 20 most played games on Steam, ranked by live player count. Updated hourly.">
<meta property="og:url"         content="https://www.loadingarchive.com/trending">
<meta property="og:site_name"   content="Loading Archive">
<meta name="twitter:card"        content="summary">
<meta name="twitter:title"       content="Most Played Games on Steam Right Now | Loading Archive">
<meta name="twitter:description" content="Top 20 most played games on Steam, ranked by live player count. Updated hourly.">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon.png">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/favicon.png">
<link rel="stylesheet" href="/css/site.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"></noscript>
<style>
/* PAGE */
.page-wrap{max-width:1060px;width:100%;margin:0 auto;padding:100px 20px 60px;flex:1}

/* HEADER ROW */
.page-header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:28px;flex-wrap:wrap}
.page-title-group{}
.page-title{font-size:22px;font-weight:700;letter-spacing:-0.01em;margin-bottom:5px}
.page-meta{font-size:11px;color:var(--dim)}

/* ROWS */
.trend-list{display:flex;flex-direction:column;gap:8px}
.trend-row{
  display:flex;align-items:center;gap:16px;
  background:var(--surface);border:1px solid var(--border);border-radius:14px;
  padding:12px 16px;text-decoration:none;color:inherit;
  transition:border-color 0.15s,background 0.15s;overflow:hidden;
}
.trend-row:hover{border-color:rgba(255,255,255,0.08);background:rgba(255,255,255,0.02)}

/* LEFT */
.trend-left{display:flex;align-items:center;gap:12px;flex:1;min-width:0}
.trend-rank{font-size:16px;font-weight:700;color:rgba(153,156,163,0.25);width:24px;flex-shrink:0;text-align:center;line-height:1}
.trend-list .trend-row:nth-child(1) .trend-rank{color:rgba(200,152,86,0.9)}
.trend-list .trend-row:nth-child(2) .trend-rank{color:rgba(200,152,86,0.55)}
.trend-list .trend-row:nth-child(3) .trend-rank{color:rgba(200,152,86,0.38)}
.trend-cover-wrap{width:80px;height:45px;border-radius:6px;overflow:hidden;background:var(--surface);flex-shrink:0}
.trend-cover{width:100%;height:100%;object-fit:cover;display:block}
.trend-info{min-width:0;flex:1}
.trend-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
.trend-dev{font-size:11px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* SPARK */
.trend-spark{display:flex;align-items:flex-end;gap:7px;height:22px;flex-shrink:0;margin:0 20px}
@media(max-width:560px){.trend-spark{display:none}}

/* STATS */
.trend-stats{flex-shrink:0;text-align:right;min-width:100px}
.trend-stat-main{font-size:16px;font-weight:700;letter-spacing:-0.01em}
.trend-stat-sub{font-size:10px;color:var(--dim);margin-top:3px}

/* RESPONSIVE */
@media(max-width:660px){
  .trend-cover-wrap{width:64px;height:36px}
  .trend-stat-main{font-size:14px}
}
@media(max-width:420px){.trend-rank{display:none}.trend-row{gap:10px}}
</style>
</head>
<body>

<!-- NAV -->
<div class="nav-wrap">
  <div class="nav-card" id="navCard">
    <div class="nav-top">
      <a class="logo" href="/">
        <svg width="22" height="21" viewBox="0 0 22 21" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect y="0.11145" width="3" height="20" fill="white"/>
          <rect x="8" y="0.11145" width="3" height="20" fill="white"/>
          <rect x="16" y="0.417511" width="3" height="20" transform="rotate(-8 16 0.417511)" fill="white"/>
        </svg>
        <span>Loading Archive</span>
      </a>
      <div class="nav-right">
        <a href="/">${new Date().getFullYear()}</a>
        <a href="/trending" class="nav-active">Trending</a>
        <a href="/contact">Contact</a>
      </div>
    </div>
  </div>
</div>

<!-- PAGE -->
<main class="page-wrap">
  <div class="page-header">
    <div class="page-title-group">
      <h1 class="page-title">Most Played on Steam</h1>
      ${updStr ? `<div class="page-meta">Updated ${updStr} · Source: Steam</div>` : '<div class="page-meta">Source: Steam</div>'}
    </div>
  </div>

  <div class="trend-list" id="trendList">
    ${rows}
  </div>
</main>

<!-- FOOTER -->
${siteFooterHtml('footerDominoRow')}

<script src="/js/domino.js"></script>
<script>
// Nav scroll shadow
window.addEventListener('scroll', () => {
  document.getElementById('navCard').classList.toggle('scrolled', scrollY > 10);
}, { passive: true });

initDominoRow('footerDominoRow');
</script>
</body>
</html>`;
}

export async function handleTrendingPage(env) {
  // Lees KV — probeer nieuwe sleutel eerst, val terug op oude
  let raw = await env.GAMES_KV.get('trending_steam');
  let isLegacy = false;
  if (!raw) {
    raw = await env.GAMES_KV.get('trending:top20');
    isLegacy = true;
  }
  if (!raw) return renderEmpty();

  let payload;
  try { payload = JSON.parse(raw); } catch { return renderEmpty(); }

  // Normaliseer legacy formaat (heeft ccu/cover/slug ipv players_now/image/link)
  let games = payload.games || [];
  if (isLegacy && games.length) {
    games = games.map(g => ({
      appid:       g.appid,
      name:        g.name,
      developer:   g.developer || '',
      image:       g.cover || `https://cdn.akamai.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
      players_now: g.ccu || 0,
      link:        g.slug ? `/game/${g.slug}` : `https://store.steampowered.com/app/${g.appid}/`,
    }));
  }

  if (!games.length) return renderEmpty();

  const top20 = games.slice(0, 20);
  const html  = renderPage(top20, payload.generatedAt || payload.updatedAt);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 's-maxage=600, stale-while-revalidate=3600',
    },
  });
}

function renderEmpty() {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Most Played on Steam | Loading Archive</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',sans-serif;background:#0E1015;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}
    h2{font-size:18px;font-weight:600;color:#999CA3;margin-bottom:10px}
    p{color:rgba(153,156,163,0.6);font-size:13px;line-height:1.7;max-width:340px}
    a{color:#1A9FFF;text-decoration:none}a:hover{color:#5BBFFF}</style>
    </head><body><div>
    <h2>Player data loading</h2>
    <p>Live player data is fetched every hour. <a href="/">Back to releases</a>.</p>
    </div></body></html>`,
    { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' } },
  );
}
