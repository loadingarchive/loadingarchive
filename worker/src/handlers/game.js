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
    `<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',sans-serif;background:#0a0c10;color:#fff;` +
    `display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}` +
    `h1{font-size:64px;font-weight:700;color:rgba(255,255,255,0.1);margin-bottom:16px}` +
    `p{color:rgba(255,255,255,0.35);margin-bottom:24px}` +
    `a{color:#66A8E0;text-decoration:none;font-weight:600}a:hover{color:#8FC4F5}</style></head>` +
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

  const metaBadges = [
    g.anticipated ? `<span class="badge badge-anticipated">✦ Anticipated</span>` : '',
    g.rerelease   ? `<span class="badge badge-rerelease">↺ Re-release · orig. ${fmtDate(g.rerelease.date)}</span>` : '',
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
  --surface: #13151B;
  --border:  #1F2127;
  --blue:    #66A8E0;
  --blue-hv: #8FC4F5;
  --gold:    #CFAF5A;
  --dim:     rgba(255,255,255,0.35);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  font-family: 'Inter', sans-serif;
  background: var(--bg);
  color: #fff;
  min-height: 100vh;
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
.nav-right a { font-size: 10px; color: rgba(255,255,255,0.55); text-decoration: none; font-weight: 500; }
.nav-right a:hover { color: #fff; }

/* ── CAROUSEL ─────────────────────────────────────── */
.carousel { position: relative; width: 100%; background: #000; overflow: hidden; user-select: none; }
.car-track { display: flex; transition: transform 0.38s cubic-bezier(0.4,0,0.2,1); will-change: transform; }
.car-slide {
  flex: 0 0 100%; aspect-ratio: 16/9;
  position: relative; overflow: hidden; background: #0a0b10;
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
.car-prev { left: 14px; }
.car-next { right: 14px; }
.car-counter {
  position: absolute; bottom: 12px; right: 14px;
  font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.5);
  background: rgba(0,0,0,0.45); padding: 3px 8px; border-radius: 10px;
  pointer-events: none; letter-spacing: 0.04em;
}

/* ── MAIN GRID ────────────────────────────────────── */
.main-grid {
  max-width: 1020px; margin: 0 auto;
  padding: 28px 20px 80px;
}

/* Meta row */
.meta-row {
  display: flex; align-items: center; gap: 14px;
  margin-bottom: 18px; flex-wrap: wrap;
}
.back-link {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
  color: rgba(255,255,255,0.38); text-decoration: none;
  transition: color 0.15s; flex-shrink: 0;
}
.back-link:hover { color: #fff; }
.meta-sep { color: rgba(255,255,255,0.12); user-select: none; }
.meta-date {
  font-size: 10px; color: var(--dim); font-weight: 500;
  display: flex; align-items: center; gap: 5px; flex-shrink: 0;
}
.meta-date strong { color: rgba(255,255,255,0.82); font-weight: 600; }
.meta-badges { display: flex; gap: 8px; margin-left: auto; flex-wrap: wrap; }
.badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10px; font-weight: 600;
  padding: 4px 10px; border-radius: 20px; border: 1px solid;
  white-space: nowrap;
}
.badge-anticipated { color: var(--gold); border-color: rgba(207,175,90,0.35); background: rgba(207,175,90,0.08); }
.badge-rerelease   { color: var(--blue); border-color: rgba(102,168,224,0.35); background: rgba(102,168,224,0.08); }

/* Title + desc */
.game-title {
  font-size: clamp(24px, 3.5vw, 38px);
  font-weight: 800; letter-spacing: -0.03em; line-height: 1.1;
  margin-bottom: 14px;
}
.game-desc {
  font-size: 15px; line-height: 1.7;
  color: rgba(255,255,255,0.65);
  margin-bottom: 18px;
}
.ptags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 28px; }
.ptag {
  font-size: 9px; font-weight: 700; padding: 3px 10px;
  border-radius: 20px; color: rgba(255,255,255,0.72);
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
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
.price-value { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
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
  font-size: 11px; color: rgba(255,255,255,0.3);
  margin-bottom: 32px;
}
.game-info-row strong { color: rgba(255,255,255,0.6); }
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
  font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.9);
  margin-bottom: 18px; padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.reqs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 600px) { .reqs-grid { grid-template-columns: 1fr; } }
.req-label {
  font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.28);
  letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 10px;
}
.req-body { font-size: 12px; color: rgba(255,255,255,0.45); line-height: 1.8; }
.req-body ul { padding-left: 18px; }
.req-body strong { color: rgba(255,255,255,0.72); }

