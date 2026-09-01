// Permanent geweerde events (op beheerdersverzoek). Filter vóór de merge in
// igdb.js zodat ze niet terugkomen op de eerstvolgende uur-cron — IGDB blijft
// ze anders gewoon teruggeven zolang het event nog in de toekomst ligt.
//
// Toegevoegd 2026-09-01: Clemmy's Best Indie Games Fall Showcase 2026
// (IGDB id 1171) — op gebruikersverzoek verwijderd: kleine community-indie-
// showcase waar IGDB zelden games aan koppelt, dus de eigen pagina bleef
// leeg en had geen waarde voor bezoekers.
const BLOCKED_EVENT_IDS = new Set([1171]);

export function isBlockedEvent(ev) {
  return BLOCKED_EVENT_IDS.has(ev.id);
}
