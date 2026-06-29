import { isoDate, decodeHtmlEntities, normalizeTitle, titlesAreCloseEnough, mapWithConcurrency, parseSteamDate, isJapanOnly } from './utils.js';
import { fetchSteamAppDetails } from './steam.js';

const RAW_URL = "https://en.wikipedia.org/w/index.php?title=List_of_video_games_released_in_2026&action=raw";

const PLATFORM_ALIASES = {
  WIN: "PC", OSX: "PC", LIN: "PC",
  NS: "NS", NS2: "NS2", PS4: "PS4", PS5: "PS5", XBO: "XBO", "XBX/S": "XSX",
};
const MONTH_LOOKUP = {
  January:1,February:2,March:3,April:4,May:5,June:6,
  July:7,August:8,September:9,October:10,November:11,December:12,
};

// Per-run cap: limits how many new titles we verify against Steam in a single
// cron invocation (the first-ever run could otherwise hit hundreds of games).
// Uncapped titles are picked up on the next weekly run.
const NEW_TITLES_PER_RUN = 120;

// --- wikitext cleanup ---

function stripRefs(s) {
  return s.replace(/<ref[^>]*\/>/g, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
}

function cleanWikitext(s) {
  s = stripRefs(s);
  s = s.replace(/\{\{efn[^}]*\}\}/g, "");
  s = s.replace(/\{\{dts\|([^}|]+)(\|[^}]*)?\}\}/g, "$1");
  s = s.replace(/\{\{Unknown\}\}/gi, "Unknown");
  s = s.replace(/\{\{nowrap\|([^}]*)\}\}/g, "$1");
  s = s.replace(/\{\{small\|([^}]*)\}\}/g, "$1");
  s = s.replace(/\{\{ubl(\|[^}]*)\}\}/g, (_, inner) => inner.split("|").filter(Boolean).join(", "));
  s = s.replace(/\{\{[^}]*\}\}/g, "");
  s = s.replace(/'''(.+?)'''/g, "$1");
  s = s.replace(/''(.+?)''/g, "$1");
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  s = s.replace(/\[\[([^\]]+)\]\]/g, "$1");
  s = decodeHtmlEntities(s);
  s = s.replace(/colspan="\d+"\s*\|/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.replace(/^\|+/, "").trim();
}

function parseWikiDate(text) {
  const m = (text || "").trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTH_LOOKUP[m[1]];
  if (!month) return null;
  return isoDate(2026, month, parseInt(m[2], 10));
}

function parsePlatforms(text) {
  return [...new Set(
    (text || "").split(",").map(p => PLATFORM_ALIASES[p.trim().toUpperCase()]).filter(Boolean)
  )];
}

function parseTableBlock(blockText) {
  const rowChunks = blockText.split(/\n\|-[^\n]*\n/).slice(1);
  const rows = [];
  for (const chunk of rowChunks) {
    const lines = chunk.split("\n").filter(l => l.trim().startsWith("|") && !l.trim().startsWith("|}"));
    if (lines.length < 6) continue;
    rows.push(lines.slice(0, 8).map(cleanWikitext));
  }
  return rows;
}

