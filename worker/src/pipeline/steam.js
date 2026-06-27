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
