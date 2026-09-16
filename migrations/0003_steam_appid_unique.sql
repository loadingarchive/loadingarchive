-- Voorkomt duplicate actieve rijen voor dezelfde Steam-game aan de
-- schrijfkant, i.p.v. alleen achteraf opruimen via de dagelijkse
-- dedupeActiveGames-cron. Partial index (alleen 'active' + niet-NULL) zodat
-- 'hidden' rijen uit de dedup-geschiedenis (die bewust hetzelfde appid
-- behouden) de index niet blokkeren.
--
-- SQLite valideert bestaande rijen bij het aanmaken van een UNIQUE INDEX —
-- als er op het moment van migreren al actieve duplicaten bestaan (precies
-- wat dedupeActiveGames normaal opruimt, maar die cron kan achterlopen)
-- faalt de CREATE UNIQUE INDEX hieronder. Ruim daarom eerst eventuele
-- bestaande duplicaten op (hou de rij met het hoogste rowid = meest recent
-- geschreven aan, verberg de rest) zodat deze migratie idempotent en veilig
-- herhaalbaar is, ook tegen een verse/lokale D1-kopie met oude testdata.
-- Was al zonder problemen toegepast op productie (geen duplicaten aanwezig
-- op migratiemoment) — deze stap is een vangnet voor andere omgevingen.
UPDATE games SET status = 'hidden'
WHERE status = 'active' AND steam_appid IS NOT NULL AND rowid NOT IN (
  SELECT MAX(rowid) FROM games
  WHERE status = 'active' AND steam_appid IS NOT NULL
  GROUP BY steam_appid
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_games_active_steam_appid
  ON games(steam_appid)
  WHERE status = 'active' AND steam_appid IS NOT NULL;