/* ── FOOTER ───────────────────────────────────────── */
.site-footer { padding: 0 20px 24px; }
.footer-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  overflow: hidden;
  max-width: 1020px;
  margin: 0 auto;
}
.footer-top {
  display: flex; flex-direction: column; gap: 7px;
  padding: 20px 20px 0;
}
.footer-brand-row { display: flex; align-items: flex-end; gap: 7px; }
.domino-wrap { flex: 1; min-width: 0; overflow: hidden; }
.d-bar {
  background: rgba(255,255,255,0.22);
  border-radius: 2px 2px 0 0;
  transform-origin: bottom center;
  width: 3px; height: 100%;
  display: block; flex-shrink: 0;
}
.footer-brand {
  flex-shrink: 0;
  display: flex; align-items: center; gap: 14px;
  padding-bottom: 4px;
}
.footer-logo-bars { display: flex; align-items: flex-end; gap: 7px; }
.footer-logo-b {
  width: 3px; background: rgba(255,255,255,0.35);
  border-radius: 2px 2px 0 0; transform-origin: bottom center; flex-shrink: 0;
}
.footer-brand span { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.35); white-space: nowrap; }
.footer-bottom {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 20px 20px;
}
.footer-copy { font-size: 10px; color: rgba(255,255,255,0.22); }
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

<!-- MAIN CONTENT — max-width 1020px -->
<div class="main-grid">

  <div class="meta-row">
    <a href="/" class="back-link">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 2 4 6 8 10"/></svg>
      Back to games
    </a>
    <span class="meta-sep">|</span>
    <div class="meta-date">Release date / <strong>${date}</strong></div>
    ${metaBadges ? `<div class="meta-badges">${metaBadges}</div>` : ''}
  </div>

  <h1 class="game-title">${title}</h1>
  ${rawDesc ? `<p class="game-desc">${esc(rawDesc)}</p>` : ''}
  ${ptagsHtml ? `<div class="ptags">${ptagsHtml}</div>` : ''}

  ${(g.price || g.steam) ? `
  <div class="price-card">
    <div>
      ${g.price ? `<div class="price-label">Base price</div><div class="price-value">${esc(g.price)}</div>` : ''}
    </div>
    ${g.steam ? `<a class="steam-cta" href="https://store.steampowered.com/app/${esc(g.steam)}" target="_blank" rel="noopener">View on Steam</a>` : ''}
  </div>` : ''}

  ${(g.dev || g.metacritic) ? `
  <div class="game-info-row">
    ${g.dev ? `<span>Developer &nbsp;<strong>${esc(g.dev)}</strong></span>` : ''}
    ${g.metacritic ? `<a class="meta-score meta-${scoreClass(g.metacritic.score)}" href="${esc(g.metacritic.url)}" target="_blank" rel="noopener">MC ${g.metacritic.score}</a>` : ''}
  </div>` : ''}

  ${reqsHtml}

</div>

<!-- FOOTER -->
<footer class="site-footer">
  <div class="footer-card">
    <div class="footer-top">
      <div id="dominoRows12"></div>
      <div class="footer-brand-row">
        <div class="domino-wrap" id="dominoRow3"></div>
        <div class="footer-brand">
          <div class="footer-logo-bars" id="footerLogoBars">
            <div class="footer-logo-b" style="height:22px"></div>
            <div class="footer-logo-b" style="height:22px"></div>
            <div class="footer-logo-b" style="height:22px;transform:rotate(-8deg)"></div>
          </div>
          <span>Loading Archive</span>
        </div>
      </div>
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

// Carousel — click arrows or drag to navigate
(function () {
  const track   = document.getElementById('carTrack');
  if (!track) return;
  const btnPrev = document.getElementById('carPrev');
  const btnNext = document.getElementById('carNext');
  const counter = document.getElementById('carCounter');
  const total   = track.children.length;
  if (total <= 1) return;
  let cur = 0;

  function goTo(n) {
    cur = ((n % total) + total) % total;
    track.style.transition = 'transform 0.38s cubic-bezier(0.4,0,0.2,1)';
    track.style.transform  = 'translateX(' + (-cur * 100) + '%)';
    if (counter) counter.textContent = (cur + 1) + ' / ' + total;
  }

  if (btnPrev) btnPrev.addEventListener('click', e => { e.stopPropagation(); goTo(cur - 1); });
  if (btnNext) btnNext.addEventListener('click', e => { e.stopPropagation(); goTo(cur + 1); });

  let startX = null, didDrag = false;
  track.addEventListener('mousedown', e => {
    startX = e.clientX; didDrag = false;
    track.style.transition = 'none'; e.preventDefault();
  });
  window.addEventListener('mouseup', e => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 50) goTo(dx < 0 ? cur + 1 : cur - 1); else goTo(cur);
    startX = null;
  });
  track.addEventListener('mousemove', e => {
    if (startX === null) return;
    didDrag = true;
    track.style.transform = 'translateX(' + (-cur * track.parentElement.offsetWidth + (e.clientX - startX)) + 'px)';
  });
  track.addEventListener('click', e => { if (didDrag) { e.stopPropagation(); e.preventDefault(); } });
  let touchStart = null;
  track.addEventListener('touchstart', e => { touchStart = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', e => {
    if (touchStart === null) return;
    const dx = e.changedTouches[0].clientX - touchStart;
    if (Math.abs(dx) > 50) goTo(dx < 0 ? cur + 1 : cur - 1);
    touchStart = null;
  }, { passive: true });
})();

