import { normalizeTitle } from './utils.js';

// Permanent geweerde games (fake/asset-flip listings). Deze worden vóór de
// upsert uit elke pipeline-batch gefilterd, ongeacht de bron (RAWG, Wikipedia,
// extra-games). Match op pipeline-id, Steam-appid én genormaliseerde titel,
// zodat de game ook geblokkeerd blijft als hij via een andere route of met
// een nieuw id terugkomt.
//
// Toegevoegd 2026-07-07: Royale Battle — vermoedelijk fake game (dev=publisher
// "Btl Games", geen website, generieke boilerplate-beschrijving).
const BLOCKED_IDS    = new Set(['rawg-1018411']);
const BLOCKED_APPIDS = new Set(['4840340']);
const BLOCKED_TITLES = new Set(['royale battle']); // normalizeTitle-vorm

export function isBlockedGame(g) {
  // TBA-records hebben id "rawg-tba-{n}", gedateerde "rawg-{n}".
  const id = String(g.id ?? '').replace(/^rawg-tba-/, 'rawg-');
  if (BLOCKED_IDS.has(id)) return true;
  if (g.steam && BLOCKED_APPIDS.has(String(g.steam))) return true;
  const t = normalizeTitle(g.title);
  return t ? BLOCKED_TITLES.has(t) : false;
}
