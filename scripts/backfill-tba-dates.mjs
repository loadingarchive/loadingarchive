/**
 * Eenmalige opschoning (2026-09-01): alle actieve TBA-games met Steam-appid
 * in één keer langs Steam halen en dag-precieze releasedatums invullen in D1.
 * De nachtelijke crons doen daarna de rest: maand-/TBA-KV's worden uit D1
 * herbouwd en pre-venster-datums ruimt de purge definitief op.
 *
 * Structureel wordt dit door reconcileTbaDates (tba-reconcile.js) in de
 * maintenance-cron bijgehouden (30/dag-rotatie); dit script is alleen de
 * inhaalslag voor de bestaande achterstand.
 *
 *   node scripts/backfill-tba-dates.mjs           # dry-run (alleen tonen)
 *   node scripts/backfill-tba-dates.mjs --apply   # D1 echt bijwerken
 */
import { execSync } from 'node:child_process';
import { parseFullSteamDate } from '../worker/src/pipeline/tba-reconcile.js';

const APPLY = process.argv.includes('--apply');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// LET OP: --command, niet --file — --file retourneert alleen een samenvatting,
// geen result-rijen. SQL moet daarom op één regel en zonder dubbele quotes
// (de hele string gaat in "" door de Windows-shell).
function d1(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  if (flat.includes('"')) throw new Error('SQL mag geen dubbele quotes bevatten');
  const out = execSync(
    `npx wrangler d1 execute loadingarchive_games --remote --json --command="${flat}"`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const m = out.trim().match(/\[[\s\S]*\]$/);
  if (!m) throw new Error(`Geen JSON in wrangler-output: ${out.slice(0, 200)}`);
  return JSON.parse(m[0])[0];
}

const { results: rows } = d1(`
  SELECT slug, name, steam_appid,
         json_extract(raw_json,'$.manual.date')      AS m_date,
         json_extract(raw_json,'$.manual.protected') AS m_prot
  FROM games
  WHERE status='active' AND release_date IS NULL AND steam_appid IS NOT NULL
  ORDER BY slug`);

console.log(`${rows.length} TBA-games met appid; Steam checken (~${Math.round(rows.length * 1.3 / 60)} min)…`);

const updates = [];
let vague = 0, skipped = 0, failed = 0;

for (const g of rows) {
  if (g.m_date || g.m_prot) { skipped++; continue; }
  try {
    const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${g.steam_appid}&cc=us&l=en&filters=release_date`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const rd = j?.[g.steam_appid]?.data?.release_date;
    const iso = rd ? parseFullSteamDate(rd.date) : null;
    if (iso) {
      updates.push({ slug: g.slug, name: g.name, iso, released: rd.coming_soon === false });
      console.log(`  ${g.name} → ${iso}${rd.coming_soon === false ? ' (al uitgebracht)' : ''}`);
    } else {
      vague++;
    }
  } catch {
    failed++;
    console.log(`  ${g.name}: Steam-fetch mislukt (blijft TBA, cron probeert later)`);
  }
  await sleep(1300);
}

console.log(`\n${updates.length} datum(s) gevonden, ${vague} terecht TBA, ${skipped} manual overgeslagen, ${failed} fetch-fouten`);

if (!updates.length) process.exit(0);
if (!APPLY) { console.log('\nDry-run — draai met --apply om D1 bij te werken.'); process.exit(0); }

const now = new Date().toISOString();
// Slugs zijn kebab-case (assignSlugs), maar quote defensief.
const q = s => `'${String(s).replace(/'/g, "''")}'`;
for (let i = 0; i < updates.length; i += 20) {
  const batch = updates.slice(i, i + 20);
  const sql = batch.map(u =>
    `UPDATE games SET release_date=${q(u.iso)}, raw_json=json_set(raw_json,'$.date',${q(u.iso)}), last_updated=${q(now)}, tba_checked_at=${q(now)} WHERE slug=${q(u.slug)};`
  ).join(' ');
  d1(sql);
  console.log(`D1: ${Math.min(i + 20, updates.length)}/${updates.length} bijgewerkt`);
}
console.log('Klaar — de nachtcrons herbouwen de KV\'s en purgen pre-venster-datums.');
