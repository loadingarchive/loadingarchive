function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PLATFORM_FULL = {
  PC: 'PC', PS4: 'PlayStation 4', PS5: 'PlayStation 5',
  XBO: 'Xbox One', XSX: 'Xbox Series X/S',
  NS: 'Nintendo Switch', NS2: 'Nintendo Switch 2',
};

function fmtDate(str) {
  if (!str) return 'TBA';
  try {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      .format(new Date(str + 'T12:00:00Z'));
  } catch { return str; }
}

function scoreClass(n) {
  if (n >= 75) return 'green';
  if (n >= 50) return 'yellow';
  return 'red';
}

export async function handleGamePage(slug, env) {
  const raw = await env.GAMES_KV.get(`game:${slug}`);
  if (!raw) return notFound();
  let game;
  try { game = JSON.parse(raw); } catch { return notFound(); }
  return new Response(renderPage(game), {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

function notFound() {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not Found | Loading Archive</title>` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<link rel="preconnect" href="https://fonts.googleapis.com">` +
    `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">` +
    `<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',sans-serif;background:#0E1015;color:#fff;` +
    `display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}` +
    `h1{font-size:64px;font-weight:700;color:rgba(255,255,255,0.1);margin-bottom:16px}` +
    `p{color:#999CA3;margin-bottom:24px}` +
    `a{color:#1A9FFF;text-decoration:none;font-weight:600}a:hover{color:#5BBFFF}</style></head>` +
    `<body><div><h1>404</h1><p>This game page doesn't exist yet.</p><a href="/">← Back to releases</a></div></body></html>`,
    { status: 404, headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  );
}


function renderPage(g) {
  const title  = esc(g.title);
  const slug   = esc(g.slug || '');
  const date   = fmtDate(g.date);
  const shots  = (g.screenshots || []).filter(Boolean);
  const genres = g.genre || [];
  const plats  = (g.platforms || []).map(p => PLATFORM_FULL[p] || p);

  const ogImg    = g.cover || shots[0] || '';
  const rawDesc  = g.short_description
    ? g.short_description.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    : `${g.title} releases ${g.date ? 'on ' + date : '(TBA)'}${plats.length ? ' for ' + plats.join(', ') : ''}.`;
  const metaDesc = esc(rawDesc.slice(0, 160));

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type':    'VideoGame',
    name:       g.title,
    ...(g.date        ? { datePublished: g.date }                                                                    : {}),
    ...(plats.length  ? { gamePlatform: plats }                                                                      : {}),
    ...(genres.length ? { genre: genres }                                                                             : {}),
    ...(ogImg         ? { image: ogImg }                                                                              : {}),
    ...(g.dev         ? { author: { '@type': 'Organization', name: g.dev } }                                         : {}),
    ...(g.steam       ? { url: `https://store.steampowered.com/app/${g.steam}` }                                     : {}),
    ...(g.metacritic  ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: g.metacritic.score, bestRating: 100, ratingCount: 1 } } : {}),
    ...(g.price && g.price !== 'TBA' ? {
      offers: { '@type': 'Offer', priceCurrency: 'USD',
                price: g.price === 'Free' ? '0.00' : g.price.replace(/[^0-9.]/g, ''),
                availability: 'https://schema.org/PreOrder' }
    } : {}),
  });

  const hasTrailer  = !!g.trailer;
  const hasReqs     = g.pc_requirements?.minimum || g.pc_requirements?.recommended;

  const carSlides = hasTrailer
    ? [`<div class="car-slide" id="carSlide0">${shots[0] ? `<img src="${esc(shots[0])}" alt="${title}" loading="eager" draggable="false">` : ''}<button class="car-play" id="heroPlay" onclick="playTrailer()" aria-label="Play trailer"${!shots[0] ? ' style="background:rgba(0,0,0,0.65)"' : ''}><div class="play-circle"><svg viewBox="0 0 24 24" fill="white"><polygon points="6,3 20,12 6,21"/></svg></div></button></div>`,
       ...shots.slice(1).map((s, i) => `<div class="car-slide"><img src="${esc(s)}" alt="" loading="${i < 3 ? 'eager' : 'lazy'}" draggable="false"></div>`)]
    : shots.map((s, i) => `<div class="car-slide"><img src="${esc(s)}" alt="" loading="${i < 2 ? 'eager' : 'lazy'}" draggable="false"></div>`);
  const totalSlides = carSlides.length;

  const ptagsHtml = (g.platforms || [])
    .map(p => `<span class="ptag">${esc(p === 'XSX' ? 'XSX/S' : p)}</span>`)
    .join('');

  const antSvg = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#antClip)"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.90647 0H4.73109L4.60851 0.125415L2.05006 2.74284C0.427325 4.403 0.427321 7.09075 2.05006 8.75092C3.67799 10.4164 6.32138 10.4164 7.9493 8.75092C9.28888 7.38046 9.52105 5.31258 8.65334 3.70021L8.40463 3.23802L8.01088 3.5851C7.73497 3.82834 7.37838 3.97365 6.98888 3.97365C6.12955 3.97365 5.4168 3.25828 5.4168 2.35573L5.41634 0.41657L5.41626 0H4.90647Z" fill="currentColor"/></g><defs><clipPath id="antClip"><rect width="10" height="10" fill="white"/></clipPath></defs></svg>`;
  const portSvg = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M8.53554 8.53554C7.59783 9.47321 6.32608 10 5 10C3.68031 10 2.70383 9.63463 1.94478 9.07575C1.68555 8.88488 1.45603 8.67437 1.25 8.45562V9.16667H0L2.72917e-08 6.875L8.295e-07 6.25H0.625H0.823867H2.91667V7.5H2.06945C2.25562 7.70913 2.45748 7.90096 2.6859 8.06913C3.21946 8.462 3.93333 8.75 5 8.75C5.99454 8.75 6.94837 8.35492 7.65167 7.65167C8.35492 6.94837 8.75 5.99454 8.75 5H10C10 6.32608 9.47321 7.59783 8.53554 8.53554ZM8.75 1.54438V0.833333H10V3.125V3.75H9.375H9.17612H7.08333V2.5H7.93054C7.74437 2.29087 7.5425 2.09903 7.31408 1.93085C6.78054 1.53802 6.06667 1.25 5 1.25C4.00544 1.25 3.05161 1.64509 2.34835 2.34835C1.64509 3.05161 1.25 4.00544 1.25 5H4.96667e-08C6.55e-08 3.67392 0.526783 2.40215 1.46447 1.46447C2.40215 0.526783 3.67392 -1.57917e-08 5 0C6.31971 1.575e-08 7.29617 0.365393 8.05521 0.924258C8.31446 1.11512 8.54396 1.32561 8.75 1.54438Z" fill="currentColor"/></svg>`;

  const metaBadges = [
    g.anticipated ? `<span class="badge badge-anticipated">${antSvg} Anticipated</span>` : '',
    g.rerelease   ? `<span class="badge badge-rerelease">${portSvg} Port · orig. ${fmtDate(g.rerelease.date)}</span>` : '',
  ].filter(Boolean).join('');

  const reqsHtml = hasReqs ? `
  <div class="section">
    <div class="section-title">System requirements</div>
    <div class="reqs-grid">
      ${g.pc_requirements?.minimum     ? `<div class="req-col"><div class="req-label">Minimum</div><div class="req-body">${g.pc_requirements.minimum}</div></div>`     : ''}
      ${g.pc_requirements?.recommended ? `<div class="req-col"><div class="req-label">Recommended</div><div class="req-body">${g.pc_requirements.recommended}</div></div>` : ''}
    </div>
  </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} – ${date} | Loading Archive</title>
<meta name="description" content="${metaDesc}">
<link rel="canonical" href="https://www.loadingarchive.com/game/${slug}">
<meta property="og:type"        content="website">
<meta property="og:title"       content="${title} | Loading Archive">
<meta property="og:description" content="${metaDesc}">
<meta property="og:url"         content="https://www.loadingarchive.com/game/${slug}">
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}">` : ''}
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:title"       content="${title} | Loading Archive">
<meta name="twitter:description" content="${metaDesc}">
${ogImg ? `<meta name="twitter:image" content="${esc(ogImg)}">` : ''}
<script type="application/ld+json">${jsonLd}</script>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
${hasTrailer ? '<script defer src="https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js"></script>' : ''}
<style>
:root {
  --bg:      #0E1015;
  --surface: #181A20;
  --border:  #292B31;
  --blue:    #1A9FFF;
  --blue-hv: #5BBFFF;
  --gold:    #C89856;
  --dim:     #999CA3;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  font-family: 'Inter', sans-serif;
  background: var(--bg);
  color: #fff;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  -webkit-font-smoothing: antialiased;
}

