/**
 * Gaming events pipeline — aankomende showcases/presentaties (Nintendo
 * Direct, State of Play, Summer Game Fest, The Game Awards, …).
 *
 * Databron: IGDB v4 events-endpoint (api.igdb.com, eigendom van Twitch).
 * Auth: Twitch client-credentials flow — TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET
 *       secrets; het access token (~60 dagen geldig) wordt gecachet in KV.
 * Output: KV sleutel 'config:events'
 *
 * IGDB-tijden zijn Unix-seconden in UTC; de frontend rekent ze client-side
 * om naar de lokale tijdzone van de bezoeker.
 */

import { isWithinRetention } from '../events-window.js';

const TOKEN_KV_KEY  = 'config:igdb-token';
const EVENTS_KV_KEY = 'config:events';

// Hoe lang vóór nu een event nog "recent" is voor de IGDB-query zelf: net
// gestarte streams blijven zo als LIVE zichtbaar, en IGDB krijgt een kans om
// deze events kort na afloop nog te taggen met aangekondigde games. Events
// die hierbuiten vallen blijven wél op de site (zie merge hieronder) — ze
// worden alleen niet meer actief ververst.
const LOOKBACK_SECONDS = 12 * 3600;

/**
 * Client-credentials token, gecachet in KV. Twitch-tokens leven ~60 dagen;
 * we cachen korter (met marge) zodat een ingetrokken token vanzelf ververst.
 */
async function getIgdbToken(env) {
  const cached = await env.GAMES_KV.get(TOKEN_KV_KEY);
  if (cached) return cached;

  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    throw new Error('TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET secrets ontbreken');
  }

  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type:    'client_credentials',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Twitch token ${r.status}`);
  const { access_token, expires_in } = await r.json();
  if (!access_token) throw new Error('Twitch token-response zonder access_token');

  // Cache met een dag marge t.o.v. de echte levensduur (KV-minimum is 60s).
  const ttl = Math.max(60, (expires_in || 3600) - 86400);
  await env.GAMES_KV.put(TOKEN_KV_KEY, access_token, { expirationTtl: ttl });
  return access_token;
}

async function igdbQuery(env, token, endpoint, body) {
  const r = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID':     env.TWITCH_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Accept':        'application/json',
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`IGDB ${endpoint} ${r.status}`);
  return r.json();
}

// Hostname i.p.v. ruwe substring-match voor de nieuwere social-checks
// hieronder — "x.com" als substring zou anders ook op bv. "vertex.com"
// matchen. Faalt een URL te parsen, dan gewoon geen match (valt terug op
// 'website').
function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

// event_networks.network_type verwijst naar de network_types-tabel; de namen
// daar zijn vrije tekst ("YouTube", "Twitch", …) — normaliseer naar een vaste
// set zodat de frontend er losse iconen/labels aan kan hangen. Zonder dit
// belanden bv. een X-profiel én een eigen site allebei onder het generieke
// "Website"-label — verwarrend als een event meerdere van dat soort links heeft.
function normalizeNetwork(name, url) {
  const n = (name || '').toLowerCase();
  const u = (url  || '').toLowerCase();
  const h = hostnameOf(url);
  if (n.includes('youtube')   || u.includes('youtube.') || u.includes('youtu.be')) return 'youtube';
  if (n.includes('twitch')    || u.includes('twitch.tv')) return 'twitch';
  if (n.includes('steam')     || u.includes('steampowered.com')) return 'steam';
  if (n.includes('twitter') || n === 'x' || h === 'x.com' || h === 'twitter.com') return 'twitter';
  if (n.includes('discord')   || h === 'discord.gg' || h === 'discord.com') return 'discord';
  if (n.includes('facebook')  || h === 'facebook.com' || h === 'fb.com') return 'facebook';
  if (n.includes('instagram') || h === 'instagram.com') return 'instagram';
  if (n.includes('tiktok')    || h === 'tiktok.com') return 'tiktok';
  if (n.includes('reddit')    || h === 'reddit.com') return 'reddit';
  return 'website';
}

function logoUrl(imageId) {
  // t_screenshot_med = 569×320 — genoeg voor een kaart-banner, klein genoeg
  // om de pagina licht te houden.
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_screenshot_med/${imageId}.jpg` : null;
}

