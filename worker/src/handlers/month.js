import { siteFooterHtml } from '../ui/footer.js';
import { MONTH_INTROS } from '../content/month-intros.js';

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const PLATFORM_LABEL = { PC:'PC', PS4:'PS4', PS5:'PS5', XBO:'XBO', XSX:'XSX/S', NS:'NS', NS2:'NS2' };

function monthLabel(key) { // "2026-07" → "July 2026"
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtDay(dateStr) { // "2026-07-09" → "Jul 9"
  try {
    const d = new Date(dateStr + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch {
    // Een niet-parsebare dateStr zou hier ongevangen een RangeError gooien en
    // de hele maandpagina laten crashen (dit draait in een .map() zonder
    // eigen try/catch in renderPage) — geef in plaats daarvan de rauwe,
    // geescapete waarde terug zodat alleen deze rij afwijkt.
    return esc(dateStr);
  }
}

// RAWG serveert covers op volledige resolutie; de rij-thumbnail is maar 92px
// breed. RAWG's CDN resize-pad: media.rawg.io/media/... → media/resize/420/-/...
function coverUrl(url, width) {
  if (!url) return url;
  return url.replace(/^https:\/\/media\.rawg\.io\/media\/(?!resize\/)/, `https://media.rawg.io/media/resize/${width}/-/`);
}

/**
 * SSR maand-overzichtspagina: /releases/2026-07
 * Crawlbaar alternatief voor de client-side homepage — targt queries als
 * "july 2026 game releases" en geeft Google echte HTML-links naar elke
 * game-detailpagina (interne linkstructuur + ItemList/Breadcrumb schema).
 */
export async function handleMonthPage(monthKey, env) {
  const isTba = monthKey === 'tba';
  if (!isTba && !MONTH_RE.test(monthKey)) return notFound();

  const raw = await env.GAMES_KV.get(isTba ? 'games:tba' : `games:${monthKey}`);
  if (!raw) return notFound();

  let payload;
  try { payload = JSON.parse(raw); } catch { return notFound(); }
  const games = payload.results || [];
  if (!games.length) return notFound();

  const label = isTba ? 'Announced Games (TBA)' : monthLabel(monthKey);
  const html  = renderPage(monthKey, label, games, isTba);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

function notFound() {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not Found | Loading Archive</title>` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">` +
    `<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#0E1015;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}` +
    `h1{font-size:64px;color:rgba(255,255,255,0.1);margin-bottom:16px}p{color:#999CA3;margin-bottom:24px}a{color:#1A9FFF;text-decoration:none;font-weight:600}</style></head>` +
    `<body><div><h1>404</h1><p>No releases listed for this period.</p><a href="/">← Back to releases</a></div></body></html>`,
    { status: 404, headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  );
}

function badge(g) {
  if (g.rerelease) {
    const isRemake = g.rerelease.type === 'remake';
    return `<span class="row-badge ${isRemake ? 'b-remake' : 'b-port'}">${isRemake ? 'Remake' : 'Port'}</span>`;
  }
  if (g.anticipated) return `<span class="row-badge b-ant">Anticipated</span>`;
  return '';
}

function renderRow(g) {
  const href  = g.slug ? `/game/${esc(g.slug)}` : null;
  const plats = (g.platforms || []).map(p => PLATFORM_LABEL[p] || p).join(' · ');
  const inner = `
    <div class="row-cover">${g.cover ? `<img src="${esc(coverUrl(g.cover, 420))}" alt="" loading="lazy" width="92" height="43">` : ''}</div>
    <div class="row-info">
      <div class="row-title">${esc(g.title)}${badge(g)}</div>
      <div class="row-meta">${plats}${(g.genre || []).length ? ` · ${esc(g.genre.join(', '))}` : ''}</div>
    </div>
    <div class="row-date">${g.date ? fmtDay(g.date) : 'TBA'}</div>`;
  return href
    ? `<a class="rel-row" href="${href}">${inner}</a>`
    : `<div class="rel-row">${inner}</div>`;
}

function renderPage(monthKey, label, games, isTba) {
  const base      = 'https://www.loadingarchive.com';
  const canonical = `${base}/releases/${monthKey}`;
  const year      = new Date().getFullYear();

  const title    = isTba
    ? `Announced Games Without a Release Date (TBA) | Loading Archive`
    : `${label} Game Releases: PC, PS5, Xbox, Switch | Loading Archive`;
  const metaDesc = isTba
    ? `All ${games.length} announced video games without a confirmed release date, with platforms, genres and details.`
    : `All ${games.length} video games releasing in ${label} with exact dates, platforms, genres, prices and trailers for PC, PlayStation 5, Xbox Series X/S and Nintendo Switch.`;

  const prevKey = isTba ? null : shiftMonth(monthKey, -1);
  const nextKey = isTba ? null : shiftMonth(monthKey, 1);
  // Alleen binnen het lopende jaar linken — daarbuiten bestaat geen KV-cache.
  const yearOf  = k => parseInt(k.slice(0, 4), 10);
  const prevOk  = prevKey && yearOf(prevKey) === yearOf(monthKey);
  const nextOk  = nextKey && yearOf(nextKey) === yearOf(monthKey);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Loading Archive', item: `${base}/` },
        { '@type': 'ListItem', position: 2, name: label, item: canonical },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: isTba ? 'Announced games (TBA)' : `${label} game releases`,
      numberOfItems: games.length,
      itemListElement: games.filter(g => g.slug).slice(0, 100).map((g, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: g.title,
        url: `${base}/game/${g.slug}`,
      })),
    },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type"        content="website">
<meta property="og:title"       content="${esc(title)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:url"         content="${canonical}">
<meta property="og:site_name"   content="Loading Archive">
<meta name="twitter:card"        content="summary">
<meta name="twitter:title"       content="${esc(title)}">
<meta name="twitter:description" content="${esc(metaDesc)}">
<script type="application/ld+json">${jsonForScript(jsonLd)}</script>
<link rel="icon" type="image/png" sizes="192x192" href="/favicon.png">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/css/site.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"></noscript>
<style>
.page-wrap{max-width:1060px;width:100%;margin:0 auto;padding:100px 20px 60px;flex:1}
.crumbs{font-size:11px;color:var(--dim);margin-bottom:14px}
.crumbs a{color:var(--dim);text-decoration:none}
.crumbs a:hover{color:#fff}
.page-title{font-size:22px;font-weight:700;letter-spacing:-0.01em;margin-bottom:5px}
.page-meta{font-size:11px;color:var(--dim);margin-bottom:24px}
.month-intro{max-width:820px;margin-bottom:28px}
.month-intro p{font-size:13px;line-height:1.75;color:#C6C8CD;margin-bottom:12px}
.month-intro strong{color:#fff;font-weight:600}

.rel-list{display:flex;flex-direction:column;gap:8px}
.rel-row{display:flex;align-items:center;gap:14px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:10px 14px;text-decoration:none;color:inherit;transition:border-color 0.15s}
a.rel-row:hover{border-color:rgba(255,255,255,0.12)}
.row-cover{width:92px;height:43px;border-radius:6px;overflow:hidden;background:rgba(255,255,255,0.03);flex-shrink:0}
.row-cover img{width:100%;height:100%;object-fit:cover;display:block}
.row-info{flex:1;min-width:0}
.row-title{font-size:13px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;display:flex;align-items:center;gap:8px}
.row-meta{font-size:11px;color:var(--dim);margin-top:3px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.row-date{flex-shrink:0;font-size:12px;font-weight:600;color:var(--dim);min-width:52px;text-align:right}

.month-pager{display:flex;justify-content:space-between;gap:12px;margin-top:28px}
.month-pager a{font-size:11px;color:var(--dim);text-decoration:none;font-weight:500;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:9px 16px}
.month-pager a:hover{color:#fff}
.month-pager .spacer{flex:1}

@media(max-width:560px){.row-cover{width:64px;height:30px}.row-meta{display:none}}
</style>
</head>
<body>

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
        <a href="/">${year}</a>
        <a href="/trending">Trending</a>
        <a href="/contact">Contact</a>
      </div>
    </div>
  </div>
</div>

<main class="page-wrap">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Loading Archive</a> / ${esc(label)}</nav>
  <h1 class="page-title">${isTba ? 'Announced Games, No Release Date Yet' : `${esc(label)} Game Releases`}</h1>
  <p class="page-meta">${games.length} games · PC, PlayStation, Xbox &amp; Nintendo Switch${payloadNote(isTba)}</p>

  ${MONTH_INTROS[monthKey] ? `<div class="month-intro prose">
    ${MONTH_INTROS[monthKey].map(p => `<p>${p}</p>`).join('\n    ')}
  </div>` : ''}

  <div class="rel-list">
    ${games.map(renderRow).join('\n    ')}
  </div>

  ${(!isTba && (prevOk || nextOk)) ? `
  <nav class="month-pager" aria-label="Months">
    ${prevOk ? `<a href="/releases/${prevKey}">← ${monthLabel(prevKey)}</a>` : '<span class="spacer"></span>'}
    ${nextOk ? `<a href="/releases/${nextKey}">${monthLabel(nextKey)} →</a>` : ''}
  </nav>` : ''}
</main>

${siteFooterHtml('footerDominoRow')}

<script src="/js/domino.js"></script>
<script>
window.addEventListener('scroll', () => {
  document.getElementById('navCard').classList.toggle('scrolled', scrollY > 10);
}, { passive: true });
initDominoRow('footerDominoRow');
</script>
</body>
</html>`;
}

function payloadNote(isTba) {
  return isTba ? ' · dates to be announced' : '';
}
