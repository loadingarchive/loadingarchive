function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PLATFORM_FULL = {
  PC: 'PC',
  PS4: 'PlayStation 4 / 5',
  PS5: 'PlayStation 5',
  XBO: 'Xbox One',
  XSX: 'Xbox Series X / S',
  NS: 'Nintendo Switch',
  NS2: 'Nintendo Switch 2',
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
  const title   = esc(g.title);
  const slug    = esc(g.slug || '');
  const date    = fmtDate(g.date);
  const genres  = g.genre || [];
  const plats   = (g.platforms || []).map(p => PLATFORM_FULL[p] || p);

  // deduplicate (PS4 + PS5 both map to different labels, keep unique)
  const platsUniq = [...new Set(plats)];

  const platStr = platsUniq.join(', ');
  const shots   = (g.screenshots || []).filter(Boolean);
  const ogImg   = g.cover || shots[0] || '';

  // Hero: up to 2 screenshots side-by-side; fall back to cover
  const heroMain = shots[0] || g.cover || '';
  const heroSide = shots[1] || '';
  const shot3    = shots[2] || '';

  const rawDesc = g.short_description
    ? g.short_description.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    : `${g.title} releases ${g.date ? 'on ' + date : '(TBA)'}${platStr ? ' for ' + platStr : ''}.`;
  const metaDesc = esc(rawDesc.slice(0, 160));

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: g.title,
    ...(g.date        ? { datePublished: g.date }                                         : {}),
    ...(platsUniq.length ? { gamePlatform: platsUniq }                                   : {}),
    ...(genres.length ? { genre: genres }                                                 : {}),
    ...(ogImg         ? { image: ogImg }                                                  : {}),
    ...(g.dev         ? { author: { '@type': 'Organization', name: g.dev } }              : {}),
    ...(g.steam       ? { url: `https://store.steampowered.com/app/${g.steam}` }          : {}),
    ...(g.metacritic  ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: g.metacritic.score, bestRating: 100, ratingCount: 1 } } : {}),
    ...(g.price && g.price !== 'TBA' ? {
      offers: { '@type': 'Offer', priceCurrency: 'USD', price: g.price === 'Free' ? '0.00' : g.price.replace(/[^0-9.]/g, ''), availability: 'https://schema.org/PreOrder' }
    } : {}),
  });

  // System requirements
  const hasReqs = g.pc_requirements?.minimum || g.pc_requirements?.recommended;
  const reqsHtml = hasReqs ? `
    <div class="content-section">
      <div class="content-section-title">System Requirements</div>
      <div class="reqs-grid">
        ${g.pc_requirements.minimum     ? `<div class="req-col"><div class="req-label">Minimum</div><div class="req-body">${g.pc_requirements.minimum}</div></div>`     : ''}
        ${g.pc_requirements.recommended ? `<div class="req-col"><div class="req-label">Recommended</div><div class="req-body">${g.pc_requirements.recommended}</div></div>` : ''}
      </div>
    </div>` : '';

  // Third screenshot (shown in center column below description)
  const shot3Html = shot3
    ? `<img class="extra-shot" src="${esc(shot3)}" alt="${title} screenshot" loading="lazy">`
    : '';

  // Metacritic badge
  const metaHtml = g.metacritic
    ? `<div class="sb-row">
        <span class="sb-label">Metacritic</span>
        <a class="meta-score meta-${scoreClass(g.metacritic.score)}" href="${esc(g.metacritic.url)}" target="_blank" rel="noopener">${g.metacritic.score}</a>
       </div>`
    : '';

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
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;0,800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Inter',sans-serif;background:#0a0c10;color:#fff;min-height:100vh;-webkit-font-smoothing:antialiased}

