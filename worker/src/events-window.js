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

// IGDB's end_time is community-submitted en soms fout (bv. verkeerd jaar
// getypt door een submitter — geeft een "event" dat een heel jaar LIVE
// lijkt). Een langere duur dan dit is bij geen enkel echt event aannemelijk
// (zelfs meerdaagse expo's zoals SAGE duren hooguit ~1.5 week) — een
// end_time die dit overschrijdt wordt genegeerd t.g.v. ASSUMED_DURATION_MS.
const MAX_PLAUSIBLE_DURATION_MS = 14 * 24 * 3600 * 1000;

// Boven deze duur is een event geen losse broadcast meer maar een
// meerdaagse expo zonder één doorlopende stream (bv. SAGE: een hele week
// "open" voor fandemo's, geen kijklink die daadwerkelijk continu live is).
// Zo'n event krijgt geen pulsende LIVE-badge — die belooft iets dat er niet
// is — maar telt (met zijn echte, ongekapte end_time) wél gewoon door tot
// isEventPast/retentie: het is alleen de broadcast-suggestie die vervalt.
const MAX_LIVE_BADGE_DURATION_MS = 24 * 3600 * 1000;

export function eventEndMs(ev) {
  const startMs = ev.startTime * 1000;
  if (!ev.endTime) return startMs + ASSUMED_DURATION_MS;
  const endMs = ev.endTime * 1000;
  return endMs - startMs > MAX_PLAUSIBLE_DURATION_MS ? startMs + ASSUMED_DURATION_MS : endMs;
}

export function isEventLive(ev, now = Date.now()) {
  const startMs = ev.startTime * 1000;
  const endMs = eventEndMs(ev);
  if (endMs - startMs > MAX_LIVE_BADGE_DURATION_MS) return false;
  return now >= startMs && now < endMs;
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
