import { runMonthPipeline, runTbaPipeline } from '../pipeline/merge.js';
import { scrapeWikipedia } from '../pipeline/wikipedia.js';
import { fetchAndStoreTrending } from '../pipeline/steamspy.js';
import { fetchAndStoreEvents } from '../pipeline/igdb.js';
import { isWithinRetention, isEventPast } from '../events-window.js';
import { fetchSteamAppDetails, fetchSteamPriceMulti, findExistingSteamAppId, PRICE_FETCH_FAILED, ADULT_CONTENT_BLOCKED } from '../pipeline/steam.js';
import { mapWithConcurrency } from '../pipeline/utils.js';
import { fetchRawgStoreSteamAppId } from '../pipeline/rawg.js';
import { reconcileTbaDates } from '../pipeline/tba-reconcile.js';
import {
  queryActiveMonthGames,
  queryActiveTbaGames,
  rebuildGamePagesKv,
  rebuildTbaGamePagesKv,
  rebuildAllGamePagesKv,
  softDeleteStaleGames,
  dedupeActiveGames,
  purgeGamesBefore,
  loadSlugOwners,
  putGamesListKv,
  hideGames,
} from '../pipeline/d1.js';
import extraGamesBundle from '../../../api/data/extra-games.json';
import { rollingMonths, toMonthKey, windowStartDate, windowEndDate, makeMonthEntry } from '../months-window.js';

// ---- helpers ----