function coverUrl(imageId) {
  // t_cover_big = 264×374 — portrait boxart formaat voor de "announced
  // games"-grid op de event-pagina.
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg` : null;
}

// Games hangen aan een event los van onze eigen RAWG/Steam-database (andere
// bron, andere id's) — geen poging tot matchen met /game/:slug, dat geeft
// valse positieven op titel-only. Deze lijst linkt uit naar IGDB's eigen
// gamepagina; per event maximaal dit aantal (grote shows als E3-retrospectief
// kunnen tientallen games hebben, meer is niet zinvol op één pagina).
const MAX_GAMES_PER_EVENT = 60;

/**
 * Haalt aankomende (en net gestarte) events op en schrijft ze naar KV.
 * Eén IGDB-call: geneste velden (event_logo.image_id, event_networks.*,
 * games.*) worden door IGDB's expander in dezelfde response meegeleverd.
 */
export async function fetchAndStoreEvents(env) {
  const token = await getIgdbToken(env);
  const since = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;

  const rows = await igdbQuery(env, token, 'events',
    `fields name,slug,description,start_time,end_time,time_zone,live_stream_url,
            event_logo.image_id,event_networks.url,event_networks.network_type.name,
            games.name,games.slug,games.url,games.cover.image_id,games.first_release_date;
     where start_time != null & start_time > ${since};
     sort start_time asc;
     limit 100;`);

  const events = rows.map(e => {
    // Kijklinks: expliciete netwerken eerst, live_stream_url als vangnet
    // (soms is dat de enige link die IGDB heeft). Dedupliceer op URL.
    const seen = new Set();
    const streams = [];
    for (const n of e.event_networks || []) {
      if (!n.url || seen.has(n.url)) continue;
      seen.add(n.url);
      streams.push({ url: n.url, network: normalizeNetwork(n.network_type?.name, n.url) });
    }
    if (e.live_stream_url && !seen.has(e.live_stream_url)) {
      streams.push({ url: e.live_stream_url, network: normalizeNetwork(null, e.live_stream_url) });
    }
    // YouTube/Twitch vooraan — dat zijn de links die bezoekers zoeken.
    const order = { youtube: 0, twitch: 1, steam: 2, twitter: 3, discord: 4, facebook: 5, instagram: 6, tiktok: 7, reddit: 8, website: 9 };
    streams.sort((a, b) => (order[a.network] ?? 99) - (order[b.network] ?? 99));

    // Games die IGDB aan dit event koppelt ("announced/featured at"). Voor
    // toekomstige events meestal nog leeg (IGDB tagt pas ná de show); voor
    // net afgelopen events (binnen LOOKBACK_SECONDS) kan dit al gevuld zijn.
    const games = (e.games || [])
      .filter(g => g.name)
      .slice(0, MAX_GAMES_PER_EVENT)
      .map(g => ({
        name:        g.name,
        url:         g.url || null,          // IGDB's eigen gamepagina
        cover:       coverUrl(g.cover?.image_id),
        releaseDate: g.first_release_date
          ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10)
          : null,
      }));

    return {
      id:          e.id,
      name:        e.name || 'Untitled event',
      slug:        e.slug || String(e.id),
      description: e.description || null,
      startTime:   e.start_time,           // Unix-seconden, UTC
      endTime:     e.end_time || null,
      logo:        logoUrl(e.event_logo?.image_id),
      streams,
      games,
    };
  }).filter(e => e.startTime);

  // Merge met de vorige KV-snapshot: IGDB's query zelf kijkt maar
  // LOOKBACK_SECONDS terug, maar afgelopen events moeten nog RETENTION_MS
  // (30 dagen) op de site bereikbaar blijven. Verse data wint altijd per id
  // (nieuwe/bijgewerkte games, gewijzigde tijden); oudere events die buiten
  // deze fetch vallen blijven staan met hun laatst bekende gegevens zolang
  // ze binnen de retentieperiode zitten.
  const prev = await env.GAMES_KV.get(EVENTS_KV_KEY, 'json');
  const byId = new Map();
  for (const ev of prev?.events || []) {
    if (isWithinRetention(ev)) byId.set(ev.id, ev);
  }
  for (const ev of events) byId.set(ev.id, ev);
  const merged = [...byId.values()].sort((a, b) => a.startTime - b.startTime);

  const payload = { generatedAt: new Date().toISOString(), events: merged };
  await env.GAMES_KV.put(EVENTS_KV_KEY, JSON.stringify(payload));
  return { total: merged.length, fresh: events.length };
}
