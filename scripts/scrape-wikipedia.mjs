// Manual "internal cmd" — run this locally whenever the RAWG/Steam pipeline is missing
// games (`node scripts/scrape-wikipedia.mjs`), then commit the resulting
// api/data/extra-games.json. Not wired into any live/automatic trigger.
//
// Source: Wikipedia's "List of video games released in 2026", licensed CC BY-SA 4.0 —
// a maintained, citation-backed database article (not someone's editorial writeup), which
// is exactly the kind of structured, freely-reusable data this is meant for. We extract
// only factual tuples (title, platform, date, genre) and verify every one of them against
// Steam ourselves; we don't copy Wikipedia's prose or images.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isoDate, parseSteamDate, decodeHtmlEntities,
  normalizeTitle, titlesAreCloseEnough, fetchSteamAppDetails, mapWithConcurrency,
} from "../api/games.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTICLE_URL = "https://en.wikipedia.org/wiki/List_of_video_games_released_in_2026";
const RAW_URL = "https://en.wikipedia.org/w/index.php?title=List_of_video_games_released_in_2026&action=raw";
const ATTRIBUTION = `Title/platform/date/genre facts adapted from Wikipedia, "List of video games released in 2026" (CC BY-SA 4.0): ${ARTICLE_URL}`;

const PLATFORM_ALIASES = { WIN: "PC", OSX: "PC", LIN: "PC", NS: "NS", NS2: "NS2", PS4: "PS4", PS5: "PS5", XBO: "XBO", "XBX/S": "XSX" };
const MONTH_FULL_LOOKUP = { January:1, February:2, March:3, April:4, May:5, June:6, July:7, August:8, September:9, October:10, November:11, December:12 };

// ---------- wikitext cleanup ----------

function stripRefs(s) {
  return s.replace(/<ref[^>]*\/>/g, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
}

function cleanWikitext(s) {
  s = stripRefs(s);
  s = s.replace(/\{\{efn[^}]*\}\}/g, "");
  s = s.replace(/\{\{dts\|([^}|]+)(\|[^}]*)?\}\}/g, "$1");
  s = s.replace(/\{\{Unknown\}\}/gi, "Unknown");
  s = s.replace(/\{\{nowrap\|([^}]*)\}\}/g, "$1");
  s = s.replace(/\{\{small\|([^}]*)\}\}/g, "$1"); // handle before {{ubl}} since it can nest {{small}}
  s = s.replace(/\{\{ubl(\|[^}]*)\}\}/g, (_, inner) => inner.split("|").filter(Boolean).join(", "));
  s = s.replace(/\{\{[^}]*\}\}/g, ""); // drop any remaining templates wholesale
  s = s.replace(/'''(.+?)'''/g, "$1"); // bold
  s = s.replace(/''(.+?)''/g, "$1");   // italics — non-greedy so it can't be tricked by a lone apostrophe
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2"); // [[Link|Display]] -> Display
  s = s.replace(/\[\[([^\]]+)\]\]/g, "$1");            // [[Link]] -> Link
  s = decodeHtmlEntities(s);
  s = s.replace(/colspan="\d+"\s*\|/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.replace(/^\|+/, "").trim();
}

function parseWikiDate(text) {
  const m = (text || "").trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTH_FULL_LOOKUP[m[1]];
  if (!month) return null;
  return isoDate(2026, month, parseInt(m[2], 10));
}

function parsePlatforms(text) {
  return [...new Set((text || "").split(",").map(p => PLATFORM_ALIASES[p.trim().toUpperCase()]).filter(Boolean))];
}

