-- 0001_init.sql : Avermontis database (Cloudflare D1 / SQLite)
-- Applied automatically by _worker.js on first request (tracked in schema_migrations).
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('customer','admin')),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','shipped','delivered','cancelled')),
  payment TEXT NOT NULL DEFAULT 'cod',
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  shipping INTEGER NOT NULL CHECK (shipping >= 0),
  total INTEGER NOT NULL CHECK (total = subtotal + shipping),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pincode TEXT NOT NULL,
  notes TEXT,
  ip TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_user_created ON orders (user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  size TEXT,
  unit_price INTEGER NOT NULL CHECK (unit_price > 0),
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 10),
  line_total INTEGER NOT NULL CHECK (line_total = unit_price * qty)
);
CREATE INDEX IF NOT EXISTS order_items_order ON order_items (order_id);
CREATE TABLE IF NOT EXISTS login_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('customer','admin')),
  event TEXT NOT NULL CHECK (event IN ('signup','login','admin_setup','admin_login')),
  success INTEGER NOT NULL CHECK (success IN (0,1)),
  reason TEXT,
  ip TEXT,
  user_agent TEXT,
  device TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_history_created ON login_history (created_at DESC);
CREATE INDEX IF NOT EXISTS login_history_user_created ON login_history (user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, datetime('now'));