// Domino footer — logo bars start cascade; sequential rise back up
(function () {
  const rows12El = document.getElementById('dominoRows12');
  const row3El   = document.getElementById('dominoRow3');
  if (!rows12El || !row3El) return;
  const GAP = 7, BAR = 3, ROW_H = 22;
  const T_FALL = 100, T_RISE = 80, T_STEP = 20, T_STEP_R = 14, T_PAUSE = 700;
  const FULL_W  = rows12El.offsetWidth || 960;
  const R3_W    = row3El.offsetWidth   || FULL_W - 160;
  const FCOLS   = Math.max(1, Math.floor((FULL_W  + GAP) / (BAR + GAP)));
  const R3COLS  = Math.max(1, Math.floor((R3_W    + GAP) / (BAR + GAP)));

  function makeRow(cols, parent) {
    const rowEl = document.createElement('div');
    rowEl.style.cssText = \`display:flex;gap:\${GAP}px;align-items:flex-end;height:\${ROW_H}px\`;
    const bars = [];
    for (let col = 0; col < cols; col++) {
      const b = document.createElement('div');
      b.className = 'd-bar'; b.style.height = ROW_H + 'px';
      rowEl.appendChild(b); bars.push(b);
    }
    parent.appendChild(rowEl);
    return bars;
  }

  rows12El.style.cssText = \`display:flex;flex-direction:column;gap:\${GAP}px\`;
  const r1 = makeRow(FCOLS,  rows12El);
  const r2 = makeRow(FCOLS,  rows12El);
  const r3 = makeRow(R3COLS, row3El);

  const logoEl   = document.getElementById('footerLogoBars');
  const logoEls  = logoEl ? [...logoEl.children] : [];
  const logoInit = new Map(logoEls.map(b => [b, b.style.transform || '']));

  // Logo bars (bottom-right) fall first, then r3→r2→r1 right-to-left each
  const fallOrd = [...logoEls.slice().reverse(), ...r3.slice().reverse(), ...r2.slice().reverse(), ...r1.slice().reverse()];
  const riseOrd = [...fallOrd].reverse();

  let idx = 0, rIdx = 0;

  function fallNext() {
    if (idx < fallOrd.length) {
      const b = fallOrd[idx++];
      b.style.transition = \`transform \${T_FALL}ms ease-in,opacity \${T_FALL}ms ease-in\`;
      b.style.transform = 'rotate(85deg)';
      b.style.opacity = '0.05';
      setTimeout(fallNext, T_STEP);
    } else {
      setTimeout(riseNext, T_PAUSE);
    }
  }

  function riseNext() {
    if (rIdx < riseOrd.length) {
      const b = riseOrd[rIdx++];
      b.style.transition = \`transform \${T_RISE}ms ease-out,opacity \${T_RISE}ms ease-out\`;
      b.style.transform = logoInit.has(b) ? logoInit.get(b) : '';
      b.style.opacity = '';
      setTimeout(riseNext, T_STEP_R);
    } else {
      rIdx = 0; idx = 0;
      setTimeout(fallNext, T_PAUSE);
    }
  }

  fallNext();
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
        showMedia(v);
        if (data.mp4) {
          v.src = data.mp4;
        } else {
          if (v.canPlayType('application/vnd.apple.mpegurl')) {
            v.src = data.hls;
          } else if (window.Hls && Hls.isSupported()) {
            const hls = new Hls();
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
    const frame = document.createElement('iframe');
    frame.src = 'https://www.youtube.com/embed/' + trailer + '?autoplay=1';
    frame.allow = 'autoplay; encrypted-media';
    frame.allowFullscreen = true;
    showMedia(frame);
  }
}` : ''}
</script>
</body>
</html>`;
}
