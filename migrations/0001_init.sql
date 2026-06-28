-- Loading Archive — D1 schema
-- Duurzame bron van waarheid voor alle game-records.
-- KV blijft de publieke leescache; nooit directe D1-reads door sitebezoekers.

CREATE TABLE IF NOT EXISTS games (
  slug              TEXT PRIMARY KEY,
  rawg_id           TEXT,
  name              TEXT NOT NULL,
  release_date      TEXT,                     -- ISO-8601 (YYYY-MM-DD) of NULL voor TBA
  platforms         TEXT NOT NULL DEFAULT '[]',  -- JSON array: ["PC","PS5",...]
  cover_image       TEXT,
  steam_appid       TEXT,
  short_description TEXT,
  price             TEXT,
  metacritic        TEXT,                     -- JSON: {score, url} of NULL
  screenshots       TEXT NOT NULL DEFAULT '[]',  -- JSON array van URL-strings
  requirements      TEXT,                     -- JSON: {minimum, recommended} of NULL
  age_rating        TEXT,
  status            TEXT NOT NULL DEFAULT 'active', -- 'active' | 'hidden'
  first_seen        TEXT NOT NULL,            -- ISO-8601 timestamp
  last_seen         TEXT NOT NULL,            -- ISO-8601 timestamp (bijgewerkt elke cron-run)
  last_updated      TEXT NOT NULL,            -- ISO-8601 timestamp (bijgewerkt bij datawijziging)
  raw_json          TEXT                      -- volledige pipeline-output als JSON-blob
);

-- Queries lopen altijd op één kolom of de composiet; geen full-table-scans.
CREATE INDEX IF NOT EXISTS idx_games_release_date ON games(release_date);
CREATE INDEX IF NOT EXISTS idx_games_status       ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_status_date  ON games(status, release_date);
CREATE INDEX IF NOT EXISTS idx_games_rawg_id      ON games(rawg_id);
