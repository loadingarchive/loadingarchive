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

function renderGameCard(g) {
  const date = fmtDate(g.releaseDate);
  const media = g.cover
    ? `<img class="eg-cover" src="${esc(g.cover)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('eg-noimg');this.remove()">`
    : '';
  const inner = `
    <div class="eg-media${g.cover ? '' : ' eg-noimg'}">${media}<span class="eg-media-fallback" aria-hidden="true">${esc((g.name || '?').slice(0, 1))}</span></div>
    <div class="eg-name">${esc(g.name)}</div>
    ${date ? `<div class="eg-date">${date}</div>` : ''}`;

  return g.url
    ? `<a class="eg-card" href="${esc(g.url)}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="eg-card">${inner}</div>`;
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
  display:block;text-decoration:none;color:inherit;
  background:var(--surface);border:1px solid var(--border);border-radius:10px;
  padding:10px;transition:border-color 0.15s;
}
a.eg-card:hover{border-color:rgba(255,255,255,0.18)}
.eg-media{position:relative;width:100%;aspect-ratio:3/4;border-radius:6px;overflow:hidden;background:rgba(255,255,255,0.04);margin-bottom:8px}
.eg-cover{width:100%;height:100%;object-fit:cover;display:block}
.eg-media-fallback{display:none;position:absolute;inset:0;align-items:center;justify-content:center;font-size:26px;font-weight:700;color:rgba(255,255,255,0.12)}
.eg-media.eg-noimg .eg-media-fallback{display:flex}
.eg-name{font-size:12px;font-weight:600;line-height:1.35;margin-bottom:4px}
.eg-date{font-size:10px;color:var(--dim)}
.eg-empty{text-align:center;color:var(--dim);font-size:13px;line-height:1.7;padding:40px 20px;background:var(--surface);border:1px solid var(--border);border-radius:14px}

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
