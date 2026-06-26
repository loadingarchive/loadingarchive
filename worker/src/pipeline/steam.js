import {
  parseSteamDate, decodeHtmlEntities, normalizeTitle,
  titlesAreCloseEnough, daysBetween, mapWithConcurrency,
} from './utils.js';

export const ADULT_DESCRIPTOR_IDS = new Set([3, 4]);

const MIN_REVIEWS_FOR_PAST = 10;
const MAX_PAST_CANDIDATES  = 50;

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

export function parseSearchRows(html) {
  const marker = '<a href="https://store.steampowered.com/app/';
  return html.split(marker).slice(1).map(chunk => {
    const appidMatch  = chunk.match(/^(\d+)\//);
    if (!appidMatch) return null;
    const nameMatch   = chunk.match(/<span class="title">([^<]*)<\/span>/);
    const dateMatch   = chunk.match(/<div class="search_released[^>]*>\s*([^<]+?)\s*<\/div>/);
    const descMatch   = chunk.match(/data-ds-descids="\[([^\]]*)\]"/);
    const reviewMatch = chunk.match(/([\d,]+)\s+user reviews/);
    return {
      appid: appidMatch[1],
      name:  nameMatch   ? decodeHtmlEntities(nameMatch[1]) : null,
      date:  dateMatch   ? parseSteamDate(dateMatch[1])     : null,
      descIds:     descMatch   ? descMatch[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n)) : [],
      reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, ""), 10) : 0,
    };
  }).filter(Boolean);
}

async function fetchSearchPage(start) {
  const url = `https://store.steampowered.com/search/results/?query&start=${start}&count=100&dynamic_data=&sort_by=Released_DESC&category1=998&supportedlang=english&infinite=1&cc=us&l=en`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const data = await r.json();
    return parseSearchRows(data.results_html || "");
  } catch (e) {
    console.error("Steam search page failed", start, e.message);
    return [];
  }
}

async function scrapePastSteamReleases(dateFrom, dateToCapped, todayStr) {
  let page0 = await fetchSearchPage(0);
  if (page0.length === 0) {
    await new Promise(r => setTimeout(r, 600));
    page0 = await fetchSearchPage(0);
  }
  if (page0.length === 0) return [];

  const dated0 = page0.filter(r => r.date);
  if (dated0.length === 0) return [];
  const span0      = Math.max(1, daysBetween(dated0[0].date, dated0[dated0.length - 1].date));
  const rowsPerDay = Math.max(1, dated0.length / span0);

  const offsetDays = daysBetween(todayStr, dateToCapped);
  let start = Math.round((offsetDays * rowsPerDay) / 100) * 100;

  let probe     = start === 0 ? page0 : await fetchSearchPage(start);
  let probeDate = probe.find(r => r.date)?.date || null;
  let guard = 0;
  while (probeDate && guard < 5) {
    const drift = daysBetween(probeDate, dateToCapped);
    if (drift <= 2) break;
    const stepPages = Math.max(1, Math.round((drift * rowsPerDay) / 100));
    start = probeDate > dateToCapped
      ? start + stepPages * 100
      : Math.max(0, start - stepPages * 100);
    probe     = start === 0 ? page0 : await fetchSearchPage(start);
    probeDate = probe.find(r => r.date)?.date || null;
    guard++;
  }

  const rangeDays       = daysBetween(dateToCapped, dateFrom) + 1;
  const extraPagesNeeded = Math.min(25, Math.ceil((rangeDays * rowsPerDay * 1.4) / 100));
  const extraStarts     = Array.from({ length: extraPagesNeeded }, (_, i) => start + (i + 1) * 100);
  const extraPages      = await mapWithConcurrency(extraStarts, 8, fetchSearchPage);

  const collected = [...probe, ...extraPages.flat()];
  return collected.filter(r => r.date && r.date >= dateFrom && r.date <= dateToCapped);
}

async function fetchUpcomingSteamReleases() {
  let html;
  try {
    const r = await fetch(
      "https://store.steampowered.com/explore/upcoming/?cc=us&l=english",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return [];
    html = await r.text();
  } catch (e) {
    console.error("Steam upcoming fetch failed", e.message);
    return [];
  }

  const m = html.match(/GStoreItemData\.AddStoreItemDataSet\(\s*(\{[\s\S]*?\})\s*\)\s*;/);
  if (!m) return [];

  let data;
  try { data = JSON.parse(m[1]); } catch (e) { console.error("upcoming JSON parse failed", e.message); return []; }

  const apps = data.rgApps || {};
  return Object.entries(apps).map(([appid, a]) => {
    if (!a.os_windows) return null;
    const date = parseSteamDate((a.release_date_string || "").replace(/^Available:\s*/, ""));
    if (!date) return null;
    return { appid, name: a.name, date, descIds: a.descids || [], reviewCount: null };
  }).filter(Boolean);
}

export async function fetchSteamPcGames(dateFrom, dateTo) {
  const today    = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const [pastRows, upcomingRows] = await Promise.all([
    dateFrom <= todayStr
      ? scrapePastSteamReleases(dateFrom, dateTo < todayStr ? dateTo : todayStr, todayStr)
      : Promise.resolve([]),
    dateTo > todayStr
      ? fetchUpcomingSteamReleases().then(rows => rows.filter(r => r.date > todayStr && r.date >= dateFrom && r.date <= dateTo))
      : Promise.resolve([]),
  ]);

  let candidates = [...pastRows, ...upcomingRows]
    .filter(c => !c.descIds.some(id => ADULT_DESCRIPTOR_IDS.has(id)))
    .filter(c => c.reviewCount === null || c.reviewCount >= MIN_REVIEWS_FOR_PAST);

  const byAppid = new Map();
  for (const c of candidates) byAppid.set(c.appid, c);
  candidates = [...byAppid.values()]
    .sort((a, b) => (b.reviewCount ?? 1e9) - (a.reviewCount ?? 1e9))
    .slice(0, MAX_PAST_CANDIDATES);

  const enriched = await mapWithConcurrency(candidates, 10, async c => {
    const app = await fetchSteamAppDetails(c.appid);
    if (!app) return null;
    return {
      id:         `steam-${c.appid}`,
      title:      app.name || c.name,
      date:       c.date,
      platforms:  ["PC"],
      genre:      (app.genres || []).map(g => g.description).slice(0, 2),
      dev:        (app.developers || [])[0] || "",
      anticipated: app.release_date?.coming_soon === true,
      trailer:    app.movies?.length ? `steam:${c.appid}` : null,
      steam:      c.appid,
      price:      app.is_free ? "Free" : (app.price_overview?.final_formatted || null),
      cover:      app.header_image || null,
    };
  });

  return enriched.filter(Boolean);
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
