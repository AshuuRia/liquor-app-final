-- Cloudflare D1 (SQLite) schema for Liquor Inventory System
-- Apply with: npx wrangler d1 execute liquor-inventory-db --file=migrations/d1/0001_init.sql

CREATE TABLE IF NOT EXISTS liquor_records (
  id TEXT PRIMARY KEY,
  liquor_code TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  ada_number TEXT,
  ada_name TEXT,
  vendor_name TEXT,
  proof TEXT,
  bottle_size TEXT,
  pack_size TEXT,
  on_premise_price REAL,
  off_premise_price REAL,
  shelf_price REAL,
  upc_code_1 TEXT,
  upc_code_2 TEXT,
  effective_date TEXT
);

CREATE TABLE IF NOT EXISTS scanned_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  liquor_record_id TEXT,
  scanned_barcode TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  override_price REAL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  item_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS custom_name_mappings (
  id TEXT PRIMARY KEY,
  upc_code TEXT NOT NULL,
  custom_name TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

-- Indexes for the most common lookups
CREATE INDEX IF NOT EXISTS idx_scanned_items_session ON scanned_items(session_id);
CREATE INDEX IF NOT EXISTS idx_liquor_upc1 ON liquor_records(upc_code_1);
CREATE INDEX IF NOT EXISTS idx_liquor_upc2 ON liquor_records(upc_code_2);
CREATE INDEX IF NOT EXISTS idx_liquor_brand ON liquor_records(brand_name);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active, updated_at);
