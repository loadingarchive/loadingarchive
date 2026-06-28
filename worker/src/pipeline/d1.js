/**
 * D1 upsert + KV-rebuild helpers.
 *
 * D1 is de duurzame bron van waarheid; KV is de snelle leescache voor
 * publiek verkeer. Nooit D1 direct lezen vanuit publiek verkeer.
 */

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
      rawg_id           = excluded.rawg_id,
      name              = excluded.name,
      release_date      = excluded.release_date,
      platforms         = excluded.platforms,
      cover_image       = excluded.cover_image,
      steam_appid       = excluded.steam_appid,
      short_description = excluded.short_description,
      price             = excluded.price,
      metacritic        = excluded.metacritic,
      screenshots       = excluded.screenshots,
      requirements      = excluded.requirements,
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
 * Markeert games als 'hidden' als ze `olderThanDays` dagen niet meer zijn
 * teruggekomen in de pipeline. Verwijdert geen rijen.
 * Retourneert het aantal verborgen games.
 */
export async function softDeleteStaleGames(env, olderThanDays = 7) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const now    = new Date().toISOString();
  const result = await env.GAMES_D1
    .prepare(`UPDATE games
              SET status = 'hidden', last_updated = ?1
              WHERE status = 'active' AND last_seen < ?2`)
    .bind(now, cutoff)
    .run();
  return result.meta?.changes ?? 0;
}