/* ── HERO SCREENSHOTS ─────────────────────────────── */
.hero-shots{display:grid;grid-template-columns:${heroSide ? '2fr 1fr' : '1fr'};height:460px;gap:5px;background:#000}
.hero-shots img{width:100%;height:100%;object-fit:cover;display:block}
@media(max-width:768px){
  .hero-shots{height:220px;grid-template-columns:1fr}
  .hero-shots .shot-side{display:none}
}

/* ── PAGE GRID ────────────────────────────────────── */
.page-grid{
  display:grid;
  grid-template-columns:160px 1fr 220px;
  gap:0 48px;
  padding:52px 48px 80px;
  max-width:1160px;
  margin:0 auto;
}
@media(max-width:1000px){
  .page-grid{grid-template-columns:1fr 220px;padding:40px 32px 60px}
  .col-left{display:none}
}
@media(max-width:640px){
  .page-grid{grid-template-columns:1fr;padding:28px 20px 60px;gap:0}
  .col-right{margin-top:40px}
}

/* ── LEFT COLUMN ──────────────────────────────────── */
.col-left{padding-top:2px}
.back-link{
  display:inline-flex;align-items:center;gap:6px;
  color:rgba(255,255,255,0.35);font-size:11px;font-weight:600;letter-spacing:0.08em;
  text-transform:uppercase;text-decoration:none;
  transition:color 0.15s;margin-bottom:44px;
}
.back-link:hover{color:#fff}
.genre-label{
  font-size:11px;font-weight:600;color:rgba(255,255,255,0.35);
  letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px
}
.left-title{font-size:30px;font-weight:800;line-height:1.1;letter-spacing:-0.03em}
@media(max-width:1000px){
  /* on 2-col layout show mobile title above center */
  .mobile-header{display:block !important}
}
.mobile-header{display:none;margin-bottom:32px}
.mobile-header .genre-label{margin-bottom:8px}
.mobile-header .left-title{font-size:26px}

/* ── CENTER COLUMN ────────────────────────────────── */
.col-main{}
.desc-lead{
  font-size:20px;font-weight:400;line-height:1.55;
  color:rgba(255,255,255,0.82);margin-bottom:36px;
}
.content-section{margin-bottom:28px}
.content-section-title{
  font-size:11px;font-weight:700;color:rgba(255,255,255,0.9);
  letter-spacing:0.04em;text-transform:uppercase;margin-bottom:8px
}
.content-section-body,.req-body{
  font-size:12.5px;color:rgba(255,255,255,0.45);line-height:1.75
}
.req-body ul{padding-left:16px}
.req-body strong{color:rgba(255,255,255,0.75)}
.reqs-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px}
@media(max-width:640px){.reqs-grid{grid-template-columns:1fr}}
.req-col{border-top:1px solid rgba(255,255,255,0.08);padding-top:12px}
.req-label{font-size:11px;font-weight:600;color:rgba(255,255,255,0.3);letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px}
.extra-shot{
  width:100%;aspect-ratio:16/9;object-fit:cover;display:block;
  margin-top:36px;border-radius:2px;
}

/* ── RIGHT SIDEBAR ────────────────────────────────── */
.col-right{padding-top:2px}
.sb-game-name{font-size:13px;font-weight:700;color:#fff;margin-bottom:4px}
.sb-price{font-size:13px;color:rgba(255,255,255,0.4);margin-bottom:20px}
.steam-btn{
  display:flex;align-items:center;justify-content:center;gap:10px;
  background:#B71C1C;color:#fff;text-decoration:none;
  font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
  padding:11px 16px;margin-bottom:32px;border-radius:2px;
  transition:background 0.15s;
}
.steam-btn:hover{background:#D32F2F}
.sb-block{margin-bottom:24px}
.sb-label{
  font-size:11px;font-weight:500;color:rgba(255,255,255,0.35);
  letter-spacing:0.04em;display:block;margin-bottom:6px
}
.sb-bigdate{font-size:21px;font-weight:700;letter-spacing:-0.025em;line-height:1.1}
.sb-platforms{font-size:16px;font-weight:700;line-height:1.5;letter-spacing:-0.02em}
.sb-row{display:flex;align-items:center;gap:10px;font-size:12px;color:rgba(255,255,255,0.35);margin-bottom:6px}
.sb-row a{color:rgba(255,255,255,0.35);text-decoration:none}
.sb-row a:hover{color:#fff}
.sb-dev-block{margin-top:28px;display:flex;flex-direction:column;gap:6px}
.meta-score{
  display:inline-block;font-size:12px;font-weight:700;
  padding:2px 8px;border-radius:3px;text-decoration:none
}
.meta-green{background:#1a4a14;color:#7ed47e}
.meta-yellow{background:#4a3f14;color:#d4c46e}
.meta-red{background:#4a1414;color:#d47e7e}
</style>
</head>
<body>

<!-- SCREENSHOTS HERO -->
<div class="hero-shots">
  ${heroMain ? `<img class="shot-main" src="${esc(heroMain)}" alt="${title}" loading="eager">` : '<div class="shot-main" style="background:#111"></div>'}
  ${heroSide ? `<img class="shot-side" src="${esc(heroSide)}" alt="${title} screenshot" loading="eager">` : ''}
</div>

<!-- PAGE GRID -->
<div class="page-grid">

  <!-- LEFT COLUMN: back link + genre + title -->
  <div class="col-left">
    <a href="/" class="back-link">← Go back</a>
    ${genres.length ? `<div class="genre-label">${esc(genres[0])}</div>` : ''}
    <h1 class="left-title">${title}</h1>
  </div>

  <!-- CENTER: mobile title, description, requirements, extra shot -->
  <div class="col-main">
    <!-- mobile-only title (hidden on desktop via col-left) -->
    <div class="mobile-header">
      ${genres.length ? `<div class="genre-label">${esc(genres[0])}</div>` : ''}
      <h1 class="left-title">${title}</h1>
    </div>

    ${rawDesc ? `<p class="desc-lead">${esc(rawDesc)}</p>` : ''}
    ${reqsHtml}
    ${shot3Html}
  </div>

  <!-- RIGHT SIDEBAR -->
  <aside class="col-right">
    <div class="sb-game-name">${title}</div>
    ${g.price ? `<div class="sb-price">${esc(g.price)}</div>` : ''}

    ${g.steam ? `<a class="steam-btn" href="https://store.steampowered.com/app/${esc(g.steam)}" target="_blank" rel="noopener">View on Steam</a>` : ''}

    <div class="sb-block">
      <span class="sb-label">Release date</span>
      <div class="sb-bigdate">${date}</div>
    </div>

    ${platsUniq.length ? `
    <div class="sb-block">
      <span class="sb-label">Available on</span>
      <div class="sb-platforms">${platsUniq.map(p => esc(p)).join('<br>')}</div>
    </div>` : ''}

    <div class="sb-dev-block">
      ${g.dev ? `<div class="sb-row"><span>Developer: ${esc(g.dev)}</span></div>` : ''}
      ${metaHtml}
    </div>
  </aside>

</div>
</body>
</html>`;
}
