function parseOwnersMin(ownersStr) {
  if (!ownersStr) return 0;
  const m = ownersStr.match(/^([\d,]+)/);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
}

function fmtPlayers(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'K';
  return n.toLocaleString('en-US');
}

function fmtOwners(ownersStr) {
  if (!ownersStr) return '';
  const m = ownersStr.match(/^([\d,]+)/);
  if (!m) return '';
  const n = parseInt(m[1].replace(/,/g, ''), 10);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(0) + 'M+ owners';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'K+ owners';
  return '';
}

function renderRow(g, rank) {
  const link  = g.slug ? `/game/${g.slug}` : `https://store.steampowered.com/app/${g.appid}`;
  const isExt = !g.slug;
  const owners = fmtOwners(g.owners);

  return `<a class="trend-row" href="${link}"${isExt ? ' target="_blank" rel="noopener"' : ''}>
    <div class="trend-left">
      <div class="trend-rank">${rank}</div>
      <div class="trend-cover-wrap">
        <img class="trend-cover" src="${g.cover}" alt="" loading="${rank <= 5 ? 'eager' : 'lazy'}" onerror="this.style.opacity='0'">
      </div>
      <div class="trend-info">
        <div class="trend-name">${g.name}</div>
        ${g.developer ? `<div class="trend-dev">${g.developer}${owners ? ` · ${owners}` : ''}</div>` : (owners ? `<div class="trend-dev">${owners}</div>` : '')}
      </div>
    </div>
    <div class="trend-spark" data-appid="${g.appid}"></div>
    <div class="trend-stats">
      <div class="trend-stat-main">${fmtPlayers(g.ccu)}</div>
      <div class="trend-stat-sub">peak concurrent</div>
    </div>
  </a>`;
}

