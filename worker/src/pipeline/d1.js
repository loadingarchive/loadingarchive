/**
 * D1 upsert + KV-rebuild helpers.
 *
 * D1 is de duurzame bron van waarheid; KV is de snelle leescache voor
 * publiek verkeer. Nooit D1 direct lezen vanuit publiek verkeer.
 */

import { normalizeTitle } from './utils.js';

/**
 * Upsert één game in D1.
 * first_seen wordt alleen gezet bij een nieuwe insert, nooit bij conflict.
 */
export async function upsertGameToD1(entry, env) {
  const now = new Date().toISOString();
  try {
    await runUpsert(entry, env, now);
  } catch (e) {
    // idx_games_active_steam_appid (0003) kan botsen als twee verschillende
    // slugs bijna gelijktijdig hetzelfde appid claimen (race tussen cron-
    // paden) — dedupeActiveGames ruimt zo'n dubbele actieve rij normaal
    // sowieso op, dus hier alleen loggen en overslaan i.p.v. de hele
    // mapWithConcurrency-batch (en dus de rest van deze maand-run) te laten
    // crashen op één game.
    if (/UNIQUE constraint failed.*steam_appid/i.test(e.message || "")) {
      console.error(`upsertGameToD1: steam_appid-botsing voor "${entry.slug}" (appid ${entry.steam}) — overgeslagen, dedupe-cron ruimt dit op`, e.message);
      return;
    }
    throw e;
  }
}

async function runUpsert(entry, env, now) {
  await env.GAMES_D1.prepare(`
    INSERT INTO games (
      slug, rawg_id, name, release_date, platforms, cover_image, steam_appid,
      short_description, price, metacritic, screenshots, requirements,
      status, first_seen, last_seen, last_updated, raw_json
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
              'active', ?13, ?13, ?13, ?14)
    ON CONFLICT(slug) DO UPDATE SET
      rawg_id           = CASE
                            -- Een numerieke RAWG-id nooit laten overschrijven
                            -- door een wiki-/excel-id: backfillSteamAppids
                            -- heeft de numerieke id nodig voor RAWG-verrijking,
                            -- en cross-bron reclaims zouden de id anders per
                            -- nacht laten ping-pongen.
                            WHEN excluded.rawg_id LIKE 'rawg-%' THEN excluded.rawg_id
                            WHEN rawg_id LIKE 'rawg-%' THEN rawg_id
                            ELSE COALESCE(excluded.rawg_id, rawg_id)
                          END,
      name              = excluded.name,
      -- Nooit een bestaande releasedatum terugzetten naar TBA op een lege
      -- excluded-waarde (zie merge.js saveGameToD1 voor het scenario).
      release_date      = COALESCE(excluded.release_date, release_date),
      platforms         = excluded.platforms,
      cover_image       = COALESCE(excluded.cover_image, cover_image),
      steam_appid       = COALESCE(excluded.steam_appid, steam_appid),
      short_description = COALESCE(excluded.short_description, short_description),
      price             = COALESCE(excluded.price, price),
      metacritic        = COALESCE(excluded.metacritic, metacritic),
      screenshots       = CASE WHEN json_array_length(excluded.screenshots) > 0 THEN excluded.screenshots ELSE screenshots END,
      requirements      = COALESCE(excluded.requirements, requirements),
      status            = 'active',
      last_seen         = excluded.last_seen,
      last_updated      = excluded.last_updated,
      raw_json          = excluded.raw_json
  `).bind(
    entry.slug,
    entry.id       ?? null,
    entry.title,
    entry.date     ?? null,
    JSON.stringify(entry.platforms    || []),
    entry.cover    ?? null,
    entry.steam    ?? null,
    entry.short_description           ?? null,
    entry.price    ?? null,
    entry.metacritic ? JSON.stringify(entry.metacritic) : null,
    JSON.stringify(entry.screenshots  || []),
    (entry.pc_requirements?.minimum || entry.pc_requirements?.recommended)
      ? JSON.stringify(entry.pc_requirements)
      : null,
    now,
    JSON.stringify(entry)
  ).run();
}

/**
 * Laadt alle bestaande slugs met hun eigenaar-info uit D1.
 * Gebruikt door assignSlugs() (merge.js) om botsingen te detecteren over
 * maanden en cron-runs heen — niet alleen binnen de huidige batch — én om
 * te herkennen dat een binnenkomende game met een ander pipeline-id
 * (excel-/wiki-/rawg-) hetzelfde spel is als een bestaand record.
 */
