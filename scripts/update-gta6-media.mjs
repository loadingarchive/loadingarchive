/**
 * Voegt media data toe aan beide GTA VI entries in D1 en herboet KV.
 * Data afkomstig van: https://www.rockstargames.com/VI (scraped)
 *
 * Cover :  poster_full van Rockstar (875 KB)
 * Screenshots: hero/sectie afbeeldingen van Rockstar website
 * Trailer:  YouTube Trailer 2 (VQRLujxTm3c) — "Grand Theft Auto VI Trailer 2"
 * Prijs:   $80.00 USD Standard Edition (officieel announced door Rockstar/Take-Two)
 */

import { readFileSync } from 'fs';
import path from 'path';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';
const toml  = readFileSync(path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'), 'utf8');
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
const CF_H  = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function d1Query(sql, params = []) {
  const body = params.length ? { sql, params } : { sql };
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results || [];
}

async function kvPut(key, value) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: { 'Authorization': `Bearer ${TOKEN}` }, body: value }
  );
  if (!r.ok) throw new Error(`KV PUT ${key}: ${r.status}`);
}

const ROCKSTAR_BASE = 'https://www.rockstargames.com/VI/_next/static/media/';

const MEDIA = {
  cover: ROCKSTAR_BASE + 'poster_full.0az_iud2g3y4j.jpg',
  screenshots: [
    ROCKSTAR_BASE + 'desktop.0iky3x6.hl8fo.jpg',
    ROCKSTAR_BASE + 'trailerDesktop.0uzwsiu0bz4qr.jpg',
    ROCKSTAR_BASE + 'onlyInLeonidaDesktop.15y2n40f3axwo.jpg',
    ROCKSTAR_BASE + 'mediaDesktop.06xrr56h6f14r.jpg',
    ROCKSTAR_BASE + 'desktop.00.5pzu2sm-z4.jpg',
  ],
  trailer: 'VQRLujxTm3c',  // Grand Theft Auto VI Trailer 2 — YouTube
  short_description: 'Vice City, USA. Jason and Lucia have always known the deck is stacked against them. But when an easy score goes wrong, they find themselves on the darkest side of the sunniest place in America, in the middle of a criminal conspiracy stretching across the state of Leonida — forced to rely on each other more than ever if they want to make it out alive.',
  price: '$80.00',
};

const SLUGS = ['grand-theft-auto-vi', 'gta-6'];

for (const slug of SLUGS) {
  const rows = await d1Query(`SELECT slug, raw_json FROM games WHERE slug = ?1`, [slug]);
  if (!rows.length) { console.log(`✗ ${slug} niet gevonden`); continue; }

  const g = JSON.parse(rows[0].raw_json || '{}');
  g.cover               = MEDIA.cover;
  g.screenshots         = MEDIA.screenshots;
  g.trailer             = MEDIA.trailer;
  g.short_description   = MEDIA.short_description;
  g.price               = MEDIA.price;
  // EUR/GBP laten we null totdat het officieel is
  g.price_eur           = g.price_eur  || null;
  g.price_gbp           = g.price_gbp  || null;
  // Ensure dev/genre correct zijn op het main entry
  if (slug === 'grand-theft-auto-vi') {
    g.dev   = g.dev   || 'Rockstar Games';
    g.genre = g.genre?.length ? g.genre : ['Action-adventure'];
  }

  const json = JSON.stringify(g);
  await d1Query(`UPDATE games SET raw_json = ?1, last_updated = ?2 WHERE slug = ?3`,
    [json, new Date().toISOString(), slug]);
  await kvPut(`game:${slug}`, json);
  console.log(`✓ ${slug} — cover, screenshots, trailer, prijs bijgewerkt`);
}

// Rebuild games:2026-11 KV (beide entries zitten in november)
const novRows = await d1Query(`
  SELECT slug, raw_json FROM games
  WHERE status = 'active' AND release_date >= '2026-11-01' AND release_date <= '2026-11-30'
  ORDER BY release_date ASC
`);
const results = novRows.map(r => JSON.parse(r.raw_json));
await kvPut('games:2026-11', JSON.stringify({ results, generatedAt: new Date().toISOString() }));
console.log(`\n✓ games:2026-11 herbouwd (${results.length} games)`);
