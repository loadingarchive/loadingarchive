import { normalizeTitle } from './utils.js';

// Permanent geweerde games (fake/asset-flip listings). Deze worden vóór de
// upsert uit elke pipeline-batch gefilterd, ongeacht de bron (RAWG, Wikipedia,
// extra-games). Match op pipeline-id, Steam-appid én genormaliseerde titel,
// zodat de game ook geblokkeerd blijft als hij via een andere route of met
// een nieuw id terugkomt.
//
// Toegevoegd 2026-07-07: Royale Battle — vermoedelijk fake game (dev=publisher
// "Btl Games", geen website, generieke boilerplate-beschrijving).
//
// Toegevoegd 2026-07-25: wiki-assassin-s-creed-black-flag-resynced — lege
// duplicaat van assassins-creed-back-flag-resynced (RAWG-bron, rijker record,
// alleen titel-typo "Back"->"Black" gefixed en vergrendeld via manual.title).
// Blokkeren op id i.p.v. titel, want de titel is na de fix identiek aan het
// RAWG-record en zou anders zelf tegen de titel-matchregel aanlopen.
//
// Toegevoegd 2026-07-25: Last Guest at Sunset (rawg-1019167, appid 4822430) —
// op gebruikersverzoek verwijderd na een handmatige review; de Steam-listing
// zelf verifieerde als een echte, actieve game (eigen site, uitgebreide
// beschrijving, live winkelpagina), maar is desondanks niet gewenst op de site.
const BLOCKED_IDS    = new Set(['rawg-1018411', 'wiki-assassin-s-creed-black-flag-resynced', 'rawg-1019167']);
const BLOCKED_APPIDS = new Set(['4840340', '4822430']);
const BLOCKED_TITLES = new Set(['royale battle', 'last guest at sunset']); // normalizeTitle-vorm

export function isBlockedGame(g) {
  // TBA-records hebben id "rawg-tba-{n}", gedateerde "rawg-{n}".
  const id = String(g.id ?? '').replace(/^rawg-tba-/, 'rawg-');
  if (BLOCKED_IDS.has(id)) return true;
  if (g.steam && BLOCKED_APPIDS.has(String(g.steam))) return true;
  const t = normalizeTitle(g.title);
  return t ? BLOCKED_TITLES.has(t) : false;
}