// Steam's 'nl' (Netherlands) locale formats EUR prices as "79,99€" (symbool
// achteraan). De rest van de site (USD "$69.99", GBP "£69.99") zet het symbool
// vooraan — dit normaliseert EUR-strings naar diezelfde "€79,99"-vorm.
function euroSymbolFirst(str) {
  if (!str) return str;
  const m = String(str).trim().match(/^([^\s€]+)\s*€$/);
  return m ? `€${m[1]}` : str;
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
  await putGamesListKv(env, kvKey, results);

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
// De maanden komen uit het rollende venster (months-window.js): vorige maand
// t/m 10 maanden vooruit, over jaargrenzen heen. fromIdx/toIdx zijn indexen
// in dat venster (0-based), zodat de twee invocaties elk 6 maanden pakken.
//
//   0 3 * * *   → runMonthsCron(0, 5)                 venster-maanden 1–6
//   45 3 * * *  → runMonthsCron(6, 11, withTba)       venster-maanden 7–12 + TBA
//   30 4 * * *  → runMaintenanceCron                  soft-delete, KV, sitemap,
//                                                     appid-backfill, prijzen

export async function runMonthsCron(env, fromIdx, toIdx, { withTba = false } = {}) {
  const rawgKey    = env.RAWG_API_KEY;
  const extraGames = await loadExtraGames(env);

  // Slug-eigenaars vooraf laden uit D1 zodat assignSlugs() botsingen kan
  // detecteren over ALLE maanden en de TBA-batch heen, niet alleen binnen
  // één maand-run. De map wordt gemuteerd terwijl elke maand verwerkt wordt.
  const slugOwners = await loadSlugOwners(env);

  const window = rollingMonths();
  console.log(`Months cron: venster-index ${fromIdx}–${toIdx}${withTba ? ' + TBA' : ''}`);

  for (let i = fromIdx; i <= toIdx && i < window.length; i++) {
    const month = makeMonthEntry(window[i].year, window[i].month);
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
      await putGamesListKv(env, 'games:tba', tbaResults);
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

  // Harde regel (gebruikersbeleid 2026-08-31): maanden die uit het rollende
  // venster zijn gevallen worden definitief verwijderd — D1 + KV. Doet
  // dagelijks meestal niets; ruimt na een maandwissel de afgevallen maand op.
  try {
    const { deleted, months, skippedProtected } = await purgeGamesBefore(env, windowStartDate());
    if (deleted.length) console.log(`  Purge: ${deleted.length} game(s) uit ${months.join(', ')} definitief verwijderd`);
    if (skippedProtected.length) console.log(`  Purge: overgeslagen wegens manual.protected: ${skippedProtected.join(', ')}`);
  } catch (e) {
    console.error('  Purge mislukt —', e.message);
  }

  // Soft-delete: games die 7+ dagen niet meer in de pipeline voorkwamen → 'hidden'.
  // Alleen binnen het rollende venster — maanden buiten het venster (vóór én
  // ná) worden niet door de pipeline verwerkt (last_seen loopt daar per
  // definitie af), die games zijn bevroren en moeten hun detailpagina houden.
  try {
    const hidden = await softDeleteStaleGames(env, 7, windowStartDate(), windowEndDate());
    if (hidden > 0) console.log(`  Soft-delete: ${hidden} game(s) op 'hidden' gezet`);
  } catch (e) {
    console.error('  Soft-delete mislukt —', e.message);
  }

  // Dedupe-vangnet: dezelfde game onder twee slugs (verschillende bronnen) →
  // duplicaat verbergen en de geraakte maand-KV's direct herbouwen, zodat de
  // dubbeling nooit langer dan één dag op de site staat.
  try {
    const { hidden, months } = await dedupeActiveGames(env);
    if (hidden.length) {
      console.log(`  Dedupe: ${hidden.length} duplicaat verborgen: ${hidden.join(', ')}`);
      for (const mon of months) {
        if (mon === 'tba') {
          const results = await queryActiveTbaGames(env);
          await putGamesListKv(env, 'games:tba', results);
        } else {
          const [y, m] = mon.split('-').map(Number);
          const { kvKey, dateFrom, dateTo } = makeMonthEntry(y, m);
          const results = await queryActiveMonthGames(env, dateFrom, dateTo);
          await putGamesListKv(env, kvKey, results);
        }
      }
    }
  } catch (e) {
    console.error('  Dedupe mislukt —', e.message);
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

  // TBA-games die inmiddels een echte releasedatum hebben (of al uit zijn)
  // de datum geven zodat ze uit de TBA-lijst naar hun maand verhuizen.
  try {
    await reconcileTbaDates(env);
  } catch (e) {
    console.error('  TBA-datumcheck mislukt —', e.message);
  }
}

/**
 * Volledige keten in één invocation. Alleen bedoeld als fallback voor
 * onbekende cron-strings en handmatige runs — overschrijdt bij veel games
 * het subrequest-budget, gebruik in productie de gesplitste triggers.
 */
export async function runDailyCron(env) {
  await runMonthsCron(env, 0, 5);
  await runMonthsCron(env, 6, 11, { withTba: true });
  await runMaintenanceCron(env);
}

async function generateSitemap(env) {
  // Alleen het rollende venster: maanden daarbuiten zijn definitief
  // verwijderd (purge-beleid) en horen dus niet in de sitemap.
  const months = rollingMonths().map(toMonthKey);

  // Verre venstermaanden kunnen nog leeg zijn (RAWG heeft dan nog geen
  // maand-precieze datums); hun /releases/-pagina geeft 404, dus die horen
  // niet in de sitemap. Zodra de cron er games voor vindt, komen ze erbij.
  // Alle KV-reads parallel (i.s.p.v. één voor één) — dit zijn ~12 onafhankelijke
  // gets, sequentieel scheelt dat onnodige latency in de maintenance-cron.
  const [monthsData, tbaData] = await Promise.all([
    Promise.all(months.map(m => env.GAMES_KV.get(`games:${m}`, 'json'))),
    env.GAMES_KV.get('games:tba', 'json'),
  ]);

  const monthsWithGames = [];
  const monthCounts = {};
  const allGames = [];
  months.forEach((m, i) => {
    const data = monthsData[i];
    monthCounts[m] = data?.results?.length ?? 0;
    if (data?.results?.length) {
      monthsWithGames.push(m);
      for (const g of data.results) {
        if (g.slug) allGames.push({ slug: g.slug, date: g.date });
      }
    }
  });

  // Compacte index {"2026-07": 179, ...} zodat month.js voor prev/next-links
  // niet de volledige buurmaand-payloads hoeft te lezen en parsen.
  await env.GAMES_KV.put('config:month-counts', JSON.stringify(monthCounts));

  // TBA-games hebben geen release_date (dus geen maand-KV), maar wel een
  // live detailpagina — anders missen ze in de sitemap tot ze een datum krijgen.
  if (tbaData?.results) {
    for (const g of tbaData.results) {
      if (g.slug) allGames.push({ slug: g.slug, date: g.date });
    }
  }

  const base  = 'https://www.loadingarchive.com';
  const today = new Date().toISOString().slice(0, 10);

  // SSR maand-overzichten + trending — hoge prioriteit, dit zijn de
  // programmatic-SEO landingspagina's ("july 2026 game releases" etc.)
  const monthUrls = monthsWithGames.map(m =>
    `  <url><loc>${base}/releases/${m}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`
  );
  monthUrls.push(`  <url><loc>${base}/releases/tba</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`);
  monthUrls.push(`  <url><loc>${base}/trending</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>0.8</priority></url>`);
  monthUrls.push(`  <url><loc>${base}/events</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`);

  // Individuele event-pagina's — inclusief afgelopen events binnen de
  // retentieperiode (30 dagen, zie events-window.js) zodat hun pagina's
  // vindbaar blijven zolang ze op de site staan. Lagere prioriteit voor
  // afgelopen events: minder relevant voor nieuwe bezoekers dan aankomende.
  const eventsData = await env.GAMES_KV.get('config:events', 'json');
  const now = Date.now();
  for (const ev of (eventsData?.events || []).filter(ev => isWithinRetention(ev, now))) {
    const priority = isEventPast(ev, now) ? 0.4 : 0.6;
    monthUrls.push(`  <url><loc>${base}/events/${ev.slug}</loc><changefreq>hourly</changefreq><priority>${priority}</priority></url>`);
  }
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

/** Retourneert per maand `{ month, ok, error? }` zodat de aanroeper (het
 *  seed-endpoint) mislukkingen niet als succes rapporteert. */
export async function seedMonths(env, months) {
  const rawgKey    = env.RAWG_API_KEY;
  const extraGames = await loadExtraGames(env);
  const slugOwners = await loadSlugOwners(env);
  const outcomes = [];
  for (const month of months) {
    try {
      await processMonth(rawgKey, extraGames, env, month, slugOwners);
      outcomes.push({ month: month.label, ok: true });
    } catch (e) {
      console.error(`  ${month.label}: seed mislukt —`, e.message);
      outcomes.push({ month: month.label, ok: false, error: e.message });
    }
  }
  return outcomes;
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
    // Stap 1: RAWG stores endpoint
    let steamAppid = await fetchRawgStoreSteamAppId(row.rawg_id, rawgKey);

    // Stap 2: Steam store search op naam als fallback
    if (!steamAppid) {
      steamAppid = await findExistingSteamAppId(row.name);
    }

    if (!steamAppid) continue;

    const app = await fetchSteamAppDetails(steamAppid);
    if (app === ADULT_CONTENT_BLOCKED) {
      // Dit spel stond al actief (wiki-/extra-games-bron zonder appid) en
      // blijkt nu, nu we zijn Steam-pagina vinden, 18+ te zijn — zelfde
      // beleid als de drop tijdens ingest (rawg.js/merge.js/wikipedia.js),
      // maar hier moet het al-live record ook echt verborgen worden i.p.v.
      // alleen de verrijking over te slaan (anders blijft het onverrijkt
      // maar zichtbaar staan).
      console.log(`Steam 18+ filter: "${row.name}" verborgen (adult content_descriptors, ontdekt tijdens appid-backfill)`);
      await hideGames(env, [row.slug]);
      continue;
    }

    // Steam details ophalen voor cover, screenshots, etc.
    // Handmatig gemarkeerde velden (entry.manual) blijven onaangeroerd.
    const entry  = JSON.parse(row.raw_json || '{}');
    const manual = entry.manual || {};
    entry.steam = steamAppid;
    if (!manual.trailer) entry.trailer = entry.trailer || `steam:${steamAppid}`;

    if (app) {
      if (!manual.cover)       entry.cover       = app.header_image || entry.cover;
      if (!manual.screenshots) entry.screenshots = (app.screenshots || []).slice(0, 3).map(s => s.path_full);
      if (!manual.short_description && !entry.short_description) entry.short_description = app.short_description || null;
      if (!manual.dev   && !entry.dev)   entry.dev   = app.developers?.[0] || null;
      // Ports/re-releases tonen bewust geen prijs (hoort bij de oude PC-
      // release) — zelfde beleid als saveGameToD1 (merge.js) en updateDailyPrices.
      if (!manual.price && !entry.price && !entry.rerelease) entry.price = app.is_free ? 'Free' : (app.price_overview?.final_formatted || null);
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
// Near-term games krijgen voorrang maar mogen nooit de hele dagcap opsouperen:
// anders komen far-term games tijdens een drukke releaseperiode (>100
// near-term games die update nodig hebben) NOOIT meer aan de beurt. Dit
// garandeert far-term altijd minstens DAILY_CAP - NEAR_TERM_CAP = 50 slots.
const PRICE_UPDATE_NEAR_TERM_CAP = 100;

/**
 * Haalt dagelijks de actuele prijs + korting op van Steam.
 * Twee aparte queries i.p.v. één gecombineerde ORDER BY/LIMIT: games rond hun
 * releasedatum (±30 dagen) krijgen voorrang (daar veranderen prijzen het
 * vaakst) maar zijn zelf gecapt op PRICE_UPDATE_NEAR_TERM_CAP, zodat de rest
 * van de dagcap altijd naar far-term games gaat — anders verhongeren die
 * structureel zodra er meer near-term games zijn dan de dagcap. Beide groepen
 * intern geroteerd op price_checked_at (oudste eerst).
 * Slaat discount_percent en price_initial op in raw_json + KV.
 */
async function updateDailyPrices(env) {
  await ensurePriceCheckColumn(env.GAMES_D1);

  const now      = new Date();
  const nearFrom = new Date(now.getTime() - PRICE_UPDATE_NEAR_TERM_DAYS * 86400_000).toISOString().slice(0, 10);
  const nearTo   = new Date(now.getTime() + PRICE_UPDATE_NEAR_TERM_DAYS * 86400_000).toISOString().slice(0, 10);

  const { results: nearResults } = await env.GAMES_D1
    .prepare(`SELECT slug, steam_appid, raw_json FROM games
              WHERE status = 'active' AND steam_appid IS NOT NULL
                AND release_date IS NOT NULL AND release_date BETWEEN ?1 AND ?2
              ORDER BY COALESCE(price_checked_at, '') ASC
              LIMIT ?3`)
    .bind(nearFrom, nearTo, PRICE_UPDATE_NEAR_TERM_CAP)
    .all();

  const farLimit = PRICE_UPDATE_DAILY_CAP - nearResults.length;
  const farResults = farLimit > 0
    ? (await env.GAMES_D1
        .prepare(`SELECT slug, steam_appid, raw_json FROM games
                  WHERE status = 'active' AND steam_appid IS NOT NULL
                    AND NOT (release_date IS NOT NULL AND release_date BETWEEN ?1 AND ?2)
                  ORDER BY COALESCE(price_checked_at, '') ASC
                  LIMIT ?3`)
        .bind(nearFrom, nearTo, farLimit)
        .all()).results
    : [];

  const results = [...nearResults, ...farResults];
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

    const priceEur      = isFree ? 'Free' : eurFailed ? (entry.price_eur         ?? null) : euroSymbolFirst(eur?.final_formatted   ?? null);
    const priceInitEur  = isFree ? null   : eurFailed ? (entry.price_initial_eur ?? null) : euroSymbolFirst(eur?.initial_formatted ?? null);
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

// ---- hourly: trending update ----

export async function runHourlyCron(env) {
  console.log('Hourly cron: trending update');
  try {
    const { total } = await fetchAndStoreTrending(env);
    console.log(`  Trending: ${total} games in KV`);
  } catch (e) {
    console.error('  Trending mislukt —', e.message);
  }

  // Gaming events (IGDB) — lichtgewicht (1-2 fetches; token zit in KV), dus
  // hij mag elk uur mee zodat net aangekondigde showcases snel op /events staan.
  try {
    const { total } = await fetchAndStoreEvents(env);
    console.log(`  Events: ${total} events in KV`);
  } catch (e) {
    console.error('  Events mislukt —', e.message);
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
