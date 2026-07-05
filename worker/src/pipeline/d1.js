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
      release_date      = excluded.release_date,
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
 * Retourneert het aantal verborgen games.
 */
export async function softDeleteStaleGames(env, olderThanDays = 7) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

  const { results } = await env.GAMES_D1
    .prepare(`SELECT slug, json_extract(raw_json, '$.manual.protected') AS protected_flag
              FROM games WHERE status = 'active' AND last_seen < ?1`)
    .bind(cutoff)
    .all();
  if (!results.length) return 0;

  const slugs = results.filter(r => !r.protected_flag).map(r => r.slug);
  if (!slugs.length) return 0;

  await hideGames(env, slugs);
  return slugs.length;
}
