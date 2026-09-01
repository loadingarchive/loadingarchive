/**
 * Gedeelde tijdslogica voor events — gebruikt door de IGDB-pipeline
 * (pipeline/igdb.js), de listing- en detailpagina (handlers/events.js,
 * handlers/event.js) en de sitemap-generator (cron/build-cache.js). Alles
 * hier vandaan zodat "live", "afgelopen" en "hoe lang blijft de pagina
 * online" overal exact dezelfde grens gebruiken.
 */

// Events zonder end_time krijgen dit als aangenomen duur — bepaalt hoelang
// een event als LIVE getoond wordt.
export const ASSUMED_DURATION_MS = 4 * 3600 * 1000;

// Een afgelopen event blijft nog deze periode bereikbaar: eigen pagina +
// "Recently ended"-sectie op /events + sitemap-vermelding. Na die periode
// laat de pipeline hem definitief uit de KV vallen (zie igdb.js).
export const RETENTION_MS = 30 * 24 * 3600 * 1000;

export function eventEndMs(ev) {
  return ev.endTime ? ev.endTime * 1000 : ev.startTime * 1000 + ASSUMED_DURATION_MS;
}

export function isEventLive(ev, now = Date.now()) {
  const startMs = ev.startTime * 1000;
  return now >= startMs && now < eventEndMs(ev);
}

export function isEventPast(ev, now = Date.now()) {
  return now >= eventEndMs(ev);
}

// Vangnet voor de weergavelaag: een event ouder dan de retentieperiode hoort
// nooit getoond te worden, zelfs niet als de KV per ongeluk nog een oud
// record bevat (bv. vlak na het instellen van deze grens).
export function isWithinRetention(ev, now = Date.now()) {
  return now - eventEndMs(ev) < RETENTION_MS;
}
