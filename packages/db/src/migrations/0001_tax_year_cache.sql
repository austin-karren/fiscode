CREATE TABLE IF NOT EXISTS tax_year_cache (
  year INTEGER PRIMARY KEY,
  json TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (current_timestamp),
  etag TEXT
);
