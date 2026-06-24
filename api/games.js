const PLATFORM_MAP = {
  "playstation4": "PS4", "playstation5": "PS5",
  "xbox-one": "XBO", "xbox-series-x": "XSX", "nintendo-switch": "NS",
};

// Steam content_descriptors ids that flag explicit sexual content.
// 1=some nudity/sexual content, 2=frequent violence/gore, 5=general mature
// content are left out on purpose -- those cover normal M-rated games (Dota 2,
// GTA, etc.) and would over-filter. Only the two "adult content" ids are excluded.
const ADULT_DESCRIPTOR_IDS = new Set([3, 4]);

const MIN_REVIEWS_FOR_PAST = 10; // cuts Steam shovelware noise; not applied to unreleased games
const MAX_PAST_CANDIDATES = 50;  // bounds appdetails fan-out, mirrors the old RAWG page_size=40

const MONTH_ABBR = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 };
const MONTH_FULL = { January:1, February:2, March:3, April:4, May:5, June:6, July:7, August:8, September:9, October:10, November:11, December:12 };

function isoDate(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseSteamDate(str) {
  if (!str) return null;
  str = str.trim();
  // "24 Jun, 2026" (day-first, used by some locales)
  let m = str.match(/^(\d{1,2})\s+([A-Za-z]{3}),?\s+(\d{4})$/);
  if (m && MONTH_ABBR[m[2]]) return isoDate(parseInt(m[3], 10), MONTH_ABBR[m[2]], parseInt(m[1], 10));
  // "Jun 24, 2026" (month-first, what cc=us&l=en actually returns)
  m = str.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTH_ABBR[m[1]]) return isoDate(parseInt(m[3], 10), MONTH_ABBR[m[1]], parseInt(m[2], 10));
  // "August 2026" (month-precision only, seen on the upcoming-releases page)
  m = str.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m && MONTH_FULL[m[1]]) return isoDate(parseInt(m[2], 10), MONTH_FULL[m[1]], 1);
  return null;
}

