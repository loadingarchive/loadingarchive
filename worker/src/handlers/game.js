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
  PS4: 'PlayStation 4',
  PS5: 'PlayStation 5',
  XBO: 'Xbox One',
  XSX: 'Xbox Series X/S',
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
    `<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',sans-serif;background:#0E1015;color:#fff;` +
    `display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}` +
    `h1{font-size:64px;font-weight:700;color:rgba(255,255,255,0.12);margin-bottom:16px}` +
    `p{color:rgba(255,255,255,0.4);margin-bottom:24px}` +
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
  const platStr = plats.join(', ');
  const shots   = (g.screenshots || []).filter(Boolean);
  const heroImg = shots[0] || g.cover || '';
  const ogImg   = g.cover || shots[0] || '';
  const hasReqs = g.pc_requirements?.minimum || g.pc_requirements?.recommended;

  const rawDesc = g.short_description
    ? g.short_description.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    : `${g.title} releases ${g.date ? 'on ' + date : '(TBA)'}${platStr ? ' for ' + platStr : ''}.`;
  const metaDesc = esc(rawDesc.slice(0, 160));

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: g.title,
    ...(g.date        ? { datePublished: g.date }                                         : {}),
    ...(plats.length  ? { gamePlatform: plats }                                           : {}),
    ...(genres.length ? { genre: genres }                                                 : {}),
    ...(ogImg         ? { image: ogImg }                                                  : {}),
    ...(g.dev         ? { author: { '@type': 'Organization', name: g.dev } }              : {}),
    ...(g.steam       ? { url: `https://store.steampowered.com/app/${g.steam}` }          : {}),
    ...(g.metacritic  ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: g.metacritic.score, bestRating: 100, ratingCount: 1 } } : {}),
    ...(g.price && g.price !== 'TBA' ? {
      offers: { '@type': 'Offer', priceCurrency: 'USD', price: g.price === 'Free' ? '0.00' : g.price.replace(/[^0-9.]/g, ''), availability: 'https://schema.org/PreOrder' }
    } : {}),
  });

  const genreBadges = genres.length
    ? `<div class="genres">${genres.map(gr => `<span class="genre-badge">${esc(gr)}</span>`).join('')}</div>`
    : '';

  const platformTags = plats.length
    ? `<div class="ptag-list">${plats.map(p => `<span class="ptag">${esc(p)}</span>`).join('')}</div>`
    : `<span class="info-value">—</span>`;

  const metacriticHtml = g.metacritic
    ? `<div class="info-row"><span class="info-label">Metacritic</span>` +
      `<a class="meta-badge meta-${scoreClass(g.metacritic.score)}" href="${esc(g.metacritic.url)}" target="_blank" rel="noopener">${g.metacritic.score}</a></div>`
    : '';

  const steamHtml = g.steam
    ? `<a class="steam-btn" href="https://store.steampowered.com/app/${esc(g.steam)}" target="_blank" rel="noopener">View on Steam ↗</a>`
    : '';

  const priceHtml = g.price
    ? `<div class="price-tag${g.price === 'Free' ? ' price-free' : ''}">${esc(g.price)}</div>`
    : '';

  const shortDescHtml = g.short_description
    ? `<p class="short-desc">${esc(g.short_description.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())}</p>`
    : '';

  const reqsHtml = hasReqs
    ? `<div class="section">
        <h2 class="section-title">System Requirements</h2>
        <div class="reqs-grid">
          ${g.pc_requirements.minimum    ? `<div class="req-col"><h3>Minimum</h3><div class="req-body">${g.pc_requirements.minimum}</div></div>`    : ''}
          ${g.pc_requirements.recommended? `<div class="req-col"><h3>Recommended</h3><div class="req-body">${g.pc_requirements.recommended}</div></div>` : ''}
        </div>
      </div>`
    : '';

  const screenshotsHtml = shots.length
    ? `<div class="section">
        <h2 class="section-title">Screenshots</h2>
        <div class="screenshots-grid">
          ${shots.map(url => `<img src="${esc(url)}" alt="${title} screenshot" loading="lazy">`).join('')}
        </div>
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
${ogImg ? `<meta property="og:image"       content="${esc(ogImg)}">` : ''}
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:title"       content="${title} | Loading Archive">
<meta name="twitter:description" content="${metaDesc}">
${ogImg ? `<meta name="twitter:image"       content="${esc(ogImg)}">` : ''}
<script type="application/ld+json">${jsonLd}</script>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#0E1015;--surface:#13151B;--border:#1F2127;--blue:#66A8E0;--gold:#CFAF5A;--dim:rgba(255,255,255,0.35)}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Inter',sans-serif;background:var(--bg);color:#fff;min-height:100vh;-webkit-font-smoothing:antialiased}

.top-nav{position:sticky;top:0;z-index:100;background:rgba(14,16,21,0.88);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;justify-content:space-between}
.back-link{color:var(--blue);text-decoration:none;font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;transition:color 0.15s}
.back-link:hover{color:#8FC4F5}
.nav-logo{font-size:13px;font-weight:600;color:rgba(255,255,255,0.35);letter-spacing:0.02em}

.hero{width:100%;height:320px;background:var(--surface) center/cover no-repeat;position:relative}
.hero::after{content:'';position:absolute;inset:0;background:linear-gradient(to bottom,rgba(14,16,21,0) 30%,var(--bg) 100%)}
@media(max-width:640px){.hero{height:200px}}

.container{max-width:1000px;margin:0 auto;padding:0 24px 80px}

.game-header{margin-top:-72px;position:relative;z-index:1;display:grid;grid-template-columns:1fr 272px;gap:28px;align-items:start}
@media(max-width:700px){.game-header{grid-template-columns:1fr;margin-top:-48px}}

.game-main h1{font-size:28px;font-weight:700;line-height:1.2;letter-spacing:-0.025em;margin-bottom:14px}
@media(max-width:640px){.game-main h1{font-size:22px}}

.genres{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.genre-badge{background:var(--surface);border:1px solid var(--border);color:rgba(255,255,255,0.55);font-size:11px;font-weight:500;padding:3px 10px;border-radius:20px}

.dev-line{font-size:12px;color:var(--dim);margin-bottom:14px}
.short-desc{font-size:14px;color:rgba(255,255,255,0.68);line-height:1.75;max-width:560px}

.sidebar-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:16px}
.price-tag{font-size:22px;font-weight:700}
.price-free{color:var(--blue)}
.steam-btn{display:block;text-align:center;background:var(--blue);color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 16px;border-radius:8px;transition:background 0.15s}
.steam-btn:hover{background:#8FC4F5}

.info-rows{display:flex;flex-direction:column;gap:11px}
.info-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;font-size:12px}
.info-label{color:var(--dim);flex-shrink:0;padding-top:2px}
.info-value{color:rgba(255,255,255,0.82);text-align:right}
.ptag-list{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end}
.ptag{background:rgba(255,255,255,0.06);border:1px solid var(--border);color:rgba(255,255,255,0.6);font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;letter-spacing:0.03em}
.meta-badge{display:inline-block;font-size:14px;font-weight:700;padding:3px 10px;border-radius:6px;text-decoration:none;line-height:1.4}
.meta-green{background:#2d5a27;color:#7ed47e}
.meta-yellow{background:#5a4d1a;color:#d4c46e}
.meta-red{background:#5a1f1f;color:#d47e7e}

.section{margin-top:48px}
.section-title{font-size:15px;font-weight:600;margin-bottom:18px;padding-bottom:10px;border-bottom:1px solid var(--border);letter-spacing:-0.01em}

.reqs-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:580px){.reqs-grid{grid-template-columns:1fr}}
.req-col{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px}
.req-col h3{font-size:11px;font-weight:600;color:var(--dim);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px}
.req-body{font-size:11.5px;color:rgba(255,255,255,0.55);line-height:1.7}
.req-body ul{padding-left:14px}
.req-body strong{color:rgba(255,255,255,0.8)}

.screenshots-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.screenshots-grid img{width:100%;border-radius:8px;border:1px solid var(--border);display:block;object-fit:cover;aspect-ratio:16/9}
</style>
</head>
<body>

<nav class="top-nav">
  <a href="/" class="back-link">← Back to releases</a>
  <span class="nav-logo">Loading Archive</span>
</nav>

<div class="hero"${heroImg ? ` style="background-image:url('${esc(heroImg)}')"` : ''}></div>

<div class="container">
  <div class="game-header">

    <div class="game-main">
      <h1>${title}</h1>
      ${genreBadges}
      ${g.dev ? `<p class="dev-line">by ${esc(g.dev)}</p>` : ''}
      ${shortDescHtml}
    </div>

    <aside>
      <div class="sidebar-card">
        ${priceHtml}
        ${steamHtml}
        <div class="info-rows">
          <div class="info-row">
            <span class="info-label">Release</span>
            <span class="info-value">${date}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Platforms</span>
            ${platformTags}
          </div>
          ${g.dev ? `<div class="info-row"><span class="info-label">Developer</span><span class="info-value">${esc(g.dev)}</span></div>` : ''}
          ${metacriticHtml}
        </div>
      </div>
    </aside>

  </div>

  ${reqsHtml}
  ${screenshotsHtml}

</div>
</body>
</html>`;
}