function collectRawEntries(wikitext) {
  const listStart  = wikitext.indexOf("==List==");
  const notesStart = wikitext.indexOf("==Notes==");
  const section    = wikitext.slice(listStart, notesStart === -1 ? undefined : notesStart);

  const tableChunks = section.split(/\{\| class="wikitable[^\n]*\n/).slice(1);
  const entries = [];

  tableChunks.forEach((chunk, i) => {
    const endIdx       = chunk.indexOf("\n|}");
    const blockContent = endIdx !== -1 ? chunk.slice(0, endIdx) : chunk;
    const isUnscheduled = i === tableChunks.length - 1;
    const rows = parseTableBlock(blockContent);

    for (const row of rows) {
      if (isUnscheduled) {
        const [title, , platformsText, , genreText, devText] = row;
        const platforms = parsePlatforms(platformsText);
        if (!title || platforms.length === 0) continue;
        entries.push({ title, platforms, date: null, genre: (genreText || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 2), dev: devText || "" });
      } else {
        const [dateText, title, platformsText, , genreText, devText] = row;
        const platforms = parsePlatforms(platformsText);
        const date      = parseWikiDate(dateText);
        if (!title || !date || platforms.length === 0) continue;
        entries.push({ title, platforms, date, genre: (genreText || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 2), dev: devText || "" });
      }
    }
  });

  return entries;
}

// --- Steam verification ---

async function findSteamAppIdByName(title) {
  const url = `https://store.steampowered.com/search/results/?term=${encodeURIComponent(title)}&category1=998&supportedlang=english&infinite=1&cc=us&l=en`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    const marker = '<a href="https://store.steampowered.com/app/';
    const candidates = (data.results_html || "").split(marker).slice(1).map(chunk => {
      const appidMatch = chunk.match(/^(\d+)\//);
      const nameMatch  = chunk.match(/<span class="title">([^<]*)<\/span>/);
      return appidMatch ? { appid: appidMatch[1], name: nameMatch ? decodeHtmlEntities(nameMatch[1]) : "" } : null;
    }).filter(Boolean);
    const key   = normalizeTitle(title);
    const match = candidates.find(c => titlesAreCloseEnough(key, normalizeTitle(c.name)));
    return match ? match.appid : null;
  } catch {
    return null;
  }
}

async function enrichWithSteam(entry) {
  const appid = await findSteamAppIdByName(entry.title);
  const app   = appid ? await fetchSteamAppDetails(appid) : null;

  let platforms = entry.platforms.filter(p => p !== "PC");
  let { date, genre, dev } = entry;
  let price = null, cover = null, trailer = null, steam = null, anticipated = false;

  if (app) {
    const steamDate = parseSteamDate(app.release_date?.date);
    const plausible = !steamDate || steamDate >= "2025-01-01";
    if (plausible) {
      platforms   = [...new Set([...platforms, "PC"])];
      price       = app.is_free ? "Free" : (app.price_overview?.final_formatted || null);
      cover       = app.header_image || null;
      trailer     = app.movies?.length ? `steam:${appid}` : null;
      steam       = appid;
      anticipated = false; // coming_soon zegt niets over hype — anticipated alleen via RAWG added-count
      date        = steamDate || date;
      const steamGenre = (app.genres || []).map(g => g.description).slice(0, 2);
      if (steamGenre.length) genre = steamGenre;
      if (!dev) dev = (app.developers || [])[0] || "";
    }
  }

  if (platforms.length === 0) return null;

  return {
    id:    `wiki-${normalizeTitle(entry.title).replace(/\s+/g, "-")}`,
    title: app?.name || entry.title,
    date, platforms, genre, dev, anticipated, trailer, steam, price, cover,
  };
}

// --- Public API ---

/**
 * Fetch and verify Wikipedia's 2026 game list against Steam.
 *
 * Incremental: `existingGames` is the previously stored array (from KV or
 * bundled JSON). Only titles NOT already present are verified against Steam
 * this run; the rest are returned as-is. This keeps subsequent weekly runs
 * cheap even though the first run processes the full article.
 *
 * Returns the merged array of old + newly verified games.
 */
export async function scrapeWikipedia(existingGames = []) {
  console.log("Wikipedia scrape: fetching article");
  let wikitext;
  try {
    const r = await fetch(RAW_URL, {
      headers: { "User-Agent": "loadingarchive-bot/1.0 (contact: loadingarchive@outlook.com)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    wikitext = await r.text();
  } catch (e) {
    console.error("Wikipedia fetch failed", e.message);
    return existingGames;
  }

  const rawEntries = collectRawEntries(wikitext);
  console.log(`Wikipedia: parsed ${rawEntries.length} raw entries`);

  // Deduplicate raw entries + verwijder Japan-only releases
  const seen   = new Set();
  const deduped = rawEntries.filter(e => {
    if (isJapanOnly(e.title)) return false;
    const key = `${e.date || "tba"}:${normalizeTitle(e.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Incremental: skip titles already in existingGames
  const existingKeys = existingGames.map(g => normalizeTitle(g.title));
  const newEntries   = deduped.filter(e => {
    const key = normalizeTitle(e.title);
    return !existingKeys.some(k => titlesAreCloseEnough(key, k));
  });

  const toProcess = newEntries.slice(0, NEW_TITLES_PER_RUN);
  console.log(`Wikipedia: ${newEntries.length} new titles, processing ${toProcess.length} this run`);

  const enriched = await mapWithConcurrency(toProcess, 3, enrichWithSteam);

  // Collapse duplicates that resolve to the same Steam appid after enrichment
  const byId = new Map(existingGames.map(g => [g.id, g]));
  for (const g of enriched.filter(Boolean)) {
    if (byId.has(g.id)) {
      byId.get(g.id).platforms = [...new Set([...byId.get(g.id).platforms, ...g.platforms])];
    } else {
      byId.set(g.id, g);
    }
  }

  console.log(`Wikipedia: done, ${byId.size} total games`);
  return [...byId.values()];
}
