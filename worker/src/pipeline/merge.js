import { normalizeTitle, titlesAreCloseEnough, daysBetween, mapWithConcurrency, parseSteamDate, generateSlug, isJapanOnly } from './utils.js';
import { fetchSteamAppDetails, findExistingSteamAppId, fetchSteamGameDetails, extractSteamDetails } from './steam.js';
import { fetchRawgGames, fetchRawgTbaGames, enrichRawgCoverWithScreenshot } from './rawg.js';
import { fetchNintendoCover } from './nintendo.js';
import { upsertGameToD1 } from './d1.js';
import { isBlockedGame } from './blocklist.js';

const RERELEASE_GAP_DAYS = 60;

function withoutAlreadyCovered(extraGames, existingResults) {
  const existingKeys = existingResults.map(g => normalizeTitle(g.title));
  return extraGames.filter(eg => {
    const key = normalizeTitle(eg.title);
    return !existingKeys.some(k => titlesAreCloseEnough(key, k));
  });
}

async function backfillFromExistingSteamPage(game) {
  const appid = game.steam ?? await findExistingSteamAppId(game.title);
  if (!appid) return game;
  // Hergebruik het app-object dat rawg.js al ophaalde; alleen fetchen als
  // deze game via een ander pad binnenkwam (extra-games/Wikipedia).
  const app   = game.steamApp ?? await fetchSteamAppDetails(appid);
  if (!app)   return game;

  // Laag B: skip Steam-verrijking als Steam het als 18+ markeert (game blijft wel)
  if (Number(app.required_age) >= 18) return game;

  const originalDate = parseSteamDate(app.release_date?.date);
  const isRerelease  = originalDate && game.date && originalDate < game.date
    && daysBetween(originalDate, game.date) >= RERELEASE_GAP_DAYS;

  // Als het een re-release/port is: geen prijs of korting tonen van de oude PC versie.
  // De Steam-prijs hoort bij de originele PC release, niet bij de nieuwe console port.
  const price = isRerelease ? null : (game.price || (app.is_free ? "Free" : (app.price_overview?.final_formatted || null)));

  return {
    ...game,
    steam:     String(appid),
    steamApp:  app, // in-memory door naar saveGameToD1 (scheelt een derde fetch)
    cover:     game.cover  || app.header_image || null,
    price,
    genre:     game.genre.length ? game.genre : (app.genres || []).map(g => g.description).slice(0, 2),
    trailer:   game.trailer || (app.movies?.length ? `steam:${appid}` : null),
    // Voeg PC alleen toe als het GEEN re-release is (bij port is de PC versie al lang uit)
    platforms: isRerelease ? game.platforms : [...new Set([...game.platforms, "PC"])],
    // type:'port' is de conservatieve default — de Steam-datum-gap heuristiek
    // kan niet onderscheiden of het een kale platform-port of een remake/
    // remaster is. Dat onderscheid wordt handmatig gezet via set-manual.mjs.
    rerelease: isRerelease ? { date: originalDate, type: 'port' } : game.rerelease || null,
  };
}

