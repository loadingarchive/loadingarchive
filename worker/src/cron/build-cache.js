import { runMonthPipeline, runTbaPipeline } from '../pipeline/merge.js';
import { scrapeWikipedia } from '../pipeline/wikipedia.js';
import {
  queryActiveMonthGames,
  queryActiveTbaGames,
  rebuildGamePagesKv,
  rebuildTbaGamePagesKv,
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
  const active     = activeMonths();
  const activeKeys = new Set(active.map(m => m.kvKey));

  // Vind maanden van dit jaar die nog niet in KV staan — seed maximaal 4 per run
  const missing = [];
  for (const m of allYearMonths()) {
    if (activeKeys.has(m.kvKey)) continue;
    const hit = await env.GAMES_KV.get(m.kvKey);
    if (hit === null) missing.push(m);
  }
  const toProcess = [...active, ...missing.slice(0, 4)];

  console.log(`Daily cron: verwerk ${active.map(m => m.label).join(', ')}${missing.length ? `, seed ${missing.slice(0, 4).map(m => m.label).join(', ')}` : ''}`);

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

  // Sitemap opnieuw opbouwen vanuit maand-KV
  try {
    await generateSitemap(env);
  } catch (e) {
    console.error('  Sitemap: generatie mislukt —', e.message);
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

export { makeMonthEntry };

// ---- weekly: Wikipedia scrape ----

export async function runWeeklyWikipediaCron(env) {
  console.log('Weekly cron: Wikipedia scrape');
  const existing = await loadExtraGames(env);
  const updated  = await scrapeWikipedia(existing);
  await env.GAMES_KV.put('config:extra-games', JSON.stringify({ games: updated, updatedAt: new Date().toISOString() }));
  console.log(`Wikipedia cron klaar: ${updated.length} games in KV`);
}
