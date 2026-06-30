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
  } catch (e) {
    console.error("Steam game details failed", appid, e.message);
    return null;
  }
}

/**
 * Haal Steam-prijzen op voor USD, EUR (nl) en GBP (gb).
 * Stap 1: volledige USD appdetails → bevat is_free + price_overview.
 * Stap 2: als het een betaald spel is, haal EUR + GBP op via lichte
 *         filters=price_overview calls in parallel.
 * Geeft { usd, eur, gbp } terug; elke waarde is null (geen prijs),
 * { is_free: true } of een Steam price_overview object.
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
    if (!r.ok) return NONE;
    const j = await r.json();
    const d = j?.[appid];
    if (!d?.success || !d.data) return NONE;
    usdData = d.data;
  } catch { return NONE; }

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
      if (!r.ok) return null;
      const j = await r.json();
      return j?.[appid]?.data?.price_overview || null;
    } catch { return null; }
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
