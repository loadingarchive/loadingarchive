/**
 * rebuild-sitemap.mjs — herbouwt config:sitemap KV handmatig, zonder op de
 * maintenance-cron (04:30) te wachten. Spiegelt exact generateSitemap() in
 * worker/src/cron/build-cache.js — als je die wijzigt, wijzig dit ook.
 *
 * Gebruik: node scripts/rebuild-sitemap.mjs
 */

import { readFileSync } from 'fs';
import path from 'path';

const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';
const toml  = readFileSync(path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'), 'utf8');
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];

async function kvGet(key) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`,
    { headers: { 'Authorization': `Bearer ${TOKEN}` } }
  );
  if (!r.ok) return null;
  return r.json();
}

async function kvPut(key, value) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: { 'Authorization': `Bearer ${TOKEN}` }, body: value }
  );
  if (!r.ok) throw new Error(`KV PUT ${key}: ${r.status}`);
}

const year   = new Date().getFullYear();
const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

const allGames = [];
for (const m of months) {
  const data = await kvGet(`games:${m}`);
  if (data?.results) {
    for (const g of data.results) {
      if (g.slug) allGames.push({ slug: g.slug, date: g.date });
    }
  }
}

const tbaData = await kvGet('games:tba');
if (tbaData?.results) {
  for (const g of tbaData.results) {
    if (g.slug) allGames.push({ slug: g.slug, date: g.date });
  }
}

const base  = 'https://www.loadingarchive.com';
const today = new Date().toISOString().slice(0, 10);

const monthUrls = months.map(m =>
  `  <url><loc>${base}/releases/${m}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`
);
monthUrls.push(`  <url><loc>${base}/releases/tba</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`);
monthUrls.push(`  <url><loc>${base}/trending</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>0.8</priority></url>`);

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
${monthUrls.join('\n')}
${allGames.map(({ slug, date }) =>
  `  <url><loc>${base}/game/${slug}</loc><lastmod>${date || today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`
).join('\n')}
</urlset>`;

await kvPut('config:sitemap', xml);
console.log(`✓ Sitemap herbouwd: 1 homepage + ${monthUrls.length} lijst-URLs + ${allGames.length} game-URLs`);
