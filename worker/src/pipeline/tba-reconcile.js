/**
 * TBA-datumcheck — TBA-games die inmiddels een echte releasedatum hebben.
 *
 * Waarom dit nodig is: de weekly Wikipedia-scrape verifieert alleen níeuwe
 * titels tegen Steam — een game die ooit dateloos is opgeslagen krijgt langs
 * die weg nooit meer een datum, ook niet als Steam er allang één heeft (of de
 * game al uit is). Deze stap loopt de TBA-lijst met Steam-appid dagelijks in
 * een rotatie na (zelfde patroon als de prijsupdate) en vult de datum in
 * zodra Steam een dag-precieze datum geeft. Verhuist de datum de game naar
 * een venstermaand, dan wordt die maand-KV direct herbouwd; een datum vóór
 * het venster betekent "al uitgebracht" — de purge ruimt het record de
 * volgende nacht definitief op (bestaand beleid).
 */

import { fetchSteamReleaseDate } from './steam.js';
import { mapWithConcurrency, parseSteamDate } from './utils.js';
import { queryActiveTbaGames, queryActiveMonthGames, putGamesListKv } from './d1.js';
import { rollingMonths, toMonthKey, makeMonthEntry } from '../months-window.js';

const TBA_RECONCILE_DAILY_CAP = 30;

async function ensureTbaCheckColumn(db) {
  try {
    await db.prepare(`ALTER TABLE games ADD COLUMN tba_checked_at TEXT`).run();
  } catch { /* kolom bestaat al */ }
}

// Alleen dag-precieze Steam-datums ("24 Jun, 2026" / "Jun 24, 2026") tellen
// als concreet. parseSteamDate maakt van "August 2026" stilzwijgend de 1e van
// de maand — dat is voor deze check te vaag en zou een verzonnen dag tonen.
export function parseFullSteamDate(str) {
  const s = String(str || '').trim();
  if (!/^(\d{1,2}\s+[A-Za-z]{3},?\s+\d{4}|[A-Za-z]{3}\s+\d{1,2},?\s+\d{4})$/.test(s)) return null;
  return parseSteamDate(s);
}

export async function reconcileTbaDates(env) {
  await ensureTbaCheckColumn(env.GAMES_D1);

  const { results } = await env.GAMES_D1
    .prepare(`SELECT slug, name, steam_appid, raw_json FROM games
              WHERE status = 'active' AND release_date IS NULL AND steam_appid IS NOT NULL
              ORDER BY COALESCE(tba_checked_at, '') ASC
              LIMIT ?1`)
    .bind(TBA_RECONCILE_DAILY_CAP)
    .all();

  if (!results.length) return { moved: 0, months: [] };
  console.log(`  TBA-datumcheck: ${results.length} games controleren`);

  const movedMonths = new Set();
  let moved = 0;

  await mapWithConcurrency(results, 4, async (row) => {
    const checkedAt = new Date().toISOString();
    const touch     = () => env.GAMES_D1
      .prepare(`UPDATE games SET tba_checked_at = ?1 WHERE slug = ?2`)
      .bind(checkedAt, row.slug).run();

    const entry = JSON.parse(row.raw_json || '{}');
    // Handmatig beheerde records niet aanraken (zelfde regels als elders).
    if (entry.manual?.date || entry.manual?.protected) return touch();

    const rel = await fetchSteamReleaseDate(row.steam_appid);
    if (rel === null) return touch();          // fetch-fout: volgende rotatie opnieuw

    const iso = parseFullSteamDate(rel.date);
    if (!iso) return touch();                  // "2026", "Q4 2026", "Coming soon" → terecht TBA

    entry.date = iso;
    const json = JSON.stringify(entry);
    await env.GAMES_D1
      .prepare(`UPDATE games SET release_date = ?1, raw_json = ?2, last_updated = ?3, tba_checked_at = ?3 WHERE slug = ?4`)
      .bind(iso, json, checkedAt, row.slug)
      .run();
    await env.GAMES_KV.put(`game:${row.slug}`, json);
    movedMonths.add(iso.slice(0, 7));
    moved++;
    console.log(`    → "${row.name}" ${rel.comingSoon ? 'heeft nu een datum' : 'is al uitgebracht'}: ${iso}`);
  });

  if (!moved) return { moved: 0, months: [] };

  // TBA-lijst-KV herbouwen + de venstermaanden waar games heen verhuisd zijn,
  // zodat de site de verplaatsing dezelfde nacht toont (de months-cron liep
  // eerder deze nacht al). Maanden búiten het venster: vóór het venster ruimt
  // de purge het record de volgende nacht op, erna bestaat de maand nog niet.
  const tbaResults = await queryActiveTbaGames(env);
  await putGamesListKv(env, 'games:tba', tbaResults);

  const windowKeys = new Set(rollingMonths().map(toMonthKey));
  for (const mon of movedMonths) {
    if (!windowKeys.has(mon)) continue;
    const [y, m] = mon.split('-').map(Number);
    const { kvKey, dateFrom, dateTo } = makeMonthEntry(y, m);
    const monthResults = await queryActiveMonthGames(env, dateFrom, dateTo);
    await putGamesListKv(env, kvKey, monthResults);
  }
  console.log(`  TBA-datumcheck: ${moved} game(s) een datum gegeven (maanden: ${[...movedMonths].join(', ')})`);
  return { moved, months: [...movedMonths] };
}