// Genereert unieke slugs voor een lijst games. Bij botsing: voeg jaar toe, dan jaar-maand.
// Titels in niet-Latijns schrift (Japans, Chinees) leveren een lege base op → val terug op rawg-id.
//
// slugOwners is een gedeelde Map<slug, rawg_id> die wordt voorgeladen vanuit D1
// (loadSlugOwners) en tussen maand-runs in dezelfde cron wordt doorgegeven.
// Zonder deze map dedupliceerde assignSlugs alleen binnen één maand-batch: twee
// verschillende games met dezelfde titel in verschillende maanden konden dezelfde
// slug krijgen, waarna de tweede de eerste in D1 overschreef (ON CONFLICT(slug)).
export function assignSlugs(games, slugOwners = new Map()) {
  // Dezelfde game heeft als TBA-record id "rawg-tba-{n}" en als gedateerd
  // record "rawg-{n}". Normaliseer zodat een game die van TBA naar een datum
  // verhuist zijn eigen slug reclaimt i.p.v. een "-jaar" duplicaat te krijgen.
  const normId = id => String(id ?? '').replace(/^rawg-tba-/, 'rawg-');
  const isFree = (slug, id) => {
    const owner = slugOwners.get(slug);
    return owner === undefined || normId(owner.id) === normId(id);
  };

  // Identiteits-indexen over bestaande actieve records: zelfde Steam-appid, of
  // zelfde genormaliseerde titel + release-maand ⇒ hetzelfde spel, ook als het
  // eerder via een andere bron binnenkwam (ander pipeline-id: excel-/wiki-/
  // rawg-). Zonder deze check muntte de botsingslogica hieronder een
  // "-jaar"-slug en stond dezelfde game twee keer in de maandlijst.
  // Hidden records doen niet mee: een dupe adopteren die verborgen is zou hem
  // reactiveren naast het actieve record.
  const byAppid      = new Map();
  const byTitleMonth = new Map();
  for (const [slug, owner] of slugOwners) {
    if (!owner.active) continue;
    if (owner.appid) byAppid.set(String(owner.appid), slug);
    // CJK-titels normaliseren naar een lege string — die zouden allemaal op
    // dezelfde sleutel botsen, dus alleen indexeren bij een bruikbare titel.
    const normTitle = normalizeTitle(owner.title);
    if (normTitle) {
      const mon = owner.date ? owner.date.slice(0, 7) : "tba";
      byTitleMonth.set(`${normTitle}|${mon}`, slug);
    }
  }

  // Elke bestaande slug mag per batch maar één keer gereclaimd worden: twee
  // batch-games die op hetzelfde record matchen zouden anders allebei dezelfde
  // slug krijgen en elkaar concurrent overschrijven (last-writer-wins). De
  // tweede valt terug op de suffix-keten; het dedupe-vangnet ruimt hem
  // desnoods de volgende nacht op.
  const adopted = new Set();

  return games.map(g => {
    const raw  = generateSlug(g.title);
    const base = raw || String(g.id || "game"); // lege slug → gebruik rawg-id als anker
    const mon  = g.date ? g.date.slice(0, 7) : "tba";

    // Reclaim: bestaat dit spel al onder een andere slug/bron, neem die slug
    // over zodat de upsert het bestaande record bijwerkt i.p.v. dupliceert.
    const normTitle = normalizeTitle(g.title);
    let slug = (g.steam && byAppid.get(String(g.steam))) || null;
    if (!slug && normTitle) {
      const cand = byTitleMonth.get(`${normTitle}|${mon}`);
      // Titel+maand-match alleen vertrouwen als de appids niet aantoonbaar
      // verschillen — anders zou een écht ander spel met dezelfde titel het
      // bestaande record overschrijven (upsert heeft geen COALESCE op
      // name/rawg_id/release_date).
      const owner = cand ? slugOwners.get(cand) : undefined;
      if (cand && !(g.steam && owner?.appid && String(owner.appid) !== String(g.steam))) {
        slug = cand;
      }
    }
    if (slug && adopted.has(slug)) slug = null;
    if (slug) adopted.add(slug);

    if (!slug) {
      const year = g.date ? g.date.slice(0, 4) : "tba";
      slug = base;
      if (!isFree(slug, g.id)) slug = `${base}-${year}`;
      if (!isFree(slug, g.id)) slug = `${base}-${mon}`;
      if (!isFree(slug, g.id)) slug = `${base}-${g.id}`; // absolute fallback op RAWG-id
    }

    slugOwners.set(slug, { id: g.id, appid: g.steam ?? null, title: g.title, date: g.date ?? null, active: true });
    return { ...g, slug };
  });
}

/**
 * Haalt Steam-details op, bouwt de volledige entry en upsert naar D1.
 * Leest het bestaande D1-record eerst zodat handmatig ge-backfillde velden
 * (prijzen, kortingen, covers, screenshots) niet worden overschreven als de
 * pipeline ze deze run niet teruggeeft.
 *
 * Handmatige overrides: als het bestaande record een `manual`-object heeft
 * (bv. { rerelease: true, cover: true }, gezet via scripts/set-manual.mjs),
 * dan wint voor die velden ALTIJD de bestaande waarde — inclusief null, zodat
 * je een pipeline-waarde ook handmatig kunt wissen. De marker zelf reist mee
 * in raw_json en overleeft dus elke cron-run.
 *
 * Schrijft niet direct naar KV; dat doet build-cache.js vanuit D1.
 */
