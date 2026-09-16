-- Voorkomt duplicate actieve rijen voor dezelfde Steam-game aan de
-- schrijfkant, i.p.v. alleen achteraf opruimen via de dagelijkse
-- dedupeActiveGames-cron. Partial index (alleen 'active' + niet-NULL) zodat
-- 'hidden' rijen uit de dedup-geschiedenis (die bewust hetzelfde appid
-- behouden) de index niet blokkeren.
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_active_steam_appid
  ON games(steam_appid)
  WHERE status = 'active' AND steam_appid IS NOT NULL;
