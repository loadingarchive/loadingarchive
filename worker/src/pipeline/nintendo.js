import { normalizeTitle, titlesAreCloseEnough } from './utils.js';

const EU_SEARCH = "https://search.nintendo-europe.com/en/select";

/**
 * Search Nintendo's Europe API for a game by title and return its cover image URL.
 * Returns null if not found or on error.
 */
export async function fetchNintendoCover(title) {
  const url = `${EU_SEARCH}?q=${encodeURIComponent(title)}&fq=type%3AGAME&start=0&rows=5&wt=json&fl=title,image_url_h16x9_s,nsuid_txt,system_type`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    const docs = data.response?.docs || [];
    const key = normalizeTitle(title);
    const match = docs.find(d => {
      const k = normalizeTitle(d.title || "");
      return k === key || titlesAreCloseEnough(key, k);
    });
    return match?.image_url_h16x9_s || null;
  } catch {
    return null;
  }
}
