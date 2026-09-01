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

// Server-side fallback in UTC — zichtbaar voor crawlers en zonder JS; de
// client herschrijft dit direct naar de lokale tijd van de bezoeker.
function fmtUtc(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
  }) + ' UTC';
}

function renderCard(ev, now) {
  const isLive = isEventLive(ev, now);
  const isPast = isEventPast(ev, now);

  const links = (ev.streams || []).map(s => {
    const meta = NETWORK_META[s.network] || NETWORK_META.website;
    return `<a class="ev-link ev-link-${s.network}" href="${esc(s.url)}" target="_blank" rel="noopener">${meta.icon}<span>${meta.label}</span></a>`;
  }).join('');

  const media = ev.logo
    ? `<img class="ev-logo" src="${esc(ev.logo)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('ev-noimg');this.remove()">`
    : '';

  const gameCount = (ev.games || []).length;

  return `<article class="ev-card${isLive ? ' ev-live' : ''}${isPast ? ' ev-past' : ''}${ev.logo ? '' : ' ev-noimg'}">
    <a class="ev-card-overlay" href="/events/${esc(ev.slug)}" aria-label="${esc(ev.name)} — event details"></a>
    <div class="ev-media">${media}<span class="ev-media-fallback" aria-hidden="true">${esc((ev.name || '?').slice(0, 1))}</span></div>
    <div class="ev-body">
      <div class="ev-head">
        <h2 class="ev-name">${esc(ev.name)}</h2>
        ${isLive ? '<span class="ev-badge-live">● LIVE</span>' : isPast ? '<span class="ev-badge-past">Ended</span>' : ''}
      </div>
      <div class="ev-time" data-start="${ev.startTime}" data-end="${ev.endTime || ''}">
        <span class="ev-time-abs">${fmtUtc(ev.startTime)}</span>
        <span class="ev-time-rel"></span>
      </div>
      ${ev.description ? `<p class="ev-desc">${esc(ev.description)}</p>` : ''}
      <div class="ev-links">${links}${gameCount ? `<span class="ev-link ev-link-games">${gameCount} game${gameCount === 1 ? '' : 's'} announced</span>` : ''}</div>
    </div>
  </article>`;
}

function renderJsonLd(events) {
  const items = events.map((ev, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'Event',
      name: ev.name,
      startDate: new Date(ev.startTime * 1000).toISOString(),
      ...(ev.endTime ? { endDate: new Date(ev.endTime * 1000).toISOString() } : {}),
      eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
      eventStatus: 'https://schema.org/EventScheduled',
      ...(ev.description ? { description: ev.description } : {}),
      ...(ev.logo ? { image: ev.logo } : {}),
      location: {
        '@type': 'VirtualLocation',
        url: ev.streams?.[0]?.url || `https://www.loadingarchive.com/events/${ev.slug}`,
      },
      url: `https://www.loadingarchive.com/events/${ev.slug}`,
    },
  }));
  return JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: items });
}

