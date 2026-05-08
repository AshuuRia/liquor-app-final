-- Add user_id to sessions (nullable for backward compatibility)
ALTER TABLE sessions ADD COLUMN user_id TEXT;

-- Add user_id to custom_name_mappings
ALTER TABLE custom_name_mappings ADD COLUMN user_id TEXT;

-- Price compare sessions table (one saved session per user)
CREATE TABLE IF NOT EXISTS price_compare_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  rows_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_name_mappings_user_id ON custom_name_mappings(user_id);
CREATE INDEX IF NOT EXISTS idx_price_compare_sessions_user_id ON price_compare_sessions(user_id);