async function saveGameToD1(game, env) {
  // Lees bestaand record om handmatig ge-backfillde velden te bewaren.
  let existing = null;
  try {
    const { results } = await env.GAMES_D1
      .prepare(`SELECT raw_json FROM games WHERE slug = ?1`)
      .bind(game.slug)
      .all();
    if (results[0]?.raw_json) existing = JSON.parse(results[0].raw_json);
  } catch { /* nieuw record, geen fallback nodig */ }

  // Hergebruik het appdetails-object uit de backfill-stap; alleen als dat
  // ontbreekt (bv. 18+-geskipte verrijking) nog zelf details ophalen.
  const detail = game.steamApp
    ? extractSteamDetails(game.steamApp)
    : (game.steam ? await fetchSteamGameDetails(game.steam) : null);

  // Screenshots: neem Steam-resultaat als het niet leeg is, anders bewaar bestaande.
  const shots = detail?.screenshots?.length
    ? detail.screenshots
    : (existing?.screenshots?.length ? existing.screenshots : []);

  const entry = {
    id:                   game.id,
    slug:                 game.slug,
    title:                game.title,
    date:                 game.date,
    platforms:            game.platforms,
    genre:                game.genre,
    dev:                  game.dev                          || existing?.dev                    || null,
    // Eenmaal anticipated blijft anticipated: RAWG's added-count daalt nooit,
    // en dit beschermt handmatig gezette vlaggen zonder marker.
    anticipated:          game.anticipated                   || existing?.anticipated            || false,
    // Bewaar een bestaande port-tag als de Steam-heuristiek hem deze run niet
    // (opnieuw) detecteerde — beschermt handmatige tags van tag-ports-scripts.
    rerelease:            game.rerelease                     || existing?.rerelease              || null,
    trailer:              game.trailer                       || existing?.trailer                || null,
    steam:                game.steam                         || existing?.steam                  || null,
    // Ports/re-releases: prijs bewust null houden (hoort bij de oude PC-release),
    // dus niet terughalen uit het bestaande record.
    price:                game.rerelease ? null : (game.price || existing?.price || null),
    // Prijs-backfill-velden: bewaar altijd als pipeline ze niet teruggeeft.
    price_initial:        game.price_initial                 || existing?.price_initial          || null,
    price_eur:            game.price_eur                     || existing?.price_eur              || null,
    price_initial_eur:    game.price_initial_eur             || existing?.price_initial_eur      || null,
    price_gbp:            game.price_gbp                     || existing?.price_gbp              || null,
    price_initial_gbp:    game.price_initial_gbp             || existing?.price_initial_gbp      || null,
    discount_percent:     game.discount_percent              ?? existing?.discount_percent       ?? 0,
    cover:                game.cover                         || existing?.cover                  || null,
    store_url:            game.store_url                     || existing?.store_url              || null,
    short_description:    detail?.short_description          || existing?.short_description      || null,
    detailed_description: detail?.detailed_description       || existing?.detailed_description   || null,
    pc_requirements:      detail?.pc_requirements            || existing?.pc_requirements        || null,
    metacritic:           detail?.metacritic                  || existing?.metacritic             || null,
    screenshots:          shots,
    categories:           detail?.categories?.length
                            ? detail.categories
                            : (existing?.categories          || []),
  };

  // Handmatige overrides toepassen: gemarkeerde velden komen 1-op-1 uit het
  // bestaande record (ook als dat null is), en de marker blijft behouden.
  const manual = existing?.manual;
  if (manual && typeof manual === 'object') {
    for (const [field, isManual] of Object.entries(manual)) {
      if (isManual) entry[field] = existing[field] ?? null;
    }
    entry.manual = manual;
  }

  await upsertGameToD1(entry, env);
}

async function enrichWithNintendoCover(game) {
  if (game.cover) return game;
  if (!game.platforms.some(p => p === "NS" || p === "NS2")) return game;
  const cover = await fetchNintendoCover(game.title);
  return cover ? { ...game, cover } : game;
}

// RAWG is de enige bron voor game-releases. Steam voegt alleen cover, prijs en trailer toe.
export async function runMonthPipeline(rawgKey, dateFrom, dateTo, extraGames, env, slugOwners) {
  const rawgGames = await fetchRawgGames(rawgKey, dateFrom, dateTo);
  console.log(`  ${dateFrom}–${dateTo}: ${rawgGames.length} games van RAWG`);

  const filtered  = extraGames.filter(g => g.date && g.date >= dateFrom && g.date <= dateTo);
  const newExtras = withoutAlreadyCovered(filtered, rawgGames);
  const all       = [...rawgGames, ...newExtras].filter(g => !isJapanOnly(g.title) && !isBlockedGame(g));

  const backfilled  = await mapWithConcurrency(all, 10, backfillFromExistingSteamPage);
  const withCovers  = await mapWithConcurrency(backfilled, 6, g => enrichRawgCoverWithScreenshot(rawgKey, g));
  const withNintendo = await mapWithConcurrency(withCovers, 4, enrichWithNintendoCover);

  // Slugs toewijzen en upserten naar D1
  const withSlugs = assignSlugs(withNintendo, slugOwners);
  await mapWithConcurrency(withSlugs, 5, g => saveGameToD1(g, env));
  console.log(`  ${dateFrom}–${dateTo}: ${withSlugs.length} games → D1`);
}

export async function runTbaPipeline(rawgKey, extraGames, env, slugOwners) {
  const rawgResults = await fetchRawgTbaGames(rawgKey);
  const extraTba    = extraGames.filter(g => !g.date);
  const newExtras   = withoutAlreadyCovered(extraTba, rawgResults);
  const all         = [...rawgResults, ...newExtras].filter(g => !isJapanOnly(g.title) && !isBlockedGame(g));

  const backfilled   = await mapWithConcurrency(all, 10, backfillFromExistingSteamPage);
  const withCovers   = await mapWithConcurrency(backfilled, 6, g => enrichRawgCoverWithScreenshot(rawgKey, g));
  const withNintendo = await mapWithConcurrency(withCovers, 4, enrichWithNintendoCover);

  const withSlugs = assignSlugs(withNintendo, slugOwners);
  await mapWithConcurrency(withSlugs, 5, g => saveGameToD1(g, env));
  console.log(`  TBA: ${withSlugs.length} games → D1`);
}
