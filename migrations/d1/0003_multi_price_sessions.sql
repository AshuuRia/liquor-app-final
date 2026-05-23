-- Add session_name column to support multiple named price compare sessions
ALTER TABLE price_compare_sessions ADD COLUMN session_name TEXT NOT NULL DEFAULT 'Auto-save';