export async function loadSlugOwners(env) {
  const { results } = await env.GAMES_D1
    .prepare(`SELECT slug, rawg_id, steam_appid, name, release_date, status FROM games`)
    .all();
  const map = new Map();
  for (const r of results) {
    map.set(r.slug, {
      id:     r.rawg_id,
      appid:  r.steam_appid,
      title:  r.name,
      date:   r.release_date,
      active: r.status === 'active',
    });
  }
  return map;
}

/**
 * Geeft alle actieve games terug voor een datumbereik (maand-cache).
 * Gebruikt idx_games_status_date → geen full-table-scan.
 */
export async function queryActiveMonthGames(env, dateFrom, dateTo) {
  const { results } = await env.GAMES_D1
    .prepare(`SELECT raw_json FROM games
              WHERE status = 'active'
                AND release_date >= ?1
                AND release_date <= ?2
              ORDER BY release_date`)
    .bind(dateFrom, dateTo)
    .all();
  return results.map(r => JSON.parse(r.raw_json));
}

/**
 * Geeft alle actieve TBA-games terug (release_date IS NULL).
 * Gebruikt idx_games_status → geen full-table-scan.
 */
export async function queryActiveTbaGames(env) {
  const { results } = await env.GAMES_D1
    .prepare(`SELECT raw_json FROM games
              WHERE status = 'active'
                AND release_date IS NULL
              ORDER BY name`)
    .all();
  return results.map(r => JSON.parse(r.raw_json));
}

/**
 * Schrijft game:{slug} KV-records vanuit D1 raw_json voor een datumbereik.
 * Retourneert het aantal bijgewerkte records.
 */
export async function rebuildGamePagesKv(env, dateFrom, dateTo) {
  const { results } = await env.GAMES_D1
    .prepare(`SELECT slug, raw_json FROM games
              WHERE status = 'active'
                AND release_date >= ?1
                AND release_date <= ?2`)
    .bind(dateFrom, dateTo)
    .all();
  await Promise.all(results.map(r => env.GAMES_KV.put(`game:${r.slug}`, r.raw_json)));
  return results.length;
}

/**
 * Schrijft game:{slug} KV-records voor TBA-games vanuit D1.
 */
export async function rebuildTbaGamePagesKv(env) {
  const { results } = await env.GAMES_D1
    .prepare(`SELECT slug, raw_json FROM games
              WHERE status = 'active'
                AND release_date IS NULL`)
    .all();
  await Promise.all(results.map(r => env.GAMES_KV.put(`game:${r.slug}`, r.raw_json)));
  return results.length;
}

/**
 * Schrijft een maand- of TBA-lijst-KV weg in de gedeelde `{results,
 * generatedAt}`-vorm die /api/games en month.js verwachten. Eén plek voor
 * deze payload-vorm i.p.v. hem los te herhalen op elke schrijfplek (cron's
 * processMonth/dedupe-rebuild en tba-reconcile.js) — voorkomt dat een
 * toekomstige wijziging aan de vorm op de ene plek wordt doorgevoerd en op
 * de andere vergeten wordt.
 */
export async function putGamesListKv(env, key, results) {
  await env.GAMES_KV.put(key, JSON.stringify({ results, generatedAt: new Date().toISOString() }));
}

/**
 * Schrijft game:{slug} KV-records voor ALLE actieve D1-games in één keer.
 * Gebruik dit na elke volledige cron-run zodat elke game altijd een detailpagina heeft.
 * Retourneert het aantal bijgewerkte records.
 */
export async function rebuildAllGamePagesKv(env) {
  const { results } = await env.GAMES_D1
    .prepare(`SELECT slug, raw_json FROM games WHERE status = 'active'`)
    .all();
  await Promise.all(results.map(r => env.GAMES_KV.put(`game:${r.slug}`, r.raw_json)));
  return results.length;
}

/**
 * Zet games op status 'hidden' en verwijdert hun game:{slug} KV-record.
 * Gedeeld door softDeleteStaleGames en dedupeActiveGames. De UPDATE wordt
 * gechunkt: D1 staat max 100 bound parameters per statement toe, dus één
 * grote IN-lijst zou bij ≥100 slugs de hele operatie laten falen.
 */
const HIDE_CHUNK_SIZE = 90;

