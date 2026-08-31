/**
 * Rollend maandvenster — de enige plek die bepaalt welke maanden "actief" zijn.
 *
 * Het venster loopt van de vorige maand t/m WINDOW_AHEAD maanden vooruit
 * (12 totaal, zelfde subrequest-budget als de oude vaste jan–dec-reeks) en
 * schuift automatisch mee met de kalender: elke maandwissel valt de oudste
 * maand af en komt er één bij. Gedeeld door de cron (welke maanden de
 * pipeline verwerkt), de sitemap en de SSR-maandpagina's (prev/next-grens).
 *
 * Maanden vóór het venster worden bevroren: hun KV en D1-records blijven
 * bestaan (detailpagina's en /releases/-pagina's blijven live), maar de
 * pipeline raakt ze niet meer aan en softDeleteStaleGames slaat ze over.
 */

export const WINDOW_BACK  = 1;
export const WINDOW_AHEAD = 10; // totaal: 1 terug + huidige + 10 vooruit = 12

// Eerste maand die ooit is gepubliceerd — ondergrens voor prev-links/sitemap.
export const SITE_START = '2026-01';

// Gedeelde validatie voor "YYYY-MM"-parameters (API, SSR-routes, seed).
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Array van 12 `{ year, month }` (month 1-based), oudste eerst. */
export function rollingMonths(now = new Date()) {
  const out = [];
  for (let off = -WINDOW_BACK; off <= WINDOW_AHEAD; off++) {
    const d = new Date(now.getFullYear(), now.getMonth() + off, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return out;
}

/** `{ year: 2027, month: 3 }` → `"2027-03"` (sorteerbaar als string). */
export function toMonthKey({ year, month }) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Laatste maand van het venster als "YYYY-MM". */
export function windowEndKey(now = new Date()) {
  const months = rollingMonths(now);
  return toMonthKey(months[months.length - 1]);
}

/** Eerste dag van het venster als "YYYY-MM-DD" — freeze-grens voor soft-delete. */
export function windowStartDate(now = new Date()) {
  return `${toMonthKey(rollingMonths(now)[0])}-01`;
}

/**
 * Laatste dag van het venster als "YYYY-MM-DD" — bovengrens voor soft-delete:
 * games gedateerd ná het venster (bv. handmatig geseede verre maanden) komen
 * niet dagelijks door de pipeline en mogen dus niet als "stale" verdwijnen.
 */
export function windowEndDate(now = new Date()) {
  const months = rollingMonths(now);
  const last = months[months.length - 1];
  const lastDay = new Date(last.year, last.month, 0).getDate();
  return `${toMonthKey(last)}-${String(lastDay).padStart(2, '0')}`;
}

/** Alle maand-keys van SITE_START t/m het einde van het venster (voor de sitemap). */
export function allMonthKeysThroughWindow(now = new Date()) {
  const [startY, startM] = SITE_START.split('-').map(Number);
  const end = windowEndKey(now);
  const keys = [];
  for (let y = startY, m = startM; ; m === 12 ? (y++, m = 1) : m++) {
    const key = toMonthKey({ year: y, month: m });
    if (key > end) break;
    keys.push(key);
  }
  return keys;
}
