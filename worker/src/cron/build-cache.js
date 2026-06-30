import { runMonthPipeline, runTbaPipeline } from '../pipeline/merge.js';
import { scrapeWikipedia } from '../pipeline/wikipedia.js';
import { fetchAndStoreTrending } from '../pipeline/steamspy.js';
import { fetchSteamAppDetails, findExistingSteamAppId } from '../pipeline/steam.js';
import { mapWithConcurrency } from '../pipeline/utils.js';
import {
  queryActiveMonthGames,
  queryActiveTbaGames,
  rebuildGamePagesKv,
  rebuildTbaGamePagesKv,
  rebuildAllGamePagesKv,
  softDeleteStaleGames,
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

/** Returns the 4 months around today that get refreshed daily. */
function activeMonths() {
  const today = new Date();
  return [-1, 0, 1, 2].map(delta => {
    const d = new Date(today.getFullYear(), today.getMonth() + delta, 1);
    return makeMonthEntry(d.getFullYear(), d.getMonth() + 1);
  });
}

/** Returns all 12 months of the current year. */
function allYearMonths() {
  const y = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, i) => makeMonthEntry(y, i + 1));
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
async function processMonth(rawgKey, extraGames, env, { kvKey, dateFrom, dateTo, label }) {
  // Stap 1: pipeline upsert → D1
  await runMonthPipeline(rawgKey, dateFrom, dateTo, extraGames, env);

  // Stap 2: lees alle actieve games voor deze maand uit D1
  const results = await queryActiveMonthGames(env, dateFrom, dateTo);

  // Stap 3a: maand-KV (gebruikt door /api/games?month=YYYY-MM)
  await env.GAMES_KV.put(kvKey, JSON.stringify({ results, generatedAt: new Date().toISOString() }));

  // Stap 3b: individuele game:{slug} KV (gebruikt door /game/:slug)
  const pageCount = await rebuildGamePagesKv(env, dateFrom, dateTo);

  console.log(`  ${label}: ${results.length} games in KV (${pageCount} pagina's bijgewerkt)`);
}

// ---- daily: monthly pipeline ----

export async function runDailyCron(env) {
  const rawgKey    = env.RAWG_API_KEY;
  const extraGames = await loadExtraGames(env);

  // Verwerk alle 12 maanden van het jaar zodat elke maand verse data en slugs heeft.
  // Actieve maanden (vorige, huidige, volgende, daarna) krijgen altijd een volledige
  // RAWG-pipeline. Voor de overige maanden haalt RAWG weinig nieuws op, maar D1
  // blijft als bron zodat de KV-cache compleet en up-to-date is.
  const toProcess = allYearMonths();
  console.log(`Daily cron: verwerk alle 12 maanden`);

  for (const month of toProcess) {
    try {
      await processMonth(rawgKey, extraGames, env, month);
    } catch (e) {
      console.error(`  ${month.label}: pipeline mislukt —`, e.message);
    }
  }

  // TBA-pipeline → D1 + KV
  try {
    await runTbaPipeline(rawgKey, extraGames, env);
    const tbaResults = await queryActiveTbaGames(env);
    await env.GAMES_KV.put('games:tba', JSON.stringify({ results: tbaResults, generatedAt: new Date().toISOString() }));
    await rebuildTbaGamePagesKv(env);
    console.log(`  TBA: ${tbaResults.length} games in KV`);
  } catch (e) {
    console.error('  TBA: pipeline mislukt —', e.message);
  }

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

  // Trending: dagelijkse live CCU snapshot
  try {
    const { total } = await fetchAndStoreTrending(env);
    console.log(`  Trending: ${total} games in KV`);
  } catch (e) {
    console.error('  Trending mislukt —', e.message);
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

  const base  = 'https://www.loadingarchive.com';
  const today = new Date().toISOString().slice(0, 10);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
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
  for (const month of months) {
    try {
      await processMonth(rawgKey, extraGames, env, month);
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
    const entry = JSON.parse(row.raw_json || '{}');
    entry.steam   = steamAppid;
    entry.trailer = entry.trailer || `steam:${steamAppid}`;

    const app = await fetchSteamAppDetails(steamAppid);
    if (app) {
      entry.cover        = app.header_image || entry.cover;
      entry.screenshots  = (app.screenshots || []).slice(0, 3).map(s => s.path_full);
      if (!entry.short_description) entry.short_description = app.short_description || null;
      if (!entry.dev) entry.dev = app.developers?.[0] || null;
      if (!entry.price) entry.price = app.is_free ? 'Free' : (app.price_overview?.final_formatted || null);
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

/**
 * Haalt dagelijks de actuele prijs + korting op van Steam voor alle actieve games.
 * Slaat discount_percent en price_initial op in raw_json + KV.
 */
async function updateDailyPrices(env) {
  const { results } = await env.GAMES_D1
    .prepare(`SELECT slug, steam_appid, raw_json FROM games
              WHERE status = 'active' AND steam_appid IS NOT NULL`)
    .all();

  if (!results.length) return;
  console.log(`  Prijsupdate: ${results.length} games controleren`);

  let updated = 0;
  await mapWithConcurrency(results, 5, async (row) => {
    const app = await fetchSteamAppDetails(row.steam_appid);
    if (!app) return;

    const po              = app.price_overview;
    const discount        = po?.discount_percent ?? 0;
    const priceInitial    = po?.initial_formatted ?? null;
    const priceFinal      = app.is_free ? 'Free' : (po?.final_formatted ?? null);

    const entry = JSON.parse(row.raw_json || '{}');
    const changed =
      entry.discount_percent !== discount ||
      entry.price_initial    !== priceInitial ||
      entry.price            !== priceFinal;

    if (!changed) return;

    entry.discount_percent = discount;
    entry.price_initial    = priceInitial;
    entry.price            = priceFinal;

    const json = JSON.stringify(entry);
    await env.GAMES_D1
      .prepare(`UPDATE games SET price = ?1, raw_json = ?2, last_updated = ?3 WHERE slug = ?4`)
      .bind(priceFinal ?? null, json, new Date().toISOString(), row.slug)
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
