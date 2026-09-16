// Permanent geweerde events (op beheerdersverzoek). Filter vóór de merge in
// igdb.js zodat ze niet terugkomen op de eerstvolgende uur-cron — IGDB blijft
// ze anders gewoon teruggeven zolang het event nog in de toekomst ligt.
//
// Toegevoegd 2026-09-01: Clemmy's Best Indie Games Fall Showcase 2026
// (IGDB id 1171) — op gebruikersverzoek verwijderd: kleine community-indie-
// showcase waar IGDB zelden games aan koppelt, dus de eigen pagina bleef
// leeg en had geen waarde voor bezoekers.
//
// Toegevoegd 2026-09-16: SAGE 2026 (IGDB id 1140) — op gebruikersverzoek
// volledig verwijderd, na de eerdere LIVE-badge-verwarring (week-lange
// fandemo-expo zonder echte stream, zie events-window.js).
const BLOCKED_EVENT_IDS = new Set([1171, 1140]);

export function isBlockedEvent(ev) {
  return BLOCKED_EVENT_IDS.has(ev.id);
}