/* ── NAV ──────────────────────────────────────────── */
.nav-wrap {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  max-width: 1060px; margin: 0 auto;
  padding: 16px 20px 0;
  pointer-events: none;
}
.nav-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 22px; padding: 11px 20px;
  pointer-events: all;
  transition: box-shadow 0.3s ease;
  overflow: hidden;
}
.nav-card.scrolled { box-shadow: 0 12px 32px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.3); }
.nav-top { display: flex; align-items: center; justify-content: space-between; }
.logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.logo svg { width: 22px; height: 22px; flex-shrink: 0; }
.logo span { font-size: 15px; font-weight: 600; color: #fff; letter-spacing: 0.01em; }
.nav-right { display: flex; align-items: center; gap: 18px; }
.nav-right a { font-size: 10px; color: #999CA3; text-decoration: none; font-weight: 500; }
.nav-right a:hover { color: #fff; }

/* ── CAROUSEL ─────────────────────────────────────── */
.carousel { position: relative; width: 100%; overflow: hidden; user-select: none; margin-top: 82px; }
.car-track { display: flex; gap: 10px; transition: transform 0.38s cubic-bezier(0.4,0,0.2,1); will-change: transform; }
.car-slide {
  flex: 0 0 min(1020px, 100vw); width: min(1020px, 100vw); aspect-ratio: 16/9;
  position: relative; overflow: hidden; background: #0E1015;
}
.car-slide img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.car-play {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.18); border: none; cursor: pointer; transition: background 0.2s;
}
.car-play:hover { background: rgba(0,0,0,0.04); }
.play-circle {
  width: 68px; height: 68px; border-radius: 50%;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.2s, background 0.2s;
}
.car-play:hover .play-circle { transform: scale(1.08); background: rgba(0,0,0,0.72); }
.play-circle svg { width: 26px; height: 26px; margin-left: 4px; }
.car-btn {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 40px; height: 40px; border-radius: 50%;
  background: rgba(0,0,0,0.5); border: none;
  cursor: pointer; z-index: 5;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.car-btn:hover { background: rgba(0,0,0,0.82); }
.car-prev { left: max(14px, calc(50% - 496px)); }
.car-next { right: max(14px, calc(50% - 496px)); }
.car-counter {
  position: absolute; bottom: 12px; right: max(14px, calc(50% - 496px));
  font-size: 10px; font-weight: 600; color: #999CA3;
  background: rgba(0,0,0,0.55); padding: 3px 8px; border-radius: 10px;
  pointer-events: none; letter-spacing: 0.04em;
}

/* ── BACK WRAP + MAIN GRID ────────────────────────── */
.back-wrap {
  display: flex; gap: 10px; align-items: flex-start;
  max-width: 1060px;
  width: 100%;
  margin: 0 auto;
  padding: 36px 20px 80px;
  overflow: visible;
  flex: 1;
}
.back-wrap.no-carousel { padding-top: 100px; }

.back-btn {
  flex-shrink: 0; margin-left: -46px;
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface);
  border: 1px solid var(--border);
  color: #999CA3;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}
.back-btn:hover { background: var(--border); color: #fff; }
@media (max-width: 600px) { .back-btn { display: none; } }

.main-grid { flex: 1; min-width: 0; }

/* Meta row */
.meta-row {
  display: flex; align-items: center; gap: 14px;
  margin-bottom: 18px; flex-wrap: wrap;
}
.meta-date {
  font-size: 12px; color: var(--dim); font-weight: 500;
  display: flex; align-items: center; gap: 5px; flex-shrink: 0;
}
.meta-date strong { color: #fff; font-weight: 600; }
.meta-badges { display: flex; gap: 8px; margin-left: auto; flex-wrap: wrap; }
.badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 10px; font-weight: 600;
  padding: 6px 10px; border-radius: 20px; border: 1px solid;
  white-space: nowrap; height: 22px;
}
.badge-anticipated { color: var(--gold); border-color: rgba(200,152,86,0.35); background: rgba(144,116,62,0.1); }
.badge-rerelease   { color: var(--blue); border-color: rgba(26,159,255,0.35); background: rgba(26,159,255,0.08); }

/* Title + desc */
.game-title {
  font-size: clamp(24px, 3.5vw, 38px);
  font-weight: 800; letter-spacing: -0.03em; line-height: 1.1;
  margin-bottom: 14px;
}
.game-desc {
  font-size: 15px; line-height: 1.7;
  color: #999CA3;
  margin-bottom: 18px;
}
.ptags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 28px; }
.ptag {
  font-size: 9px; font-weight: 700; padding: 3px 10px;
  border-radius: 20px; color: #999CA3;
  background: rgba(153,156,163,0.08); border: 1px solid var(--border);
  letter-spacing: 0.05em;
}

/* Price card */
.price-card {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 18px 22px;
  margin-bottom: 16px; gap: 16px;
}
.price-label { font-size: 10px; color: var(--dim); font-weight: 500; margin-bottom: 5px; }
.price-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.price-value { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
.price-original { font-size: 13px; color: var(--dim); text-decoration: line-through; margin-right: 2px; }
.price-discount-badge {
  font-size: 11px; font-weight: 700; padding: 3px 7px; border-radius: 5px;
  background: rgba(76,175,80,0.18); color: #4CAF50; border: 1px solid rgba(76,175,80,0.35);
}
.cur-toggle {
  display: flex; align-items: center; gap: 2px;
  background: rgba(41,43,49,0.6); border-radius: 8px; padding: 3px;
}
.cur-btn {
  font-family: inherit; font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
  color: #999CA3; background: none; border: none;
  padding: 4px 9px; border-radius: 5px; cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.cur-btn:hover { color: #fff; }
.cur-btn.active { background: var(--border); color: #fff; }
.steam-cta {
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--blue); color: #fff;
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  text-decoration: none; padding: 10px 20px; border-radius: 8px;
  transition: background 0.15s; white-space: nowrap; flex-shrink: 0;
}
.steam-cta:hover { background: var(--blue-hv); }

/* Dev / metacritic */
.game-info-row {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  font-size: 11px; color: #999CA3;
  margin-bottom: 32px;
}
.game-info-row strong { color: #fff; }
.meta-score {
  display: inline-flex; align-items: center;
  font-size: 11px; font-weight: 700;
  padding: 2px 8px; border-radius: 4px; text-decoration: none;
}
.meta-green  { background: #1a4a14; color: #7ed47e; }
.meta-yellow { background: #4a3f14; color: #d4c46e; }
.meta-red    { background: #4a1414; color: #d47e7e; }

/* System requirements */
.section { margin-bottom: 36px; }
.section-title {
  font-size: 13px; font-weight: 700; color: #fff;
  margin-bottom: 18px; padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.reqs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 600px) { .reqs-grid { grid-template-columns: 1fr; } }
.req-label {
  font-size: 10px; font-weight: 700; color: #999CA3;
  letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 10px;
}
.req-body { font-size: 12px; color: #999CA3; line-height: 1.8; }
.req-body ul { padding-left: 18px; }
.req-body strong { color: #fff; }

/* ── FOOTER ───────────────────────────────────────── */
.site-footer { padding: 0 20px 24px; }
.footer-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  overflow: visible;
  max-width: 1020px;
  margin: 0 auto;
}
.footer-top { padding: 20px 20px 0; overflow: visible; }
.d-bar {
  background: rgba(255,255,255,0.22);
  transform-origin: bottom center;
  width: 3px; height: 100%;
  display: block; flex-shrink: 0;
}
.footer-bottom {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 20px 20px;
}
.footer-copy { font-size: 10px; color: #999CA3; }
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
        <a href="/trending">Trending</a>
        <a href="mailto:loadingarchive@outlook.com">Contact</a>
      </div>
    </div>
  </div>
</div>

${totalSlides > 0 ? `
<!-- CAROUSEL -->
<div class="carousel" id="carousel">
  <div class="car-track" id="carTrack">
    ${carSlides.join('')}
  </div>
  ${totalSlides > 1 ? `
  <button class="car-btn car-prev" id="carPrev" aria-label="Previous">
    <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 1 1 9 9 17"/></svg>
  </button>
  <button class="car-btn car-next" id="carNext" aria-label="Next">
    <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 1 9 9 1 17"/></svg>
  </button>
  <div class="car-counter" id="carCounter">1 / ${totalSlides}</div>` : ''}
</div>` : ''}

<!-- MAIN CONTENT -->
<div class="back-wrap${totalSlides === 0 ? ' no-carousel' : ''}">
  <a href="/" class="back-btn" aria-label="Back to games">
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 2 4 6 8 10"/></svg>
  </a>

  <div class="main-grid">
  <div class="meta-row">
    <div class="meta-date">Release date / <strong>${date}</strong></div>
    ${metaBadges ? `<div class="meta-badges">${metaBadges}</div>` : ''}
  </div>

  <h1 class="game-title">${title}</h1>
  ${rawDesc ? `<p class="game-desc">${esc(rawDesc)}</p>` : ''}
  ${ptagsHtml ? `<div class="ptags">${ptagsHtml}</div>` : ''}

  ${g.steam ? `
  <div class="price-card">
    <div>
      <div class="price-label">${g.price && g.discount_percent > 0 ? 'Sale price' : 'Price'}</div>
      <div class="price-row">
        ${g.price ? `
          ${g.discount_percent > 0 && g.price_initial ? `<span class="price-original" id="priceOrig">${esc(g.price_initial)}</span>` : ''}
          <div class="price-value" id="priceVal">${esc(g.price)}</div>
          ${g.discount_percent > 0 ? `<span class="price-discount-badge">-${g.discount_percent}%</span>` : ''}
          ${g.price !== 'Free' ? `
          <div class="cur-toggle" role="group" aria-label="Currency">
            <button class="cur-btn active" data-cur="USD">USD</button>
            <button class="cur-btn" data-cur="EUR">EUR</button>
            <button class="cur-btn" data-cur="GBP">GBP</button>
          </div>` : ''}
        ` : `<div class="price-value" style="color:var(--dim);font-size:16px">TBA</div>`}
      </div>
    </div>
    <a class="steam-cta" href="https://store.steampowered.com/app/${esc(g.steam)}" target="_blank" rel="noopener">View on Steam</a>
  </div>` : ''}

  ${(g.dev || g.metacritic) ? `
  <div class="game-info-row">
    ${g.dev ? `<span>Developer &nbsp;<strong>${esc(g.dev)}</strong></span>` : ''}
    ${g.metacritic ? `<a class="meta-score meta-${scoreClass(g.metacritic.score)}" href="${esc(g.metacritic.url)}" target="_blank" rel="noopener">MC ${g.metacritic.score}</a>` : ''}
  </div>` : ''}

  ${reqsHtml}

  </div><!-- /main-grid -->
</div><!-- /back-wrap -->

<!-- FOOTER -->
<footer class="site-footer">
  <div class="footer-card">
    <div class="footer-top">
      <div id="dominoRow"></div>
    </div>
    <div class="footer-bottom">
      <span class="footer-copy">&copy; Loading Archive 2026</span>
      <span class="footer-copy">All rights reserved</span>
    </div>
  </div>
</footer>

<script>
window.addEventListener('scroll', () => {
  document.getElementById('navCard').classList.toggle('scrolled', window.scrollY > 30);
}, { passive: true });

// Currency toggle — echte regionale Steam-prijzen
(function () {
  const priceEl = document.getElementById('priceVal');
  const origEl  = document.getElementById('priceOrig');
  const btns    = document.querySelectorAll('.cur-btn');
  if (!priceEl || !btns.length) return;

  // Opgeslagen Steam regionale prijzen (null = nog niet beschikbaar voor die regio)
  const PRICES = {
    USD: { final: ${JSON.stringify(g.price || null)}, initial: ${JSON.stringify(g.price_initial || null)} },
    EUR: { final: ${JSON.stringify(g.price_eur || null)}, initial: ${JSON.stringify(g.price_initial_eur || null)} },
    GBP: { final: ${JSON.stringify(g.price_gbp || null)}, initial: ${JSON.stringify(g.price_initial_gbp || null)} },
  };

  function apply(cur) {
    const p = PRICES[cur];
    if (p?.final) {
      priceEl.textContent = p.final;
      if (origEl) origEl.textContent = p.initial || '';
    } else {
      // Regionale prijs nog niet opgeslagen — toon streepje
      priceEl.textContent = '—';
      if (origEl) origEl.textContent = '';
    }
    btns.forEach(b => b.classList.toggle('active', b.dataset.cur === cur));
    try { localStorage.setItem('la_currency', cur); } catch {}
  }

  btns.forEach(btn => btn.addEventListener('click', () => apply(btn.dataset.cur)));

  let saved = 'USD';
  try { saved = localStorage.getItem('la_currency') || 'USD'; } catch {}
  if (!PRICES[saved]) saved = 'USD';
  apply(saved);
}());

// Carousel — infinite peek carousel (adjacent slides visible on sides)
(function () {
  const track   = document.getElementById('carTrack');
  if (!track) return;
  const btnPrev = document.getElementById('carPrev');
  const btnNext = document.getElementById('carNext');
  const counter = document.getElementById('carCounter');

  const real  = [...track.children];
  const total = real.length;
  if (total === 0) return;

  if (total > 1) {
    const cloneLast  = real[total - 1].cloneNode(true);
    const cloneFirst = real[0].cloneNode(true);
    [cloneLast, cloneFirst].forEach(cl => {
      cl.removeAttribute('id');
      cl.querySelectorAll('[id]').forEach(c => c.removeAttribute('id'));
    });
    track.insertBefore(cloneLast, track.firstChild);
    track.appendChild(cloneFirst);
  }
  // DOM: [cloneLast?, slide0..slideN-1, cloneFirst?]
  // cur=1 points to slide0 when total>1, cur=0 when total===1

  let cur  = total > 1 ? 1 : 0;
  let busy = false;

  const SLIDE_GAP = 10;
  function sw() { return track.children[0] ? track.children[0].offsetWidth : Math.min(1020, window.innerWidth); }
  function xFor(i) { return (window.innerWidth / 2) - i * (sw() + SLIDE_GAP) - sw() / 2; }
  function realIdx(i) {
    if (total === 1) return 0;
    if (i === 0) return total - 1;
    if (i === total + 1) return 0;
    return i - 1;
  }

  function setPos(i, animate) {
    track.style.transition = animate ? 'transform 0.38s cubic-bezier(0.4,0,0.2,1)' : 'none';
    track.style.transform  = 'translateX(' + xFor(i) + 'px)';
    cur = i;
    if (counter) counter.textContent = (realIdx(i) + 1) + ' / ' + total;
    if (animate) busy = true;
  }

  track.addEventListener('transitionend', () => {
    busy = false;
    if (total > 1) {
      if (cur === 0)           setPos(total, false);
      else if (cur === total + 1) setPos(1, false);
    }
  });

  setPos(cur, false);
  window.addEventListener('resize', () => setPos(cur, false));

  function prev() { if (!busy) setPos(cur - 1, true); }
  function next() { if (!busy) setPos(cur + 1, true); }

  if (btnPrev) btnPrev.addEventListener('click', e => { e.stopPropagation(); prev(); });
  if (btnNext) btnNext.addEventListener('click', e => { e.stopPropagation(); next(); });

  let startX = null, dragged = false;
  track.addEventListener('mousedown', e => {
    startX = e.clientX; dragged = false;
    track.style.transition = 'none'; e.preventDefault();
  });
  window.addEventListener('mouseup', e => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 50) { if (dx < 0) next(); else prev(); }
    else { setPos(cur, false); }
    startX = null;
  });
  track.addEventListener('mousemove', e => {
    if (startX === null) return;
    dragged = true;
    track.style.transform = 'translateX(' + (xFor(cur) + e.clientX - startX) + 'px)';
  });
  track.addEventListener('click', e => { if (dragged) { dragged = false; e.stopPropagation(); e.preventDefault(); } });

  let touchX = null;
  track.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) { if (dx < 0) next(); else prev(); }
    touchX = null;
  }, { passive: true });
})();

// Domino footer — continuous wave right→left, single row
(function () {
  const rowEl = document.getElementById('dominoRow');
  if (!rowEl) return;

  const GAP = 7, BAR = 3, ROW_H = 22;
  const STEP   = 40;
  const TRAIL  = 15;
  const T_FALL = 120;
  const T_RISE = 100;
  const PAUSE  = 800;

  const FULL_W = rowEl.offsetWidth || 960;
  const NCOLS  = Math.max(1, Math.floor((FULL_W + GAP) / (BAR + GAP)));

  const rowDiv = document.createElement('div');
  rowDiv.style.cssText = \`display:flex;gap:\${GAP}px;align-items:flex-end;height:\${ROW_H}px;overflow:visible\`;
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
    if (p < NCOLS) {
      bars[ci].style.transition = \`transform \${T_FALL}ms ease-in\`;
      bars[ci].style.transform  = 'rotateZ(-70deg)';
    }
    const rp = p - TRAIL;
    const rc = NCOLS - 1 - rp;
    if (rp >= 0 && rp < NCOLS) {
      bars[rc].style.transition = \`transform \${T_RISE}ms ease-out\`;
      bars[rc].style.transform  = '';
    }
    p++;
    if (p >= TOTAL) { p = 0; setTimeout(tick, PAUSE); }
    else             { setTimeout(tick, STEP); }
  }

  tick();
})();
${hasTrailer ? `
async function playTrailer() {
  const trailer = ${JSON.stringify(g.trailer)};
  const slide = document.getElementById('carSlide0');
  const play  = document.getElementById('heroPlay');
  if (play) play.style.display = 'none';

  function showMedia(el) {
    el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;background:#000;display:block';
    if (slide) {
      slide.appendChild(el);
      const img = slide.querySelector('img');
      if (img) img.style.display = 'none';
    }
  }

  if (trailer.startsWith('steam:')) {
    const appid = trailer.slice(6);
    try {
      const res  = await fetch('/api/trailer?appid=' + appid);
      const data = await res.json();
      if (data.mp4 || data.hls) {
        const v = document.createElement('video');
        v.controls = v.autoplay = v.playsInline = true;
        v.volume = 0.25;
        showMedia(v);
        if (data.mp4) {
          v.src = data.mp4;
        } else {
          if (v.canPlayType('application/vnd.apple.mpegurl')) {
            v.src = data.hls;
          } else if (window.Hls && Hls.isSupported()) {
            const hls = new Hls({ startLevel: -1 });
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              hls.currentLevel = hls.levels.length - 1;
            });
            hls.loadSource(data.hls);
            hls.attachMedia(v);
          }
        }
      } else {
        if (play) play.style.display = '';
      }
    } catch {
      if (play) play.style.display = '';
    }
  } else {
    const ytId  = 'yt_' + Date.now();
    const wrap  = document.createElement('div');
    const inner = document.createElement('div');
    inner.id = ytId;
    inner.style.cssText = 'width:100%;height:100%';
    wrap.appendChild(inner);
    showMedia(wrap);

    function initYT() {
      new YT.Player(ytId, {
        videoId: trailer,
        width: '100%', height: '100%',
        playerVars: { autoplay: 1, rel: 0 },
        events: {
          onReady: function(e) { e.target.setVolume(25); e.target.playVideo(); }
        }
      });
    }
    if (window.YT && window.YT.Player) {
      initYT();
    } else {
      window.onYouTubeIframeAPIReady = initYT;
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  }
}` : ''}
(function () {
  const titleEl = document.querySelector('.game-title');
  const btnEl   = document.querySelector('.back-btn');
  if (!titleEl || !btnEl) return;
  function align() {
    btnEl.style.marginTop = '0';
    const diff = titleEl.getBoundingClientRect().top - btnEl.getBoundingClientRect().top;
    btnEl.style.marginTop = Math.max(0, diff) + 'px';
  }
  requestAnimationFrame(align);
  window.addEventListener('resize', align);
}());
</script>
</body>
</html>`;
}
