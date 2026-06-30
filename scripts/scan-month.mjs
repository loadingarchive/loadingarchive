/**
 * scan-month.mjs — Maand-scanner voor Loading Archive
 *
 * Controleert elke game in een maand op:
 *   cover, trailer, screenshots, prijs, beschrijving, developer, genre
 *
 * Probeert automatisch te fixen via Steam voor games met een steam_appid.
 * Zoekt ook Steam appids voor PC-games die er nog geen hebben.
 * Schrijft fixes naar D1 en rebuildt KV.
 *
 * Gebruik:
 *   node scripts/scan-month.mjs 2026-09
 *   node scripts/scan-month.mjs tba
 *   node scripts/scan-month.mjs 2026-09 --dry-run   (alleen rapport, geen wijzigingen)
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Config ────────────────────────────────────────────────────────────────────
const ROOT  = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACCT  = '651cb8c006e468c78e9ba255dd28b7cb';
const DB_ID = '70fde97b-0c21-40e5-87e6-abf655aa2772';
const KV_NS = 'cccc2aea7c3c44379b6fe07a28e06bff';

const toml  = readFileSync(
  path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'),
  'utf8'
);
const TOKEN = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
const CF_H  = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const MONTH   = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');

if (!MONTH) {
  console.error('Gebruik: node scripts/scan-month.mjs <YYYY-MM|tba> [--dry-run]');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/'/g, "''"); }

async function d1Query(sql) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify({ sql }) }
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result[0].results;
}

async function d1Exec(sql) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: CF_H, body: JSON.stringify({ sql }) }
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j;
}

async function kvPut(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`;
  const r = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${TOKEN}` }, body: value });
  if (!r.ok) console.warn(`    KV PUT mislukt voor ${key}: ${r.status}`);
}

async function kvGet(key) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(key)}`;
  const r = await fetch(url, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  if (r.status === 404) return null;
  return r.ok ? r.text() : null;
}

async function fetchSteam(appid) {
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    return d[String(appid)]?.success ? d[String(appid)].data : null;
  } catch { return null; }
}

async function steamSearch(name) {
  try {
    const q = encodeURIComponent(name);
    const r = await fetch(
      `https://store.steampowered.com/api/storesearch/?term=${q}&l=english&cc=US`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const items = d.items || [];
    // Zoek exacte of bijna-exacte match op naam
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = norm(name);
    const hit = items.find(i => norm(i.name) === target)
             || items.find(i => norm(i.name).startsWith(target.slice(0, 10)));
    return hit?.id ? String(hit.id) : null;
  } catch { return null; }
}

// ── Velden checken ────────────────────────────────────────────────────────────
function checkGame(entry, slug) {
  const missing = [];
  if (!entry.cover)              missing.push('cover');
  if (!entry.trailer)            missing.push('trailer');
  if (!entry.screenshots?.length) missing.push('screenshots');
  if (!entry.price)              missing.push('price');
  if (!entry.short_description)  missing.push('description');
  if (!entry.dev)                missing.push('developer');
  if (!entry.genre?.length)      missing.push('genre');
  return missing;
}

// ── KV detail-pagina check ────────────────────────────────────────────────────
async function hasDetailPage(slug) {
  const v = await kvGet(`game:${slug}`);
  return v !== null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const isTba = MONTH === 'tba';
let dateFilter;
if (isTba) {
  dateFilter = `release_date IS NULL`;
} else {
  const [y, m] = MONTH.split('-');
  const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
  dateFilter = `release_date >= '${MONTH}-01' AND release_date <= '${MONTH}-${String(lastDay).padStart(2,'0')}'`;
}

console.log(`\n═══════════════════════════════════════════════════════`);
console.log(`  Loading Archive — Maand-scan: ${MONTH.toUpperCase()}${DRY_RUN ? '  [DRY RUN]' : ''}`);
console.log(`═══════════════════════════════════════════════════════\n`);

const rows = await d1Query(
  `SELECT slug, name, steam_appid, platforms, raw_json FROM games WHERE status='active' AND ${dateFilter} ORDER BY release_date, name`
);

console.log(`${rows.length} games gevonden.\n`);

const report = {
  perfect:   [],
  fixed:     [],
  partial:   [],
  noPage:    [],
};

for (const row of rows) {
  let entry = JSON.parse(row.raw_json || '{}');
  const slug = row.slug;
  const name = entry.title || row.name;
  const platforms = JSON.parse(row.platforms || '[]');
  const hasPc = platforms.includes('PC');

  // Controleer detail-pagina in KV
  const pageExists = await hasDetailPage(slug);

  let steamAppid = row.steam_appid || entry.steam || null;
  let steamData  = null;
  let changed    = false;
  let missingBefore = checkGame(entry, slug);

  // Stap 1: Zoek Steam appid als de game PC heeft maar geen appid
  if (!steamAppid && hasPc) {
    const found = await steamSearch(name);
    if (found) {
      steamAppid = found;
      console.log(`  🔍 ${name} → Steam appid gevonden: ${found}`);
    }
  }

  // Stap 2: Haal Steam details op als we een appid hebben
  if (steamAppid) {
    steamData = await fetchSteam(steamAppid);
  }

  // Stap 3: Vul ontbrekende velden aan
  if (steamAppid && !entry.steam) { entry.steam = steamAppid; changed = true; }
  if (steamAppid && !entry.trailer) { entry.trailer = `steam:${steamAppid}`; changed = true; }

  if (steamData) {
    if (!entry.cover && steamData.header_image) {
      entry.cover = steamData.header_image; changed = true;
    }
    if (!entry.screenshots?.length && steamData.screenshots?.length) {
      entry.screenshots = steamData.screenshots.slice(0, 5).map(s => s.path_full); changed = true;
    }
    if (!entry.short_description && steamData.short_description) {
      entry.short_description = steamData.short_description; changed = true;
    }
    if (!entry.dev && steamData.developers?.[0]) {
      entry.dev = steamData.developers[0]; changed = true;
    }
    if (!entry.price) {
      entry.price = steamData.is_free ? 'Free' : (steamData.price_overview?.final_formatted || null);
      if (entry.price) changed = true;
    }
    if (!entry.genre?.length && steamData.genres?.length) {
      entry.genre = steamData.genres.map(g => g.description).slice(0, 3); changed = true;
    }
  }

  // Stap 4: Schrijf naar D1 en KV als er iets veranderd is
  if (changed && !DRY_RUN) {
    const json = JSON.stringify(entry);
    const coverCol  = entry.cover  ? `'${esc(entry.cover)}'`  : 'cover_image';
    const steamCol  = steamAppid   ? `'${esc(steamAppid)}'`   : 'steam_appid';
    await d1Exec(`
      UPDATE games SET
        steam_appid = ${steamCol},
        cover_image = ${coverCol},
        raw_json    = '${esc(json)}',
        last_updated = datetime('now')
      WHERE slug = '${esc(slug)}'
    `);
    await kvPut(`game:${slug}`, json);
  } else if (changed && DRY_RUN) {
    // In dry-run mode: update KV in-memory but don't write to D1
  }

  // Stap 5: Maak eindstatus op
  const missingAfter = checkGame(entry, slug);
  const fixedFields  = missingBefore.filter(f => !missingAfter.includes(f));

  const status = {
    name, slug, platforms, steamAppid,
    missing: missingAfter,
    fixed: fixedFields,
    pageExists: pageExists || changed, // als we net geschreven hebben, is de pagina er
  };

  if (!pageExists && !changed) {
    report.noPage.push(status);
  } else if (missingAfter.length === 0) {
    report.perfect.push(status);
  } else if (fixedFields.length > 0) {
    report.partial.push(status);
  } else {
    report.partial.push(status);
  }

  if (fixedFields.length > 0) {
    report.fixed.push(status);
  }
}

// ── Rebuild KV maandlijst ──────────────────────────────────────────────────────
if (!DRY_RUN) {
  if (isTba) {
    const tbaRows  = await d1Query(`SELECT raw_json FROM games WHERE status='active' AND release_date IS NULL ORDER BY name`);
    const tbaGames = tbaRows.map(r => JSON.parse(r.raw_json));
    await kvPut('games:tba', JSON.stringify({ results: tbaGames, generatedAt: new Date().toISOString() }));
  } else {
    const [y, m] = MONTH.split('-');
    const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
    const from = `${MONTH}-01`, to = `${MONTH}-${String(lastDay).padStart(2,'0')}`;
    const monthRows  = await d1Query(`SELECT raw_json FROM games WHERE status='active' AND release_date >= '${from}' AND release_date <= '${to}' ORDER BY release_date`);
    const monthGames = monthRows.map(r => JSON.parse(r.raw_json));
    await kvPut(`games:${MONTH}`, JSON.stringify({ results: monthGames, generatedAt: new Date().toISOString() }));
  }
}

// ── Rapport ───────────────────────────────────────────────────────────────────
const perfect  = report.perfect.filter(g => report.fixed.every(f => f.slug !== g.slug));
const fixed    = report.fixed;
const problems = report.partial.filter(g => g.missing.length > 0);
const noPage   = report.noPage;

console.log('\n───────────────────────────────────────────────────────');
console.log(`  RAPPORT — ${MONTH.toUpperCase()}`);
console.log('───────────────────────────────────────────────────────\n');

console.log(`✅ Volledig (${perfect.length}/${rows.length}):`);
if (perfect.length === 0) console.log('   (geen)');
else perfect.forEach(g => console.log(`   • ${g.name}`));

if (fixed.length > 0) {
  console.log(`\n🔧 Auto-gefixed (${fixed.length}):`);
  fixed.forEach(g => {
    console.log(`   • ${g.name}`);
    console.log(`     Fixed: ${g.fixed.join(', ')}`);
    if (g.missing.length) console.log(`     Nog mist: ${g.missing.join(', ')}`);
  });
}

if (problems.length > 0) {
  const unfixed = problems.filter(g => !fixed.some(f => f.slug === g.slug));
  const partialFixed = problems.filter(g => fixed.some(f => f.slug === g.slug));

  if (partialFixed.length > 0) {
    console.log(`\n⚠️  Deels gefixed — nog onvolledig (${partialFixed.length}):`);
    partialFixed.forEach(g => {
      console.log(`   • ${g.name} (${g.platforms.join('/')})`);
      console.log(`     Mist nog: ${g.missing.join(', ')}`);
    });
  }

  if (unfixed.length > 0) {
    console.log(`\n❌ Niet opgelost — handmatige actie nodig (${unfixed.length}):`);
    unfixed.forEach(g => {
      const hasPc = g.platforms.includes('PC');
      const reden = !g.steamAppid && !hasPc
        ? 'Geen Steam (console-only)'
        : !g.steamAppid && hasPc
        ? 'Steam appid niet gevonden'
        : 'Steam data incompleet';
      console.log(`   • ${g.name} (${g.platforms.join('/')})`);
      console.log(`     Mist: ${g.missing.join(', ')} — ${reden}`);
    });
  }
}

if (noPage.length > 0) {
  console.log(`\n🚫 Geen detail-pagina in KV (${noPage.length}):`);
  noPage.forEach(g => console.log(`   • ${g.name} — /game/${g.slug}`));
}

console.log('\n───────────────────────────────────────────────────────');
console.log(`  Samenvatting:`);
console.log(`  Totaal:    ${rows.length} games`);
console.log(`  Volledig:  ${rows.length - problems.length - noPage.length} games`);
console.log(`  Gefixed:   ${fixed.length} games (automatisch)`);
console.log(`  Onvolledig:${problems.length} games (handmatig nodig of console-only)`);
console.log(`  Geen KV:   ${noPage.length} games`);
if (DRY_RUN) console.log(`\n  ⚠️  DRY RUN — geen wijzigingen opgeslagen`);
console.log('───────────────────────────────────────────────────────\n');
