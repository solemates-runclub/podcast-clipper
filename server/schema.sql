CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  youtube_url TEXT NOT NULL,
  youtube_id TEXT,
  title TEXT,
  duration REAL,
  width INTEGER,
  height INTEGER,
  fps REAL,
  file_path TEXT,
  whisper_model TEXT,
  language TEXT DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'pending',
  transcript_json_path TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  transcribed_at TEXT
);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  start_sec REAL NOT NULL,
  end_sec REAL NOT NULL,
  score REAL,
  transcript_snippet TEXT,
  topic_text TEXT,
  hook_text TEXT,
  hook_options TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_clips_source ON clips(source_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, type);
CREATE INDEX IF NOT EXISTS idx_jobs_target ON jobs(target_id);