function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function normalizeTitle(t) {
  return (t || "").toLowerCase().replace(/[®™©]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function daysBetween(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs((new Date(a) - new Date(b)) / 86400000);
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------- RAWG: PlayStation / Xbox / Nintendo only ----------

async function fetchRawgConsoleGames(rawgKey, dateFrom, dateTo) {
  const url = `https://api.rawg.io/api/games?key=${rawgKey}&dates=${dateFrom},${dateTo}&ordering=released&page_size=40&exclude_additions=true&parent_platforms=2,3,7`;

  let data;
  try {
    const r = await fetch(url);
    if (!r.ok) {
      console.error("RAWG request failed", r.status, await r.text());
      return [];
    }
    data = await r.json();
  } catch (e) {
    console.error("RAWG fetch failed", e.message);
    return [];
  }

  return (data.results || []).map((g, idx) => {
    const platforms = (g.platforms || [])
      .map(p => PLATFORM_MAP[p.platform?.slug] || null)
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);
    if (platforms.length === 0) return null;

    const steamStore = (g.stores || []).find(s => s.store?.slug === "steam");
    const steamId = steamStore?.url?.match(/\/app\/(\d+)/)?.[1] || null;

    return {
      id: `rawg-${g.id ?? idx}`,
      title: g.name,
      date: g.released,
      platforms,
      genre: (g.genres || []).map(genre => genre.name).slice(0, 2),
      dev: "",
      anticipated: (g.added || 0) > 200,
      trailer: steamId ? `steam:${steamId}` : null,
      steam: steamId,
      price: null,
      cover: g.background_image || null,
    };
  }).filter(Boolean);
}

// ---------- Steam: PC only ----------

function parseSearchRows(html) {
  const marker = '<a href="https://store.steampowered.com/app/';
  return html.split(marker).slice(1).map(chunk => {
    const appidMatch = chunk.match(/^(\d+)\//);
    if (!appidMatch) return null;

    const nameMatch = chunk.match(/<span class="title">([^<]*)<\/span>/);
    const dateMatch = chunk.match(/<div class="search_released[^>]*>\s*([^<]+?)\s*<\/div>/);
    const descMatch = chunk.match(/data-ds-descids="\[([^\]]*)\]"/);
    const reviewMatch = chunk.match(/([\d,]+)\s+user reviews/);

    return {
      appid: appidMatch[1],
      name: nameMatch ? decodeHtmlEntities(nameMatch[1]) : null,
      date: dateMatch ? parseSteamDate(dateMatch[1]) : null,
      descIds: descMatch ? descMatch[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n)) : [],
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
    return []; // a single flaky page should degrade gracefully, not fail the whole batch
  }
}

// Steam's search has no date-range param, only a global Released_DESC sort that we
// must page through ourselves. For months far in the past, paging forward from page 0
// would take 50-100+ requests, so instead we estimate a `start` offset from the release
// rate observed on page 0, jump there directly, and correct that estimate (release volume
// varies day to day) with a few cheap probes before pulling the actual block of pages.
async function scrapePastSteamReleases(dateFrom, dateToCapped, todayStr) {
  let page0 = await fetchSearchPage(0);
  if (page0.length === 0) {
    // Page 0 is a single point of failure for everything below — a transient
    // blip (timeout, momentary throttling) shouldn't blank out the whole month.
    await new Promise(r => setTimeout(r, 600));
    page0 = await fetchSearchPage(0);
  }
  if (page0.length === 0) return [];

  const dated0 = page0.filter(r => r.date);
  if (dated0.length === 0) return [];
  const span0 = Math.max(1, daysBetween(dated0[0].date, dated0[dated0.length - 1].date));
  const rowsPerDay = Math.max(1, dated0.length / span0);

  const offsetDays = daysBetween(todayStr, dateToCapped);
  let start = Math.round((offsetDays * rowsPerDay) / 100) * 100;

  let probe = start === 0 ? page0 : await fetchSearchPage(start);
  let probeDate = probe.find(r => r.date)?.date || null;
  let guard = 0;
  while (probeDate && guard < 5) {
    const drift = daysBetween(probeDate, dateToCapped);
    if (drift <= 2) break; // close enough to start collecting from here
    const stepPages = Math.max(1, Math.round((drift * rowsPerDay) / 100));
    start = probeDate > dateToCapped
      ? start + stepPages * 100   // probe still too recent — jump further back
      : Math.max(0, start - stepPages * 100); // probe overshot into the past — step toward today
    probe = start === 0 ? page0 : await fetchSearchPage(start);
    probeDate = probe.find(r => r.date)?.date || null;
    guard++;
  }

  const rangeDays = daysBetween(dateToCapped, dateFrom) + 1;
  const extraPagesNeeded = Math.min(25, Math.ceil((rangeDays * rowsPerDay * 1.4) / 100));
  const extraStarts = Array.from({ length: extraPagesNeeded }, (_, i) => start + (i + 1) * 100);
  // Bounded concurrency — firing 25 requests at once is what seems to trigger Steam's throttling.
  const extraPages = await mapWithConcurrency(extraStarts, 8, fetchSearchPage);

  const collected = [...probe, ...extraPages.flat()];
  return collected.filter(r => r.date && r.date >= dateFrom && r.date <= dateToCapped);
}

async function fetchUpcomingSteamReleases() {
  let html;
  try {
    const r = await fetch("https://store.steampowered.com/explore/upcoming/?cc=us&l=english", { signal: AbortSignal.timeout(8000) });
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
    return {
      appid,
      name: a.name,
      date,
      descIds: a.descids || [],
      reviewCount: null, // unreleased — no review-noise gate
    };
  }).filter(Boolean);
}

async function fetchSteamPcGames(dateFrom, dateTo) {
  const today = new Date();
  const todayStr = isoDate(today.getFullYear(), today.getMonth() + 1, today.getDate());

  const tasks = [];
  if (dateFrom <= todayStr) {
    tasks.push(scrapePastSteamReleases(dateFrom, dateTo < todayStr ? dateTo : todayStr, todayStr));
  } else {
    tasks.push(Promise.resolve([]));
  }
  if (dateTo > todayStr) {
    tasks.push(
      fetchUpcomingSteamReleases().then(rows =>
        rows.filter(r => r.date > todayStr && r.date >= dateFrom && r.date <= dateTo)
      )
    );
  } else {
    tasks.push(Promise.resolve([]));
  }

  const [pastRows, upcomingRows] = await Promise.all(tasks);

  let candidates = [...pastRows, ...upcomingRows]
    .filter(c => !c.descIds.some(id => ADULT_DESCRIPTOR_IDS.has(id)))
    .filter(c => c.reviewCount === null || c.reviewCount >= MIN_REVIEWS_FOR_PAST);

  const byAppid = new Map();
  for (const c of candidates) byAppid.set(c.appid, c);
  candidates = [...byAppid.values()]
    .sort((a, b) => (b.reviewCount ?? 1e9) - (a.reviewCount ?? 1e9))
    .slice(0, MAX_PAST_CANDIDATES);

  const enriched = await mapWithConcurrency(candidates, 10, async c => {
    try {
      const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${c.appid}&cc=us&l=en`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      const data = await r.json();
      const app = data?.[c.appid]?.data;
      if (!app) return null;

      const descIds = app.content_descriptors?.ids || [];
      if (descIds.some(id => ADULT_DESCRIPTOR_IDS.has(id))) return null; // authoritative re-check

      const price = app.is_free ? "Free" : (app.price_overview?.final_formatted || null);

      return {
        id: `steam-${c.appid}`,
        title: app.name || c.name,
        date: c.date,
        platforms: ["PC"],
        genre: (app.genres || []).map(g => g.description).slice(0, 2),
        dev: (app.developers || [])[0] || "",
        anticipated: app.release_date?.coming_soon === true,
        trailer: app.movies?.length ? `steam:${c.appid}` : null,
        steam: c.appid,
        price,
        cover: app.header_image || null,
      };
    } catch (e) {
      console.error("Steam appdetails enrich failed", c.appid, e.message);
      return null;
    }
  });

  return enriched.filter(Boolean);
}

// ---------- Merge: collapse a game found on both Steam (PC) and RAWG (console) into one card ----------

function mergeResults(steamGames, rawgGames) {
  const steamByKey = new Map();
  for (const g of steamGames) {
    const key = normalizeTitle(g.title);
    if (!steamByKey.has(key)) steamByKey.set(key, []);
    steamByKey.get(key).push(g);
  }

  const usedSteamIds = new Set();
  const merged = [];

  for (const rg of rawgGames) {
    const key = normalizeTitle(rg.title);
    const candidates = (steamByKey.get(key) || []).filter(sg => !usedSteamIds.has(sg.id));
    // Same normalized title within the same displayed month is almost certainly the same
    // game even when the console date differs from the PC date by weeks (timed exclusivity,
    // certification lead time, etc.) — match on title alone and only use date to disambiguate
    // when more than one Steam candidate shares that title.
    let match = null;
    if (candidates.length === 1) {
      match = candidates[0];
    } else if (candidates.length > 1) {
      match = candidates.reduce((best, c) => daysBetween(c.date, rg.date) < daysBetween(best.date, rg.date) ? c : best);
    }

    if (match) {
      usedSteamIds.add(match.id);
      merged.push({
        ...match,
        platforms: [...new Set([...match.platforms, ...rg.platforms])],
        genre: match.genre.length ? match.genre : rg.genre,
        dev: match.dev || rg.dev,
        anticipated: match.anticipated || rg.anticipated,
      });
    } else {
      merged.push(rg);
    }
  }

  for (const sg of steamGames) {
    if (!usedSteamIds.has(sg.id)) merged.push(sg);
  }

  return merged;
}

export default async function handler(req, res) {
  const rawgKey = process.env.RAWG_API_KEY;
  const { month } = req.query;

  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: "Invalid month", detail: `Expected format YYYY-MM, got "${month}"` });
  }

  const now = month ? new Date(month + "-01") : new Date();
  const year = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const daysInMonth = new Date(year, now.getMonth() + 1, 0).getDate();
  const dateFrom = `${year}-${m}-01`;
  const dateTo   = `${year}-${m}-${daysInMonth}`;

  let rawgGames = [];
  let steamGames = [];
  try {
    [rawgGames, steamGames] = await Promise.all([
      fetchRawgConsoleGames(rawgKey, dateFrom, dateTo),
      fetchSteamPcGames(dateFrom, dateTo),
    ]);
  } catch (e) {
    console.error("games handler failed", e.message);
    return res.status(500).json({ error: "Games fetch failed", detail: e.message });
  }

  const results = mergeResults(steamGames, rawgGames);
  return res.status(200).json({ results });
}
