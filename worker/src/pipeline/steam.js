import { normalizeTitle, titlesAreCloseEnough } from './utils.js';

// Content descriptors 3 (Nudity) en 4 (Sexual Content) → return null zodat aanroeper de game droppt
export const ADULT_DESCRIPTOR_IDS = new Set([3, 4]);

export async function fetchSteamAppDetails(appid) {
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const app = data?.[appid]?.data;
    if (!app) return null;
    const descIds = app.content_descriptors?.ids || [];
    if (descIds.some(id => ADULT_DESCRIPTOR_IDS.has(id))) return null;
    return app;
  } catch (e) {
    console.error("Steam appdetails failed", appid, e.message);
    return null;
  }
}

/**
 * Destilleert de detailvelden uit een reeds opgehaald Steam appdetails-object.
 * Losgetrokken uit fetchSteamGameDetails zodat de pipeline een al gefetcht
 * app-object kan hergebruiken i.p.v. hetzelfde endpoint nogmaals aan te roepen.
 */
export function extractSteamDetails(app) {
  return {
    short_description:    app.short_description || null,
    detailed_description: app.detailed_description || null,
    pc_requirements: {
      minimum:     app.pc_requirements?.minimum     || null,
      recommended: app.pc_requirements?.recommended || null,
    },
    metacritic:    app.metacritic ? { score: app.metacritic.score, url: app.metacritic.url } : null,
    screenshots:   (app.screenshots || []).slice(0, 3).map(s => s.path_full),
    categories:    (app.categories  || []).map(c => c.description),
  };
}

export async function fetchSteamGameDetails(appid) {
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const app = data?.[appid]?.data;
    if (!app) return null;
    return extractSteamDetails(app);
  } catch (e) {
    console.error("Steam game details failed", appid, e.message);
    return null;
  }
}

// Sentinel: een regionale (EUR/GBP) prijs-fetch is mislukt (timeout/429).
// Onderscheidt "fetch faalde" van "game heeft echt geen prijs" (null) zodat
// de aanroeper bestaande regionale prijzen niet wist bij een storing.
export const PRICE_FETCH_FAILED = Symbol('steam-price-fetch-failed');

/**
 * Haal Steam-prijzen op voor USD, EUR (nl) en GBP (gb).
 * Stap 1: volledige USD appdetails → bevat is_free + price_overview.
 * Stap 2: als het een betaald spel is, haal EUR + GBP op via lichte
 *         filters=price_overview calls in parallel.
 * Geeft { usd, eur, gbp } terug; elke waarde is null (geen prijs),
 * { is_free: true }, een Steam price_overview object, of PRICE_FETCH_FAILED
 * (alleen eur/gbp) als die regionale call zelf mislukte.
 * Geeft null (heel resultaat) terug als de USD-fetch mislukte (timeout,
 * rate-limit) — de aanroeper mag bestaande prijzen dan NIET overschrijven.
 */
export async function fetchSteamPriceMulti(appid) {
  const NONE = { usd: null, eur: null, gbp: null };

  // Stap 1: USD (volledig, voor is_free)
  let usdData;
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`,
      { signal: AbortSignal.timeout(7000) }
    );
    if (!r.ok) return null; // fetch mislukt — geen uitspraak over de prijs
    const j = await r.json();
    const d = j?.[appid];
    if (!d?.success || !d.data) return NONE;
    usdData = d.data;
  } catch { return null; }

  // Gratis games hebben geen price_overview
  if (usdData.is_free) return { usd: { is_free: true }, eur: { is_free: true }, gbp: { is_free: true } };

  const usd = usdData.price_overview || null;
  if (!usd) return NONE; // niet uitgebracht / geen prijs

  // Stap 2: EUR + GBP parallel (licht, alleen price_overview)
  async function fetchRegional(cc) {
    try {
      const r = await fetch(
        `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${cc}&filters=price_overview`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!r.ok) return PRICE_FETCH_FAILED;
      const j = await r.json();
      return j?.[appid]?.data?.price_overview || null;
    } catch { return PRICE_FETCH_FAILED; }
  }

  const [eur, gbp] = await Promise.all([fetchRegional('nl'), fetchRegional('gb')]);
  return { usd, eur, gbp };
}

export async function findExistingSteamAppId(title) {
  const target = normalizeTitle(title);
  if (!target) return null;
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(target)}&cc=us&l=en`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const exact = (data.items || []).find(it => it.type === "app" && normalizeTitle(it.name) === target);
    return exact ? exact.id : null;
  } catch (e) {
    console.error("Steam storesearch failed", title, e.message);
    return null;
  }
}
