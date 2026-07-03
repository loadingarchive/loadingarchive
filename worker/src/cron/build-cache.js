import { runMonthPipeline, runTbaPipeline } from '../pipeline/merge.js';
import { scrapeWikipedia } from '../pipeline/wikipedia.js';
import { fetchAndStoreTrending } from '../pipeline/steamspy.js';
import { fetchSteamAppDetails, fetchSteamPriceMulti, findExistingSteamAppId, PRICE_FETCH_FAILED } from '../pipeline/steam.js';
import { mapWithConcurrency } from '../pipeline/utils.js';
import {
  queryActiveMonthGames,
  queryActiveTbaGames,
  rebuildGamePagesKv,
  rebuildTbaGamePagesKv,
  rebuildAllGamePagesKv,
  softDeleteStaleGames,
  loadSlugOwners,
} from '../pipeline/d1.js';
import extraGamesBundle from '../../../api/data/extra-games.json';

// ---- helpers ----

function pad(n) { return String(n).padStart(2, '0'); }

function makeMonthEntry(year, month) {
  const y = year;
  const m = pad(month);
  const lastDay = new Date(y, month, 0).getDate();
  return { kvKey: `games:${y}-${m}`, dateFrom: `${y}-${m}-01`, dateTo: `${y}-${m}-${lastDay}`, label: `${y}-${m}` };
}

/** Load extra-games from KV (updated by weekly Wikipedia cron), fall back to bundle. */
async function loadExtraGames(env) {
  try {
    const cached = await env.GAMES_KV.get('config:extra-games', 'json');
    if (cached?.games?.length) return cached.games;
  } catch { /* fall through */ }
  return extraGamesBundle.games ?? [];
}

/**
 * Verwerkt één maand:
 * 1. Pipeline → upsert naar D1 (nieuwe + bijgewerkte games)
 * 2. Lees alle actieve games voor deze maand uit D1
 * 3. Schrijf maand-KV + individuele game:{slug} KV vanuit D1
 *
 * Dankzij stap 2 verdwijnen games die RAWG deze run niet teruggaf nooit
 * uit de publieke site, zolang ze in D1 staan met status='active'.
 */
async function processMonth(rawgKey, extraGames, env, { kvKey, dateFrom, dateTo, label }, slugOwners) {
  // Stap 1: pipeline upsert → D1
  await runMonthPipeline(rawgKey, dateFrom, dateTo, extraGames, env, slugOwners);

  // Stap 2: lees alle actieve games voor deze maand uit D1
  const results = await queryActiveMonthGames(env, dateFrom, dateTo);

  // Stap 3a: maand-KV (gebruikt door /api/games?month=YYYY-MM)
  await env.GAMES_KV.put(kvKey, JSON.stringify({ results, generatedAt: new Date().toISOString() }));

  // Stap 3b: individuele game:{slug} KV (gebruikt door /game/:slug)
  const pageCount = await rebuildGamePagesKv(env, dateFrom, dateTo);

  console.log(`  ${label}: ${results.length} games in KV (${pageCount} pagina's bijgewerkt)`);
}

// ---- daily: monthly pipeline ----
//
// De dagelijkse keten is opgeknipt in drie aparte cron-invocaties omdat één
// Worker-invocation max ~1000 subrequests mag doen (fetch + D1 + KV samen).
// Alles in één run — 12 maanden × tientallen games × meerdere Steam-calls,
// plus TBA, prijzen en KV-rebuilds — schoot daar ruim overheen, waardoor de
// laatste stappen stil konden falen.
//
//   0 3 * * *   → runMonthsCron(1, 6)                 maanden jan–jun
//   45 3 * * *  → runMonthsCron(7, 12, withTba)       maanden jul–dec + TBA
//   30 4 * * *  → runMaintenanceCron                  soft-delete, KV, sitemap,
//                                                     appid-backfill, prijzen

