function fmtPlayers(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return n.toLocaleString('en-US');
  return String(n);
}

function renderRow(g, rank) {
  const isExt = g.link.startsWith('http');
  return `<a class="trend-row" href="${g.link}"${isExt ? ' target="_blank" rel="noopener"' : ''}>
    <div class="trend-left">
      <div class="trend-rank">${rank}</div>
      <div class="trend-cover-wrap">
        <img class="trend-cover" src="${g.image}" alt="" loading="${rank <= 5 ? 'eager' : 'lazy'}" onerror="this.style.opacity='0'">
      </div>
      <div class="trend-info">
        <div class="trend-name">${g.name}</div>
        ${g.developer ? `<div class="trend-dev">${g.developer}</div>` : ''}
      </div>
    </div>
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

  const rows = games.map((g, i) => renderRow(g, i + 1)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Most Played on Steam | Loading Archive</title>
<meta name="description" content="Top 10 most played games on Steam right now, by current player count.">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0E1015;--surface:#181A20;--border:#292B31;--blue:#1A9FFF;--gold:#C89856}
html{scroll-behavior:smooth}
body{font-family:'Inter',sans-serif;background:var(--bg);color:#fff;min-height:100vh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}

/* NAV */
.nav-wrap{position:fixed;top:0;left:0;right:0;z-index:100;max-width:1060px;margin:0 auto;padding:16px 20px 0}
.nav-card{background:var(--surface);border:1px solid var(--border);border-radius:22px;padding:11px 20px;transition:box-shadow 0.3s ease;overflow:hidden}
.nav-card.scrolled{box-shadow:0 12px 32px rgba(0,0,0,0.5),0 4px 12px rgba(0,0,0,0.3)}
.nav-top{display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:10px;text-decoration:none}
.logo svg{width:22px;height:22px;flex-shrink:0}
.logo span{font-size:15px;font-weight:600;color:#fff;letter-spacing:0.01em}
.nav-right{display:flex;align-items:center;gap:18px}
.nav-right a{font-size:10px;color:#999CA3;text-decoration:none;font-weight:500}
.nav-right a:hover{color:#fff}
.nav-right a.nav-active{color:#fff;font-weight:600}

/* PAGE */
.page-wrap{max-width:1060px;width:100%;margin:0 auto;padding:100px 20px 60px;flex:1}

/* HEADER ROW */
.page-header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:28px;flex-wrap:wrap}
.page-title-group{}
.page-title{font-size:22px;font-weight:700;letter-spacing:-0.01em;margin-bottom:5px}
.page-meta{font-size:11px;color:#999CA3}

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
.trend-dev{font-size:11px;color:#999CA3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* STATS */
.trend-stats{flex-shrink:0;text-align:right;min-width:100px}
.trend-stat-main{font-size:16px;font-weight:700;letter-spacing:-0.01em}
.trend-stat-sub{font-size:10px;color:#999CA3;margin-top:3px}

/* RESPONSIVE */
@media(max-width:660px){
  .trend-cover-wrap{width:64px;height:36px}
  .trend-stat-main{font-size:14px}
}
@media(max-width:420px){.trend-rank{display:none}.trend-row{gap:10px}}

/* FOOTER */
.site-footer{padding:0 20px 24px}
.footer-card{background:var(--surface);border:1px solid var(--border);border-radius:20px;overflow:visible;max-width:1020px;margin:0 auto}
.footer-top{padding:20px 20px 0;overflow:visible}
.d-bar{background:rgba(255,255,255,0.22);transform-origin:bottom center;width:3px;height:100%;display:block;flex-shrink:0}
.footer-bottom{display:flex;align-items:center;justify-content:space-between;padding:20px}
.footer-copy{font-size:10px;color:#999CA3}
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
        <a href="/">2026</a>
        <a href="/trending" class="nav-active">Trending</a>
        <a href="mailto:loadingarchive@outlook.com">Contact</a>
      </div>
    </div>
  </div>
</div>

<!-- PAGE -->
<div class="page-wrap">
  <div class="page-header">
    <div class="page-title-group">
      <h1 class="page-title">Most Played on Steam</h1>
      ${updStr ? `<div class="page-meta">Updated ${updStr} · Source: Steam</div>` : '<div class="page-meta">Source: Steam</div>'}
    </div>
  </div>

  <div class="trend-list" id="trendList">
    ${rows}
  </div>
</div>

<!-- FOOTER -->
<footer class="site-footer">
  <div class="footer-card">
    <div class="footer-top">
      <div id="footerDominoRow"></div>
    </div>
    <div class="footer-bottom">
      <span class="footer-copy">&copy; Loading Archive ${new Date().getFullYear()}</span>
      <span class="footer-copy">All rights reserved</span>
    </div>
  </div>
</footer>

<script>
// Nav scroll shadow
window.addEventListener('scroll', () => {
  document.getElementById('navCard').classList.toggle('scrolled', scrollY > 10);
}, { passive: true });

// Domino footer
(function () {
  const rowEl = document.getElementById('footerDominoRow');
  if (!rowEl) return;
  const GAP = 7, BAR = 3, ROW_H = 22;
  const STEP = 40, TRAIL = 15, T_FALL = 120, T_RISE = 100, PAUSE = 800;
  const FULL_W = rowEl.offsetWidth || 960;
  const NCOLS  = Math.max(1, Math.floor((FULL_W + GAP) / (BAR + GAP)));
  const rowDiv = document.createElement('div');
  rowDiv.style.cssText = 'display:flex;gap:' + GAP + 'px;align-items:flex-end;height:' + ROW_H + 'px;overflow:visible';
  const bars = [];
  for (let i = 0; i < NCOLS; i++) {
    const b = document.createElement('div');
    b.className = 'd-bar'; b.style.height = ROW_H + 'px';
    rowDiv.appendChild(b); bars.push(b);
  }
  rowEl.appendChild(rowDiv);
  rowEl.style.overflow = 'visible';
  const TOTAL = NCOLS + TRAIL;
  let p = 0;
  function tick() {
    const ci = NCOLS - 1 - p;
    if (p < NCOLS) { bars[ci].style.transition = 'transform ' + T_FALL + 'ms ease-in'; bars[ci].style.transform = 'rotateZ(-70deg)'; }
    const rp = p - TRAIL, rc = NCOLS - 1 - rp;
    if (rp >= 0 && rp < NCOLS) { bars[rc].style.transition = 'transform ' + T_RISE + 'ms ease-out'; bars[rc].style.transform = ''; }
    p++;
    if (p >= TOTAL) { p = 0; setTimeout(tick, PAUSE); } else { setTimeout(tick, STEP); }
  }
  tick();
}());
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

  const top10 = games.slice(0, 10);
  const html  = renderPage(top10, payload.generatedAt || payload.updatedAt);
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
