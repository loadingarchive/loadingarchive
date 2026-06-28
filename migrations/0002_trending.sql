CREATE TABLE IF NOT EXISTS trending_history (
  appid       TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  ccu         INTEGER NOT NULL DEFAULT 0,
  avg_2weeks  INTEGER NOT NULL DEFAULT 0,
  name        TEXT,
  PRIMARY KEY (appid, recorded_at)
);
CREATE INDEX IF NOT EXISTS idx_th_appid ON trending_history(appid, recorded_at);