function renderPage(top20, histByCcu, updatedAt) {
  const top10  = top20.slice(0, 10);
  const updStr = updatedAt
    ? new Date(updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
    : '';

  const rows = top10.map((g, i) => renderRow(g, i + 1)).join('');

  // Serialiseer history als compacte JSON voor client-side sparklines
  // { "730": [{ d: "2026-06-28", c: 1435957 }, ...], ... }
  const histJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(histByCcu).map(([appid, pts]) => [appid, pts])
    )
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trending Games | Loading Archive</title>
<meta name="description" content="Top 10 trending games on Steam right now, sorted by peak concurrent players.">
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

/* RANGE FILTER */
.range-bar{display:flex;gap:3px;background:rgba(41,43,49,0.5);border-radius:10px;padding:3px}
.range-btn{font-family:inherit;font-size:11px;font-weight:600;letter-spacing:0.02em;color:#999CA3;background:none;border:none;padding:5px 13px;border-radius:7px;cursor:pointer;transition:color 0.15s,background 0.15s}
.range-btn:hover{color:#fff}
.range-btn.active{background:var(--border);color:#fff}

/* ROWS */
.trend-list{display:flex;flex-direction:column;gap:8px}
.trend-row{
  display:flex;align-items:center;gap:16px;
  background:var(--surface);border:1px solid var(--border);border-radius:14px;
  padding:12px 16px;text-decoration:none;color:inherit;
  transition:border-color 0.15s,background 0.15s;overflow:hidden;
}
.trend-row:hover{border-color:var(--border);background:var(--surface)}

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

/* SPARKLINE */
.trend-spark{flex-shrink:0;width:220px;height:52px;position:relative;transition:opacity 0.18s}
.trend-spark svg{width:100%;height:100%;display:block;overflow:visible}
.spark-label{position:absolute;bottom:2px;left:4px;font-size:9px;font-weight:600;letter-spacing:0.06em;color:rgba(153,156,163,0.4);pointer-events:none;font-family:inherit}

/* STATS */
.trend-stats{flex-shrink:0;text-align:right;min-width:100px}
.trend-stat-main{font-size:16px;font-weight:700;letter-spacing:-0.01em}
.trend-stat-sub{font-size:10px;color:#999CA3;margin-top:3px}

/* RESPONSIVE */
@media(max-width:860px){.trend-spark{width:160px}}
@media(max-width:660px){
  .trend-spark{display:none}
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
      <h1 class="page-title">Trending on Steam</h1>
      ${updStr ? `<div class="page-meta">Updated ${updStr} · Source: Steam API</div>` : '<div class="page-meta">Source: Steam API</div>'}
    </div>
    <div class="range-bar" id="rangeBar" role="group" aria-label="Time range">
      <button class="range-btn active" data-days="7">7D</button>
      <button class="range-btn" data-days="30">1M</button>
      <button class="range-btn" data-days="90">3M</button>
      <button class="range-btn" data-days="365">1Y</button>
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
// History data van server: { appid: [{ d: "YYYY-MM-DD", c: number }, ...] }
const HISTORY = ${histJson};

// --- Sparkline ---
function buildSpark(ccus, W, H) {
  if (!ccus.length) {
    return '<svg viewBox="0 0 ' + W + ' ' + H + '"><text x="' + (W/2) + '" y="' + (H/2+4) + '" text-anchor="middle" fill="#292B31" font-size="9" font-family="Inter,sans-serif">Collecting data…</text></svg>';
  }
  if (ccus.length === 1) {
    const cy = H / 2;
    return '<svg viewBox="0 0 ' + W + ' ' + H + '"><line x1="0" y1="' + cy + '" x2="' + W + '" y2="' + cy + '" stroke="rgba(26,159,255,0.15)" stroke-width="1.5" stroke-dasharray="4 4"/><circle cx="' + (W/2) + '" cy="' + cy + '" r="3.5" fill="#1A9FFF" stroke="#0E1015" stroke-width="1.5"/></svg>';
  }

  const PAD = 6;
  const max = Math.max(...ccus), min = Math.min(...ccus);
  const range = max - min || 1;
  const pts = ccus.map((v, i) => ({
    x: PAD + (i / (ccus.length - 1)) * (W - PAD * 2),
    y: PAD + (1 - (v - min) / range) * (H - PAD * 2),
  }));

  let line = 'M ' + pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i-1], c = pts[i];
    const cpx = ((p.x + c.x) / 2).toFixed(1);
    line += ' C ' + cpx + ',' + p.y.toFixed(1) + ' ' + cpx + ',' + c.y.toFixed(1) + ' ' + c.x.toFixed(1) + ',' + c.y.toFixed(1);
  }
  const last = pts[pts.length - 1];
  const area = line + ' L ' + last.x.toFixed(1) + ',' + H + ' L ' + pts[0].x.toFixed(1) + ',' + H + ' Z';
  const gid  = 'sg' + Math.random().toString(36).slice(2, 7);

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
    '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#1A9FFF" stop-opacity="0.25"/>' +
    '<stop offset="100%" stop-color="#1A9FFF" stop-opacity="0.02"/>' +
    '</linearGradient></defs>' +
    '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
    '<path d="' + line + '" fill="none" stroke="#1A9FFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="3" fill="#1A9FFF" stroke="#0E1015" stroke-width="1.5"/>' +
    '</svg>';
}

const RANGE_LABELS = { 7: '7D', 30: '1M', 90: '3M', 365: '1Y' };

function renderSparks(days) {
  const cutoff = days
    ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    : '0000-00-00';
  const label = RANGE_LABELS[days] || '';

  document.querySelectorAll('.trend-spark[data-appid]').forEach(el => {
    const appid   = el.dataset.appid;
    const allPts  = HISTORY[appid] || [];
    const filtered = allPts.filter(p => p.d >= cutoff);
    const ccus    = filtered.map(p => p.c);
    const W       = el.offsetWidth || 220;
    el.innerHTML  = buildSpark(ccus, W, 52)
      + (label ? '<span class="spark-label">' + label + '</span>' : '');
  });
}

// Range filter — fade out → update → fade in
let activeDays = 7;
document.getElementById('rangeBar').addEventListener('click', e => {
  const btn = e.target.closest('.range-btn');
  if (!btn || btn.classList.contains('active')) return;
  activeDays = Number(btn.dataset.days);
  document.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('active', b === btn));
  const sparks = document.querySelectorAll('.trend-spark[data-appid]');
  sparks.forEach(el => { el.style.opacity = '0'; });
  setTimeout(() => {
    renderSparks(activeDays);
    sparks.forEach(el => { el.style.opacity = ''; });
  }, 180);
});

// Nav scroll shadow
window.addEventListener('scroll', () => {
  document.getElementById('navCard').classList.toggle('scrolled', scrollY > 10);
}, { passive: true });

// Initial render — wait for layout so offsetWidth is correct
requestAnimationFrame(() => requestAnimationFrame(() => renderSparks(activeDays)));

// Domino footer — identical to main page
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
  const raw = await env.GAMES_KV.get('trending:top20');
  if (!raw) return renderEmpty();

  let payload;
  try { payload = JSON.parse(raw); } catch { return renderEmpty(); }

  const top20 = payload.games || [];
  if (!top20.length) return renderEmpty();

  // Historische CCU-data uit D1 (max 365 dagen voor het 1Y filter)
  const appids  = top20.map(g => g.appid);
  const holders = appids.map((_, i) => `?${i + 1}`).join(',');
  const cutoff  = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);

  let histRows = [];
  try {
    const { results } = await env.GAMES_D1
      .prepare(
        `SELECT appid, recorded_at, ccu FROM trending_history
         WHERE appid IN (${holders}) AND recorded_at >= ?${appids.length + 1}
         ORDER BY appid, recorded_at`
      )
      .bind(...appids, cutoff)
      .all();
    histRows = results;
  } catch (e) {
    console.error('trending_history query mislukt:', e.message);
  }

  // Groepeer als { appid: [{ d, c }, ...] } voor client-side filtering
  const histByCcu = {};
  for (const r of histRows) {
    (histByCcu[r.appid] = histByCcu[r.appid] || []).push({ d: r.recorded_at, c: r.ccu });
  }

  const html = renderPage(top20, histByCcu, payload.updatedAt);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 's-maxage=1800, stale-while-revalidate=7200',
    },
  });
}

function renderEmpty() {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Trending | Loading Archive</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',sans-serif;background:#0E1015;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}
    h2{font-size:18px;font-weight:600;color:#999CA3;margin-bottom:10px}
    p{color:rgba(153,156,163,0.6);font-size:13px;line-height:1.7;max-width:340px}
    a{color:#1A9FFF;text-decoration:none}a:hover{color:#5BBFFF}</style>
    </head><body><div>
    <h2>Trending data wordt geladen</h2>
    <p>De eerste snapshot wordt opgehaald door de dagelijkse cron om 03:00 UTC. <a href="/">Terug naar releases</a>.</p>
    </div></body></html>`,
    { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' } },
  );
}