export async function hideGames(env, slugs) {
  const now = new Date().toISOString();
  for (let i = 0; i < slugs.length; i += HIDE_CHUNK_SIZE) {
    const chunk        = slugs.slice(i, i + HIDE_CHUNK_SIZE);
    const placeholders = chunk.map((_, j) => `?${j + 2}`).join(',');
    await env.GAMES_D1
      .prepare(`UPDATE games SET status = 'hidden', last_updated = ?1 WHERE slug IN (${placeholders})`)
      .bind(now, ...chunk)
      .run();
  }
  await Promise.all(slugs.map(slug => env.GAMES_KV.delete(`game:${slug}`)));
}

/**
 * Hard-delete-beleid (gebruikerskeuze 2026-08-31): maanden die uit het
 * rollende venster vallen worden definitief verwijderd — de D1-rijen, hun
 * game:{slug} KV-records én de games:{YYYY-MM} maand-KV's. Draait dagelijks
 * in de maintenance-cron; doet meestal niets en ruimt bij een maandwissel
 * de afgevallen maand op (~100–250 games, past ruim in het subrequest-budget).
 *
 * Games met raw_json.manual.protected = true worden overgeslagen en
 * gerapporteerd: die zijn met de hand toegevoegd en verdwijnen alleen door
 * een bewuste actie, nooit stilletjes via beleid. Hun maand-KV gaat wél weg
 * (de maand is uit het venster), maar hun detailpagina blijft bestaan.
 *
 * De DELETE is per slug gechunkt (max 100 bound params per D1-statement)
 * i.p.v. één DELETE-op-datum, juist zodat protected rijen blijven staan.
 *
 * Retourneert { deleted: [slugs], months: [keys], skippedProtected: [slugs] }.
 */
export async function purgeGamesBefore(env, beforeDate) {
  const { results } = await env.GAMES_D1
    .prepare(`SELECT slug, release_date,
                     json_extract(raw_json, '$.manual.protected') AS protected_flag
              FROM games WHERE release_date < ?1`)
    .bind(beforeDate)
    .all();

  const toDelete          = results.filter(r => !r.protected_flag);
  const skippedProtected  = results.filter(r => r.protected_flag).map(r => r.slug);
  const months = [...new Set(results.map(r => (r.release_date || '').slice(0, 7)))].filter(Boolean);
  const slugs  = toDelete.map(r => r.slug);

  for (let i = 0; i < slugs.length; i += HIDE_CHUNK_SIZE) {
    const chunk        = slugs.slice(i, i + HIDE_CHUNK_SIZE);
    const placeholders = chunk.map((_, j) => `?${j + 1}`).join(',');
    await env.GAMES_D1
      .prepare(`DELETE FROM games WHERE slug IN (${placeholders})`)
      .bind(...chunk)
      .run();
  }

  await Promise.all([
    ...slugs.map(slug => env.GAMES_KV.delete(`game:${slug}`)),
    ...months.map(m => env.GAMES_KV.delete(`games:${m}`)),
  ]);

  return { deleted: slugs, months, skippedProtected };
}

/**
 * Vangnet tegen duplicaten: vindt actieve games die hetzelfde spel zijn —
 * zelfde Steam-appid (over maandgrenzen heen, net als de reclaim in
 * assignSlugs), of zelfde genormaliseerde titel + release-maand — en verbergt
 * alle duplicaten op één houder na. Dit vangt alles wat langs de
 * identiteits-reclaim in assignSlugs() glipt (bv. records die vóór die fix
 * zijn aangemaakt, of een appid die achteraf door backfillSteamAppids op een
 * tweede rij is gezet).
 *
 * Een titel+maand-match telt NIET als duplicaat wanneer beide rijen een
 * verschillend non-null appid hebben — dat zijn aantoonbaar twee producten.
 *
 * Houder-keuze: records met een manual-marker winnen (handwerk nooit
 * weggooien), daarna het oudste record (first_seen; ontbrekend telt als
 * jongst). De game:{slug} KV van elke verborgen dupe wordt verwijderd zodat
 * de detailpagina offline gaat.
 *
 * Retourneert { hidden: [slugs], months: Set<'YYYY-MM'|'tba'> } zodat de
 * caller de geraakte maand-KV's direct kan herbouwen.
 */