export async function runMonthsCron(env, fromMonth, toMonth, { withTba = false } = {}) {
  const rawgKey    = env.RAWG_API_KEY;
  const extraGames = await loadExtraGames(env);

  // Slug-eigenaars vooraf laden uit D1 zodat assignSlugs() botsingen kan
  // detecteren over ALLE maanden en de TBA-batch heen, niet alleen binnen
  // één maand-run. De map wordt gemuteerd terwijl elke maand verwerkt wordt.
  const slugOwners = await loadSlugOwners(env);

  const y = new Date().getFullYear();
  console.log(`Months cron: maanden ${fromMonth}–${toMonth}${withTba ? ' + TBA' : ''}`);

  for (let m = fromMonth; m <= toMonth; m++) {
    const month = makeMonthEntry(y, m);
    try {
      await processMonth(rawgKey, extraGames, env, month, slugOwners);
    } catch (e) {
      console.error(`  ${month.label}: pipeline mislukt —`, e.message);
    }
  }

  if (withTba) {
    try {
      await runTbaPipeline(rawgKey, extraGames, env, slugOwners);
      const tbaResults = await queryActiveTbaGames(env);
      await env.GAMES_KV.put('games:tba', JSON.stringify({ results: tbaResults, generatedAt: new Date().toISOString() }));
      await rebuildTbaGamePagesKv(env);
      console.log(`  TBA: ${tbaResults.length} games in KV`);
    } catch (e) {
      console.error('  TBA: pipeline mislukt —', e.message);
    }
  }
}

export async function runMaintenanceCron(env) {
  const rawgKey = env.RAWG_API_KEY;
  console.log('Maintenance cron');

  // Soft-delete: games die 7+ dagen niet meer in de pipeline voorkwamen → 'hidden'
  try {
    const hidden = await softDeleteStaleGames(env, 7);
    if (hidden > 0) console.log(`  Soft-delete: ${hidden} game(s) op 'hidden' gezet`);
  } catch (e) {
    console.error('  Soft-delete mislukt —', e.message);
  }

  // Herbouw game:{slug} KV voor ALLE actieve D1-records zodat elke game een detailpagina heeft.
  try {
    const pageCount = await rebuildAllGamePagesKv(env);
    console.log(`  Detailpagina's: ${pageCount} game:{slug} records naar KV geschreven`);
  } catch (e) {
    console.error('  Rebuild game-pagina\'s mislukt —', e.message);
  }

  // Sitemap opnieuw opbouwen vanuit maand-KV
  try {
    await generateSitemap(env);
  } catch (e) {
    console.error('  Sitemap: generatie mislukt —', e.message);
  }

  // Backfill: geef games zonder Steam appid nog een kans (max 15 per dag)
  try {
    await backfillSteamAppids(rawgKey, env);
  } catch (e) {
    console.error('  Backfill steam_appid mislukt —', e.message);
  }

  // Dagelijkse prijsupdate: kortingen en actuele prijzen ophalen van Steam
  try {
    await updateDailyPrices(env);
  } catch (e) {
    console.error('  Prijsupdate mislukt —', e.message);
  }
}

/**
 * Volledige keten in één invocation. Alleen bedoeld als fallback voor
 * onbekende cron-strings en handmatige runs — overschrijdt bij veel games
 * het subrequest-budget, gebruik in productie de gesplitste triggers.
 */
export async function runDailyCron(env) {
  await runMonthsCron(env, 1, 6);
  await runMonthsCron(env, 7, 12, { withTba: true });
  await runMaintenanceCron(env);
}

