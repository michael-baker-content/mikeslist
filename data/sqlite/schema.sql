PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_imports (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_url TEXT,
  source_event_id TEXT,
  event_date TEXT,
  venue_name TEXT,
  title TEXT,
  details TEXT,
  content_fingerprint TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_imports_date_source
  ON raw_imports (event_date, source_name);

CREATE TABLE IF NOT EXISTS shows (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'scheduled',
  show_type TEXT NOT NULL DEFAULT 'artist',
  event_date TEXT NOT NULL,
  venue_id TEXT,
  venue_name_snapshot TEXT,
  title TEXT,
  display_name TEXT,
  details TEXT,
  event_description TEXT,
  info_url TEXT,
  image_url TEXT,
  image_source TEXT,
  mikes_pick INTEGER NOT NULL DEFAULT 0,
  manually_reviewed INTEGER NOT NULL DEFAULT 0,
  manually_reviewed_at TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shows_date_venue
  ON shows (event_date, venue_id);

CREATE INDEX IF NOT EXISTS idx_shows_mikes_pick
  ON shows (mikes_pick, event_date);

CREATE TABLE IF NOT EXISTS show_sources (
  show_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  raw_import_id TEXT,
  PRIMARY KEY (show_id, source_name, source_url),
  FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE,
  FOREIGN KEY (raw_import_id) REFERENCES raw_imports(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT,
  confidence TEXT,
  locality TEXT,
  image_url TEXT,
  image_source TEXT,
  spotify_image_url TEXT,
  summary TEXT,
  disambiguation TEXT,
  review_notes TEXT,
  manually_reviewed INTEGER NOT NULL DEFAULT 0,
  manually_reviewed_at TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artists_name
  ON artists (name);

CREATE TABLE IF NOT EXISTS artist_aliases (
  artist_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  source TEXT,
  PRIMARY KEY (artist_id, alias),
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS artist_links (
  artist_id TEXT NOT NULL,
  type TEXT,
  label TEXT,
  url TEXT NOT NULL,
  confidence TEXT,
  source TEXT,
  display_priority TEXT,
  PRIMARY KEY (artist_id, url),
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS artist_genres (
  artist_id TEXT NOT NULL,
  genre TEXT NOT NULL,
  PRIMARY KEY (artist_id, genre),
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT,
  merged_into TEXT,
  confidence TEXT,
  status TEXT,
  venue_type TEXT,
  city TEXT,
  region TEXT,
  address TEXT,
  image_url TEXT,
  image_source TEXT,
  latitude REAL,
  longitude REAL,
  age_policy TEXT,
  capacity INTEGER,
  review_notes TEXT,
  manually_reviewed INTEGER NOT NULL DEFAULT 0,
  manually_reviewed_at TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_venues_name
  ON venues (name);

CREATE TABLE IF NOT EXISTS venue_aliases (
  venue_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  source TEXT,
  PRIMARY KEY (venue_id, alias),
  FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS venue_links (
  venue_id TEXT NOT NULL,
  type TEXT,
  label TEXT,
  url TEXT NOT NULL,
  confidence TEXT,
  source TEXT,
  PRIMARY KEY (venue_id, url),
  FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS show_artist_slots (
  show_id TEXT NOT NULL,
  artist_id TEXT,
  billing_order INTEGER NOT NULL,
  name_snapshot TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'scheduled',
  raw_json TEXT NOT NULL,
  PRIMARY KEY (show_id, billing_order, name_snapshot),
  FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_entity_id TEXT,
  note TEXT,
  data_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decisions_entity
  ON decisions (entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS suppressed_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  source_name TEXT,
  source_url TEXT,
  source_event_id TEXT,
  event_date TEXT,
  venue_key TEXT,
  artist_key TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suppressed_imports_match
  ON suppressed_imports (entity_type, event_date, venue_key, artist_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppressed_imports_source_decision
  ON suppressed_imports (entity_type, source_event_id, reason);

CREATE TABLE IF NOT EXISTS show_overrides (
  show_id TEXT PRIMARY KEY,
  event_date TEXT,
  venue_key TEXT,
  artist_key TEXT,
  mikes_pick INTEGER,
  data_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_show_overrides_match
  ON show_overrides (event_date, venue_key, artist_key);