function renderPage(upcoming, past) {
  const now = Date.now();
  const upcomingCards = upcoming.map(ev => renderCard(ev, now)).join('');
  const pastCards     = past.map(ev => renderCard(ev, now)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upcoming Gaming Events &amp; Showcases: Dates, Times &amp; Streams | Loading Archive</title>
<meta name="description" content="Every upcoming gaming showcase and event — Nintendo Direct, State of Play, Summer Game Fest and more — with start times in your timezone and where to watch on YouTube or Twitch.">
<link rel="canonical" href="https://www.loadingarchive.com/events">
<meta property="og:type"        content="website">
<meta property="og:title"       content="Upcoming Gaming Events & Showcases | Loading Archive">
<meta property="og:description" content="Dates, start times in your timezone, and stream links for every upcoming gaming showcase.">
<meta property="og:url"         content="https://www.loadingarchive.com/events">
<meta property="og:site_name"   content="Loading Archive">
<meta name="twitter:card"        content="summary">
<meta name="twitter:title"       content="Upcoming Gaming Events & Showcases | Loading Archive">
<meta name="twitter:description" content="Dates, start times in your timezone, and stream links for every upcoming gaming showcase.">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon.png">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/favicon.png">
<link rel="stylesheet" href="/css/site.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"></noscript>
<script type="application/ld+json">${renderJsonLd(upcoming)}</script>
<style>
/* PAGE */
.page-wrap{max-width:1060px;width:100%;margin:0 auto;padding:100px 20px 60px;flex:1}
.page-header{margin-bottom:28px}
.page-title{font-size:22px;font-weight:700;letter-spacing:-0.01em;margin-bottom:5px}
.page-meta{font-size:11px;color:var(--dim)}
.page-meta + .page-meta{margin-top:4px}

/* CARDS */
.ev-list{display:flex;flex-direction:column;gap:12px}
.ev-card{
  position:relative;
  display:flex;gap:16px;
  background:var(--surface);border:1px solid var(--border);border-radius:14px;
  padding:14px;overflow:hidden;
  transition:border-color 0.15s;
}
.ev-card:hover{border-color:rgba(255,255,255,0.08)}
.ev-card.ev-live{border-color:rgba(255,70,85,0.35)}
.ev-card.ev-past{opacity:0.72}
.ev-card.ev-past:hover{opacity:1}
.ev-badge-past{
  font-size:10px;font-weight:700;letter-spacing:0.04em;color:var(--dim);
  background:rgba(255,255,255,0.04);border:1px solid var(--border);
  border-radius:99px;padding:2px 8px;
}
/* Hele kaart klikbaar naar de detailpagina, behalve de stream-knoppen
   (die krijgen een hogere z-index zodat ze boven de overlay blijven). */
.ev-card-overlay{position:absolute;inset:0;z-index:1}
.ev-card-overlay:focus-visible{outline:2px solid #1A9FFF;outline-offset:-2px}
.ev-media{z-index:2}
.ev-links{position:relative;z-index:2;pointer-events:none}
.ev-links a{pointer-events:auto}

/* MEDIA */
.ev-media{position:relative;width:150px;height:84px;border-radius:8px;overflow:hidden;background:rgba(255,255,255,0.04);flex-shrink:0}
.ev-logo{width:100%;height:100%;object-fit:cover;display:block}
.ev-media-fallback{
  display:none;position:absolute;inset:0;align-items:center;justify-content:center;
  font-size:30px;font-weight:700;color:rgba(255,255,255,0.12);
}
.ev-noimg .ev-media-fallback{display:flex}

/* BODY */
.ev-body{min-width:0;flex:1}
.ev-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
.ev-name{font-size:15px;font-weight:600;letter-spacing:-0.01em;margin:0}
.ev-badge-live{
  font-size:10px;font-weight:700;letter-spacing:0.04em;color:#FF4655;
  background:rgba(255,70,85,0.12);border:1px solid rgba(255,70,85,0.3);
  border-radius:99px;padding:2px 8px;animation:evpulse 1.6s ease-in-out infinite;
}
@keyframes evpulse{50%{opacity:0.55}}
.ev-time{font-size:12px;color:#c8d0da;margin-bottom:6px}
.ev-time-rel{color:var(--dim);margin-left:8px}
.ev-desc{
  font-size:12px;line-height:1.6;color:var(--dim);margin:0 0 10px;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;
}
.ev-links{display:flex;flex-wrap:wrap;gap:8px}
.ev-link{
  display:inline-flex;align-items:center;gap:6px;
  font-size:11px;font-weight:500;color:#c8d0da;text-decoration:none;
  background:rgba(255,255,255,0.04);border:1px solid var(--border);
  border-radius:8px;padding:5px 10px;transition:border-color 0.15s,color 0.15s;
}
.ev-link:hover{color:#fff;border-color:rgba(255,255,255,0.18)}
.ev-link-games{color:var(--dim);pointer-events:none;background:transparent;border-style:dashed}

/* EMPTY */
.ev-empty{text-align:center;color:var(--dim);font-size:13px;line-height:1.7;padding:60px 20px}

/* SECTIONS */
.ev-section-title{font-size:13px;font-weight:700;color:var(--dim);letter-spacing:0.04em;text-transform:uppercase;margin:36px 0 14px}
.ev-section-title:first-child{margin-top:0}

/* RESPONSIVE */
@media(max-width:560px){
  .ev-card{flex-direction:column}
  .ev-media{width:100%;height:120px}
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
  <div class="page-header">
    <h1 class="page-title">Upcoming Gaming Events</h1>
    <div class="page-meta">Showcases, Directs and award shows — times shown in <span id="tzName">UTC</span> · Source: IGDB</div>
    <div class="page-meta">Ended events stay listed for 30 days so you can still check what got announced.</div>
  </div>

  ${upcomingCards
    ? `<div class="ev-list">${upcomingCards}</div>`
    : `<div class="ev-empty">No upcoming events announced right now.<br>New showcases usually get announced a few days ahead — check back soon.</div>`}

  ${pastCards ? `
  <h2 class="ev-section-title">Recently ended</h2>
  <div class="ev-list">${pastCards}</div>` : ''}
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

// Tijden omrekenen naar de lokale tijdzone van de bezoeker. De server rendert
// UTC als fallback; hier vervangen we die door bv. "Fri, Sep 12, 22:00 (CEST)"
// plus een relatieve aanduiding ("in 3 days" / "LIVE").
(function () {
  var tzEl = document.getElementById('tzName');
  try {
    // Vaste 'en-US'-locale: de site is Engels, dus ook de datums — alleen de
    // tíjdzone volgt de bezoeker (geen locale meegeven zou bv. Nederlandse
    // maandnamen tonen).
    var abs = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short'
    });
    var rel = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    if (tzEl) tzEl.textContent = 'your local time (' + (Intl.DateTimeFormat().resolvedOptions().timeZone || 'local') + ')';

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

export async function handleEventsPage(env) {
  const data = await env.GAMES_KV.get('config:events', 'json');
  const now  = Date.now();

  // Vangnet: de pipeline (igdb.js) laat events al vallen na RETENTION_MS,
  // maar filter hier defensief nogmaals voor het geval de KV nog een oud
  // record bevat (bv. vlak na het instellen van deze grens).
  const all      = (data?.events || []).filter(ev => isWithinRetention(ev, now));
  const upcoming = all.filter(ev => !isEventPast(ev, now));
  const past     = all.filter(ev => isEventPast(ev, now))
    .sort((a, b) => b.startTime - a.startTime); // meest recent afgelopen eerst

  const html = renderPage(upcoming, past);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      // Kort aan de edge cachen: de LIVE-badge en relatieve tijden zijn
      // client-side, dus een iets oudere HTML-versie is onschadelijk.
      'Cache-Control': 's-maxage=600, stale-while-revalidate=3600',
    },
  });
}