async function generateSitemap(env) {
  const year   = new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

  const allGames = [];
  for (const m of months) {
    const data = await env.GAMES_KV.get(`games:${m}`, 'json');
    if (data?.results) {
      for (const g of data.results) {
        if (g.slug) allGames.push({ slug: g.slug, date: g.date });
      }
    }
  }

  // TBA-games hebben geen release_date (dus geen maand-KV), maar wel een
  // live detailpagina — anders missen ze in de sitemap tot ze een datum krijgen.
  const tbaData = await env.GAMES_KV.get('games:tba', 'json');
  if (tbaData?.results) {
    for (const g of tbaData.results) {
      if (g.slug) allGames.push({ slug: g.slug, date: g.date });
    }
  }

  const base  = 'https://www.loadingarchive.com';
  const today = new Date().toISOString().slice(0, 10);

  // SSR maand-overzichten + trending — hoge prioriteit, dit zijn de
  // programmatic-SEO landingspagina's ("july 2026 game releases" etc.)
  const monthUrls = months.map(m =>
    `  <url><loc>${base}/releases/${m}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`
  );
  monthUrls.push(`  <url><loc>${base}/releases/tba</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`);
  monthUrls.push(`  <url><loc>${base}/trending</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>0.8</priority></url>`);
  // Statische trust-pagina's (AdSense/E-E-A-T): about, privacy, contact
  monthUrls.push(`  <url><loc>${base}/about</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>`);
  monthUrls.push(`  <url><loc>${base}/privacy</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>`);
  monthUrls.push(`  <url><loc>${base}/contact</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
${monthUrls.join('\n')}
${allGames.map(({ slug, date }) =>
  `  <url><loc>${base}/game/${slug}</loc><lastmod>${date || today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`
).join('\n')}
</urlset>`;

  await env.GAMES_KV.put('config:sitemap', xml);
  console.log(`  Sitemap: ${allGames.length} game-URLs opgeslagen in KV`);
}

// ---- seed specific months (used by temporary seeding endpoint) ----

export async function seedMonths(env, months) {
  const rawgKey    = env.RAWG_API_KEY;
  const extraGames = await loadExtraGames(env);
  const slugOwners = await loadSlugOwners(env);
  for (const month of months) {
    try {
      await processMonth(rawgKey, extraGames, env, month, slugOwners);
    } catch (e) {
      console.error(`  ${month.label}: seed mislukt —`, e.message);
    }
  }
}

/**
 * Backfill: zoek Steam appid voor actieve games die er nog geen hebben.
 * Probeert RAWG /stores endpoint eerst, daarna Steam zoekfunctie op naam.
 * Max 15 per run zodat de cron niet te lang loopt.
 */
async function backfillSteamAppids(rawgKey, env) {
  const { results } = await env.GAMES_D1
    .prepare(`SELECT slug, name, rawg_id, raw_json FROM games
              WHERE status='active' AND steam_appid IS NULL AND rawg_id IS NOT NULL
              ORDER BY last_seen DESC LIMIT 15`)
    .all();

  if (!results.length) return;
  console.log(`  Backfill steam_appid: ${results.length} candidates`);

  let fixed = 0;
  for (const row of results) {
    const rawgNumId = row.rawg_id?.replace(/^rawg(-tba)?-/, '');
    let steamAppid  = null;

    // Stap 1: RAWG stores endpoint
    if (rawgNumId && /^\d+$/.test(rawgNumId)) {
      try {
        const r = await fetch(
          `https://api.rawg.io/api/games/${rawgNumId}/stores?key=${rawgKey}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (r.ok) {
          const data = await r.json();
          const steamEntry = (data.results || []).find(s => s.store_id === 1);
          const m = steamEntry?.url?.match(/\/app\/(\d+)/);
          if (m) steamAppid = m[1];
        }
      } catch { /* ignore */ }
    }

    // Stap 2: Steam store search op naam als fallback
    if (!steamAppid) {
      steamAppid = await findExistingSteamAppId(row.name);
    }

    if (!steamAppid) continue;

    // Steam details ophalen voor cover, screenshots, etc.
    // Handmatig gemarkeerde velden (entry.manual) blijven onaangeroerd.
    const entry  = JSON.parse(row.raw_json || '{}');
    const manual = entry.manual || {};
    entry.steam = steamAppid;
    if (!manual.trailer) entry.trailer = entry.trailer || `steam:${steamAppid}`;

    const app = await fetchSteamAppDetails(steamAppid);
    if (app) {
      if (!manual.cover)       entry.cover       = app.header_image || entry.cover;
      if (!manual.screenshots) entry.screenshots = (app.screenshots || []).slice(0, 3).map(s => s.path_full);
      if (!manual.short_description && !entry.short_description) entry.short_description = app.short_description || null;
      if (!manual.dev   && !entry.dev)   entry.dev   = app.developers?.[0] || null;
      if (!manual.price && !entry.price) entry.price = app.is_free ? 'Free' : (app.price_overview?.final_formatted || null);
    }

    const now  = new Date().toISOString();
    const json = JSON.stringify(entry);
    await env.GAMES_D1.prepare(`
      UPDATE games SET
        steam_appid       = ?1,
        cover_image       = ?2,
        screenshots       = ?3,
        short_description = COALESCE(?4, short_description),
        raw_json          = ?5,
        last_updated      = ?6
      WHERE slug = ?7
    `).bind(
      steamAppid,
      entry.cover ?? null,
      JSON.stringify(entry.screenshots || []),
      entry.short_description ?? null,
      json,
      now,
      row.slug,
    ).run();

    await env.GAMES_KV.put(`game:${row.slug}`, json);
    console.log(`    → "${row.name}" appid ${steamAppid}`);
    fixed++;
  }

  if (fixed) console.log(`  Backfill: ${fixed} games bijgewerkt`);
}

async function ensurePriceCheckColumn(db) {
  try {
    await db.prepare(`ALTER TABLE games ADD COLUMN price_checked_at TEXT`).run();
  } catch { /* kolom bestaat al */ }
}

// Bovengrens op games/run: elke game kost tot 3 Steam-requests plus 1-2
// D1-writes en 1 KV-write, en de maintenance-invocation doet daarnaast ook de
// KV-rebuild en sitemap. 150 games ≈ 700 subrequests voor prijzen — ruim
// binnen het invocation-budget van ~1000. Near-term games staan vooraan in de
// sortering; de rotatie op price_checked_at zorgt dat de rest elke paar dagen
// aan de beurt komt.
const PRICE_UPDATE_DAILY_CAP = 150;
const PRICE_UPDATE_NEAR_TERM_DAYS = 30;

/**
 * Haalt dagelijks de actuele prijs + korting op van Steam.
 * Eén query met totale cap: games rond hun releasedatum (±30 dagen) eerst —
 * daar veranderen prijzen het vaakst — daarna de rest, beide groepen intern
 * geroteerd op price_checked_at (oudste eerst) zodat elke game periodiek aan
 * de beurt komt zonder het subrequest-budget van de invocation te overschrijden.
 * Slaat discount_percent en price_initial op in raw_json + KV.
 */
async function updateDailyPrices(env) {
  await ensurePriceCheckColumn(env.GAMES_D1);

  const now      = new Date();
  const nearFrom = new Date(now.getTime() - PRICE_UPDATE_NEAR_TERM_DAYS * 86400_000).toISOString().slice(0, 10);
  const nearTo   = new Date(now.getTime() + PRICE_UPDATE_NEAR_TERM_DAYS * 86400_000).toISOString().slice(0, 10);

  const { results } = await env.GAMES_D1
    .prepare(`SELECT slug, steam_appid, raw_json FROM games
              WHERE status = 'active' AND steam_appid IS NOT NULL
              ORDER BY CASE WHEN release_date IS NOT NULL AND release_date BETWEEN ?1 AND ?2 THEN 0 ELSE 1 END,
                       COALESCE(price_checked_at, '') ASC
              LIMIT ?3`)
    .bind(nearFrom, nearTo, PRICE_UPDATE_DAILY_CAP)
    .all();

  if (!results.length) return;
  console.log(`  Prijsupdate: ${results.length} games controleren`);

  let updated = 0;
  await mapWithConcurrency(results, 4, async (row) => {
    const entry     = JSON.parse(row.raw_json || '{}');
    const checkedAt = new Date().toISOString();
    const touch     = () => env.GAMES_D1
      .prepare(`UPDATE games SET price_checked_at = ?1 WHERE slug = ?2`)
      .bind(checkedAt, row.slug).run();

    // Handmatig vastgezette prijzen (scripts/set-manual.mjs) niet aanraken.
    if (entry.manual?.price) return touch();

    // Ports/re-releases tonen bewust geen prijs (die hoort bij de oude PC-release).
    if (entry.rerelease) return touch();

    // Haal USD, EUR en GBP prijzen op in parallel (lichte price_overview calls)
    const multi = await fetchSteamPriceMulti(row.steam_appid);
    if (multi === null) {
      // USD-fetch mislukt — bestaande prijzen laten staan, maar checked_at wel
      // bijwerken zodat deze game niet blijft vastzitten vooraan de rotatie.
      return touch();
    }
    const { usd, eur, gbp } = multi;

    // is_free wordt gesignaleerd als { is_free: true } terug van fetchOne
    const isFree = usd?.is_free || eur?.is_free || gbp?.is_free;

    // PRICE_FETCH_FAILED: de regionale call zelf faalde (timeout/429) — houd
    // dan de opgeslagen regionale prijs vast i.p.v. hem te wissen.
    const eurFailed = eur === PRICE_FETCH_FAILED;
    const gbpFailed = gbp === PRICE_FETCH_FAILED;

    const priceFinal    = isFree ? 'Free' : (usd?.final_formatted    ?? null);
    const priceInitial  = isFree ? null   : (usd?.initial_formatted   ?? null);
    const discount      = isFree ? 0      : (usd?.discount_percent    ?? 0);

    const priceEur      = isFree ? 'Free' : eurFailed ? (entry.price_eur         ?? null) : (eur?.final_formatted   ?? null);
    const priceInitEur  = isFree ? null   : eurFailed ? (entry.price_initial_eur ?? null) : (eur?.initial_formatted ?? null);
    const priceGbp      = isFree ? 'Free' : gbpFailed ? (entry.price_gbp         ?? null) : (gbp?.final_formatted   ?? null);
    const priceInitGbp  = isFree ? null   : gbpFailed ? (entry.price_initial_gbp ?? null) : (gbp?.initial_formatted ?? null);

    const changed =
      entry.price            !== priceFinal   ||
      entry.price_initial    !== priceInitial ||
      entry.discount_percent !== discount     ||
      entry.price_eur        !== priceEur     ||
      entry.price_gbp        !== priceGbp;

    if (!changed) return touch();

    entry.price            = priceFinal;
    entry.price_initial    = priceInitial;
    entry.discount_percent = discount;
    entry.price_eur        = priceEur;
    entry.price_initial_eur = priceInitEur;
    entry.price_gbp        = priceGbp;
    entry.price_initial_gbp = priceInitGbp;

    const json = JSON.stringify(entry);
    await env.GAMES_D1
      .prepare(`UPDATE games SET price = ?1, raw_json = ?2, last_updated = ?3, price_checked_at = ?3 WHERE slug = ?4`)
      .bind(priceFinal ?? null, json, checkedAt, row.slug)
      .run();
    await env.GAMES_KV.put(`game:${row.slug}`, json);
    updated++;
  });

  console.log(`  Prijsupdate: ${updated} games bijgewerkt`);
}

export { makeMonthEntry };

// ---- hourly: trending update ----

export async function runHourlyCron(env) {
  console.log('Hourly cron: trending update');
  try {
    const { total } = await fetchAndStoreTrending(env);
    console.log(`  Trending: ${total} games in KV`);
  } catch (e) {
    console.error('  Trending mislukt —', e.message);
  }
}

// ---- weekly: Wikipedia scrape ----

export async function runWeeklyWikipediaCron(env) {
  console.log('Weekly cron: Wikipedia scrape');
  const existing = await loadExtraGames(env);
  const updated  = await scrapeWikipedia(existing);
  await env.GAMES_KV.put('config:extra-games', JSON.stringify({ games: updated, updatedAt: new Date().toISOString() }));
  console.log(`Wikipedia cron klaar: ${updated.length} games in KV`);
}