export async function dedupeActiveGames(env) {
  // json_extract i.p.v. de volledige raw_json: die blob bevat screenshots en
  // beschrijvingen (multi-KB per rij) terwijl alleen de manual-marker nodig is.
  const { results } = await env.GAMES_D1
    .prepare(`SELECT slug, name, release_date, steam_appid, first_seen,
                     json_extract(raw_json, '$.manual') AS manual_json
              FROM games WHERE status = 'active'`)
    .all();

  const hasManual = r => {
    try {
      const m = JSON.parse(r.manual_json || 'null');
      return !!m && Object.keys(m).length > 0;
    } catch { return false; }
  };

  // Houders eerst: manual-records boven pipeline-records, daarna oudste
  // first_seen. Wie het eerst komt claimt zijn identiteitssleutels; elke
  // latere row die een geclaimde sleutel raakt is een duplicaat.
  const rows = results
    .map(r => ({ ...r, manual: hasManual(r) }))
    .sort((a, b) => {
      if (a.manual !== b.manual) return a.manual ? -1 : 1;
      const af = a.first_seen || '9999'; // ontbrekende first_seen = jongst
      const bf = b.first_seen || '9999';
      return af < bf ? -1 : af > bf ? 1 : 0;
    });

  const claimed = new Map(); // identiteitssleutel → houder-row
  const toHide  = [];
  for (const r of rows) {
    const mon = r.release_date ? r.release_date.slice(0, 7) : 'tba';
    // CJK-titels normaliseren naar een lege string; zonder deze guard zouden
    // alle niet-Latijnse games in dezelfde maand elkaars "duplicaat" zijn.
    const normTitle = normalizeTitle(r.name);
    const titleKey  = normTitle ? `title:${normTitle}|${mon}` : null;
    const appidKey  = r.steam_appid ? `appid:${r.steam_appid}` : null;

    const appidHolder = appidKey ? claimed.get(appidKey) : undefined;
    const titleHolder = titleKey ? claimed.get(titleKey) : undefined;
    // Titel-match met aantoonbaar verschillende appids ⇒ twee echte producten.
    const titleIsDupe = titleHolder && !(r.steam_appid && titleHolder.steam_appid
      && String(titleHolder.steam_appid) !== String(r.steam_appid));

    if (appidHolder || titleIsDupe) {
      toHide.push(r);
      continue;
    }
    if (titleKey && !claimed.has(titleKey)) claimed.set(titleKey, r);
    if (appidKey) claimed.set(appidKey, r);
  }
  if (!toHide.length) return { hidden: [], months: new Set() };

  const slugs = toHide.map(r => r.slug);
  await hideGames(env, slugs);

  const months = new Set(toHide.map(r => r.release_date ? r.release_date.slice(0, 7) : 'tba'));
  return { hidden: slugs, months };
}

/**
 * Markeert games als 'hidden' als ze `olderThanDays` dagen niet meer zijn
 * teruggekomen in de pipeline. Verwijdert geen D1-rijen, maar verwijdert wel
 * hun game:{slug} KV-record — anders blijft de detailpagina voor altijd
 * publiek bereikbaar ondanks dat de game nergens meer in de lijsten staat.
 *
 * Games met raw_json.manual.protected = true worden nooit verborgen, ook niet
 * als last_seen verloopt — voor volledig handmatig toegevoegde games die nooit
 * via RAWG/extra-games terugkomen. Zet via:
 *   node scripts/set-manual.mjs <slug> protected true
 *
 * Alleen games binnen het rollende venster (of zonder datum) zijn kandidaat:
 * maanden vóór het venster worden niet meer door de pipeline verwerkt en
 * maanden ná het venster (bv. handmatig geseed) evenmin — daar verloopt
 * last_seen gegarandeerd, dus die releases zijn bevroren zodat hun
 * detailpagina's blijven bestaan. Games zonder release_date (TBA) draaien
 * wél dagelijks mee en blijven gewoon soft-delete-kandidaat.
 *
 * Retourneert het aantal verborgen games.
 */
export async function softDeleteStaleGames(env, olderThanDays = 7, windowFrom = null, windowTo = null) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

  const { results } = await env.GAMES_D1
    .prepare(`SELECT slug, json_extract(raw_json, '$.manual.protected') AS protected_flag
              FROM games WHERE status = 'active' AND last_seen < ?1
                AND (?2 IS NULL OR release_date IS NULL
                     OR (release_date >= ?2 AND (?3 IS NULL OR release_date <= ?3)))`)
    .bind(cutoff, windowFrom, windowTo)
    .all();
  if (!results.length) return 0;

  const slugs = results.filter(r => !r.protected_flag).map(r => r.slug);
  if (!slugs.length) return 0;

  await hideGames(env, slugs);
  return slugs.length;
}
