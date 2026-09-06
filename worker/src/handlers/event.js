import { siteFooterHtml } from '../ui/footer.js';
import { isEventLive, isEventPast, isWithinRetention } from '../events-window.js';

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const NETWORK_META = {
  youtube: { label: 'YouTube', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="#FF0000" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4L15.8 12l-6.2 3.6z"/></svg>' },
  twitch:  { label: 'Twitch',  icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="#9146FF" aria-hidden="true"><path d="M11.6 4.7h1.7v5.1h-1.7zm4.7 0H18v5.1h-1.7zM4.3 0 0 4.3v15.4h5.1V24l4.3-4.3h3.4L20.6 12V0zm14.6 11.1-3.4 3.4h-3.4l-3 3v-3H5.1V1.7h13.7z"/></svg>' },
  steam:   { label: 'Steam',   icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="#66c0f4" aria-hidden="true"><path d="M12 0C5.7 0 .6 4.8 0 11l6.5 2.7a3.4 3.4 0 0 1 1.9-.6h.2l2.9-4.2v-.1a4.6 4.6 0 1 1 4.6 4.6h-.1l-4.1 3v.2a3.4 3.4 0 0 1-6.8.4L.4 15A12 12 0 1 0 12 0zm-4.5 18.2-1.5-.6a2.6 2.6 0 0 0 4.9-1.2 2.6 2.6 0 0 0-3.5-2.4l1.5.6a1.9 1.9 0 0 1-1.4 3.6zm11.6-9.4a3.1 3.1 0 1 0-6.2 0 3.1 3.1 0 0 0 6.2 0zm-5.4 0a2.3 2.3 0 1 1 4.6 0 2.3 2.3 0 0 1-4.6 0z"/></svg>' },
  twitter: { label: 'X',        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
  discord: { label: 'Discord', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5865F2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' },
  facebook:{ label: 'Facebook',icon: '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#1877F2"/><path d="M13.5 21v-7h2.3l.35-2.7h-2.65V9.5c0-.78.22-1.32 1.34-1.32h1.43V5.77c-.25-.03-1.1-.11-2.09-.11-2.07 0-3.48 1.26-3.48 3.58v2h-2.34v2.7h2.34v7z" fill="#fff"/></svg>' },
  instagram:{ label: 'Instagram', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#E4405F" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="#E4405F" stroke="none"/></svg>' },
  tiktok:  { label: 'TikTok',  icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>' },
  reddit:  { label: 'Reddit',  icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF4500" stroke-width="2" aria-hidden="true"><circle cx="12" cy="14" r="7"/><circle cx="8.5" cy="14" r="1" fill="#FF4500" stroke="none"/><circle cx="15.5" cy="14" r="1" fill="#FF4500" stroke="none"/><path d="M12 7V4M9 4h3" stroke-linecap="round"/></svg>' },
  website: { label: 'Website', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/></svg>' },
};

function fmtUtc(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
  }) + ' UTC';
}

function fmtDate(str) {
  if (!str) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
      .format(new Date(str + 'T12:00:00Z'));
  } catch {
    return null;
  }
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
    `<body><div><h1>404</h1><p>This event doesn't exist, or it already wrapped up.</p><a href="/events">← Back to events</a></div></body></html>`,
    { status: 404, headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  );
}

// g.trailer is ofwel een kaal YouTube-ID (auto, via IGDB's games.videos) of
// een volledige YouTube-URL (handmatige curatie, scripts/set-event-trailers.mjs)
// — deze haalt in beide gevallen het 11-tekens video-ID eruit voor de player.
function youtubeId(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function renderGameCard(g) {
  const date = fmtDate(g.releaseDate);
  const media = g.cover
    ? `<img class="eg-cover" src="${esc(g.cover)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('eg-noimg');this.remove()">`
    : '';
  const ytId = youtubeId(g.trailer);
  const playBadge = ytId ? `<span class="eg-play" aria-hidden="true">▶</span>` : '';
  const inner = `
    <div class="eg-media${g.cover ? '' : ' eg-noimg'}">${media}${playBadge}<span class="eg-media-fallback" aria-hidden="true">${esc((g.name || '?').slice(0, 1))}</span></div>
    <div class="eg-name">${esc(g.name)}</div>
    ${date ? `<div class="eg-date">${date}</div>` : ''}`;

  // Elke kaart opent de detail-lightbox i.p.v. te linken naar een andere
  // site (was voorheen IGDB's eigen gamepagina, of een YouTube-tab) — ook
  // zonder trailer is er meestal wel genre/platform/dev-uitgever/summary te
  // tonen. De payload gaat als JSON in een data-attribuut mee (esc() maakt
  // 'm attribuut-veilig, de lightbox-JS doet JSON.parse op dataset.game).
  const payload = JSON.stringify({
    name: g.name, yt: ytId, summary: g.summary || null,
    genres: g.genres || [], platforms: g.platforms || [],
    developer: g.developer || null, publisher: g.publisher || null,
    website: g.website || null,
  });
  return `<button type="button" class="eg-card" data-game="${esc(payload)}">${inner}</button>`;
}

function renderJsonLd(ev) {
  const base = 'https://www.loadingarchive.com';
  return JSON.stringify([
    {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: ev.name,
      startDate: new Date(ev.startTime * 1000).toISOString(),
      ...(ev.endTime ? { endDate: new Date(ev.endTime * 1000).toISOString() } : {}),
      eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
      eventStatus: 'https://schema.org/EventScheduled',
      ...(ev.description ? { description: ev.description } : {}),
      ...(ev.logo ? { image: ev.logo } : {}),
      location: { '@type': 'VirtualLocation', url: ev.streams?.[0]?.url || `${base}/events/${ev.slug}` },
      url: `${base}/events/${ev.slug}`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Loading Archive', item: `${base}/` },
        { '@type': 'ListItem', position: 2, name: 'Events', item: `${base}/events` },
        { '@type': 'ListItem', position: 3, name: ev.name, item: `${base}/events/${ev.slug}` },
      ],
    },
  ]);
}

function renderPage(ev) {
  const now    = Date.now();
  const isLive = isEventLive(ev, now);
  const isPast = isEventPast(ev, now);
  const name   = esc(ev.name);

  const links = (ev.streams || []).map(s => {
    const meta = NETWORK_META[s.network] || NETWORK_META.website;
    return `<a class="ev-link ev-link-${s.network}" href="${esc(s.url)}" target="_blank" rel="noopener">${meta.icon}<span>${meta.label}</span></a>`;
  }).join('');

  const games = ev.games || [];
  const gamesHtml = games.length
    ? `<div class="eg-grid">${games.map(renderGameCard).join('')}</div>`
    : `<div class="eg-empty">No games have been announced for this event yet.${isPast ? '' : ' Check back once the show starts — this list fills in as reveals happen.'}</div>`;

  const rawDesc  = ev.description ? String(ev.description).replace(/\s+/g, ' ').trim() : '';
  const metaDesc = esc((rawDesc || `${ev.name} — dates, start time in your timezone, stream links and every game announced there.`).slice(0, 160));
  const ogImg    = ev.logo || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — Date, Time &amp; Announced Games | Loading Archive</title>
<meta name="description" content="${metaDesc}">
<link rel="canonical" href="https://www.loadingarchive.com/events/${esc(ev.slug)}">
<meta property="og:type"        content="website">
<meta property="og:title"       content="${name} | Loading Archive">
<meta property="og:description" content="${metaDesc}">
<meta property="og:url"         content="https://www.loadingarchive.com/events/${esc(ev.slug)}">
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}">` : ''}
<meta name="twitter:card"        content="${ogImg ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title"       content="${name} | Loading Archive">
<meta name="twitter:description" content="${metaDesc}">
${ogImg ? `<meta name="twitter:image" content="${esc(ogImg)}">` : ''}
<link rel="icon" type="image/png" sizes="192x192" href="/favicon.png">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/favicon.png">
<link rel="stylesheet" href="/css/site.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"></noscript>
<script type="application/ld+json">${renderJsonLd(ev)}</script>
<style>
/* PAGE */
.page-wrap{max-width:1060px;width:100%;margin:0 auto;padding:100px 20px 60px;flex:1}
.crumbs{font-size:11px;color:var(--dim);margin-bottom:18px}
.crumbs a{color:var(--dim);text-decoration:none}
.crumbs a:hover{color:#fff}

/* HERO */
.ev-hero{
  display:flex;gap:20px;
  background:var(--surface);border:1px solid var(--border);border-radius:16px;
  padding:20px;margin-bottom:36px;overflow:hidden;
}
.ev-hero.ev-live{border-color:rgba(255,70,85,0.35)}
.ev-hero-media{position:relative;width:220px;height:124px;border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.04);flex-shrink:0}
.ev-hero-logo{width:100%;height:100%;object-fit:cover;display:block}
.ev-hero-fallback{display:none;position:absolute;inset:0;align-items:center;justify-content:center;font-size:44px;font-weight:700;color:rgba(255,255,255,0.12)}
.ev-hero-media.ev-noimg .ev-hero-fallback{display:flex}
.ev-hero-body{min-width:0;flex:1;display:flex;flex-direction:column;justify-content:center}
.ev-hero-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.ev-title{font-size:clamp(20px,3vw,28px);font-weight:800;letter-spacing:-0.02em;margin:0}
.ev-badge-live{
  font-size:10px;font-weight:700;letter-spacing:0.04em;color:#FF4655;
  background:rgba(255,70,85,0.12);border:1px solid rgba(255,70,85,0.3);
  border-radius:99px;padding:2px 8px;animation:evpulse 1.6s ease-in-out infinite;
}
@keyframes evpulse{50%{opacity:0.55}}
.ev-badge-past{font-size:10px;font-weight:700;letter-spacing:0.04em;color:var(--dim);background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:99px;padding:2px 8px}
.ev-past-note{font-size:11px;color:var(--dim);margin-top:10px}
.ev-time{font-size:13px;color:#c8d0da;margin-bottom:10px}
.ev-time-rel{color:var(--dim);margin-left:8px}
.ev-desc{font-size:13px;line-height:1.7;color:var(--dim);margin:0 0 12px}
.ev-links{display:flex;flex-wrap:wrap;gap:8px}
.ev-link{
  display:inline-flex;align-items:center;gap:6px;
  font-size:11px;font-weight:500;color:#c8d0da;text-decoration:none;
  background:rgba(255,255,255,0.04);border:1px solid var(--border);
  border-radius:8px;padding:5px 10px;transition:border-color 0.15s,color 0.15s;
}
.ev-link:hover{color:#fff;border-color:rgba(255,255,255,0.18)}

/* GAMES SECTION */
.section-title{font-size:15px;font-weight:700;margin-bottom:16px;letter-spacing:-0.01em}
.eg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:14px}
.eg-card{
  display:block;width:100%;text-align:left;font:inherit;color:inherit;
  background:var(--surface);border:1px solid var(--border);border-radius:10px;
  padding:10px;cursor:pointer;transition:border-color 0.15s;
  -webkit-appearance:none;appearance:none;
}
.eg-card:hover{border-color:rgba(255,255,255,0.18)}
.eg-media{position:relative;width:100%;aspect-ratio:3/4;border-radius:6px;overflow:hidden;background:rgba(255,255,255,0.04);margin-bottom:8px}
.eg-cover{width:100%;height:100%;object-fit:cover;display:block}
.eg-media-fallback{display:none;position:absolute;inset:0;align-items:center;justify-content:center;font-size:26px;font-weight:700;color:rgba(255,255,255,0.12)}
.eg-media.eg-noimg .eg-media-fallback{display:flex}
.eg-play{
  position:absolute;bottom:6px;right:6px;
  display:flex;align-items:center;justify-content:center;
  width:22px;height:22px;border-radius:50%;
  background:rgba(0,0,0,0.65);color:#fff;font-size:9px;
  padding-left:1px; /* optisch centreren van ▶ */
}
.eg-card:hover .eg-play{background:#1A9FFF}
.eg-name{font-size:12px;font-weight:600;line-height:1.35;margin-bottom:4px}
.eg-date{font-size:10px;color:var(--dim)}
.eg-empty{text-align:center;color:var(--dim);font-size:13px;line-height:1.7;padding:40px 20px;background:var(--surface);border:1px solid var(--border);border-radius:14px}

/* GAME DETAIL LIGHTBOX — houdt de klik binnen de site (geen navigatie naar
   YouTube/IGDB); trailer + summary/genre/platform/dev-uitgever/website. */
.eg-modal{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px}
.eg-modal[hidden]{display:none}
.eg-modal-backdrop{position:absolute;inset:0;background:rgba(6,7,10,0.85)}
.eg-modal-box{
  position:relative;z-index:1;width:100%;max-width:640px;max-height:86vh;overflow-y:auto;
  background:var(--surface);border:1px solid var(--border);border-radius:14px;
  box-shadow:0 20px 60px rgba(0,0,0,0.5);
}
.eg-modal-frame{position:relative;width:100%;aspect-ratio:16/9;background:#000}
.eg-modal-frame[hidden]{display:none}
.eg-modal-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.eg-modal-close{
  position:absolute;top:10px;right:10px;z-index:2;
  width:32px;height:32px;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.15);border-radius:8px;
  color:#fff;font-size:16px;cursor:pointer;
}
.eg-modal-close:hover{background:rgba(0,0,0,0.75)}
.eg-modal-body{padding:20px 44px 20px 20px}
.eg-modal-title{font-size:17px;font-weight:800;letter-spacing:-0.01em;margin-bottom:10px}
.eg-modal-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.eg-modal-tags[hidden]{display:none}
.eg-tag{font-size:10px;font-weight:600;color:#c8d0da;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:99px;padding:3px 9px}
.eg-modal-credits{font-size:12px;color:var(--dim);margin-bottom:10px}
.eg-modal-credits[hidden]{display:none}
.eg-modal-summary{font-size:13px;line-height:1.65;color:#c8d0da;margin-bottom:14px}
.eg-modal-summary[hidden]{display:none}
.eg-modal-site{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#1A9FFF;text-decoration:none}
.eg-modal-site:hover{color:#5BBFFF}
.eg-modal-site[hidden]{display:none}

/* RESPONSIVE */
@media(max-width:560px){
  .ev-hero{flex-direction:column}
  .ev-hero-media{width:100%;height:160px}
}
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
      <button class="nav-burger" aria-label="Menu" aria-expanded="false" onclick="this.setAttribute('aria-expanded', this.closest('.nav-card').classList.toggle('menu-open'))">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      <div class="nav-right">
        <a href="/">Releases</a>
        <a href="/trending">Trending</a>
        <a href="/events" class="nav-active">Events</a>
        <a href="/contact">Contact</a>
      </div>
    </div>
  </div>
</div>

<!-- PAGE -->
<main class="page-wrap">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Loading Archive</a> / <a href="/events">Events</a> / ${name}</nav>

  <div class="ev-hero${isLive ? ' ev-live' : ''}">
    <div class="ev-hero-media${ev.logo ? '' : ' ev-noimg'}">
      ${ev.logo ? `<img class="ev-hero-logo" src="${esc(ev.logo)}" alt="" loading="eager" onerror="this.parentNode.classList.add('ev-noimg');this.remove()">` : ''}
      <span class="ev-hero-fallback" aria-hidden="true">${esc((ev.name || '?').slice(0, 1))}</span>
    </div>
    <div class="ev-hero-body">
      <div class="ev-hero-head">
        <h1 class="ev-title">${name}</h1>
        ${isLive ? '<span class="ev-badge-live">● LIVE</span>' : isPast ? '<span class="ev-badge-past">Ended</span>' : ''}
      </div>
      <div class="ev-time" data-start="${ev.startTime}" data-end="${ev.endTime || ''}">
        <span class="ev-time-abs">${fmtUtc(ev.startTime)}</span>
        <span class="ev-time-rel"></span>
      </div>
      ${rawDesc ? `<p class="ev-desc">${esc(rawDesc)}</p>` : ''}
      ${links ? `<div class="ev-links">${links}</div>` : ''}
      ${isPast ? `<p class="ev-past-note">This event has ended — this page stays up for reference for 30 days.</p>` : ''}
    </div>
  </div>

  <h2 class="section-title">Games announced at ${name}</h2>
  ${gamesHtml}
</main>

<!-- GAME DETAIL LIGHTBOX -->
<div class="eg-modal" id="egModal" hidden>
  <div class="eg-modal-backdrop" data-eg-close></div>
  <div class="eg-modal-box">
    <button type="button" class="eg-modal-close" data-eg-close aria-label="Close">✕</button>
    <div class="eg-modal-frame" id="egModalFrame" hidden></div>
    <div class="eg-modal-body">
      <h3 class="eg-modal-title" id="egModalTitle"></h3>
      <div class="eg-modal-tags" id="egModalTags" hidden></div>
      <p class="eg-modal-credits" id="egModalCredits" hidden></p>
      <p class="eg-modal-summary" id="egModalSummary" hidden></p>
      <a class="eg-modal-site" id="egModalSite" href="#" target="_blank" rel="noopener" hidden>Visit website ↗</a>
    </div>
  </div>
</div>

<!-- FOOTER -->
${siteFooterHtml('footerDominoRow')}

<script src="/js/domino.js"></script>
<script>
window.addEventListener('scroll', () => {
  document.getElementById('navCard').classList.toggle('scrolled', scrollY > 10);
}, { passive: true });
initDominoRow('footerDominoRow');

(function () {
  try {
    var abs = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short'
    });
    var rel = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

    document.querySelectorAll('.ev-time').forEach(function (el) {
      var start = parseInt(el.dataset.start, 10) * 1000;
      if (!start) return;
      el.querySelector('.ev-time-abs').textContent = abs.format(new Date(start));

      var relEl = el.querySelector('.ev-time-rel');
      var diffMin = Math.round((start - Date.now()) / 60000);
      if (diffMin > 0) {
        if      (diffMin < 60)   relEl.textContent = '· ' + rel.format(diffMin, 'minute');
        else if (diffMin < 2880) relEl.textContent = '· ' + rel.format(Math.round(diffMin / 60), 'hour');
        else                     relEl.textContent = '· ' + rel.format(Math.round(diffMin / 1440), 'day');
      }
    });
  } catch (e) { /* oude browser: UTC-fallback blijft staan */ }
})();

// Game-detail lightbox: kaarten navigeren nergens meer naartoe, alles (trailer
// + summary/genre/platform/dev-uitgever/website) toont hier inline. Iframe
// wordt pas bij openen aangemaakt en bij sluiten weer verwijderd (i.p.v. src
// leegmaken) zodat de video ook echt stopt met afspelen.
(function () {
  var modal    = document.getElementById('egModal');
  var frame    = document.getElementById('egModalFrame');
  var title    = document.getElementById('egModalTitle');
  var tagsEl   = document.getElementById('egModalTags');
  var credits  = document.getElementById('egModalCredits');
  var summary  = document.getElementById('egModalSummary');
  var siteLink = document.getElementById('egModalSite');
  if (!modal || !frame) return;

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function openGame(g) {
    if (g.yt) {
      frame.hidden = false;
      frame.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(g.yt) +
        '?autoplay=1&rel=0" title="' + escHtml(g.name || 'Trailer') +
        '" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
    } else {
      frame.hidden = true;
      frame.innerHTML = '';
    }

    title.textContent = g.name || '';

    var tags = [].concat(g.platforms || [], g.genres || []);
    tagsEl.innerHTML = tags.map(function (t) { return '<span class="eg-tag">' + escHtml(t) + '</span>'; }).join('');
    tagsEl.hidden = tags.length === 0;

    var creditParts = [];
    if (g.developer) creditParts.push('Developer: ' + g.developer);
    if (g.publisher && g.publisher !== g.developer) creditParts.push('Publisher: ' + g.publisher);
    credits.textContent = creditParts.join(' · ');
    credits.hidden = creditParts.length === 0;

    summary.textContent = g.summary || '';
    summary.hidden = !g.summary;

    if (g.website) {
      siteLink.href = g.website;
      siteLink.hidden = false;
    } else {
      siteLink.hidden = true;
    }

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.hidden = true;
    frame.innerHTML = '';
    document.body.style.overflow = '';
  }

  document.querySelectorAll('.eg-card[data-game]').forEach(function (card) {
    card.addEventListener('click', function () {
      try { openGame(JSON.parse(card.dataset.game)); } catch (e) { /* corrupte payload, negeer klik */ }
    });
  });
  modal.querySelectorAll('[data-eg-close]').forEach(function (el) {
    el.addEventListener('click', closeModal);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });
})();
</script>
</body>
</html>`;
}

export async function handleEventPage(slug, env) {
  const data = await env.GAMES_KV.get('config:events', 'json');
  const ev = (data?.events || []).find(e => e.slug === slug);
  // Vangnet: idem als events.js — de pipeline laat events al vallen na
  // RETENTION_MS, dit beschermt alleen tegen een verdwaald oud KV-record.
  if (!ev || !isWithinRetention(ev)) return notFound();

  return new Response(renderPage(ev), {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 's-maxage=600, stale-while-revalidate=3600',
    },
  });
}
