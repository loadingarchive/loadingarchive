export const PLATFORM_MAP = {
  "playstation4": "PS4", "playstation5": "PS5",
  "xbox-one": "XBO", "xbox-series-x": "XSX", "nintendo-switch": "NS",
};

export const MONTH_ABBR = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
export const MONTH_FULL = { January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12 };

export function isoDate(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseSteamDate(str) {
  if (!str) return null;
  str = str.trim();
  // "24 Jun, 2026"
  let m = str.match(/^(\d{1,2})\s+([A-Za-z]{3}),?\s+(\d{4})$/);
  if (m && MONTH_ABBR[m[2]]) return isoDate(parseInt(m[3], 10), MONTH_ABBR[m[2]], parseInt(m[1], 10));
  // "Jun 24, 2026"
  m = str.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTH_ABBR[m[1]]) return isoDate(parseInt(m[3], 10), MONTH_ABBR[m[1]], parseInt(m[2], 10));
  // "August 2026"
  m = str.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m && MONTH_FULL[m[1]]) return isoDate(parseInt(m[2], 10), MONTH_FULL[m[1]], 1);
  return null;
}

export function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

export function normalizeTitle(t) {
  return (t || "").toLowerCase().replace(/[®™©]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function daysBetween(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs((new Date(a) - new Date(b)) / 86400000);
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[b.length];
}

export function titlesAreCloseEnough(a, b) {
  if (a === b) return true;
  if (a.length < 10 || b.length < 10) return false;
  const threshold = Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.1));
  return levenshtein(a, b) <= threshold;
}

export async function mapWithConcurrency(items, limit, fn) {
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