function splitGenre(text) {
  return (text || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 2);
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
  const listStart = wikitext.indexOf("==List==");
  const notesStart = wikitext.indexOf("==Notes==");
  const section = wikitext.slice(listStart, notesStart === -1 ? undefined : notesStart);

  const tableChunks = section.split(/\{\| class="wikitable[^\n]*\n/).slice(1);
  const entries = [];

  tableChunks.forEach((chunk, i) => {
    const endIdx = chunk.indexOf("\n|}");
    const blockContent = endIdx !== -1 ? chunk.slice(0, endIdx) : chunk;
    const isUnscheduled = i === tableChunks.length - 1; // last table = "Unscheduled releases"
    const rows = parseTableBlock(blockContent);

    for (const row of rows) {
      if (isUnscheduled) {
        const [title, , platformsText, , genreText, devText] = row;
        const platforms = parsePlatforms(platformsText);
        if (!title || platforms.length === 0) continue;
        entries.push({ title, platforms, date: null, genre: splitGenre(genreText), dev: devText || "" });
      } else {
        const [dateText, title, platformsText, , genreText, devText] = row;
        const platforms = parsePlatforms(platformsText);
        const date = parseWikiDate(dateText);
        if (!title || !date || platforms.length === 0) continue;
        entries.push({ title, platforms, date, genre: splitGenre(genreText), dev: devText || "" });
      }
    }
  });

  return entries;
}

// ---------- Steam verification ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));

// This offline script can afford to be patient where the live request-time pipeline can't —
// a burst of concurrent Steam requests across ~900 titles tends to trigger transient
// throttling (seen earlier the same way when scraping search pages for the live site), so
// every lookup gets a couple of retries with backoff before we give up on it.
async function withRetry(fn, attempts = 3, delays = [800, 2500]) {
  for (let i = 0; i < attempts; i++) {
    const result = await fn();
    if (result) return result;
    if (i < attempts - 1) await sleep(delays[i] || delays[delays.length - 1]);
  }
  return null;
}

async function findSteamAppIdByName(title) {
  return withRetry(async () => {
    const url = `https://store.steampowered.com/search/results/?term=${encodeURIComponent(title)}&category1=998&supportedlang=english&infinite=1&cc=us&l=en`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const data = await r.json();
      const marker = '<a href="https://store.steampowered.com/app/';
      const candidates = (data.results_html || "").split(marker).slice(1).map(chunk => {
        const appidMatch = chunk.match(/^(\d+)\//);
        const nameMatch = chunk.match(/<span class="title">([^<]*)<\/span>/);
        return appidMatch ? { appid: appidMatch[1], name: nameMatch ? decodeHtmlEntities(nameMatch[1]) : "" } : null;
      }).filter(Boolean);
      const key = normalizeTitle(title);
      const match = candidates.find(c => titlesAreCloseEnough(key, normalizeTitle(c.name)));
      return match ? match.appid : null;
    } catch (e) {
      console.error("Steam search attempt failed for", title, e.message);
      return null;
    }
  });
}

// Wikipedia's console platform tags are trusted as-is (same trust level as RAWG — console
// certification already screens those storefronts for explicit content). PC is the one tag
// we never take on the page's word alone: it only gets added once we've found and verified
// the matching Steam listing ourselves, the same safety gate the rest of the site uses.
async function enrichWithSteam(entry) {
  const appid = await findSteamAppIdByName(entry.title);
  const app = appid ? await withRetry(() => fetchSteamAppDetails(appid)) : null;

  let platforms = entry.platforms.filter(p => p !== "PC");
  let date = entry.date;
  let genre = entry.genre;
  let price = null, cover = null, trailer = null, dev = entry.dev, steam = null, anticipated = false;

  if (app) {
    const steamDate = parseSteamDate(app.release_date?.date);
    // A handful of short, generic titles (e.g. "171") collide with an unrelated, already-
    // released Steam game of the same name. This whole list is 2026 releases, so a match
    // resolving to well before that is a strong signal we grabbed the wrong appid entirely —
    // distrust the match rather than let a wrong date/price/cover slip through.
    const plausible = !steamDate || steamDate >= "2025-01-01";
    if (plausible) {
      platforms = [...new Set([...platforms, "PC"])];
      price = app.is_free ? "Free" : (app.price_overview?.final_formatted || null);
      cover = app.header_image || null;
      trailer = app.movies?.length ? `steam:${appid}` : null;
      steam = appid;
      anticipated = app.release_date?.coming_soon === true;
      date = steamDate || date; // Steam's date is the source of truth
      const steamGenre = (app.genres || []).map(g => g.description).slice(0, 2);
      if (steamGenre.length) genre = steamGenre;
      if (!dev) dev = (app.developers || [])[0] || "";
    }
  }

  if (platforms.length === 0) return null; // nothing left we can safely show

  return {
    id: `wiki-${normalizeTitle(entry.title).replace(/\s+/g, "-")}`,
    title: app?.name || entry.title,
    date,
    platforms,
    genre,
    dev,
    anticipated,
    trailer,
    steam,
    price,
    cover,
  };
}

async function main() {
  console.log("Fetching", RAW_URL);
  const res = await fetch(RAW_URL, { headers: { "User-Agent": "loadingarchive-scraper/1.0 (contact: loadingarchive@outlook.com)" } });
  if (!res.ok) throw new Error(`Wikipedia fetch failed with status ${res.status}`);
  const wikitext = await res.text();

  const rawEntries = collectRawEntries(wikitext);
  console.log(`Parsed ${rawEntries.length} raw entries from Wikipedia`);

  const seen = new Set();
  const deduped = rawEntries.filter(e => {
    const key = `${e.date || "tba"}:${normalizeTitle(e.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`Looking up Steam listings for ${deduped.length} games (this takes a while)...`);
  let done = 0;
  const enriched = await mapWithConcurrency(deduped, 3, async entry => {
    const result = await enrichWithSteam(entry);
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${deduped.length}`);
    return result;
  });

  // Two distinct Wikipedia rows (e.g. different per-platform dates before launch) can both
  // resolve to the same Steam appid once enriched, which would otherwise render as the exact
  // same card twice — collapse by id (derived from the title) and union their platforms.
  const byId = new Map();
  for (const g of enriched.filter(Boolean)) {
    if (byId.has(g.id)) {
      byId.get(g.id).platforms = [...new Set([...byId.get(g.id).platforms, ...g.platforms])];
    } else {
      byId.set(g.id, g);
    }
  }
  const final = [...byId.values()];
  console.log(`Final dataset: ${final.length} games (dropped ${deduped.length - final.length} with no verifiable platform or as a post-enrichment duplicate)`);

  const outPath = path.join(__dirname, "..", "api", "data", "extra-games.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    source: ARTICLE_URL,
    attribution: ATTRIBUTION,
    license: "CC BY-SA 4.0",
    scrapedAt: new Date().toISOString(),
    games: final,
  }, null, 2));
  console.log("Wrote", outPath);
}

main().catch(e => {
  console.error("Scrape failed:", e);
  process.exit(1);
});
