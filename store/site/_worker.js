// Avermontis server (Cloudflare Worker + D1 database). Runs next to the static pages.
// Every rule that touches money, access or data lives HERE, never in the browser:
//  - prices/totals re-computed from products.js (browser sends only product id + qty)
//  - passwords hashed (PBKDF2-SHA256, random salt), sessions in HttpOnly cookies
//  - customers can read only their own orders + login history; admin APIs need an admin session
//  - all POST/PATCH/DELETE need JSON + same-origin Origin header (CSRF), rate limits in the DB
// No secret keys live in this file. The admin password is created once at /admin/setup and stored hashed.

// ---- limits (change here) ----
const AUTH_LIMIT = 10, AUTH_WINDOW_S = 120;        // login + signup: 10 tries per 2 min per IP
const ADMIN_LIMIT = 10, ADMIN_WINDOW_S = 120;      // admin login/setup: 10 tries per 2 min per IP
const ORDER_LIMIT = 5, ORDER_WINDOW_S = 600;       // orders: 5 per 10 min per IP
const API_LIMIT = 120, API_WINDOW_S = 60;          // any other write: 120 per min per IP
const CUSTOMER_SESSION_DAYS = 30, ADMIN_SESSION_HOURS = 12;
const PBKDF2_ITER = 100000;                        // max allowed by the Workers runtime
const MAX_BODY_BYTES = 8000;
const ORDER_STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const STATES = ['Andaman and Nicobar Islands','Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jammu and Kashmir','Jharkhand','Karnataka','Kerala','Ladakh','Lakshadweep','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal'];

export const MIGRATION_SQL = `-- 0001_init.sql : Avermontis database (Cloudflare D1 / SQLite)
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
`;

export const MIGRATION_2_SQL = `-- 0002_store.sql : products, stock, coupons, reviews, wishlist, newsletter, messages, invoices, tracking, password reset
-- Additive only: new tables + new columns. Nothing is dropped or rewritten. Applied automatically by _worker.js.
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 2 AND 60),
  name TEXT NOT NULL,
  size TEXT,
  category TEXT NOT NULL DEFAULT 'Skincare',
  price INTEGER NOT NULL CHECK (price > 0),
  mrp INTEGER CHECK (mrp IS NULL OR mrp >= 0),
  stock INTEGER NOT NULL DEFAULT 100 CHECK (stock >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  images TEXT NOT NULL DEFAULT '[]',
  short TEXT,
  description TEXT,
  ingredients TEXT NOT NULL DEFAULT '[]',
  how_to_use TEXT,
  faqs TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_active_cat_price ON products (active, category, price);
CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('percent','flat')),
  value INTEGER NOT NULL CHECK (value > 0),
  min_order INTEGER NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  max_discount INTEGER CHECK (max_discount IS NULL OR max_discount > 0),
  expires_at TEXT,
  usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  note TEXT,
  created_at TEXT NOT NULL,
  CHECK (kind != 'percent' OR value <= 90),
  CHECK (usage_limit IS NULL OR used_count <= usage_limit)
);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_events_order ON order_events (order_id, id);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (product_id, user_id)
);
CREATE INDEX IF NOT EXISTS reviews_product_status ON reviews (product_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS wishlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  source TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','archived')),
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_created ON messages (created_at DESC);
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  ip TEXT,
  emailed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT,
  to_email TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
`;

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(self), xr-spatial-tracking=(self), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin'
};
const ASSET_LINKS = '[{"relation": ["delegate_permission/common.handle_all_urls"], "target": {"namespace": "android_app", "package_name": "bot.tab.sites.avermontis.twa", "sha256_cert_fingerprints": ["BD:E6:E4:EE:37:40:CF:0E:62:C6:1A:30:C6:8E:31:B7:B6:CC:E4:BE:3D:D4:61:0B:EF:3D:63:C3:39:C4:F7:D3"]}}]';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; manifest-src 'self'; worker-src 'self'";
// the AR page runs the 3D viewer and on-device camera tracking (WebAssembly + workers), all served from this site
const CSP_AR = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: data:; media-src 'self' blob: mediastream:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; manifest-src 'self'";

// ---------- responses (one error format everywhere: {ok:false, error:{code, message, fields?}}) ----------
function json(status, body, extra) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...(extra || {}) } });
}
function fail(status, code, message, extra, fields) {
  const error = { code, message }; if (fields) error.fields = fields;
  return json(status, { ok: false, error }, extra);
}
class HttpError extends Error { constructor(status, code, message, extra, fields) { super(message); this.status = status; this.code = code; this.extra = extra; this.fields = fields; } }

// ---------- database bootstrap (runs the migration once per database) ----------
let schemaReady = null;
export function splitSql(sql) {
  return sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
}
async function ensureSchema(env) {
  if (!env.DB) throw new HttpError(503, 'db_unavailable', 'The store database is not connected.');
  if (!schemaReady) {
    schemaReady = (async () => {
      let v1 = null;
      try { v1 = await env.DB.prepare("SELECT version FROM schema_migrations WHERE version = 1").first(); } catch (e) { /* table missing -> run migration */ }
      if (!v1) await env.DB.batch(splitSql(MIGRATION_SQL).map((s) => env.DB.prepare(s)));
      await migrateV2(env);       // additive: new tables + columns only
      await migrateV3(env);       // v4: chat, notifications, bargaining (additive)
      await migrateV5(env);       // v5: design versions, audit log, admin tokens, session last_seen (additive)
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

// ---------- small helpers ----------
const nowIso = () => new Date().toISOString();
const enc = new TextEncoder();
function b64u(bytes) { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromB64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function sha256hex(str) { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str))); return [...d].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function safeEqual(a, b) { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i]; return x === 0; }

export async function hashPassword(password, iterations = PBKDF2_ITER) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
  return `pbkdf2_sha256$${iterations}$${b64u(salt)}$${b64u(bits)}`;
}
export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = parseInt(parts[1], 10); if (!(iterations > 0 && iterations <= PBKDF2_ITER)) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64u(parts[2]), iterations }, key, 256));
  return safeEqual(bits, fromB64u(parts[3]));
}
// a fixed dummy hash so a login for an unknown email costs the same time as a real one
let DUMMY_HASH = null;
async function dummyVerify(pw) { if (!DUMMY_HASH) DUMMY_HASH = await hashPassword('dummy-password-for-timing'); await verifyPassword(pw, DUMMY_HASH); }

export function deviceFromUA(ua) {
  ua = String(ua || '');
  if (!ua) return 'Unknown device';
  let os = 'Other';
  if (/iPhone/.test(ua)) os = 'iPhone'; else if (/iPad/.test(ua)) os = 'iPad'; else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows'; else if (/Mac OS X|Macintosh/.test(ua)) os = 'Mac'; else if (/Linux/.test(ua)) os = 'Linux';
  let br = 'Browser';
  if (/Edg\//.test(ua)) br = 'Edge'; else if (/OPR\/|Opera/.test(ua)) br = 'Opera'; else if (/SamsungBrowser/.test(ua)) br = 'Samsung Internet';
  else if (/CriOS|Chrome\//.test(ua)) br = 'Chrome'; else if (/FxiOS|Firefox\//.test(ua)) br = 'Firefox'; else if (/Safari\//.test(ua)) br = 'Safari';
  else if (/curl|python|node|axios|wget/i.test(ua)) br = 'Script';
  return os + ' · ' + br;
}
const clientIp = (req) => req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown';
const clientUA = (req) => String(req.headers.get('user-agent') || '').slice(0, 300);

export function istString(iso) {
  const d = new Date(new Date(iso).getTime() + 330 * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} IST`;
}
export function istMidnightUtcIso(now = Date.now()) {
  const ist = new Date(now + 330 * 60000);
  const midIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(midIst - 330 * 60000).toISOString();
}

// ---------- rate limit (stored in the database, fixed window) ----------
async function rateLimit(env, bucket, ip, limit, windowS) {
  const now = Math.floor(Date.now() / 1000);
  const key = bucket + ':' + ip;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET count = CASE WHEN rate_limits.reset_at <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
                                    reset_at = CASE WHEN rate_limits.reset_at <= ?3 THEN ?2 ELSE rate_limits.reset_at END
     RETURNING count, reset_at`).bind(key, now + windowS, now).first();
  if (row && row.count > limit) {
    const wait = Math.max(1, row.reset_at - now);
    throw new HttpError(429, 'rate_limited', `Too many attempts. Please try again in ${wait} seconds.`, { 'Retry-After': String(wait) });
  }
}

// ---------- request parsing + CSRF ----------
// The native Android app (Capacitor) serves its own bundled screens from https://localhost and calls this API
// cross-origin with a bearer token (never cookies), so these origins are allowed in addition to the site itself.
const APP_ORIGINS = ['https://localhost', 'capacitor://localhost'];
function isAppRequest(request) { return APP_ORIGINS.includes(request.headers.get('origin') || ''); }
function corsHeaders(request) {
  return { 'Access-Control-Allow-Origin': request.headers.get('origin'), 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };
}
function checkOrigin(request) {
  const origin = request.headers.get('origin');
  const self = new URL(request.url).origin;
  if (isAppRequest(request)) return;
  if (!origin || origin !== self) throw new HttpError(403, 'bad_origin', 'This action can only be done from the Avermontis website.');
}
async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  checkOrigin(request);
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'bad_content_type', 'Send JSON.');
  const raw = await request.text();
  if (raw.length > maxBytes) throw new HttpError(413, 'too_large', 'Request too large.');
  let body; try { body = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'bad_json', 'Invalid request.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad_json', 'Invalid request.');
  return body;
}

// ---------- validation ----------
const str = (v) => (typeof v === 'string' ? v.trim() : '');
export function validateSignup(b) {
  const out = { name: str(b.name).replace(/\s+/g, ' '), email: str(b.email).toLowerCase(), password: typeof b.password === 'string' ? b.password : '' };
  const f = {};
  if (out.name.length < 2 || out.name.length > 60) f.name = 'Name must be 2–60 characters.';
  else if (/[<>{}\\]/.test(out.name)) f.name = 'Name has characters that are not allowed.';
  else if (isReservedName(out.name) || isReservedName(out.name.replace(/\s+/g, ''))) f.name = 'This name is reserved. Please use your own name.';
  if (isReservedName(out.email.split('@')[0]) && /^(admin|administrator|owner|root)$/i.test(out.email.split('@')[0])) f.email = f.email || 'Please use your personal email address.';
  if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(out.email) || out.email.length > 254) f.email = 'Enter a valid email address.';
  if (out.password.length < 8) f.password = 'Password must be at least 8 characters.';
  else if (out.password.length > 128) f.password = 'Password must be at most 128 characters.';
  else if (!/[A-Za-z]/.test(out.password) || !/[0-9]/.test(out.password)) f.password = 'Use at least one letter and one number.';
  return { value: out, fields: f };
}
export function validateLogin(b) {
  const out = { email: str(b.email).toLowerCase(), password: typeof b.password === 'string' ? b.password : '' };
  const f = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email) || out.email.length > 254) f.email = 'Enter a valid email address.';
  if (!out.password) f.password = 'Enter your password.'; else if (out.password.length > 128) f.password = 'Password is too long.';
  return { value: out, fields: f };
}
function assertValid(fields) {
  const k = Object.keys(fields);
  if (k.length) throw new HttpError(400, 'invalid_input', fields[k[0]], null, fields);
}

// ---------- catalog + order pricing (prices come only from products.js) ----------
async function loadCatalog(env, url) {
  const r = await env.ASSETS.fetch(new Request(new URL('/products.js', url)));
  const txt = await r.text();
  const settingsMatch = txt.match(/AVERMONTIS_SETTINGS\s*=\s*(\{[^;]*\})\s*;/);
  const settings = settingsMatch ? JSON.parse(settingsMatch[1]) : { free_shipping_from: 499, shipping_fee: 49, max_qty_per_item: 10 };
  const start = txt.indexOf('[', txt.indexOf('AVERMONTIS_PRODUCTS'));
  const end = txt.lastIndexOf(']');
  const products = JSON.parse(txt.slice(start, end + 1));
  return { products, settings };
}


export function validateCustomer(c) {
  const errs = {};
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const out = { name: s(c && c.name), phone: s(c && c.phone).replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''), email: s(c && c.email),
    address: s(c && c.address), pincode: s(c && c.pincode), city: s(c && c.city), state: s(c && c.state), notes: s(c && c.notes).slice(0, 300) };
  if (out.name.length < 2 || out.name.length > 80) errs.name = 'Name must be 2-80 characters.';
  if (!/^[6-9]\d{9}$/.test(out.phone)) errs.phone = 'Enter a valid 10-digit Indian mobile number.';
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email)) errs.email = 'Invalid email.';
  if (out.address.length < 10 || out.address.length > 300) errs.address = 'Address must be 10-300 characters.';
  if (!/^[1-9]\d{5}$/.test(out.pincode)) errs.pincode = 'Pincode must be 6 digits.';
  if (out.city.length < 2 || out.city.length > 60) errs.city = 'Enter a city.';
  if (!STATES.includes(out.state)) errs.state = 'Choose a valid state.';
  return { customer: out, errors: errs };
}


export function priceOrder(items, products, settings) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) return { error: 'Cart is empty or too large.' };
  const max = settings.max_qty_per_item || 10;
  const merged = new Map();
  for (const it of items) {
    if (!it || typeof it.id !== 'string') return { error: 'Invalid item.' };
    const q = Number(it.qty);
    if (!Number.isInteger(q) || q < 1 || q > max) return { error: `Quantity must be a whole number from 1 to ${max}.` };
    merged.set(it.id, (merged.get(it.id) || 0) + q);
  }
  const lines = [];
  for (const [id, qty] of merged) {
    const p = products.find((x) => x.id === id && x.active !== false);
    if (!p) return { error: 'A product in your cart is no longer available. Please refresh your cart.' };
    if (qty > max) return { error: `Max ${max} per product.` };
    if (p.stock != null && qty > p.stock) return { error: p.stock <= 0 ? `Sorry, ${p.name} is out of stock.` : `Only ${p.stock} left of ${p.name}. Please lower the quantity.` };
    lines.push({ id: p.id, name: p.name, size: p.size, price: p.price, qty, total: p.price * qty });
  }
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const shipping = subtotal >= settings.free_shipping_from ? 0 : settings.shipping_fee;
  return { lines, subtotal, shipping, total: subtotal + shipping };
}


// ---------- sessions ----------
function cookieName(kind) { return kind === 'admin' ? 'av_admin' : 'av_sess'; }
function readCookie(request, name) {
  const c = request.headers.get('cookie') || '';
  for (const part of c.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return null;
}
function setCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
const ISSUED_TOKENS = new WeakMap();   // request -> session token, handed to the native app in the JSON body
function withAppToken(request, body) {
  const t = ISSUED_TOKENS.get(request);
  if (t && isAppRequest(request)) body.token = t;
  return body;
}
function bearerToken(request) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer ([A-Za-z0-9_-]{20,100})$/);
  return m ? m[1] : null;
}
async function createSession(env, request, kind, userId) {
  const token = b64u(crypto.getRandomValues(new Uint8Array(32)));
  if (kind === 'customer') ISSUED_TOKENS.set(request, token);
  const id = await sha256hex(token);       // only the hash is stored; a database leak does not leak sessions
  const maxAge = kind === 'admin' ? ADMIN_SESSION_HOURS * 3600 : CUSTOMER_SESSION_DAYS * 86400;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date(now).toISOString()),
    env.DB.prepare('INSERT INTO sessions (id, kind, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?)')
      .bind(id, kind, userId, new Date(now).toISOString(), new Date(now + maxAge * 1000).toISOString(), clientIp(request), clientUA(request))
  ]);
  return setCookie(cookieName(kind), token, maxAge);
}
async function getSession(env, request, kind, opts) {
  // customer sessions: the app sends its token as a bearer header; the website uses the HttpOnly cookie
  const token = (kind === 'customer' && bearerToken(request)) || readCookie(request, cookieName(kind));
  if (!token || token.length > 100 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const id = await sha256hex(token);
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE id = ? AND kind = ?').bind(id, kind).first();
  if (!s || s.expires_at < nowIso()) return null;
  if (kind === 'admin') {   // v5: an owner session ends after the chosen idle time (30 min by default)
    const sec = await adminSecurity(env).catch(() => ({ idle_minutes: ADMIN_IDLE_DEFAULT_MIN }));
    const last = Date.parse(s.last_seen_at || s.created_at), now = Date.now();
    if (now - last > sec.idle_minutes * 60000) { await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(s.id).run(); return null; }
    if (!(opts && opts.noTouch) && now - last > 60000 && 'last_seen_at' in s) await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(new Date(now).toISOString(), s.id).run();
  }
  return { id: s.id, kind: s.kind, user_id: s.user_id, expires_at: s.expires_at };
}
async function currentUser(env, request) {
  const s = await getSession(env, request, 'customer');
  if (!s || !s.user_id) return null;
  return env.DB.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').bind(s.user_id).first();
}
async function requireUser(env, request) {
  const u = await currentUser(env, request);
  if (!u) throw new HttpError(401, 'not_signed_in', 'Please sign in first.');
  return u;
}
async function requireAdmin(env, request, opts) {
  const s = await getSession(env, request, 'admin', opts);
  if (!s) throw new HttpError(403, 'forbidden', 'Owner access only.');
  return s;
}
async function logAttempt(env, request, row) {
  const ua = clientUA(request);
  await env.DB.prepare('INSERT INTO login_history (user_id, email, kind, event, success, reason, ip, user_agent, device, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(row.user_id || null, String(row.email || '').slice(0, 254), row.kind, row.event, row.success ? 1 : 0, row.reason || null, clientIp(request), ua, deviceFromUA(ua), nowIso()).run();
}

// ---------- customer auth ----------
async function signup(request, env) {
  const body = await readJson(request);
  await rateLimit(env, 'auth', clientIp(request), AUTH_LIMIT, AUTH_WINDOW_S);
  const { value, fields } = validateSignup(body); assertValid(fields);
  const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(value.email).first();
  if (exists) {
    await logAttempt(env, request, { user_id: exists.id, email: value.email, kind: 'customer', event: 'signup', success: false, reason: 'email_taken' });
    throw new HttpError(409, 'email_taken', 'An account with this email already exists. Please sign in.', null, { email: 'An account with this email already exists.' });
  }
  const hash = await hashPassword(value.password);
  const t = nowIso();
  const r = await env.DB.prepare('INSERT INTO users (email, name, password_hash, created_at, last_login_at) VALUES (?,?,?,?,?) RETURNING id').bind(value.email, value.name, hash, t, t).first();
  await logAttempt(env, request, { user_id: r.id, email: value.email, kind: 'customer', event: 'signup', success: true });
  const cookie = await createSession(env, request, 'customer', r.id);
  return json(201, withAppToken(request, { ok: true, user: { id: r.id, email: value.email, name: value.name } }), { 'Set-Cookie': cookie });
}
async function login(request, env) {
  const body = await readJson(request);
  await rateLimit(env, 'auth', clientIp(request), AUTH_LIMIT, AUTH_WINDOW_S);
  const { value, fields } = validateLogin(body); assertValid(fields);
  const u = await env.DB.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').bind(value.email).first();
  let ok = false;
  if (u) ok = await verifyPassword(value.password, u.password_hash); else await dummyVerify(value.password);
  if (!ok) {
    await logAttempt(env, request, { user_id: u ? u.id : null, email: value.email, kind: 'customer', event: 'login', success: false, reason: u ? 'wrong_password' : 'no_account' });
    throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.');
  }
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowIso(), u.id).run();
  await logAttempt(env, request, { user_id: u.id, email: u.email, kind: 'customer', event: 'login', success: true });
  const cookie = await createSession(env, request, 'customer', u.id);
  return json(200, withAppToken(request, { ok: true, user: { id: u.id, email: u.email, name: u.name } }), { 'Set-Cookie': cookie });
}
async function logout(request, env, kind) {
  checkOrigin(request);
  const s = await getSession(env, request, kind);
  if (s) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(s.id).run();
  return json(200, { ok: true }, { 'Set-Cookie': setCookie(cookieName(kind), '', 0) });
}

// ---------- orders ----------
async function loadItems(env, ids) {
  const map = {};
  if (!ids.length) return map;
  const rows = await env.DB.prepare(`SELECT order_id, product_id, name, size, unit_price, qty, line_total FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).bind(...ids).all();
  for (const r of rows.results) (map[r.order_id] = map[r.order_id] || []).push(r);
  return map;
}
async function createOrder(request, env) {
  const body = await readJson(request);
  await rateLimit(env, 'order', clientIp(request), ORDER_LIMIT, ORDER_WINDOW_S);
  if (body.payment && body.payment !== 'cod') throw new HttpError(400, 'payment_unavailable', 'Only Cash on Delivery is available right now.');
  const { products, settings } = await loadCatalog(env, request.url);
  const priced = priceOrder(body.items, products, settings);
  if (priced.error) throw new HttpError(400, 'invalid_cart', priced.error);
  const { customer, errors } = validateCustomer(body.customer);
  if (Object.keys(errors).length) throw new HttpError(400, 'invalid_customer', Object.values(errors)[0], null, errors);
  const user = await currentUser(env, request);    // link to the account only from the session cookie, never from the body
  const d = new Date(); const t = d.toISOString();
  const id = 'AV-' + t.slice(2, 10).replace(/-/g, '') + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  const stmts = [env.DB.prepare('INSERT INTO orders (id, user_id, status, payment, subtotal, shipping, total, name, phone, email, address, city, state, pincode, notes, ip, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, user ? user.id : null, 'new', 'cod', priced.subtotal, priced.shipping, priced.total, customer.name, customer.phone, customer.email || (user ? user.email : null), customer.address, customer.city, customer.state, customer.pincode, customer.notes || null, clientIp(request), t, t)];
  for (const l of priced.lines) stmts.push(env.DB.prepare('INSERT INTO order_items (order_id, product_id, name, size, unit_price, qty, line_total) VALUES (?,?,?,?,?,?,?)').bind(id, l.id, l.name, l.size || null, l.price, l.qty, l.total));
  await env.DB.batch(stmts);
  const order = { id, created_at: t, items: priced.lines, subtotal: priced.subtotal, shipping: priced.shipping, total: priced.total, customer, payment: 'Cash on Delivery', status: 'new', saved: true, account: user ? user.email : null };
  return json(201, { ok: true, order });
}
function shapeOrder(o, items, admin) {
  const out = { id: o.id, status: o.status, created_at: o.created_at, subtotal: o.subtotal, shipping: o.shipping, total: o.total, payment: 'Cash on Delivery',
    items: (items || []).map((i) => ({ id: i.product_id, name: i.name, size: i.size, price: i.unit_price, qty: i.qty, total: i.line_total })),
    customer: { name: o.name, phone: o.phone, email: o.email, address: o.address, city: o.city, state: o.state, pincode: o.pincode, notes: o.notes } };
  if (admin) { out.user_id = o.user_id; out.account_email = o.account_email || null; out.updated_at = o.updated_at; }
  return out;
}
async function myOrders(request, env) {
  const u = await requireUser(env, request);
  const rows = (await env.DB.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(u.id).all()).results;
  const items = await loadItems(env, rows.map((r) => r.id));
  return json(200, { ok: true, orders: rows.map((r) => shapeOrder(r, items[r.id])) });
}
async function myOrder(request, env, id) {
  const u = await requireUser(env, request);
  if (!/^AV-[0-9A-Z-]{6,20}$/.test(id)) throw new HttpError(404, 'not_found', 'Order not found.');
  // the user_id condition is the ownership check: another customer's order is "not found"
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').bind(id, u.id).first();
  if (!o) throw new HttpError(404, 'not_found', 'Order not found.');
  const items = await loadItems(env, [o.id]);
  return json(200, { ok: true, order: shapeOrder(o, items[o.id]) });
}
async function myLogins(request, env) {
  const u = await requireUser(env, request);
  const rows = (await env.DB.prepare("SELECT event, success, ip, device, created_at FROM login_history WHERE user_id = ? AND kind = 'customer' ORDER BY id DESC LIMIT 50").bind(u.id).all()).results;
  return json(200, { ok: true, logins: rows.map((r) => ({ ...r, success: !!r.success, time_ist: istString(r.created_at) })) });
}

// ---------- admin ----------
async function adminSetupOpen(env) {
  const r = await env.DB.prepare("SELECT 1 AS x FROM settings WHERE key = 'admin_password_hash'").first();
  return !r;
}
async function adminSetup(request, env) {
  const body = await readJson(request);
  await rateLimit(env, 'admin', clientIp(request), ADMIN_LIMIT, ADMIN_WINDOW_S);
  if (!(await adminSetupOpen(env))) throw new HttpError(409, 'setup_closed', 'The owner password is already set. Setup is permanently closed.');
  const pw = typeof body.password === 'string' ? body.password : '';
  const f = {};
  if (pw.length < 10) f.password = 'Use at least 10 characters.'; else if (pw.length > 128) f.password = 'At most 128 characters.';
  else if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) f.password = 'Use at least one letter and one number.';
  if (!f.password && body.confirm !== pw) f.confirm = 'The two passwords do not match.';
  assertValid(f);
  const hash = await hashPassword(pw);
  // INSERT (not upsert): the primary key makes this succeed exactly once, even if two people race
  const r = await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('admin_password_hash', ?, ?)").bind(hash, nowIso()).run();
  if (!r.meta || r.meta.changes !== 1) throw new HttpError(409, 'setup_closed', 'The owner password is already set. Setup is permanently closed.');
  await logAttempt(env, request, { email: 'owner', kind: 'admin', event: 'admin_setup', success: true });
  const cookie = await createSession(env, request, 'admin', null);
  return json(201, { ok: true }, { 'Set-Cookie': cookie });
}
async function adminLogin(request, env) {
  const body = await readJson(request);
  await rateLimit(env, 'admin', clientIp(request), ADMIN_LIMIT, ADMIN_WINDOW_S);
  const pw = typeof body.password === 'string' ? body.password : '';
  if (!pw || pw.length > 128) throw new HttpError(400, 'invalid_input', 'Enter the owner password.', null, { password: 'Enter the owner password.' });
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").first();
  if (!row) throw new HttpError(409, 'setup_required', 'The owner password has not been created yet. Open /admin/setup first.');
  if (!(await verifyPassword(pw, row.value))) {
    await logAttempt(env, request, { email: 'owner', kind: 'admin', event: 'admin_login', success: false, reason: 'wrong_password' });
    throw new HttpError(401, 'invalid_credentials', 'Wrong owner password.');
  }
  await logAttempt(env, request, { email: 'owner', kind: 'admin', event: 'admin_login', success: true });
  const cookie = await createSession(env, request, 'admin', null);
  return json(200, { ok: true }, { 'Set-Cookie': cookie });
}
async function adminStats(request, env) {
  await requireAdmin(env, request);
  const today = istMidnightUtcIso();
  const since24 = new Date(Date.now() - 86400000).toISOString();
  const [a, b, c, d] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status != \'cancelled\' THEN total ELSE 0 END),0) AS s FROM orders WHERE created_at >= ?').bind(today),
    env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS s, SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS pending FROM orders WHERE status != 'cancelled'"),
    env.DB.prepare('SELECT COUNT(*) AS n FROM users'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM login_history WHERE success = 0 AND created_at >= ?').bind(since24)
  ]);
  return json(200, { ok: true, stats: { orders_today: a.results[0].n, sales_today: a.results[0].s, orders_total: b.results[0].n, total_sales: b.results[0].s, new_orders: b.results[0].pending || 0, users: c.results[0].n, failed_logins_24h: d.results[0].n } });
}
function pageArgs(url) {
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
  const offset = Math.min(Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0), 100000);
  return { limit, offset };
}
async function adminOrders(request, env, url) {
  await requireAdmin(env, request);
  const { limit, offset } = pageArgs(url);
  const status = url.searchParams.get('status') || '';
  if (status && !ORDER_STATUSES.includes(status)) throw new HttpError(400, 'invalid_input', 'Unknown status filter.');
  const where = status ? 'WHERE o.status = ?' : '';
  const q = env.DB.prepare(`SELECT o.*, u.email AS account_email FROM orders o LEFT JOIN users u ON u.id = o.user_id ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`);
  const rows = (await (status ? q.bind(status, limit, offset) : q.bind(limit, offset)).all()).results;
  const items = await loadItems(env, rows.map((r) => r.id));
  return json(200, { ok: true, orders: rows.map((r) => shapeOrder(r, items[r.id], true)), limit, offset });
}
async function adminSetStatus(request, env, id) {
  await requireAdmin(env, request);
  const body = await readJson(request);
  if (!ORDER_STATUSES.includes(body.status)) throw new HttpError(400, 'invalid_input', 'Status must be one of: ' + ORDER_STATUSES.join(', ') + '.', null, { status: 'Invalid status.' });
  const r = await env.DB.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').bind(body.status, nowIso(), id).run();
  if (!r.meta || r.meta.changes !== 1) throw new HttpError(404, 'not_found', 'Order not found.');
  return json(200, { ok: true, id, status: body.status });
}
async function adminDeleteOrder(request, env, id) {
  await requireAdmin(env, request);
  checkOrigin(request);
  const r = await env.DB.batch([env.DB.prepare('DELETE FROM order_items WHERE order_id = ?').bind(id), env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(id)]);
  if (!r[1].meta || r[1].meta.changes !== 1) throw new HttpError(404, 'not_found', 'Order not found.');
  return json(200, { ok: true, id, deleted: true });
}
async function adminCustomers(request, env, url) {
  await requireAdmin(env, request);
  const { limit, offset } = pageArgs(url);
  const rows = (await env.DB.prepare(`SELECT u.id, u.email, u.name, u.created_at, u.last_login_at,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders,
      (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.user_id = u.id AND o.status != 'cancelled') AS spent
    FROM users u ORDER BY u.created_at DESC LIMIT ? OFFSET ?`).bind(limit, offset).all()).results;
  return json(200, { ok: true, customers: rows, limit, offset });
}
async function adminLogins(request, env, url) {
  await requireAdmin(env, request);
  const { limit, offset } = pageArgs(url);
  const result = url.searchParams.get('result') || '';
  if (result && !['ok', 'fail'].includes(result)) throw new HttpError(400, 'invalid_input', 'result must be ok or fail.');
  const where = result ? `WHERE success = ${result === 'ok' ? 1 : 0}` : '';
  const rows = (await env.DB.prepare(`SELECT id, user_id, email, kind, event, success, reason, ip, device, user_agent, created_at FROM login_history ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(limit, offset).all()).results;
  return json(200, { ok: true, logins: rows.map((r) => ({ ...r, success: !!r.success, time_ist: istString(r.created_at) })), limit, offset });
}
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvResponse(name, header, rows) {
  const body = '\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', ...SEC_HEADERS } });
}
async function exportOrders(request, env) {
  await requireAdmin(env, request);
  const rows = (await env.DB.prepare('SELECT o.*, u.email AS account_email FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 10000').all()).results;
  const items = await loadItems(env, rows.map((r) => r.id).slice(0, 90));
  const allItems = rows.length > 90 ? await (async () => { const m = {}; for (let i = 90; i < rows.length; i += 90) Object.assign(m, await loadItems(env, rows.slice(i, i + 90).map((r) => r.id))); return m; })() : {};
  Object.assign(items, allItems);
  const out = rows.map((o) => [o.id, istString(o.created_at), o.status, (items[o.id] || []).map((i) => `${i.name} x${i.qty}`).join('; '), o.subtotal, o.shipping, o.total, 'COD', o.name, o.phone, o.email, o.address, o.city, o.state, o.pincode, o.notes, o.account_email || 'guest']);
  return csvResponse('avermontis-orders.csv', ['order_id', 'time_ist', 'status', 'items', 'subtotal_inr', 'shipping_inr', 'total_inr', 'payment', 'name', 'phone', 'email', 'address', 'city', 'state', 'pincode', 'notes', 'account'], out);
}
async function exportLogins(request, env) {
  await requireAdmin(env, request);
  const rows = (await env.DB.prepare('SELECT * FROM login_history ORDER BY id DESC LIMIT 20000').all()).results;
  const out = rows.map((r) => [istString(r.created_at), r.email, r.kind, r.event, r.success ? 'success' : 'failed', r.reason, r.ip, r.device, r.user_agent]);
  return csvResponse('avermontis-login-history.csv', ['time_ist', 'email', 'kind', 'event', 'result', 'reason', 'ip', 'device', 'user_agent'], out);
}


// =====================================================================================
// ---------- store upgrade (v2): products in the database, stock, coupons, invoices, tracking,
//            reviews, wishlist, newsletter, contact inbox, password reset, email, backup/restore ----------
// =====================================================================================
const ORDER_COLS_V2 = [['coupon_code', 'TEXT'], ['discount', 'INTEGER NOT NULL DEFAULT 0'], ['items_subtotal', 'INTEGER'], ['invoice_no', 'TEXT'], ['invoice_token', 'TEXT']];
async function migrateV2(env) {
  const have = await env.DB.prepare("SELECT version FROM schema_migrations WHERE version = 2").first();
  if (have) return;
  const cols = (await env.DB.prepare("PRAGMA table_info(orders)").all()).results.map((c) => c.name);
  const stmts = splitSql(MIGRATION_2_SQL).map((q) => env.DB.prepare(q));
  for (const [c, type] of ORDER_COLS_V2) if (!cols.includes(c)) stmts.push(env.DB.prepare(`ALTER TABLE orders ADD COLUMN ${c} ${type}`));
  stmts.push(env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS orders_invoice_no ON orders (invoice_no)'));
  stmts.push(env.DB.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, datetime('now'))"));
  await env.DB.batch(stmts);
  await backfillInvoices(env);
}
// every existing order gets an invoice number (in date order), a private invoice link token and a first timeline entry
async function backfillInvoices(env) {
  const rows = (await env.DB.prepare('SELECT id, created_at FROM orders WHERE invoice_no IS NULL OR invoice_token IS NULL ORDER BY created_at ASC LIMIT 500').all()).results;
  for (const o of rows) {
    const yr = istYear(o.created_at);
    await env.DB.batch([
      env.DB.prepare(SEQ_SQL).bind('invoice_seq:' + yr, nowIso()),
      env.DB.prepare(`UPDATE orders SET invoice_token = COALESCE(invoice_token, ?), invoice_no = COALESCE(invoice_no, (SELECT 'INV-' || ? || '-' || printf('%04d', CAST(value AS INTEGER)) FROM settings WHERE key = ?)) WHERE id = ?`)
        .bind(randToken(18), String(yr), 'invoice_seq:' + yr, o.id),
      env.DB.prepare("INSERT INTO order_events (order_id, status, note, created_at) SELECT ?, 'new', 'Order placed', ? WHERE NOT EXISTS (SELECT 1 FROM order_events WHERE order_id = ?)").bind(o.id, o.created_at, o.id)
    ]);
  }
}
const SEQ_SQL = "INSERT INTO settings (key, value, updated_at) VALUES (?1, '1', ?2) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(settings.value AS INTEGER) + 1 AS TEXT), updated_at = ?2";
function istYear(iso) { return new Date(new Date(iso).getTime() + 330 * 60000).getUTCFullYear(); }
function randToken(n) { return b64u(crypto.getRandomValues(new Uint8Array(n || 24))); }
function jparse(s, d) { try { const v = JSON.parse(s); return v == null ? d : v; } catch { return d; } }
const clamp = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const isEmail = (e) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const inr = (n) => '\u20B9' + Number(n || 0).toLocaleString('en-IN');

// ---------- store settings (owner-editable in /admin → Settings; the email key never leaves the server) ----------
const PUBLIC_SETTING_KEYS = ['gstin', 'seller_address', 'gst_rate', 'whatsapp_number', 'announcement', 'support_email', 'email_provider', 'email_from', 'email_from_name'];
const SETTING_DEFAULTS = { gstin: '', seller_address: 'India', gst_rate: '18', whatsapp_number: '', announcement: 'Free shipping above \u20B9499 \u00B7 Cash on Delivery available', support_email: 'avermontis@mail.tab.bot', email_provider: '', email_from: '', email_from_name: 'Avermontis' };
async function getSettings(env) {
  const rows = (await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'cfg:%'").all()).results;
  const out = { ...SETTING_DEFAULTS };
  for (const r of rows) out[r.key.slice(4)] = r.value;
  return out;
}
async function publicConfig(request, env) {
  const s = await getSettings(env);
  const { settings } = await loadCatalog(env, request.url);
  return json(200, { ok: true, config: { whatsapp_number: s.whatsapp_number || '', announcement: s.announcement || '', support_email: s.support_email, gstin: s.gstin || '', gst_rate: Number(s.gst_rate) || 18,
    free_shipping_from: settings.free_shipping_from, shipping_fee: settings.shipping_fee, max_qty_per_item: settings.max_qty_per_item || 10 } }, { 'Cache-Control': 'public, max-age=60' });
}

// ---------- products (the database is the source of truth; products.js seeds it the first time) ----------
function shapeProduct(r, admin) {
  const images = jparse(r.images, []);
  const p = { id: r.id, name: r.name, size: r.size, category: r.category, price: r.price, mrp: r.mrp, stock: r.stock, in_stock: r.stock > 0, active: !!r.active,
    images, image: images[0] || 'img/hero.webp', short: r.short, description: r.description, ingredients: jparse(r.ingredients, []), how_to_use: r.how_to_use, faqs: jparse(r.faqs, []), sort: r.sort };
  p.ar = arOf(r);
  const bg = jparse(r.bargain, {}) || {};
  p.bargain_on = bg.on !== false;
  if (admin) p.bargain = bg;          // the floor price is for the owner only
  if (!admin) { delete p.sort; if (p.stock > 10) p.stock = null; }   // shoppers see the exact count only when stock is low
  return p;
}
async function seedProducts(env, url) {
  const { products } = await loadCatalog(env, url);
  const t = nowIso();
  await env.DB.batch(products.map((p, i) => env.DB.prepare(`INSERT OR IGNORE INTO products (id, name, size, category, price, mrp, stock, active, images, short, description, ingredients, how_to_use, faqs, sort, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(p.id, p.name, p.size || null, p.category || 'Skincare', p.price, p.mrp || null, Number.isInteger(p.stock) ? p.stock : 100, p.active === false ? 0 : 1,
      JSON.stringify(p.images || (p.image ? [p.image] : [])), p.short || null, p.description || null, JSON.stringify(p.ingredients || []), p.how_to_use || null, JSON.stringify(p.faqs || []), i, t, t)));
}
async function dbProducts(env, url, includeHidden) {
  let rows = (await env.DB.prepare('SELECT * FROM products ORDER BY sort, name').all()).results;
  if (!rows.length) { await seedProducts(env, url); rows = (await env.DB.prepare('SELECT * FROM products ORDER BY sort, name').all()).results; }
  return includeHidden ? rows : rows.filter((r) => r.active);
}
async function catalogRoute(request, env) {
  const rows = await dbProducts(env, request.url, false);
  const stats = (await env.DB.prepare("SELECT product_id, COUNT(*) AS n, ROUND(AVG(rating), 1) AS avg FROM reviews WHERE status = 'approved' GROUP BY product_id").all()).results;
  const rmap = Object.fromEntries(stats.map((s) => [s.product_id, { count: s.n, avg: s.avg }]));
  const { settings } = await loadCatalog(env, request.url);
  return json(200, { ok: true, products: rows.map((r) => ({ ...shapeProduct(r), rating: rmap[r.id] || { count: 0, avg: null } })),
    settings: { free_shipping_from: settings.free_shipping_from, shipping_fee: settings.shipping_fee, max_qty_per_item: settings.max_qty_per_item || 10 } }, { 'Cache-Control': 'public, max-age=15' });
}
// the pricing catalog used by checkout: real prices + stock from the database
async function pricingCatalog(env, url) {
  const rows = await dbProducts(env, url, false);
  const { settings } = await loadCatalog(env, url);
  return { products: rows.map((r) => ({ id: r.id, name: r.name, size: r.size, price: r.price, stock: r.stock, active: true })), settings };
}

// ---------- coupons ----------
export function couponDiscount(c, subtotal, now = nowIso()) {
  if (!c || !c.active) return { error: 'This coupon code is not valid.' };
  if (c.expires_at && c.expires_at < now) return { error: 'This coupon has expired.' };
  if (c.usage_limit != null && c.used_count >= c.usage_limit) return { error: 'This coupon has reached its usage limit.' };
  if (subtotal < (c.min_order || 0)) return { error: `Add items worth ${inr(c.min_order - subtotal)} more to use this coupon (minimum order ${inr(c.min_order)}).` };
  let d = c.kind === 'percent' ? Math.floor(subtotal * c.value / 100) : c.value;
  if (c.max_discount) d = Math.min(d, c.max_discount);
  d = Math.max(0, Math.min(d, subtotal - 1));        // an order is never free
  return { discount: d };
}
function normCode(v) { return str(v).toUpperCase().replace(/\s+/g, ''); }
async function priceWithCoupon(env, url, items, codeRaw, user) {
  const { products, settings } = await pricingCatalog(env, url);
  const priced = priceOrder(items, products, settings);
  if (priced.error) throw new HttpError(400, 'invalid_cart', priced.error);
  let discount = 0, code = null;
  const raw = normCode(codeRaw);
  if (raw) {
    if (!/^[A-Z0-9_-]{3,24}$/.test(raw)) throw new HttpError(400, 'invalid_coupon', 'This coupon code is not valid.', null, { coupon: 'This coupon code is not valid.' });
    const c = await env.DB.prepare('SELECT * FROM coupons WHERE code = ?').bind(raw).first();
    const r = couponDiscount(c, priced.subtotal);
    if (r.error) throw new HttpError(400, 'invalid_coupon', r.error, null, { coupon: r.error });
    discount = r.discount; code = c.code;
    // v4: a bargain deal coupon works only for the customer who made the deal, only with that product, once
    if (c.user_id != null && (!user || user.id !== c.user_id)) { const e = user ? 'This deal coupon belongs to another account.' : 'Sign in to the account that made this deal to use its coupon.'; throw new HttpError(400, 'invalid_coupon', e, null, { coupon: e }); }
    if (c.product_id) {
      const line = priced.lines.find((l) => l.id === c.product_id);
      if (!line) { const e = 'This deal coupon is for a different product. Add that product to your bag.'; throw new HttpError(400, 'invalid_coupon', e, null, { coupon: e }); }
      discount = Math.max(0, Math.min(discount, line.price - 1, priced.subtotal - 1));
    }
  }
  const net = priced.subtotal - discount;
  const shipping = net >= settings.free_shipping_from ? 0 : settings.shipping_fee;
  return { lines: priced.lines, items_subtotal: priced.subtotal, discount, coupon: code, subtotal: net, shipping, total: net + shipping };
}
async function quoteRoute(request, env) {
  const body = await readJson(request);
  await rateLimit(env, 'quote', clientIp(request), 40, 600);
  const q = await priceWithCoupon(env, request.url, body.items, body.coupon, await currentUser(env, request));
  return json(200, { ok: true, quote: q });
}

// ---------- orders v2 ----------
async function createOrderV2(request, env, url, m, ctx) {
  const body = await readJson(request);
  await rateLimit(env, 'order', clientIp(request), ORDER_LIMIT, ORDER_WINDOW_S);
  if (body.payment && body.payment !== 'cod') throw new HttpError(400, 'payment_unavailable', 'Only Cash on Delivery is available right now.');
  const { customer, errors } = validateCustomer(body.customer);
  if (Object.keys(errors).length) throw new HttpError(400, 'invalid_customer', Object.values(errors)[0], null, errors);
  const ui4 = await getUi(env);
  if (!pincodeServiceable(ui4.delivery, customer.pincode).ok) { const msg = ui4.delivery.message || `Sorry, we don't deliver to ${customer.pincode} yet.`; throw new HttpError(400, 'invalid_customer', msg, null, { pincode: msg }); }
  const user = await currentUser(env, request);    // link to the account only from the session cookie, never from the body
  const q = await priceWithCoupon(env, request.url, body.items, body.coupon, user);
  const t = nowIso(); const yr = istYear(t);
  const id = 'AV-' + t.slice(2, 10).replace(/-/g, '') + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  const token = randToken(18);
  const email = customer.email || (user ? user.email : null);
  const stmts = [
    env.DB.prepare(SEQ_SQL).bind('invoice_seq:' + yr, t),
    env.DB.prepare(`INSERT INTO orders (id, user_id, status, payment, subtotal, shipping, total, name, phone, email, address, city, state, pincode, notes, ip, created_at, updated_at, coupon_code, discount, items_subtotal, invoice_token, invoice_no)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, (SELECT 'INV-' || ? || '-' || printf('%04d', CAST(value AS INTEGER)) FROM settings WHERE key = ?))`)
      .bind(id, user ? user.id : null, 'new', 'cod', q.subtotal, q.shipping, q.total, customer.name, customer.phone, email, customer.address, customer.city, customer.state, customer.pincode, customer.notes || null, clientIp(request), t, t,
        q.coupon, q.discount, q.items_subtotal, token, String(yr), 'invoice_seq:' + yr)
  ];
  for (const l of q.lines) {
    stmts.push(env.DB.prepare('INSERT INTO order_items (order_id, product_id, name, size, unit_price, qty, line_total) VALUES (?,?,?,?,?,?,?)').bind(id, l.id, l.name, l.size || null, l.price, l.qty, l.total));
    stmts.push(env.DB.prepare('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?').bind(l.qty, t, l.id));   // CHECK (stock >= 0) aborts the whole order if stock ran out
  }
  if (q.coupon) stmts.push(env.DB.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?').bind(q.coupon));   // CHECK (used_count <= usage_limit)
  stmts.push(env.DB.prepare("INSERT INTO order_events (order_id, status, note, created_at) VALUES (?, 'new', 'Order placed', ?)").bind(id, t));
  try { await env.DB.batch(stmts); }
  catch (e) {
    if (/CHECK constraint/i.test(String(e && e.message || e))) throw new HttpError(409, 'sold_out', 'Sorry — an item just sold out or the coupon was used up. Please refresh your cart and try again.');
    throw e;
  }
  const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  const origin = new URL(request.url).origin;
  const order = { id, invoice_no: row.invoice_no, invoice_url: `${origin}/invoice/${id}?t=${token}`, created_at: t, items: q.lines, items_subtotal: q.items_subtotal, discount: q.discount, coupon: q.coupon,
    subtotal: q.subtotal, shipping: q.shipping, total: q.total, customer: { ...customer, email }, payment: 'Cash on Delivery', status: 'new', saved: true, account: user ? user.email : null };
  if (email) {
    const p = sendOrderEmail(env, origin, row, q.lines.map((l) => ({ name: l.name, size: l.size, unit_price: l.price, qty: l.qty, line_total: l.total })), 'received').catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
  }
  return json(201, { ok: true, order });
}
function shapeOrderV2(o, items, admin, origin) {
  const out = shapeOrder(o, items, admin);
  out.items_subtotal = o.items_subtotal != null ? o.items_subtotal : o.subtotal;
  out.discount = o.discount || 0; out.coupon = o.coupon_code || null; out.invoice_no = o.invoice_no || null;
  if (o.invoice_token) out.invoice_url = `${origin || ''}/invoice/${o.id}?t=${o.invoice_token}`;
  return out;
}
async function myOrdersV2(request, env) {
  const u = await requireUser(env, request);
  const origin = new URL(request.url).origin;
  const rows = (await env.DB.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(u.id).all()).results;
  const items = await loadItems(env, rows.map((r) => r.id));
  return json(200, { ok: true, orders: rows.map((r) => shapeOrderV2(r, items[r.id], false, origin)) });
}
async function adminOrdersV2(request, env, url) {
  await requireAdmin(env, request);
  const { limit, offset } = pageArgs(url);
  const status = url.searchParams.get('status') || '';
  if (status && !ORDER_STATUSES.includes(status)) throw new HttpError(400, 'invalid_input', 'Unknown status filter.');
  // v6: search (order id, name, phone, e-mail, city, pincode) for the Admin app
  const search = String(url.searchParams.get('q') || '').trim().slice(0, 60);
  const conds = [], args = [];
  if (status) { conds.push('o.status = ?'); args.push(status); }
  if (search) { const like = '%' + search.replace(/[%_\\]/g, (c) => '\\' + c) + '%'; conds.push("(o.id LIKE ? ESCAPE '\\' OR o.name LIKE ? ESCAPE '\\' OR o.phone LIKE ? ESCAPE '\\' OR o.email LIKE ? ESCAPE '\\' OR o.city LIKE ? ESCAPE '\\' OR o.pincode LIKE ? ESCAPE '\\')"); args.push(like, like, like, like, like, like); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const q = env.DB.prepare(`SELECT o.*, u.email AS account_email FROM orders o LEFT JOIN users u ON u.id = o.user_id ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`);
  const rows = (await q.bind(...args, limit, offset).all()).results;
  const items = await loadItems(env, rows.map((r) => r.id));
  const origin = new URL(request.url).origin;
  return json(200, { ok: true, orders: rows.map((r) => ({ ...shapeOrderV2(r, items[r.id], true, origin), mail: orderMailDraft(origin, r, items[r.id] || [], r.status === 'new' ? 'received' : r.status === 'confirmed' ? 'confirmed' : 'update') })), limit, offset });
}
async function adminSetStatusV2(request, env, id) {
  await requireAdmin(env, request);
  const body = await readJson(request);
  if (!ORDER_STATUSES.includes(body.status)) throw new HttpError(400, 'invalid_input', 'Status must be one of: ' + ORDER_STATUSES.join(', ') + '.', null, { status: 'Invalid status.' });
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o) throw new HttpError(404, 'not_found', 'Order not found.');
  const t = nowIso();
  const items = (await loadItems(env, [id]))[id] || [];
  const stmts = [env.DB.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').bind(body.status, t, id)];
  if (body.status !== o.status) {
    stmts.push(env.DB.prepare('INSERT INTO order_events (order_id, status, note, created_at) VALUES (?,?,?,?)').bind(id, body.status, clamp(body.note, 200) || null, t));
    // stock goes back on the shelf when an order is cancelled, and comes off again if it is re-opened
    const sign = body.status === 'cancelled' ? 1 : (o.status === 'cancelled' ? -1 : 0);
    if (sign) for (const i of items) stmts.push(env.DB.prepare('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?').bind(sign * i.qty, t, i.product_id));
  }
  try { await env.DB.batch(stmts); }
  catch (e) { if (/CHECK constraint/i.test(String(e && e.message))) throw new HttpError(409, 'out_of_stock', 'Not enough stock to re-open this order. Add stock in Products first.'); throw e; }
  const origin = new URL(request.url).origin;
  const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  let email = null;
  if (body.status === 'confirmed' && o.status !== 'confirmed') email = o.email ? await sendOrderEmail(env, origin, fresh, items, 'confirmed') : { sent: false, reason: 'no_customer_email' };
  return json(200, { ok: true, id, status: body.status, email, mail: orderMailDraft(origin, fresh, items, body.status === 'confirmed' ? 'confirmed' : 'update') });
}
async function adminDeleteOrderV2(request, env, id) {
  await requireAdmin(env, request);
  checkOrigin(request);
  const o = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first();
  if (!o) throw new HttpError(404, 'not_found', 'Order not found.');
  const items = (await loadItems(env, [id]))[id] || [];
  const t = nowIso();
  const stmts = [];
  if (o.status !== 'cancelled') for (const i of items) stmts.push(env.DB.prepare('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?').bind(i.qty, t, i.product_id));
  stmts.push(env.DB.prepare('DELETE FROM order_events WHERE order_id = ?').bind(id), env.DB.prepare('DELETE FROM order_items WHERE order_id = ?').bind(id), env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(id));
  await env.DB.batch(stmts);
  return json(200, { ok: true, id, deleted: true });
}

// ---------- order tracking (order number + the phone or email used at checkout) ----------
export function contactMatches(o, contact) {
  const c = str(contact).toLowerCase();
  if (!c) return false;
  if (c.includes('@')) return !!o.email && o.email.toLowerCase() === c;
  const digits = c.replace(/\D/g, '').slice(-10);
  return digits.length === 10 && String(o.phone || '').replace(/\D/g, '').slice(-10) === digits;
}
async function trackOrder(request, env) {
  const body = await readJson(request);
  await rateLimit(env, 'track', clientIp(request), 20, 600);
  const id = str(body.order_id).toUpperCase();
  const fields = {};
  if (!/^AV-[0-9A-Z-]{6,20}$/.test(id)) fields.order_id = 'Enter the order number, e.g. AV-261026-ABC123.';
  if (!str(body.contact)) fields.contact = 'Enter the phone number or email used at checkout.';
  assertValid(fields);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o || !contactMatches(o, body.contact)) throw new HttpError(404, 'not_found', 'We could not find an order with that number and phone/email. Please check both and try again.');
  const items = (await loadItems(env, [id]))[id] || [];
  const events = (await env.DB.prepare('SELECT status, note, created_at FROM order_events WHERE order_id = ? ORDER BY id').bind(id).all()).results;
  const s = shapeOrderV2(o, items, false, new URL(request.url).origin);
  // only what the timeline needs: no full address or phone back to the browser
  return json(200, { ok: true, order: { id: s.id, status: s.status, created_at: s.created_at, items: s.items, items_subtotal: s.items_subtotal, discount: s.discount, shipping: s.shipping, total: s.total,
    payment: s.payment, invoice_no: s.invoice_no, invoice_url: s.invoice_url, ship_to: `${o.name.split(' ')[0]}, ${o.city} ${o.pincode}`,
    events: events.map((e) => ({ status: e.status, note: e.note, at: e.created_at, time_ist: istString(e.created_at) })) } });
}

// ---------- invoice (GST-style tax invoice; the page prints / saves as PDF) ----------
export function amountInWords(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return 'Rupees Zero Only';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : ''));
  const three = (x) => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x));
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(three(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (thousand) parts.push(two(thousand) + ' Thousand');
  if (n) parts.push(three(n));
  return 'Rupees ' + parts.join(' ') + ' Only';
}
const money2 = (n) => '\u20B9' + (Math.round(n * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function invoiceHtml(o, items, cfg, origin) {
  const rate = Math.max(0, Math.min(28, Number(cfg.gst_rate) || 18));
  const f = 1 + rate / 100;
  const taxable = o.total / f, gst = o.total - taxable;
  const d = istString(o.created_at).slice(0, 10).split('-').reverse().join('/');
  const itemsSub = o.items_subtotal != null ? o.items_subtotal : o.subtotal;
  const mail = escHtml(cfg.support_email || 'avermontis@mail.tab.bot');
  const rows = items.map((i, n) => `<tr><td>${n + 1}</td><td>${escHtml(i.name)}${i.size ? ` <span class="m">(${escHtml(i.size)})</span>` : ''}<div class="m">HSN 3304</div></td><td class="r">${i.qty}</td><td class="r">${money2(i.unit_price)}</td><td class="r">${money2(i.line_total / f)}</td><td class="r">${money2(i.line_total - i.line_total / f)}</td><td class="r">${money2(i.line_total)}</td></tr>`).join('');
  const addr = `${escHtml(o.name)}<br>${escHtml(o.address)}<br>${escHtml(o.city)}, ${escHtml(o.state)} ${escHtml(o.pincode)}<br>Phone: ${escHtml(o.phone)}${o.email ? '<br>' + escHtml(o.email) : ''}`;
  const status = o.status === 'cancelled' ? '<p class="cancel">This order was cancelled. This invoice is void.</p>' : '';
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Tax Invoice ${escHtml(o.invoice_no || o.id)} - Avermontis</title><link rel="icon" href="/img/favicon.png"><link rel="stylesheet" href="/assets/invoice.css"></head><body>
<div class="bar no-print"><a href="/">&larr; Avermontis</a><button type="button" id="print-btn">Download PDF / Print</button></div>
<main class="inv">
<header class="ih"><div><div class="brand">AVER<span>MONTIS</span></div><div class="m">Skincare &middot; Made in India</div></div><div class="tt"><h1>Tax Invoice</h1><div class="m">Original for recipient</div></div></header>
${status}
<section class="meta"><div><b>Sold by</b><br>Avermontis<br>${escHtml(cfg.seller_address || 'India')}<br>Email: ${mail}<br>GSTIN: ${escHtml(cfg.gstin || '(to be added)')}</div>
<div><table class="kv"><tr><td>Invoice no.</td><td><b>${escHtml(o.invoice_no || '-')}</b></td></tr><tr><td>Invoice date</td><td>${d}</td></tr><tr><td>Order no.</td><td>${escHtml(o.id)}</td></tr><tr><td>Order date</td><td>${d}</td></tr><tr><td>Payment</td><td>Cash on Delivery (COD)</td></tr><tr><td>Place of supply</td><td>${escHtml(o.state)}</td></tr></table></div></section>
<section class="meta"><div><b>Bill to</b><br>${addr}</div><div><b>Ship to</b><br>${addr}</div></section>
<div class="tw"><table class="items"><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Taxable value</th><th class="r">GST ${rate}%</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table></div>
<table class="tot">
<tr><td>Items total (incl. GST)</td><td class="r">${money2(itemsSub)}</td></tr>
${o.discount ? `<tr><td>Discount${o.coupon_code ? ' (' + escHtml(o.coupon_code) + ')' : ''}</td><td class="r">&minus; ${money2(o.discount)}</td></tr>` : ''}
<tr><td>Shipping</td><td class="r">${o.shipping ? money2(o.shipping) : 'Free'}</td></tr>
<tr class="g"><td>Grand total</td><td class="r">${money2(o.total)}</td></tr>
<tr><td class="m">Total taxable value</td><td class="r m">${money2(taxable)}</td></tr>
<tr><td class="m">GST @ ${rate}% (included in price)</td><td class="r m">${money2(gst)}</td></tr>
</table>
<p class="words"><b>Amount in words:</b> ${amountInWords(o.total)}</p>
<p class="m small">All prices are inclusive of GST. Payment mode: Cash on Delivery &mdash; please pay ${inr(o.total)} to the delivery partner. The CGST/SGST or IGST split will be shown once the seller's GSTIN is added. This is a computer-generated invoice and does not need a signature.</p>
<footer class="if">Thank you for shopping with Avermontis &middot; ${mail} &middot; ${escHtml(origin.replace(/^https?:\/\//, ''))}</footer>
</main><script src="/assets/invoice.js"></script></body></html>`;
}
function htmlHeaders(extra) { return { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': CSP, ...SEC_HEADERS, ...(extra || {}) }; }
async function invoicePage(request, env, id) {
  await ensureSchema(env);
  const url = new URL(request.url);
  const o = /^AV-[0-9A-Z-]{6,20}$/.test(id) ? await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first() : null;
  let allowed = false;
  if (o) {
    const t = url.searchParams.get('t') || '';
    if (o.invoice_token && t.length === o.invoice_token.length && safeEqual(enc.encode(t), enc.encode(o.invoice_token))) allowed = true;
    if (!allowed && await getSession(env, request, 'admin')) allowed = true;
    if (!allowed && o.user_id) { const u = await currentUser(env, request); if (u && u.id === o.user_id) allowed = true; }
  }
  if (!allowed) return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invoice not found</title><link rel="stylesheet" href="/assets/invoice.css"></head><body><main class="inv"><h1>Invoice not found</h1><p>Open the invoice from your order confirmation, My account or the order tracking page.</p><p><a href="/track">Track an order</a></p></main></body></html>', { status: 404, headers: htmlHeaders() });
  const items = (await loadItems(env, [o.id]))[o.id] || [];
  return new Response(invoiceHtml(o, items, await getSettings(env), url.origin), { status: 200, headers: htmlHeaders() });
}

// ---------- email (works once the owner adds an email service key in /admin → Settings; the key stays on the server) ----------
async function emailConfig(env) {
  const s = await getSettings(env);
  const keyRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'secret:email_api_key'").first();
  const key = String(env.EMAIL_API_KEY || (keyRow && keyRow.value) || '').trim();
  const provider = String(env.EMAIL_PROVIDER || s.email_provider || '').trim();
  return { provider, key, from: String(env.EMAIL_FROM || s.email_from || '').trim(), fromName: s.email_from_name || 'Avermontis', replyTo: s.support_email || 'avermontis@mail.tab.bot' };
}
async function logEmail(env, row) {
  try { await env.DB.prepare('INSERT INTO email_log (order_id, to_email, kind, status, detail, created_at) VALUES (?,?,?,?,?,?)').bind(row.order_id || null, row.to, row.kind, row.status, clamp(row.detail, 300) || null, nowIso()).run(); } catch {}
}
export async function sendEmail(env, msg, fetcher) {
  const cfg = await emailConfig(env);
  if (!cfg.provider || !cfg.key || !cfg.from) { await logEmail(env, { ...msg, status: 'skipped', detail: 'Email sending is not set up yet (Admin > Settings).' }); return { sent: false, reason: 'not_configured' }; }
  const f = fetcher || globalThis.__avFetch || fetch;
  let req;
  if (cfg.provider === 'brevo') req = ['https://api.brevo.com/v3/smtp/email', { 'api-key': cfg.key }, { sender: { email: cfg.from, name: cfg.fromName }, to: [{ email: msg.to }], replyTo: { email: cfg.replyTo }, subject: msg.subject, htmlContent: msg.html, textContent: msg.text }];
  else if (cfg.provider === 'resend') req = ['https://api.resend.com/emails', { Authorization: 'Bearer ' + cfg.key }, { from: `${cfg.fromName} <${cfg.from}>`, to: [msg.to], reply_to: cfg.replyTo, subject: msg.subject, html: msg.html, text: msg.text }];
  else { await logEmail(env, { ...msg, status: 'failed', detail: 'Unknown email provider.' }); return { sent: false, reason: 'not_configured' }; }
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 10000) : null;
  try {
    const r = await f(req[0], { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...req[1] }, body: JSON.stringify(req[2]), signal: ctl ? ctl.signal : undefined });
    const txt = (await r.text()).slice(0, 300).split(cfg.key).join('[key]');
    if (r.ok) { await logEmail(env, { ...msg, status: 'sent', detail: txt }); return { sent: true }; }
    await logEmail(env, { ...msg, status: 'failed', detail: `HTTP ${r.status}: ${txt}` });
    return { sent: false, reason: 'provider_error', detail: `The email service answered ${r.status}: ${txt}` };
  } catch (e) {
    await logEmail(env, { ...msg, status: 'failed', detail: String(e && e.message || e) });
    return { sent: false, reason: 'provider_error', detail: 'Could not reach the email service.' };
  } finally { if (timer) clearTimeout(timer); }
}
// ---------- one-time email seed (Tab wires the owner's Brevo key without the admin password) ----------
// The token itself is never in this file: only its SHA-256. The seed only fills an EMPTY key slot, so a key the
// owner sets in /admin -> Settings always wins and can never be overwritten from here.
const EMAIL_SEED_SHA256 = 'f93d13edcb52801292c7e6f9d300d1617a95d2f1171eb53b045f7c90d5622058';
async function emailSeed(request, env) {
  const tok = request.headers.get('x-seed-token') || '';
  if (!tok || (await sha256hex(tok)) !== EMAIL_SEED_SHA256) throw new HttpError(403, 'forbidden', 'Not allowed.');
  const b = await readJson(request);
  const out = {};
  if (b.api_key !== undefined || b.from !== undefined) {
    const key = String(b.api_key || '').trim(), from = String(b.from || '').trim().toLowerCase(), name = clamp(b.from_name || 'Avermontis', 80);
    const f = {};
    if (key.length < 10 || key.length > 300 || /\s/.test(key)) f.api_key = 'bad key';
    if (!isEmail(from)) f.from = 'bad sender';
    assertValid(f);
    const have = await env.DB.prepare("SELECT value FROM settings WHERE key = 'secret:email_api_key'").first();
    if (have && have.value && !b.replace_seeded) throw new HttpError(409, 'already_set', 'An email key is already set (Admin > Settings).');
    const seeded = await env.DB.prepare("SELECT value FROM settings WHERE key = 'meta:email_seeded'").first();
    if (have && have.value && b.replace_seeded && !seeded) throw new HttpError(409, 'owner_set', 'The owner set this key; not replacing it.');
    const t = nowIso();
    const up = 'INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at';
    await env.DB.batch([env.DB.prepare(up).bind('secret:email_api_key', key, t), env.DB.prepare(up).bind('cfg:email_provider', 'brevo', t),
      env.DB.prepare(up).bind('cfg:email_from', from, t), env.DB.prepare(up).bind('cfg:email_from_name', name, t), env.DB.prepare(up).bind('meta:email_seeded', t, t)]);
    out.seeded = true;
  }
  if (b.test_to !== undefined) {
    const to = String(b.test_to || '').trim().toLowerCase();
    if (!isEmail(to) || !/@mail\.tab\.bot$/.test(to)) throw new HttpError(400, 'invalid', 'Test mail only goes to a Tab mailbox.');
    const subj = clamp(b.test_subject || 'Avermontis email test', 120);
    out.test = await sendEmail(env, { to, kind: 'test', subject: subj, text: 'This is a test email from the Avermontis store. Customer emails are working.', html: '<p>This is a test email from the <b>Avermontis</b> store. Customer emails are working.</p>' });
  }
  const cfg = await emailConfig(env);
  return json(200, { ok: true, ...out, configured: !!(cfg.provider && cfg.key && cfg.from), provider: cfg.provider, from: cfg.from, key_hint: cfg.key ? '****' + cfg.key.slice(-4) : '' });
}
function orderText(origin, o, items, kind) {
  const lines = items.map((i) => `- ${i.name}${i.size ? ' (' + i.size + ')' : ''} x${i.qty}: ${inr(i.line_total)}`).join('\n');
  const head = kind === 'confirmed' ? `Good news! Your Avermontis order ${o.id} is confirmed and will be packed soon.` : kind === 'received' ? `Thank you! We have received your Avermontis order ${o.id}.` : `An update on your Avermontis order ${o.id}: it is now "${o.status}".`;
  return `Hi ${String(o.name).split(' ')[0]},\n\n${head}\n\n${lines}\n${o.discount ? `Discount${o.coupon_code ? ' (' + o.coupon_code + ')' : ''}: -${inr(o.discount)}\n` : ''}Shipping: ${o.shipping ? inr(o.shipping) : 'Free'}\nTotal: ${inr(o.total)} (Cash on Delivery, GST included)\n\nDeliver to: ${o.name}, ${o.address}, ${o.city}, ${o.state} ${o.pincode}\n\nInvoice: ${origin}/invoice/${o.id}?t=${o.invoice_token}\nTrack your order: ${origin}/track?order=${o.id}\n\nQuestions? Just reply to this email.\nTeam Avermontis`;
}
export function orderMailDraft(origin, o, items, kind) {
  const subject = kind === 'confirmed' ? `Your Avermontis order ${o.id} is confirmed` : kind === 'received' ? `We received your Avermontis order ${o.id}` : `Update on your Avermontis order ${o.id}`;
  return { to: o.email || '', subject, body: orderText(origin, o, items, kind) };
}
function orderEmailHtml(origin, o, items, kind) {
  const head = kind === 'confirmed' ? 'Your order is confirmed' : 'Thank you for your order';
  const sub = kind === 'confirmed' ? 'we are packing it now. You pay in cash when it arrives.' : 'we have received your order and will confirm it shortly.';
  const td = 'padding:8px 0;border-bottom:1px solid #e8e4da';
  const rows = items.map((i) => `<tr><td style="${td}">${escHtml(i.name)}${i.size ? ' <span style="color:#777">(' + escHtml(i.size) + ')</span>' : ''} &times; ${i.qty}</td><td style="${td};text-align:right">${inr(i.line_total)}</td></tr>`).join('');
  const inv = `${origin}/invoice/${o.id}?t=${o.invoice_token}`;
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#1d221f"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:#0b0f0d;padding:22px 24px;color:#efe9dc;font-family:Georgia,serif;font-size:22px;letter-spacing:4px">AVER<span style="color:#3ccf8e">MONTIS</span></td></tr>
<tr><td style="padding:24px"><h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;margin:0 0 6px">${head}</h1><p style="margin:0 0 18px;color:#555">Hi ${escHtml(String(o.name).split(' ')[0])}, ${sub}</p>
<p style="margin:0 0 4px;font-size:13px;color:#777">Order ${escHtml(o.id)} &middot; Invoice ${escHtml(o.invoice_no || '')}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${rows}
${o.discount ? `<tr><td style="padding:6px 0">Discount${o.coupon_code ? ' (' + escHtml(o.coupon_code) + ')' : ''}</td><td style="text-align:right">&minus;${inr(o.discount)}</td></tr>` : ''}
<tr><td style="padding:6px 0">Shipping</td><td style="text-align:right">${o.shipping ? inr(o.shipping) : 'Free'}</td></tr>
<tr><td style="padding:8px 0;font-weight:bold">Total (Cash on Delivery)</td><td style="text-align:right;font-weight:bold">${inr(o.total)}</td></tr></table>
<p style="font-size:13px;color:#555;margin:16px 0">Deliver to: ${escHtml(o.name)}, ${escHtml(o.address)}, ${escHtml(o.city)}, ${escHtml(o.state)} ${escHtml(o.pincode)}</p>
<p style="margin:20px 0"><a href="${inv}" style="background:#13784c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">View / download invoice</a> &nbsp; <a href="${origin}/track?order=${o.id}" style="color:#13784c">Track order</a></p>
<p style="font-size:12px;color:#888;margin:0">Questions? Reply to this email. Prices include GST.</p></td></tr></table></td></tr></table></body></html>`;
}
async function sendOrderEmail(env, origin, o, items, kind) {
  if (!o.email) return { sent: false, reason: 'no_customer_email' };
  const d = orderMailDraft(origin, o, items, kind);
  return sendEmail(env, { to: o.email, subject: d.subject, text: d.body, html: orderEmailHtml(origin, o, items, kind), kind: 'order_' + kind, order_id: o.id });
}

// ---------- reviews (signed-in customers; shown only after the owner approves) ----------
async function productReviews(request, env, id) {
  const rows = (await env.DB.prepare("SELECT id, author, rating, title, body, verified, created_at FROM reviews WHERE product_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 100").bind(id).all()).results;
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.rating, 0) / rows.length * 10) / 10 : null;
  let mine = null;
  const u = await currentUser(env, request);
  if (u) mine = await env.DB.prepare('SELECT rating, title, body, status FROM reviews WHERE product_id = ? AND user_id = ?').bind(id, u.id).first();
  return json(200, { ok: true, reviews: rows.map((r) => ({ ...r, verified: !!r.verified })), count: rows.length, avg, mine: mine || null, signed_in: !!u });
}
async function addReview(request, env, id) {
  const body = await readJson(request);
  const u = await requireUser(env, request);
  await rateLimit(env, 'review', clientIp(request), 10, 3600);
  const p = await env.DB.prepare('SELECT id FROM products WHERE id = ? AND active = 1').bind(id).first();
  if (!p) throw new HttpError(404, 'not_found', 'Product not found.');
  const rating = Number(body.rating), title = clamp(body.title, 80), text = clamp(body.body, 1000);
  const f = {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) f.rating = 'Choose a rating from 1 to 5 stars.';
  if (text.length < 10) f.body = 'Please write at least 10 characters.';
  else if (/[<>]/.test(title + text)) f.body = 'Please remove < and > characters.';
  assertValid(f);
  const bought = await env.DB.prepare("SELECT 1 AS x FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.user_id = ? AND i.product_id = ? AND o.status != 'cancelled' LIMIT 1").bind(u.id, id).first();
  try {
    await env.DB.prepare('INSERT INTO reviews (product_id, user_id, author, rating, title, body, status, verified, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, u.id, u.name.split(' ')[0].slice(0, 30), rating, title || null, text, 'pending', bought ? 1 : 0, nowIso()).run();
  } catch (e) { if (/UNIQUE/i.test(String(e && e.message))) throw new HttpError(409, 'already_reviewed', 'You have already reviewed this product.'); throw e; }
  return json(201, { ok: true, message: 'Thank you! Your review will appear after a quick check.' });
}

// ---------- wishlist (signed-in customers, own list only) ----------
async function wishlistGet(request, env) {
  const u = await requireUser(env, request);
  const rows = (await env.DB.prepare('SELECT product_id FROM wishlist WHERE user_id = ? ORDER BY created_at DESC').bind(u.id).all()).results;
  return json(200, { ok: true, items: rows.map((r) => r.product_id) });
}
async function wishlistAdd(request, env) {
  const body = await readJson(request);
  const u = await requireUser(env, request);
  const pid = str(body.product_id);
  const p = pid && await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(pid).first();
  if (!p) throw new HttpError(404, 'not_found', 'Product not found.');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM wishlist WHERE user_id = ?').bind(u.id).first();
  if (n.n >= 100) throw new HttpError(400, 'too_many', 'Your wishlist is full.');
  await env.DB.prepare('INSERT OR IGNORE INTO wishlist (user_id, product_id, created_at) VALUES (?,?,?)').bind(u.id, pid, nowIso()).run();
  return json(200, { ok: true, product_id: pid, saved: true });
}
async function wishlistRemove(request, env, pid) {
  checkOrigin(request);
  const u = await requireUser(env, request);
  await env.DB.prepare('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?').bind(u.id, pid).run();
  return json(200, { ok: true, product_id: pid, saved: false });
}

// ---------- newsletter + contact form (saved to the database, visible in /admin) ----------
async function newsletter(request, env) {
  const body = await readJson(request);
  await rateLimit(env, 'form', clientIp(request), 10, 600);
  const email = str(body.email).toLowerCase();
  if (!isEmail(email)) throw new HttpError(400, 'invalid_input', 'Enter a valid email address.', null, { email: 'Enter a valid email address.' });
  await env.DB.prepare('INSERT OR IGNORE INTO subscribers (email, source, ip, created_at) VALUES (?,?,?,?)').bind(email, clamp(body.source, 30) || 'site', clientIp(request), nowIso()).run();
  return json(200, { ok: true, message: 'You are subscribed. Thank you!' });
}
async function contactForm(request, env) {
  const body = await readJson(request);
  await rateLimit(env, 'form', clientIp(request), 10, 600);
  const v = { name: clamp(body.name, 80), email: str(body.email).toLowerCase(), phone: clamp(body.phone, 20), subject: clamp(body.subject, 120), message: clamp(body.message, 2000) };
  const f = {};
  if (v.name.length < 2) f.name = 'Please enter your name.';
  if (!isEmail(v.email)) f.email = 'Enter a valid email address.';
  if (v.phone && !/^[0-9+\s-]{7,20}$/.test(v.phone)) f.phone = 'Enter a valid phone number or leave it empty.';
  if (v.message.length < 10) f.message = 'Please write at least 10 characters.';
  assertValid(f);
  await env.DB.prepare('INSERT INTO messages (name, email, phone, subject, body, ip, created_at) VALUES (?,?,?,?,?,?,?)').bind(v.name, v.email, v.phone || null, v.subject || null, v.message, clientIp(request), nowIso()).run();
  return json(201, { ok: true, message: 'Thanks! Your message has reached us. We usually reply within 1-2 working days.' });
}

// ---------- forgot / reset password ----------
const RESET_HOURS = 2;
async function makeResetLink(env, request, userId, emailed) {
  const token = randToken(32);
  const t = Date.now();
  await env.DB.prepare('INSERT INTO password_resets (id, user_id, created_at, expires_at, ip, emailed) VALUES (?,?,?,?,?,?)')
    .bind(await sha256hex(token), userId, new Date(t).toISOString(), new Date(t + RESET_HOURS * 3600000).toISOString(), clientIp(request), emailed ? 1 : 0).run();
  return `${new URL(request.url).origin}/reset?token=${token}`;
}
async function forgotPassword(request, env) {
  const body = await readJson(request);
  await rateLimit(env, 'auth', clientIp(request), AUTH_LIMIT, AUTH_WINDOW_S);
  const email = str(body.email).toLowerCase();
  if (!isEmail(email)) throw new HttpError(400, 'invalid_input', 'Enter a valid email address.', null, { email: 'Enter a valid email address.' });
  const u = await env.DB.prepare('SELECT id, name, email FROM users WHERE email = ?').bind(email).first();
  if (u) {
    const cfg = await emailConfig(env);
    const canSend = !!(cfg.provider && cfg.key && cfg.from);
    const link = await makeResetLink(env, request, u.id, canSend);
    if (canSend) {
      const first = escHtml(u.name.split(' ')[0]);
      await sendEmail(env, { to: u.email, kind: 'password_reset', subject: 'Reset your Avermontis password',
        text: `Hi ${u.name.split(' ')[0]},\n\nUse this link to set a new password (valid for ${RESET_HOURS} hours):\n${link}\n\nIf you did not ask for this, ignore this email.\nTeam Avermontis`,
        html: `<p>Hi ${first},</p><p>Use this link to set a new password (valid for ${RESET_HOURS} hours):</p><p><a href="${link}">Set a new password</a></p><p>If you did not ask for this, ignore this email.</p><p>Team Avermontis</p>` });
    }
    await logAttempt(env, request, { user_id: u.id, email, kind: 'customer', event: 'login', success: false, reason: 'reset_requested' });
  }
  // same answer whether or not the account exists (no account fishing)
  return json(200, { ok: true, message: 'If an account exists for this email, a reset link is on its way. No email within 10 minutes? Write to us from the Contact page and we will send you a reset link.' });
}
async function resetPassword(request, env) {
  const body = await readJson(request);
  await rateLimit(env, 'auth', clientIp(request), AUTH_LIMIT, AUTH_WINDOW_S);
  const token = str(body.token);
  const pw = typeof body.password === 'string' ? body.password : '';
  const f = {};
  if (pw.length < 8) f.password = 'Password must be at least 8 characters.'; else if (pw.length > 128) f.password = 'Password must be at most 128 characters.';
  else if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) f.password = 'Use at least one letter and one number.';
  assertValid(f);
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw new HttpError(400, 'bad_token', 'This reset link is not valid. Please ask for a new one.');
  const r = await env.DB.prepare('SELECT * FROM password_resets WHERE id = ?').bind(await sha256hex(token)).first();
  if (!r || r.used_at || r.expires_at < nowIso()) throw new HttpError(400, 'bad_token', 'This reset link has expired or was already used. Please ask for a new one.');
  const u = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(r.user_id).first();
  if (!u) throw new HttpError(400, 'bad_token', 'This reset link is not valid.');
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(pw), u.id),
    env.DB.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').bind(t, u.id),
    env.DB.prepare("DELETE FROM sessions WHERE kind = 'customer' AND user_id = ?").bind(u.id)
  ]);
  await logAttempt(env, request, { user_id: u.id, email: u.email, kind: 'customer', event: 'login', success: true, reason: 'password_reset' });
  const cookie = await createSession(env, request, 'customer', u.id);
  return json(200, withAppToken(request, { ok: true, user: { id: u.id, email: u.email, name: u.name } }), { 'Set-Cookie': cookie });
}

// ---------- admin: products ----------
export function validateProduct(b, isNew) {
  const v = { id: str(b.id).toLowerCase(), name: clamp(b.name, 100), size: clamp(b.size, 30), category: clamp(b.category, 40) || 'Skincare', price: Number(b.price), mrp: b.mrp === '' || b.mrp == null ? null : Number(b.mrp),
    stock: Number(b.stock), active: b.active === false || b.active === 0 || b.active === '0' ? 0 : 1, short: clamp(b.short, 200), description: clamp(b.description, 3000), how_to_use: clamp(b.how_to_use, 1500), sort: Number.isInteger(Number(b.sort)) ? Number(b.sort) : 0 };
  const list = (x, n, len) => (Array.isArray(x) ? x : String(x || '').split('\n')).map((s) => clamp(s, len)).filter(Boolean).slice(0, n);
  v.ingredients = list(b.ingredients, 30, 120);
  v.images = list(b.images, 8, 300);
  v.faqs = (Array.isArray(b.faqs) ? b.faqs : []).map((q) => ({ q: clamp(q && q.q, 200), a: clamp(q && q.a, 800) })).filter((q) => q.q && q.a).slice(0, 12);
  const f = {};
  if (isNew && !/^[a-z0-9][a-z0-9-]{1,58}$/.test(v.id)) f.id = 'ID: 2-60 lowercase letters, numbers or hyphens (e.g. rose-toner).';
  if (v.name.length < 2) f.name = 'Enter a product name.';
  if (!Number.isInteger(v.price) || v.price < 1 || v.price > 100000) f.price = 'Price must be a whole number of rupees (1-100000).';
  if (v.mrp != null && (!Number.isInteger(v.mrp) || v.mrp < 0 || v.mrp > 100000)) f.mrp = 'MRP must be a whole number or empty.';
  if (!Number.isInteger(v.stock) || v.stock < 0 || v.stock > 100000) f.stock = 'Stock must be a whole number (0 or more).';
  for (const im of v.images) if (!/^(\/media\/products\/[A-Za-z0-9_.-]+|\/?img\/[A-Za-z0-9_.-]+|\/?assets\/[A-Za-z0-9/_.-]+)$/.test(im)) { f.images = 'Images must be uploaded here or be files in the img folder.'; break; }
  if (/[<>]/.test(v.name + v.short + v.description + v.how_to_use + v.ingredients.join('') + v.faqs.map((q) => q.q + q.a).join(''))) f.description = 'Please remove < and > characters.';
  return { value: v, fields: f };
}
async function adminProducts(request, env) {
  await requireAdmin(env, request);
  const rows = await dbProducts(env, request.url, true);
  return json(200, { ok: true, products: rows.map((r) => shapeProduct(r, true)) });
}
async function adminSaveProduct(request, env, id) {
  await requireAdmin(env, request);
  const body = await readJson(request, 40000);
  const isNew = !id;
  const { value: v, fields } = validateProduct(isNew ? body : { ...body, id }, isNew);
  assertValid(fields);
  const t = nowIso();
  if (isNew) {
    try {
      await env.DB.prepare('INSERT INTO products (id, name, size, category, price, mrp, stock, active, images, short, description, ingredients, how_to_use, faqs, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(v.id, v.name, v.size || null, v.category, v.price, v.mrp, v.stock, v.active, JSON.stringify(v.images), v.short || null, v.description || null, JSON.stringify(v.ingredients), v.how_to_use || null, JSON.stringify(v.faqs), v.sort, t, t).run();
    } catch (e) { if (/UNIQUE|PRIMARY/i.test(String(e && e.message))) throw new HttpError(409, 'exists', 'A product with this ID already exists.', null, { id: 'This ID is taken.' }); throw e; }
  } else {
    const r = await env.DB.prepare('UPDATE products SET name=?, size=?, category=?, price=?, mrp=?, stock=?, active=?, images=?, short=?, description=?, ingredients=?, how_to_use=?, faqs=?, sort=?, updated_at=? WHERE id = ?')
      .bind(v.name, v.size || null, v.category, v.price, v.mrp, v.stock, v.active, JSON.stringify(v.images), v.short || null, v.description || null, JSON.stringify(v.ingredients), v.how_to_use || null, JSON.stringify(v.faqs), v.sort, t, id).run();
    if (!r.meta || r.meta.changes !== 1) throw new HttpError(404, 'not_found', 'Product not found.');
  }
  const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(isNew ? v.id : id).first();
  return json(isNew ? 201 : 200, { ok: true, product: shapeProduct(row, true) });
}
// image upload -> R2 (MEDIA binding). Type checked from the file's own bytes, size capped, random file name.
const UPLOAD_MAX_BYTES = 3 * 1024 * 1024;   // change the image size limit here
function sniffImage(b) {
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return ['jpg', 'image/jpeg'];
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return ['png', 'image/png'];
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return ['webp', 'image/webp'];
  return null;
}
async function adminUpload(request, env) {
  await requireAdmin(env, request);
  checkOrigin(request);
  if (!env.MEDIA) throw new HttpError(503, 'no_storage', 'Image storage is not connected. Put the photo in the img folder instead.');
  if (Number(request.headers.get('content-length') || 0) > UPLOAD_MAX_BYTES) throw new HttpError(413, 'too_large', 'Image is too large (max 3 MB).');
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length > UPLOAD_MAX_BYTES) throw new HttpError(413, 'too_large', 'Image is too large (max 3 MB).');
  if (buf.length < 100) throw new HttpError(400, 'bad_file', 'That file is empty.');
  const kind = sniffImage(buf);
  if (!kind) throw new HttpError(415, 'bad_file', 'Only JPG, PNG or WebP images are allowed.');
  const key = `products/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 12)}.${kind[0]}`;
  await env.MEDIA.put(key, buf, { httpMetadata: { contentType: kind[1], cacheControl: 'public, max-age=31536000, immutable' } });
  return json(201, { ok: true, url: '/media/' + key, bytes: buf.length });
}
async function serveMedia(request, env, key) {
  if (!env.MEDIA || !/^products\/[A-Za-z0-9_.-]{5,80}$/.test(key)) return null;
  const obj = await env.MEDIA.get(key);
  if (!obj) return null;
  return new Response(obj.body, { status: 200, headers: { 'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', ...SEC_HEADERS } });
}

// ---------- admin: coupons ----------
export function validateCoupon(b) {
  const num = (x) => (x === '' || x == null ? null : Number(x));
  const v = { code: normCode(b.code), kind: b.kind === 'flat' ? 'flat' : b.kind === 'percent' ? 'percent' : '', value: Number(b.value), min_order: num(b.min_order) == null ? 0 : num(b.min_order),
    max_discount: num(b.max_discount), usage_limit: num(b.usage_limit), expires: str(b.expires), note: clamp(b.note, 100), active: b.active === false ? 0 : 1 };
  const f = {};
  if (!/^[A-Z0-9_-]{3,24}$/.test(v.code)) f.code = 'Code: 3-24 letters/numbers (e.g. WELCOME10).';
  if (!v.kind) f.kind = 'Choose % off or Rs off.';
  if (!Number.isInteger(v.value) || v.value < 1 || (v.kind === 'percent' && v.value > 90) || v.value > 100000) f.value = v.kind === 'percent' ? 'Percent must be 1-90.' : 'Amount must be a whole number of rupees.';
  if (!Number.isInteger(v.min_order) || v.min_order < 0) f.min_order = 'Minimum order must be a whole number (0 for none).';
  if (v.max_discount != null && (!Number.isInteger(v.max_discount) || v.max_discount < 1)) f.max_discount = 'Max discount must be a whole number or empty.';
  if (v.usage_limit != null && (!Number.isInteger(v.usage_limit) || v.usage_limit < 1)) f.usage_limit = 'Usage limit must be 1 or more, or empty for unlimited.';
  v.expires_at = null;
  if (v.expires) {
    const ms = Date.parse(v.expires + 'T23:59:59+05:30');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.expires) || !isFinite(ms)) f.expires = 'Pick a valid date.';
    else v.expires_at = new Date(ms).toISOString();   // valid until the end of that day in India
  }
  return { value: v, fields: f };
}
async function adminCoupons(request, env) {
  await requireAdmin(env, request);
  const rows = (await env.DB.prepare("SELECT * FROM coupons WHERE source IS NULL OR source != 'bargain' ORDER BY created_at DESC LIMIT 500").all()).results;
  const now = nowIso();
  return json(200, { ok: true, coupons: rows.map((c) => ({ ...c, active: !!c.active, expired: !!(c.expires_at && c.expires_at < now) })) });
}
async function adminCreateCoupon(request, env) {
  await requireAdmin(env, request);
  const { value: v, fields } = validateCoupon(await readJson(request));
  assertValid(fields);
  try {
    await env.DB.prepare('INSERT INTO coupons (code, kind, value, min_order, max_discount, expires_at, usage_limit, used_count, active, note, created_at) VALUES (?,?,?,?,?,?,?,0,?,?,?)')
      .bind(v.code, v.kind, v.value, v.min_order, v.max_discount, v.expires_at, v.usage_limit, v.active, v.note || null, nowIso()).run();
  } catch (e) { if (/UNIQUE|PRIMARY/i.test(String(e && e.message))) throw new HttpError(409, 'exists', 'This coupon code already exists.', null, { code: 'This code already exists.' }); throw e; }
  return json(201, { ok: true, code: v.code });
}
async function adminUpdateCoupon(request, env, code) {
  await requireAdmin(env, request);
  const body = await readJson(request);
  if (typeof body.active !== 'boolean') throw new HttpError(400, 'invalid_input', 'Send active: true or false.');
  const r = await env.DB.prepare('UPDATE coupons SET active = ? WHERE code = ?').bind(body.active ? 1 : 0, normCode(code)).run();
  if (!r.meta || r.meta.changes !== 1) throw new HttpError(404, 'not_found', 'Coupon not found.');
  return json(200, { ok: true, code: normCode(code), active: body.active });
}
async function adminDeleteCoupon(request, env, code) {
  await requireAdmin(env, request);
  checkOrigin(request);
  const c = await env.DB.prepare('SELECT used_count FROM coupons WHERE code = ?').bind(normCode(code)).first();
  if (!c) throw new HttpError(404, 'not_found', 'Coupon not found.');
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE coupon_code = ?').bind(normCode(code)).first();
  if (used.n > 0) throw new HttpError(409, 'in_use', 'This coupon is on existing orders, so it is kept for your records. Switch it off instead.');
  await env.DB.prepare('DELETE FROM coupons WHERE code = ?').bind(normCode(code)).run();
  return json(200, { ok: true, deleted: true });
}

// ---------- admin: reviews, subscribers, messages, password resets, sales chart, stats, settings ----------
async function adminReviews(request, env, url) {
  await requireAdmin(env, request);
  const st = url.searchParams.get('status') || '';
  if (st && !['pending', 'approved', 'rejected'].includes(st)) throw new HttpError(400, 'invalid_input', 'Unknown status.');
  const q = `SELECT r.*, u.email AS email, p.name AS product_name FROM reviews r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN products p ON p.id = r.product_id ${st ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC LIMIT 300`;
  const rows = (await (st ? env.DB.prepare(q).bind(st) : env.DB.prepare(q)).all()).results;
  return json(200, { ok: true, reviews: rows.map((r) => ({ ...r, verified: !!r.verified, time_ist: istString(r.created_at) })) });
}
async function adminModerateReview(request, env, id) {
  await requireAdmin(env, request);
  const body = await readJson(request);
  if (!['approved', 'rejected', 'pending'].includes(body.status)) throw new HttpError(400, 'invalid_input', 'Status must be approved, rejected or pending.');
  const r = await env.DB.prepare('UPDATE reviews SET status = ? WHERE id = ?').bind(body.status, Number(id)).run();
  if (!r.meta || r.meta.changes !== 1) throw new HttpError(404, 'not_found', 'Review not found.');
  return json(200, { ok: true, id: Number(id), status: body.status });
}
async function adminDeleteRow(request, env, table, id) {
  await requireAdmin(env, request);
  checkOrigin(request);
  if (!['reviews', 'subscribers', 'messages'].includes(table)) throw new HttpError(404, 'not_found', 'No such list.');
  const r = await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(Number(id)).run();
  if (!r.meta || r.meta.changes !== 1) throw new HttpError(404, 'not_found', 'Not found.');
  return json(200, { ok: true, deleted: true });
}
async function adminSubscribers(request, env) {
  await requireAdmin(env, request);
  const rows = (await env.DB.prepare('SELECT id, email, source, created_at FROM subscribers ORDER BY created_at DESC LIMIT 5000').all()).results;
  return json(200, { ok: true, subscribers: rows.map((r) => ({ ...r, time_ist: istString(r.created_at) })) });
}
async function exportSubscribers(request, env) {
  await requireAdmin(env, request);
  const rows = (await env.DB.prepare('SELECT email, source, created_at FROM subscribers ORDER BY created_at DESC').all()).results;
  return csvResponse('avermontis-subscribers.csv', ['email', 'source', 'joined_ist'], rows.map((r) => [r.email, r.source, istString(r.created_at)]));
}
async function adminMessages(request, env) {
  await requireAdmin(env, request);
  const rows = (await env.DB.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT 1000').all()).results;
  return json(200, { ok: true, messages: rows.map((r) => ({ ...r, time_ist: istString(r.created_at) })) });
}
async function adminMarkMessage(request, env, id) {
  await requireAdmin(env, request);
  const body = await readJson(request);
  if (!['new', 'read', 'archived'].includes(body.status)) throw new HttpError(400, 'invalid_input', 'Unknown status.');
  const r = await env.DB.prepare('UPDATE messages SET status = ? WHERE id = ?').bind(body.status, Number(id)).run();
  if (!r.meta || r.meta.changes !== 1) throw new HttpError(404, 'not_found', 'Message not found.');
  return json(200, { ok: true });
}
async function adminResets(request, env) {
  await requireAdmin(env, request);
  const rows = (await env.DB.prepare('SELECT r.created_at, r.expires_at, r.used_at, r.emailed, u.id AS user_id, u.email, u.name FROM password_resets r JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 100').all()).results;
  return json(200, { ok: true, resets: rows.map((r) => ({ ...r, emailed: !!r.emailed, time_ist: istString(r.created_at) })) });
}
async function adminResetLink(request, env, uid) {
  await requireAdmin(env, request);
  checkOrigin(request);
  const u = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(Number(uid)).first();
  if (!u) throw new HttpError(404, 'not_found', 'Customer not found.');
  const link = await makeResetLink(env, request, u.id, false);
  return json(201, { ok: true, link, email: u.email, name: u.name, valid_hours: RESET_HOURS,
    mail: { to: u.email, subject: 'Reset your Avermontis password', body: `Hi ${u.name.split(' ')[0]},\n\nHere is your link to set a new password (valid for ${RESET_HOURS} hours):\n${link}\n\nTeam Avermontis` } });
}
async function adminSales(request, env, url) {
  await requireAdmin(env, request);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10) || 30, 7), 90);
  const since = new Date(Date.parse(istMidnightUtcIso()) - (days - 1) * 86400000).toISOString();
  const rows = (await env.DB.prepare("SELECT date(created_at, '+330 minutes') AS d, COUNT(*) AS n, COALESCE(SUM(total),0) AS s FROM orders WHERE status != 'cancelled' AND created_at >= ? GROUP BY d ORDER BY d").bind(since).all()).results;
  const map = Object.fromEntries(rows.map((r) => [r.d, r]));
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.parse(since) + 330 * 60000 + i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d, orders: map[d] ? map[d].n : 0, sales: map[d] ? map[d].s : 0 });
  }
  return json(200, { ok: true, days: out });
}
async function adminStatsV2(request, env) {
  await requireAdmin(env, request);
  const today = istMidnightUtcIso();
  const since24 = new Date(Date.now() - 86400000).toISOString();
  const r = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END),0) AS s FROM orders WHERE created_at >= ?").bind(today),
    env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS s, SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS pending FROM orders WHERE status != 'cancelled'"),
    env.DB.prepare('SELECT COUNT(*) AS n FROM users'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM login_history WHERE success = 0 AND created_at >= ?').bind(since24),
    env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'new'"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'"),
    env.DB.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND stock <= 5'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM subscribers')
  ]);
  const v = (i, k) => (r[i].results[0] || {})[k || 'n'] || 0;
  return json(200, { ok: true, stats: { orders_today: v(0), sales_today: v(0, 's'), orders_total: v(1), total_sales: v(1, 's'), new_orders: v(1, 'pending'), users: v(2),
    failed_logins_24h: v(3), new_messages: v(4), pending_reviews: v(5), low_stock: v(6), subscribers: v(7) } });
}
async function adminGetSettings(request, env) {
  await requireAdmin(env, request);
  const s = await getSettings(env);
  const cfg = await emailConfig(env);
  const log = (await env.DB.prepare('SELECT to_email, kind, status, detail, created_at FROM email_log ORDER BY id DESC LIMIT 20').all()).results;
  return json(200, { ok: true, settings: Object.fromEntries(PUBLIC_SETTING_KEYS.map((k) => [k, s[k] || ''])),
    email: { configured: !!(cfg.provider && cfg.key && cfg.from), key_set: !!cfg.key, key_hint: cfg.key ? '****' + cfg.key.slice(-4) : '' },
    email_log: log.map((l) => ({ ...l, time_ist: istString(l.created_at) })), media_storage: !!env.MEDIA });
}
async function adminPutSettings(request, env) {
  await requireAdmin(env, request);
  const b = await readJson(request);
  const v = {}, f = {};
  for (const k of PUBLIC_SETTING_KEYS) if (b[k] !== undefined) v[k] = clamp(b[k], k === 'announcement' || k === 'seller_address' ? 200 : 80);
  if (v.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(v.gstin.toUpperCase())) f.gstin = 'GSTIN is 15 characters, e.g. 09ABCDE1234F1Z5 (or leave empty).'; else if (v.gstin) v.gstin = v.gstin.toUpperCase();
  if (v.gst_rate && !['0', '5', '12', '18', '28'].includes(v.gst_rate)) f.gst_rate = 'GST rate must be 0, 5, 12, 18 or 28.';
  if (v.whatsapp_number && !/^[0-9]{10,13}$/.test(v.whatsapp_number.replace(/\D/g, ''))) f.whatsapp_number = 'Business WhatsApp number with country code, e.g. 919876543210 (or leave empty).'; else if (v.whatsapp_number) v.whatsapp_number = v.whatsapp_number.replace(/\D/g, '');
  if (v.support_email && !isEmail(v.support_email)) f.support_email = 'Enter a valid email.';
  if (v.email_from && !isEmail(v.email_from)) f.email_from = 'Enter the verified sender email.';
  if (v.email_provider && !['brevo', 'resend'].includes(v.email_provider)) f.email_provider = 'Choose Brevo or Resend.';
  if (/[<>]/.test(Object.values(v).join(''))) f.announcement = 'Please remove < and > characters.';
  const key = typeof b.email_api_key === 'string' ? b.email_api_key.trim() : '';
  if (key && (key.length < 10 || key.length > 300 || /\s/.test(key))) f.email_api_key = 'That API key does not look right.';
  assertValid(f);
  const t = nowIso();
  const up = 'INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at';
  const stmts = Object.entries(v).map(([k, val]) => env.DB.prepare(up).bind('cfg:' + k, val, t));
  if (key) stmts.push(env.DB.prepare(up).bind('secret:email_api_key', key, t));
  if (b.remove_email_api_key === true) stmts.push(env.DB.prepare("DELETE FROM settings WHERE key = 'secret:email_api_key'"));
  if (stmts.length) await env.DB.batch(stmts);
  return adminGetSettings(request, env);
}
async function adminEmailTest(request, env) {
  await requireAdmin(env, request);
  const b = await readJson(request);
  const to = str(b.to).toLowerCase();
  if (!isEmail(to)) throw new HttpError(400, 'invalid_input', 'Enter a valid email.', null, { to: 'Enter a valid email.' });
  await rateLimit(env, 'emailtest', clientIp(request), 5, 3600);
  const r = await sendEmail(env, { to, kind: 'test', subject: 'Avermontis test email', text: 'This is a test email from your Avermontis store. Email sending works.', html: '<p>This is a test email from your <b>Avermontis</b> store. Email sending works.</p>' });
  return json(200, { ok: true, result: r });
}

// ---------- backup (one Excel .xlsx with a sheet per table, or full JSON) and restore ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
export function zipStore(files) {
  const chunks = [], central = []; let offset = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const head = [0x50, 0x4B, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    chunks.push(new Uint8Array(head), name, data);
    central.push(new Uint8Array([0x50, 0x4B, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += head.length + name.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([0x50, 0x4B, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end]; const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0)); let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}
const xmlEsc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
export function buildXlsx(sheets) {
  const sheetXml = (rows) => {
    const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
      const ref = colName(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : '';
      if (v == null || v === '') return '';
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xmlEsc(String(v).slice(0, 32000))}</t></is></c>`;
    }).join('') + '</row>').join('');
    const cols = (rows[0] || []).map((_, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${Math.min(50, Math.max(10, ...rows.slice(0, 200).map((r) => String(r[ci] == null ? '' : r[ci]).length + 2)))}" customWidth="1"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${body}</sheetData></worksheet>`;
  };
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const files = [
    { name: '[Content_Types].xml', data: `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `${X}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF13784C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows) }))
  ];
  return zipStore(files);
}
// tables in a full backup, in restore order (parents before children). Admin password, sessions and the email key are never included.
const BACKUP_TABLES = {
  users: ['id', 'email', 'name', 'password_hash', 'created_at', 'last_login_at'],
  products: ['id', 'name', 'size', 'category', 'price', 'mrp', 'stock', 'active', 'images', 'short', 'description', 'ingredients', 'how_to_use', 'faqs', 'sort', 'created_at', 'updated_at'],
  coupons: ['code', 'kind', 'value', 'min_order', 'max_discount', 'expires_at', 'usage_limit', 'used_count', 'active', 'note', 'created_at'],
  orders: ['id', 'user_id', 'status', 'payment', 'subtotal', 'shipping', 'total', 'name', 'phone', 'email', 'address', 'city', 'state', 'pincode', 'notes', 'ip', 'created_at', 'updated_at', 'coupon_code', 'discount', 'items_subtotal', 'invoice_no', 'invoice_token'],
  order_items: ['id', 'order_id', 'product_id', 'name', 'size', 'unit_price', 'qty', 'line_total'],
  order_events: ['id', 'order_id', 'status', 'note', 'created_at'],
  login_history: ['id', 'user_id', 'email', 'kind', 'event', 'success', 'reason', 'ip', 'user_agent', 'device', 'created_at'],
  reviews: ['id', 'product_id', 'user_id', 'author', 'rating', 'title', 'body', 'status', 'verified', 'created_at'],
  wishlist: ['user_id', 'product_id', 'created_at'],
  subscribers: ['id', 'email', 'source', 'ip', 'created_at'],
  messages: ['id', 'name', 'email', 'phone', 'subject', 'body', 'status', 'ip', 'created_at']
};
async function dumpAll(env) {
  const out = {};
  for (const [t, cols] of Object.entries(BACKUP_TABLES)) out[t] = (await env.DB.prepare(`SELECT ${cols.join(', ')} FROM ${t} ORDER BY rowid`).all()).results;
  const set = (await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'cfg:%' OR key LIKE 'invoice_seq:%'").all()).results;
  out.settings = set;
  return out;
}
function backupName(ext) { return `avermontis-backup-${istString(nowIso()).slice(0, 10)}.${ext}`; }
async function backupJson(request, env) {
  await requireAdmin(env, request);
  const data = await dumpAll(env);
  const body = JSON.stringify({ format: 'avermontis-backup', version: 2, created_at: nowIso(), counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])), data }, null, 1);
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${backupName('json')}"`, 'Cache-Control': 'no-store', ...SEC_HEADERS } });
}
async function backupXlsx(request, env) {
  await requireAdmin(env, request);
  const d = await dumpAll(env);
  const ist = (x) => (x ? istString(x) : '');
  const itemsBy = {};
  for (const i of d.order_items) (itemsBy[i.order_id] = itemsBy[i.order_id] || []).push(`${i.name} x${i.qty}`);
  const userEmail = Object.fromEntries(d.users.map((u) => [u.id, u.email]));
  const sheets = [
    { name: 'Orders', rows: [['Order no.', 'Invoice no.', 'Date (IST)', 'Status', 'Items', 'Items total (Rs)', 'Coupon', 'Discount (Rs)', 'Shipping (Rs)', 'Total (Rs)', 'Payment', 'Customer name', 'Phone', 'Email', 'Address', 'City', 'State', 'Pincode', 'Notes', 'Account'],
      ...d.orders.slice().reverse().map((o) => [o.id, o.invoice_no, ist(o.created_at), o.status, (itemsBy[o.id] || []).join('; '), o.items_subtotal != null ? o.items_subtotal : o.subtotal, o.coupon_code, o.discount || 0, o.shipping, o.total, 'Cash on Delivery', o.name, o.phone, o.email, o.address, o.city, o.state, o.pincode, o.notes, o.user_id ? userEmail[o.user_id] || o.user_id : 'guest'])] },
    { name: 'Order items', rows: [['Order no.', 'Product ID', 'Product', 'Size', 'Unit price (Rs)', 'Qty', 'Line total (Rs)'], ...d.order_items.map((i) => [i.order_id, i.product_id, i.name, i.size, i.unit_price, i.qty, i.line_total])] },
    { name: 'Customers', rows: [['Customer ID', 'Name', 'Email', 'Joined (IST)', 'Last sign-in (IST)', 'Orders', 'Spent (Rs)'],
      ...d.users.map((u) => { const os = d.orders.filter((o) => o.user_id === u.id); return [u.id, u.name, u.email, ist(u.created_at), ist(u.last_login_at), os.length, os.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0)]; })] },
    { name: 'Login history', rows: [['Time (IST)', 'Email', 'Who', 'Event', 'Result', 'Reason', 'IP', 'Device', 'Browser details'], ...d.login_history.slice().reverse().map((l) => [ist(l.created_at), l.email, l.kind, l.event, l.success ? 'success' : 'failed', l.reason, l.ip, l.device, l.user_agent])] },
    { name: 'Subscribers', rows: [['Email', 'Source', 'Joined (IST)'], ...d.subscribers.map((s) => [s.email, s.source, ist(s.created_at)])] },
    { name: 'Messages', rows: [['Time (IST)', 'Name', 'Email', 'Phone', 'Subject', 'Message', 'Status'], ...d.messages.map((m) => [ist(m.created_at), m.name, m.email, m.phone, m.subject, m.body, m.status])] },
    { name: 'Coupons', rows: [['Code', 'Type', 'Value', 'Min order (Rs)', 'Max discount (Rs)', 'Expires (IST)', 'Usage limit', 'Used', 'Active', 'Note'], ...d.coupons.map((c) => [c.code, c.kind === 'percent' ? '% off' : 'Rs off', c.value, c.min_order, c.max_discount, ist(c.expires_at), c.usage_limit, c.used_count, c.active ? 'yes' : 'no', c.note])] },
    { name: 'Reviews', rows: [['Time (IST)', 'Product', 'Author', 'Rating', 'Title', 'Review', 'Status', 'Verified buyer'], ...d.reviews.map((r) => [ist(r.created_at), r.product_id, r.author, r.rating, r.title, r.body, r.status, r.verified ? 'yes' : 'no'])] },
    { name: 'Products', rows: [['ID', 'Name', 'Size', 'Category', 'Price (Rs)', 'MRP (Rs)', 'Stock', 'Visible'], ...d.products.map((p) => [p.id, p.name, p.size, p.category, p.price, p.mrp, p.stock, p.active ? 'yes' : 'no'])] }
  ];
  // v4 sheets: assistant chats, bargains, notifications
  try {
    const chats = (await env.DB.prepare('SELECT m.created_at, m.session_id, s.source, s.lang, m.role, m.text, m.intent, m.engine FROM chat_messages m LEFT JOIN chat_sessions s ON s.id = m.session_id ORDER BY m.id DESC LIMIT 5000').all()).results;
    sheets.push({ name: 'Chats', rows: [['Time (IST)', 'Chat', 'From', 'Language', 'Who', 'Message', 'Topic', 'Engine'], ...chats.map((c) => [ist(c.created_at), c.session_id, c.source, c.lang, c.role === 'bot' ? 'Assistant' : 'Customer', c.text, c.intent, c.engine])] });
    const bgs = (await env.DB.prepare('SELECT b.*, u.email FROM bargains b LEFT JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC LIMIT 5000').all()).results;
    sheets.push({ name: 'Bargains', rows: [['Time (IST)', 'Customer', 'Product', 'Status', 'List price (Rs)', 'Deal price (Rs)', 'Rounds', 'Coupon'], ...bgs.map((b) => [ist(b.created_at), b.email, b.product_id, b.status, b.list_price, b.agreed_price, b.rounds, b.coupon_code])] });
    const ns = (await env.DB.prepare('SELECT * FROM notifications ORDER BY id DESC').all()).results;
    sheets.push({ name: 'Notifications', rows: [['Created (IST)', 'Type', 'Title', 'Text', 'Link', 'Active', 'Ends (IST)'], ...ns.map((n) => [ist(n.created_at), n.kind, n.title, n.body, n.link, n.active ? 'yes' : 'no', ist(n.expires_at)])] });
  } catch (e) { /* older database: those sheets are skipped */ }
  const bytes = buildXlsx(sheets);
  return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${backupName('xlsx')}"`, 'Cache-Control': 'no-store', ...SEC_HEADERS } });
}
// restore = put back anything missing. Rows that already exist are left exactly as they are, so nothing current is overwritten or deleted.
async function restoreBackup(request, env) {
  await requireAdmin(env, request);
  const body = await readJson(request, 20 * 1024 * 1024);
  if (body.confirm !== 'RESTORE') throw new HttpError(400, 'confirm_required', 'Type RESTORE to confirm.', null, { confirm: 'Type RESTORE to confirm.' });
  const b = body.backup;
  if (!b || b.format !== 'avermontis-backup' || !b.data || typeof b.data !== 'object') throw new HttpError(400, 'bad_backup', 'This is not an Avermontis JSON backup file.');
  const report = {};
  for (const [t, cols] of Object.entries(BACKUP_TABLES)) {
    const rows = Array.isArray(b.data[t]) ? b.data[t] : [];
    let added = 0, skipped = 0;
    const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`;
    const stmtOf = (r) => env.DB.prepare(sql).bind(...cols.map((c) => (r[c] === undefined ? null : (typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]) : r[c]))));
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50).filter((r) => r && typeof r === 'object');
      try { const res = await env.DB.batch(chunk.map(stmtOf)); for (const x of res) { if (x.meta && x.meta.changes) added++; else skipped++; } }
      catch { for (const r of chunk) { try { const x = await stmtOf(r).run(); if (x.meta && x.meta.changes) added++; else skipped++; } catch { skipped++; } } }
    }
    report[t] = { in_file: rows.length, added, already_there_or_skipped: skipped };
  }
  return json(200, { ok: true, report });
}

// ---------- SEO: robots.txt, sitemap.xml, per-product meta + structured data ----------
const PAGES_FOR_SITEMAP = ['/', '/shop', '/shop/serums', '/shop/moisturisers', '/shop/cleansers', '/shop/sunscreens', '/shop/eye-care', '/collections', '/collections/morning-ritual', '/collections/evening-ritual', '/collections/serum-edit', '/concerns', '/ingredients', '/about', '/blog', '/guide-routine', '/guide-sunscreen', '/guide-serums', '/faq', '/contact', '/track', '/shipping', '/returns', '/privacy', '/terms'];
async function sitemap(request, env) {
  await ensureSchema(env);
  const o = new URL(request.url).origin;
  const prods = await dbProducts(env, request.url, false);
  const urls = [...PAGES_FOR_SITEMAP.map((p) => o + p), ...prods.map((p) => `${o}/product?id=${encodeURIComponent(p.id)}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${xmlEsc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ...SEC_HEADERS } });
}
function robots(request) {
  const o = new URL(request.url).origin;
  return new Response(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /account\nDisallow: /api/\nDisallow: /invoice/\nDisallow: /checkout\nDisallow: /reset\n\nSitemap: ${o}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ...SEC_HEADERS } });
}
async function productSeo(html, request, env) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  if (!/^[a-z0-9-]{2,60}$/.test(id)) return html;
  await ensureSchema(env);
  const r = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND active = 1').bind(id).first();
  if (!r) return html;
  const p = shapeProduct(r);
  const img = url.origin + '/' + String(p.image).replace(/^\//, '');
  const title = `${p.name}${p.size ? ' (' + p.size + ')' : ''} | Avermontis`;
  const desc = clamp(p.short || p.description || '', 160);
  const canonical = `${url.origin}/product?id=${p.id}`;
  const rs = await env.DB.prepare("SELECT COUNT(*) AS n, AVG(rating) AS a FROM reviews WHERE product_id = ? AND status = 'approved'").bind(id).first();
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: p.name, image: [img], description: p.description || p.short || '', sku: p.id, brand: { '@type': 'Brand', name: 'Avermontis' },
    offers: { '@type': 'Offer', url: canonical, priceCurrency: 'INR', price: String(p.price), availability: p.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', itemCondition: 'https://schema.org/NewCondition' } };
  if (rs && rs.n > 0) ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: String(Math.round(rs.a * 10) / 10), reviewCount: String(rs.n) };
  const head = `<title>${escHtml(title)}</title>\n<meta name="description" content="${escHtml(desc)}">\n<link rel="canonical" href="${escHtml(canonical)}">\n<meta property="og:type" content="product">\n<meta property="og:title" content="${escHtml(title)}">\n<meta property="og:description" content="${escHtml(desc)}">\n<meta property="og:image" content="${escHtml(img)}">\n<meta property="og:url" content="${escHtml(canonical)}">\n<meta name="twitter:card" content="summary_large_image">\n<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
  return html.replace(/<!--SEO-->[\s\S]*?<!--\/SEO-->/, head);
}

// ---------- router ----------
const ID = '([^/]+)';
const ROUTES = [
  ['GET', /^\/api\/health$/, async (r, env) => { await env.DB.prepare('SELECT 1').first(); return json(200, { ok: true, db: 'ok', time: nowIso() }); }],
  // public catalog + config
  ['GET', /^\/api\/catalog$/, catalogRoute],
  ['GET', /^\/api\/config$/, publicConfigV4],
  ['GET', /^\/api\/delivery$/, deliveryCheck],
  ['POST', /^\/api\/chat$/, chatRoute],
  ['GET', /^\/api\/notifications$/, notificationsRoute],
  ['POST', /^\/api\/bargain$/, bargainRoute],
  ['GET', new RegExp('^/api/products/' + ID + '/reviews$'), (r, env, u, m) => productReviews(r, env, decodeURIComponent(m[1]))],
  ['POST', new RegExp('^/api/products/' + ID + '/reviews$'), (r, env, u, m) => addReview(r, env, decodeURIComponent(m[1]))],
  ['POST', /^\/api\/quote$/, quoteRoute],
  ['POST', /^\/api\/track$/, trackOrder],
  ['POST', /^\/api\/newsletter$/, newsletter],
  ['POST', /^\/api\/contact$/, contactForm],
  // customer auth + account (own data only)
  ['POST', /^\/api\/auth\/signup$/, signup],
  ['POST', /^\/api\/auth\/login$/, loginV5],
  ['POST', /^\/api\/auth\/logout$/, (r, env) => logout(r, env, 'customer')],
  ['POST', /^\/api\/auth\/forgot$/, forgotPassword],
  ['POST', /^\/api\/auth\/reset$/, resetPassword],
  ['GET', /^\/api\/auth\/me$/, async (r, env) => json(200, { ok: true, user: await currentUser(env, r) })],
  ['GET', /^\/api\/account\/orders$/, myOrdersV2],
  ['GET', new RegExp('^/api/account/orders/' + ID + '$'), (r, env, u, m) => myOrder(r, env, decodeURIComponent(m[1]))],
  ['GET', /^\/api\/account\/logins$/, myLogins],
  ['GET', /^\/api\/account\/wishlist$/, wishlistGet],
  ['POST', /^\/api\/account\/wishlist$/, wishlistAdd],
  ['DELETE', new RegExp('^/api/account/wishlist/' + ID + '$'), (r, env, u, m) => wishlistRemove(r, env, decodeURIComponent(m[1]))],
  ['POST', /^\/api\/orders$/, createOrderV2],
  // owner (admin session required on every route below, checked on the server)
  ['GET', /^\/api\/admin\/setup-status$/, async (r, env) => json(200, { ok: true, setup_open: await adminSetupOpen(env) })],
  ['POST', /^\/api\/admin\/setup$/, adminSetup],
  ['POST', /^\/api\/admin\/login$/, adminLoginV5],
  ['POST', /^\/api\/admin\/logout$/, (r, env) => logout(r, env, 'admin')],
  ['GET', /^\/api\/admin\/me$/, async (r, env) => { await requireAdmin(env, r); return json(200, { ok: true, admin: true }); }],
  ['GET', /^\/api\/admin\/stats$/, adminStatsV2],
  ['GET', /^\/api\/admin\/sales$/, adminSales],
  ['GET', /^\/api\/admin\/orders$/, adminOrdersV2],
  ['PATCH', new RegExp('^/api/admin/orders/' + ID + '$'), (r, env, u, m) => adminSetStatusV2(r, env, decodeURIComponent(m[1]))],
  ['DELETE', new RegExp('^/api/admin/orders/' + ID + '$'), (r, env, u, m) => adminDeleteOrderV2(r, env, decodeURIComponent(m[1]))],
  ['GET', /^\/api\/admin\/customers$/, adminCustomers],
  ['POST', new RegExp('^/api/admin/customers/(\\d+)/reset-link$'), (r, env, u, m) => adminResetLink(r, env, m[1])],
  ['GET', /^\/api\/admin\/resets$/, adminResets],
  ['GET', /^\/api\/admin\/logins$/, adminLogins],
  ['GET', /^\/api\/admin\/products$/, adminProducts],
  ['POST', /^\/api\/admin\/products$/, (r, env) => adminSaveProduct(r, env, null)],
  ['PUT', new RegExp('^/api/admin/products/' + ID + '$'), (r, env, u, m) => adminSaveProduct(r, env, decodeURIComponent(m[1]))],
  ['POST', /^\/api\/admin\/upload$/, adminUploadV4],
  ['GET', /^\/api\/admin\/coupons$/, adminCoupons],
  ['POST', /^\/api\/admin\/coupons$/, adminCreateCoupon],
  ['PATCH', new RegExp('^/api/admin/coupons/' + ID + '$'), (r, env, u, m) => adminUpdateCoupon(r, env, decodeURIComponent(m[1]))],
  ['DELETE', new RegExp('^/api/admin/coupons/' + ID + '$'), (r, env, u, m) => adminDeleteCoupon(r, env, decodeURIComponent(m[1]))],
  ['GET', /^\/api\/admin\/reviews$/, adminReviews],
  ['PATCH', /^\/api\/admin\/reviews\/(\d+)$/, (r, env, u, m) => adminModerateReview(r, env, m[1])],
  ['DELETE', /^\/api\/admin\/(reviews|subscribers|messages)\/(\d+)$/, (r, env, u, m) => adminDeleteRow(r, env, m[1], m[2])],
  ['GET', /^\/api\/admin\/subscribers$/, adminSubscribers],
  ['GET', /^\/api\/admin\/messages$/, adminMessages],
  ['PATCH', /^\/api\/admin\/messages\/(\d+)$/, (r, env, u, m) => adminMarkMessage(r, env, m[1])],
  ['GET', /^\/api\/admin\/settings$/, adminGetSettings],
  ['PUT', /^\/api\/admin\/settings$/, adminPutSettings],
  ['POST', /^\/api\/admin\/email-test$/, adminEmailTest],
  ['POST', /^\/api\/internal\/email-seed$/, emailSeed],
  ['GET', /^\/api\/admin\/export\/orders\.csv$/, exportOrders],
  ['GET', /^\/api\/admin\/export\/logins\.csv$/, exportLogins],
  ['GET', /^\/api\/admin\/export\/subscribers\.csv$/, exportSubscribers],
  ['GET', /^\/api\/admin\/backup\.xlsx$/, backupXlsx],
  ['GET', /^\/api\/admin\/backup\.json$/, backupJson],
  ['POST', /^\/api\/admin\/restore$/, restoreBackup],
  // v4
  ['GET', /^\/api\/admin\/ui$/, adminGetUi],
  ['PUT', /^\/api\/admin\/ui\/([a-z]+)$/, (r, env, u, m) => adminPutUiV5(r, env, m[1])],
  ['DELETE', /^\/api\/admin\/ui\/([a-z]+)$/, (r, env, u, m) => adminResetUiV5(r, env, m[1])],
  ['POST', /^\/api\/admin\/ui-preview$/, adminUiPreview],
  ['GET', /^\/api\/admin\/insights$/, adminInsights],
  ['GET', /^\/api\/admin\/chats$/, adminChats],
  ['POST', /^\/api\/admin\/chat-test$/, adminChatTest],
  ['GET', /^\/api\/admin\/notifications$/, adminNotifications],
  ['POST', /^\/api\/admin\/notifications$/, adminCreateNotification],
  ['PATCH', /^\/api\/admin\/notifications\/(\d+)$/, (r, env, u, m) => adminPatchNotification(r, env, m[1])],
  ['GET', /^\/api\/admin\/bargains$/, adminBargains],
  ['PUT', new RegExp('^/api/admin/products/' + ID + '/bargain$'), (r, env, u, m) => adminProductBargain(r, env, decodeURIComponent(m[1]))],
  ['PUT', new RegExp('^/api/admin/products/' + ID + '/ar$'), (r, env, u, m) => adminProductAr(r, env, decodeURIComponent(m[1]))],
  ['GET', new RegExp('^/api/admin/orders/' + ID + '/events$'), (r, env, u, m) => adminOrderEvents(r, env, decodeURIComponent(m[1]))],
  ['PUT', new RegExp('^/api/admin/orders/' + ID + '/note$'), (r, env, u, m) => adminOrderNote(r, env, decodeURIComponent(m[1]))]
];

async function handleApi(request, env, url, ctx) {
  const matches = ROUTES.filter((r) => r[1].test(url.pathname));
  if (!matches.length) return fail(404, 'not_found', 'No such route.');
  const route = matches.find((r) => r[0] === request.method);
  if (!route) return fail(405, 'method_not_allowed', 'Use ' + matches.map((r) => r[0]).join(' or ') + '.', { Allow: matches.map((r) => r[0]).join(', ') });
  try {
    await ensureSchema(env);
    if (!['GET', 'HEAD'].includes(request.method) && !/\/(signup|login|setup|orders)$/.test(url.pathname)) {
      await rateLimit(env, 'api', clientIp(request), API_LIMIT, API_WINDOW_S);
    }
    const res = await route[2](request, env, url, url.pathname.match(route[1]), ctx);
    if (!['GET', 'HEAD'].includes(request.method) && res && res.status < 400 && /^\/api\/admin\//.test(url.pathname)) await writeAudit(env, request, url, res.status);
    return res;
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.code, e.message, e.extra, e.fields);
    console.log(JSON.stringify({ level: 'error', path: url.pathname, method: request.method, error: String(e && e.message || e).slice(0, 200) }));
    return fail(500, 'server_error', 'Something went wrong on our side. Please try again.');
  }
}

function withHeaders(res, url) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v);
  if ((h.get('content-type') || '').includes('text/html')) { h.set('Content-Security-Policy', /^\/ar(\/|$)/.test(url.pathname) ? CSP_AR : /^\/app(\/|$)/.test(url.pathname) ? CSP_AR.replace("frame-ancestors 'none'", "frame-ancestors 'self'") : CSP); h.set('Cache-Control', 'no-cache'); }
  if (/^\/(ar|app)(\/|$)/.test(url.pathname)) h.set('Permissions-Policy', 'camera=(self), xr-spatial-tracking=(self), microphone=(), geolocation=(), payment=()');
  if (/^\/admin(\/|$)/.test(url.pathname)) {   // the dashboard itself can never be framed; shop pages can be framed by the dashboard's live preview only
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=()'); h.set('X-Frame-Options', 'DENY');
    if (h.get('Content-Security-Policy')) h.set('Content-Security-Policy', h.get('Content-Security-Policy').replace("frame-ancestors 'self'", "frame-ancestors 'none'"));
  }
  if (/^\/(admin|account|login|signup|reset|forgot|checkout|order-success|track)/.test(url.pathname)) { h.set('Cache-Control', 'no-store'); }
  if (/^\/(admin|account|reset|forgot|order-success|download\/admin)/.test(url.pathname)) h.set('X-Robots-Tag', 'noindex, nofollow');
  if (/^\/download\/admin/.test(url.pathname)) h.set('Cache-Control', 'no-store');
  if (/^\/(assets|img|icons)\//.test(url.pathname) && !/\.html$/.test(url.pathname)) h.set('Cache-Control', 'public, max-age=86400');
  // v4 AR files are also loaded by the installed app (its pages run from the phone, a different origin)
  if (/^\/assets\/ar\//.test(url.pathname)) {
    h.set('Access-Control-Allow-Origin', '*'); h.set('Cross-Origin-Resource-Policy', 'cross-origin');
    const ext = (url.pathname.match(/\.([a-z0-9]+)$/i) || [])[1];
    const types = { glb: 'model/gltf-binary', mind: 'application/octet-stream', wasm: 'application/wasm', tflite: 'application/octet-stream', mjs: 'text/javascript; charset=utf-8', js: 'text/javascript; charset=utf-8', task: 'application/octet-stream' };
    if (ext && types[ext.toLowerCase()]) h.set('Content-Type', types[ext.toLowerCase()]);
  }
  // app (PWA) files: always re-checked so an update reaches installed phones on the next open
  if (url.pathname === '/sw.js') { h.set('Cache-Control', 'no-cache'); h.set('Service-Worker-Allowed', '/'); h.set('Content-Type', 'text/javascript; charset=utf-8'); }
  if (url.pathname === '/manifest.webmanifest') { h.set('Cache-Control', 'no-cache'); h.set('Content-Type', 'application/manifest+json; charset=utf-8'); }
  if (url.pathname === '/assets/pwa.js' || url.pathname === '/assets/pwa-boot.js' || url.pathname.startsWith('/assets/m/')) h.set('Cache-Control', 'no-cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (isAppRequest(request)) {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
        // v6: the customer app has no owner area at all - every owner API answers "not found" to it
        const res = /^\/api\/(admin(\/|$)|auth\/admin)/.test(url.pathname) ? fail(403, 'forbidden', 'Owner access only.') : await handleApi(request, env, url, ctx);
        const h = new Headers(res.headers); for (const [k, v] of Object.entries(corsHeaders(request))) h.set(k, v);
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
      }
      return handleApi(request, env, url, ctx);
    }
    if (url.pathname === '/robots.txt') return robots(request);
    // Android app (Trusted Web Activity) proof that the app and this site belong together: lets the app open full-screen
    if (url.pathname === '/.well-known/assetlinks.json') return new Response(ASSET_LINKS, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*', ...SEC_HEADERS } });
    // the Android app as a direct download (e-mail services refuse .apk attachments); the file sits at /_dl/ so this route
    // (not the static file server) answers and can name the type and the file name
    // v4: AR files for the installed app. Static files skip the Worker, so the app loads them through this path, which adds CORS.
    if (url.pathname.startsWith('/ar-files/') && (request.method === 'GET' || request.method === 'HEAD')) {
      const rest = url.pathname.slice('/ar-files/'.length);
      if (!/^[A-Za-z0-9_./-]+$/.test(rest) || rest.includes('..')) return withHeaders(new Response('Not found', { status: 404 }), url);
      const f = await env.ASSETS.fetch(new Request(url.origin + '/assets/ar/' + rest, { method: request.method }));
      const h = new Headers(f.headers);
      h.set('Access-Control-Allow-Origin', '*'); h.set('Cross-Origin-Resource-Policy', 'cross-origin'); h.set('Cache-Control', 'public, max-age=86400'); h.set('X-Content-Type-Options', 'nosniff');
      const ext = (rest.match(/\.([a-z0-9]+)$/i) || [])[1];
      const types = { glb: 'model/gltf-binary', mind: 'application/octet-stream', wasm: 'application/wasm', tflite: 'application/octet-stream', mjs: 'text/javascript; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', png: 'image/png' };
      if (ext && types[ext.toLowerCase()]) h.set('Content-Type', types[ext.toLowerCase()]);
      return new Response(f.status === 404 ? 'Not found' : f.body, { status: f.status, headers: h });
    }
    if (url.pathname === '/download/avermontis.apk' && (request.method === 'GET' || request.method === 'HEAD')) {
      const f = await env.ASSETS.fetch(new Request(url.origin + '/_dl/avermontis.apk', { method: request.method }));
      if (f.status === 200) {
        const h = new Headers(f.headers); h.set('Content-Type', 'application/vnd.android.package-archive');
        h.set('Content-Disposition', 'attachment; filename="AVERMONTIS.apk"'); h.set('Cache-Control', 'no-cache'); h.set('X-Robots-Tag', 'noindex');
        for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v);
        return new Response(f.body, { status: 200, headers: h });
      }
    }
    // v6: the owner's "Avermontis Admin" app - a separate, unlisted download (the page is noindex and linked from nowhere)
    if (url.pathname === '/download/avermontis-admin.apk' && (request.method === 'GET' || request.method === 'HEAD')) {
      const f = await env.ASSETS.fetch(new Request(url.origin + '/_dl/avermontis-admin.apk', { method: request.method }));
      if (f.status === 200) {
        const h = new Headers(f.headers); h.set('Content-Type', 'application/vnd.android.package-archive');
        h.set('Content-Disposition', 'attachment; filename="Avermontis-Admin.apk"'); h.set('Cache-Control', 'no-cache'); h.set('X-Robots-Tag', 'noindex, nofollow');
        for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v);
        return new Response(f.body, { status: 200, headers: h });
      }
    }
    if (url.pathname === '/sitemap.xml') { try { return await sitemap(request, env); } catch { return new Response('', { status: 503 }); } }
    let m = url.pathname.match(/^\/invoice\/([A-Za-z0-9-]{6,30})$/);
    if (m) { try { return await invoicePage(request, env, m[1].toUpperCase()); } catch { return new Response('Something went wrong. Please try again.', { status: 500, headers: htmlHeaders() }); } }
    m = url.pathname.match(/^\/media\/(.+)$/);
    if (m) { const r = await serveMediaV4(request, env, m[1]).catch(() => null); if (r) return r; }
    if (url.pathname === '/manifest.webmanifest' && request.method === 'GET') { const r = await manifestV4(request, env).catch(() => null); if (r) return withHeaders(r, url); }
    if (url.pathname === '/admin/' || url.pathname === '/admin/index.html') return Response.redirect(url.origin + '/admin', 301);
    if (url.pathname === '/admin/handoff') return Response.redirect(url.origin + '/admin', 302);   // v6: hand-off retired
    // HTML pages live in /_pages/ so every page passes through here and gets the security headers.
    let res, isPage = false;
    let name = url.pathname.replace(/\.html$/, '');
    if (name === '/' || name === '/index') name = '/index';
    if (/^\/[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(name) && !name.startsWith('/_pages')) {
      res = await env.ASSETS.fetch(new Request(url.origin + '/_pages' + (name === '/index' ? '/' : name), { method: request.method === 'HEAD' ? 'HEAD' : 'GET' }));
      isPage = res.status === 200;
      if (isPage && name === '/product' && request.method !== 'HEAD') {
        try { const html = await productSeo(await res.clone().text(), request, env); res = new Response(html, { status: 200, headers: res.headers }); } catch { /* serve the page without the extra tags */ }
      }
      // v4: the owner's live look (colours, fonts, layout, logo, hero, banners) + the assistant on every shop page
      if (isPage && request.method !== 'HEAD' && !/^\/(admin|app|offline|design)(\/|$)/.test(name)) {
        try {
          await ensureSchema(env);
          const [ui, cfg] = await Promise.all([getUi(env), getSettings(env)]);
          const html = personalizePage(await res.clone().text(), ui, cfg, name);
          res = new Response(html, { status: 200, headers: res.headers });
        } catch (e) { /* serve the page as built */ }
      }
    }
    if (!isPage) {
      res = await env.ASSETS.fetch(request);
      if (res.status === 404) {
        const nf = await env.ASSETS.fetch(new Request(url.origin + '/_pages/404'));
        res = new Response(nf.body, { status: 404, headers: nf.headers });
      }
    }
    return withHeaders(res, url);
  }
};



// =====================================================================================================================
// v4 (Oct 2026): live customisation (colours, fonts, layout, logo, store info, location, delivery areas) for the website
// AND the installed app (it reads /api/config at launch), store assistant (chat), notifications, insights, bargaining.
// Additive only: new tables + columns. Nothing existing is dropped or rewritten.
// =====================================================================================================================
export const MIGRATION_3_SQL = `-- 0003_v4.sql : chat, notifications, bargaining (+ columns on coupons, products, orders)
CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, user_id INTEGER, lang TEXT, source TEXT, ip TEXT, msgs INTEGER NOT NULL DEFAULT 0, handoff INTEGER NOT NULL DEFAULT 0, ctx TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS chat_sessions_updated ON chat_sessions (updated_at DESC);
CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('user','bot')), text TEXT NOT NULL, intent TEXT, engine TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS chat_messages_session ON chat_messages (session_id, id);
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT, link TEXT, kind TEXT NOT NULL DEFAULT 'news', active INTEGER NOT NULL DEFAULT 1, expires_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bargains (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','agreed','declined','closed')), list_price INTEGER NOT NULL, rounds INTEGER NOT NULL DEFAULT 0, last_offer INTEGER, counter INTEGER, agreed_price INTEGER, coupon_code TEXT, log TEXT NOT NULL DEFAULT '[]', ip TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS bargains_user ON bargains (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bargains_created ON bargains (created_at DESC);
`;
const V3_COLS = [['coupons', 'product_id', 'TEXT'], ['coupons', 'user_id', 'INTEGER'], ['coupons', 'source', 'TEXT'], ['products', 'bargain', 'TEXT'], ['products', 'ar', 'TEXT'],
  ['orders', 'admin_note', 'TEXT'], ['orders', 'refund_note', 'TEXT']];
async function migrateV3(env) {
  const have = await env.DB.prepare('SELECT version FROM schema_migrations WHERE version = 3').first();
  if (have) return;
  const stmts = splitSql(MIGRATION_3_SQL).map((q) => env.DB.prepare(q));
  for (const t of ['coupons', 'products', 'orders']) {
    const cols = (await env.DB.prepare(`PRAGMA table_info(${t})`).all()).results.map((c) => c.name);
    for (const [tt, c, type] of V3_COLS) if (tt === t && !cols.includes(c)) stmts.push(env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`));
  }
  stmts.push(env.DB.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (3, datetime('now'))"));
  await env.DB.batch(stmts);
}

// ---------- live UI settings ----------
export const HOME_WEB_SECTIONS = ['hero', 'banners', 'story', 'categories', 'collection', 'concerns', 'ingredients', 'routine', 'closing'];
export const HOME_APP_SECTIONS = ['banners', 'today', 'picks', 'ar', 'order', 'explore', 'ingredient'];
export const THEME_PRESETS = {
  obsidian: { label: 'Obsidian & Gold (original)', primary: '#0B0C0B', accent: '#C6A16A', background: '#F5F0E7', text: '#252522' },
  avr_green: { label: 'AVR Green', primary: '#123F2E', accent: '#C6A16A', background: '#F7F6F1', text: '#1E2A24' },
  rose: { label: 'Rose Quartz', primary: '#2E2224', accent: '#C9908A', background: '#FBF3F0', text: '#2E2224' },
  midnight: { label: 'Midnight & Champagne', primary: '#0E1726', accent: '#CDAE79', background: '#F4F2EE', text: '#1C2433' },
  sage: { label: 'Sage & Sand', primary: '#26352C', accent: '#A8B58F', background: '#F3F1EA', text: '#26352C' },
  pearl: { label: 'Pearl White', primary: '#2B2B2B', accent: '#B89B72', background: '#FFFFFF', text: '#222222' },
  // v5 ready-made themes (a preset may also set fonts, light/dark and corners)
  classic_gold: { label: 'Classic Gold', primary: '#14110C', accent: '#B8913F', background: '#FAF6EC', text: '#221D14', heading_font: 'playfair', body_font: 'system', site_mode: 'light', app_mode: 'dark', radius: 'sharp' },
  fresh_green: { label: 'Fresh Green', primary: '#1F5E3B', accent: '#3E9B5F', background: '#F4FAF5', text: '#17301F', heading_font: 'montserrat', body_font: 'poppins', site_mode: 'light', app_mode: 'light', radius: 'round' },
  minimal_white: { label: 'Minimal White', primary: '#111111', accent: '#555555', background: '#FFFFFF', text: '#111111', heading_font: 'montserrat', body_font: 'system', site_mode: 'light', app_mode: 'light', radius: 'soft' },
  dark_luxe: { label: 'Dark Luxe', primary: '#0A0A0C', accent: '#D4AF6A', background: '#F3EEE4', text: '#1A1814', heading_font: 'dmserif', body_font: 'montserrat', site_mode: 'dark', app_mode: 'dark', radius: 'sharp' },
  rose_blush: { label: 'Rose', primary: '#4A2530', accent: '#C76B7E', background: '#FFF5F6', text: '#3A1F27', heading_font: 'lora', body_font: 'poppins', site_mode: 'light', app_mode: 'light', radius: 'round' },
  desi_hindi: { label: 'Saffron (Hindi-ready)', primary: '#3B1F0E', accent: '#E07B24', background: '#FFF8EF', text: '#2B190C', heading_font: 'rozha', body_font: 'hind', site_mode: 'light', app_mode: 'light', radius: 'soft' }
};
export const FONTS = { heading: ['cormorant', 'playfair', 'georgia', 'system', 'poppins', 'montserrat', 'lora', 'dmserif', 'hind', 'mukta', 'noto', 'rozha'], body: ['system', 'poppins', 'georgia', 'montserrat', 'lora', 'hind', 'mukta', 'noto'] };
export const APP_ICONS = ['avr', 'avr_gold', 'avr_green', 'classic'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const UI_DEFAULTS = {
  theme: { preset: 'obsidian', primary: '#0B0C0B', accent: '#C6A16A', background: '#F5F0E7', text: '#252522', site_mode: 'light', app_mode: 'dark', heading_font: 'cormorant', body_font: 'system', radius: 'sharp',
    secondary: '', surface: '', button_bg: '', button_text: '', link: '', header_bg: '', header_text: '', footer_bg: '', footer_text: '', success: '', error: '',
    dark_background: '', dark_surface: '', dark_text: '', dark_accent: '', font_scale: 100, heading_weight: '', body_weight: '' },
  style: { grid_mobile: 2, grid_desktop: 4, app_grid: 2, card_radius: null, card_shadow: 'none', card_border: true, button_shape: 'default', header_layout: 'left', density: 'comfortable',
    animations: true, announce_text: '', announce_bg: '', announce_fg: '', bottom_nav: ['home', 'routine', 'diary', 'shop', 'me'], custom_css: '' },
  layout: { home_web: HOME_WEB_SECTIONS.map((id) => ({ id, on: true })), home_app: HOME_APP_SECTIONS.map((id) => ({ id, on: true })) },
  brand: { store_name: 'AVERMONTIS', tagline: '', logo_url: '', favicon_url: '', app_icon: 'avr' },
  hero: { eyebrow: '', title: '', subtitle: '', cta_text: '', cta_link: '', image: '' },
  banners: [],
  contact: { phone: '', email: '', instagram: '', facebook: '', youtube: '' },
  location: { show: false, name: '', address: '', city: '', pincode: '', lat: null, lng: null, hours: DAY_KEYS.map((d) => ({ day: d, open: '10:00', close: '18:00', closed: d === 'sun' })), note: '' },
  delivery: { mode: 'all', areas: '', message: '' },
  features: { chat: true, ar: true, bargain: true, notifications: true, wishlist: true },
  chat: { name: 'AVERMONTIS Assistant', greeting: '', provider: '', model: '' },
  ar: { viewer: true, selfie: true, scan: true, caption: 'My AVERMONTIS glow' },
  bargain: { on: true, deal_minutes: 30, per_customer_daily: 3, daily_cap: 50, max_discount_pct: 10, start_discount_pct: 3, max_rounds: 4 }
};
const UI_SECTIONS = Object.keys(UI_DEFAULTS);
let uiCache = { at: 0, v: null };
const UI_TTL_MS = 15000;
function mergeUi(saved) {
  const out = {};
  for (const k of UI_SECTIONS) {
    const d = UI_DEFAULTS[k], s = saved[k];
    if (Array.isArray(d)) out[k] = Array.isArray(s) ? s : d;
    else out[k] = { ...d, ...(s && typeof s === 'object' && !Array.isArray(s) ? s : {}) };
  }
  // layouts: keep every known section exactly once (new sections appear at the end, unknown ones are dropped)
  for (const [k, all] of [['home_web', HOME_WEB_SECTIONS], ['home_app', HOME_APP_SECTIONS]]) {
    const list = Array.isArray(out.layout[k]) ? out.layout[k].filter((x) => x && all.includes(x.id)) : [];
    const seen = new Set(); const clean = [];
    for (const x of list) if (!seen.has(x.id)) { seen.add(x.id); clean.push({ id: x.id, on: x.on !== false }); }
    for (const id of all) if (!seen.has(id)) clean.push({ id, on: true });
    out.layout[k] = clean;
  }
  return out;
}
export async function getUi(env, fresh) {
  if (!fresh && uiCache.v && Date.now() - uiCache.at < UI_TTL_MS) return uiCache.v;
  const rows = (await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'ui:%'").all()).results;
  const saved = {};
  for (const r of rows) saved[r.key.slice(3)] = jparse(r.value, null);
  const v = mergeUi(saved);
  uiCache = { at: Date.now(), v };
  return v;
}

// colour helpers (themes are computed on the server for the website and in the app for the app)
const HEX = /^#[0-9A-Fa-f]{6}$/;
function rgbOf(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function hexOf(r) { return '#' + r.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join(''); }
export function mixHex(a, b, t) { const x = rgbOf(a), y = rgbOf(b); return hexOf(x.map((v, i) => v + (y[i] - v) * t)); }
function rgba(h, a) { const r = rgbOf(h); return `rgba(${r[0]},${r[1]},${r[2]},${a})`; }
function hsl(h) { let [r, g, b] = rgbOf(h).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let hh = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh /= 6; } return [hh, s, l]; }
function fromHsl(hh, s, l) { const f = (n) => { const k = (n + hh * 12) % 12, a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }; return hexOf([f(0), f(8), f(4)]); }
export function withLightness(h, fn) { const [a, s, l] = hsl(h); return fromHsl(a, s, Math.max(0, Math.min(1, fn(l)))); }
export function luminance(h) { const c = rgbOf(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
export function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const FONT_FACES = {
  playfair: '@font-face{font-family:"Playfair Display";src:url(/assets/fonts/playfair-600.woff2) format("woff2");font-weight:500 700;font-display:swap}',
  poppins: '@font-face{font-family:"Poppins";src:url(/assets/fonts/poppins-400.woff2) format("woff2");font-weight:400;font-display:swap}@font-face{font-family:"Poppins";src:url(/assets/fonts/poppins-600.woff2) format("woff2");font-weight:500 700;font-display:swap}'
};
const HEADING_STACK = { cormorant: '"Cormorant","Cormorant Garamond",Georgia,"Times New Roman",serif', playfair: '"Playfair Display",Georgia,serif', georgia: 'Georgia,"Times New Roman",serif', system: 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif' };
const BODY_STACK = { system: '"Inter",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif', poppins: '"Poppins",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif', georgia: 'Georgia,"Times New Roman",serif' };
// website variables for a theme. The original preset returns nothing, so the site looks exactly as before.
export function siteThemeVars(t) {
  const d = UI_DEFAULTS.theme;
  const same = ['primary', 'accent', 'background', 'text'].every((k) => String(t[k]).toUpperCase() === d[k].toUpperCase()) && t.site_mode !== 'dark';
  const v = {};
  if (!same) {
    const P = t.primary, A = t.accent, B = t.background, T = t.text;
    if (t.site_mode === 'dark') {
      const fg = luminance(B) > 0.5 ? B : '#F5F0E7';
      Object.assign(v, { '--bg': P, '--bg2': mixHex(P, '#ffffff', 0.04), '--surface': mixHex(P, '#ffffff', 0.07), '--surface2': mixHex(P, '#ffffff', 0.11), '--line': rgba(fg, 0.12), '--line2': rgba(fg, 0.22),
        '--text': fg, '--text2': mixHex(fg, P, 0.12), '--muted': mixHex(fg, P, 0.38), '--accent': withLightness(A, (l) => Math.max(l, 0.62)), '--green': A, '--green-d': withLightness(A, (l) => l - 0.07),
        '--forest': mixHex(P, '#000000', 0.35), '--obsidian': mixHex(P, '#000000', 0.35), '--ivory': fg, '--ink': fg, '--charcoal': fg, '--gold': A, '--stone': mixHex(A, P, 0.5) });
    } else {
      Object.assign(v, { '--bg': B, '--bg2': mixHex(B, T, 0.035), '--surface': mixHex(B, '#ffffff', 0.45), '--surface2': mixHex(B, T, 0.07), '--line': rgba(T, 0.12), '--line2': rgba(T, 0.22),
        '--text': T, '--text2': mixHex(T, B, 0.12), '--muted': mixHex(T, B, 0.34), '--accent': withLightness(A, (l) => Math.min(l, 0.33)), '--green': A, '--green-d': withLightness(A, (l) => l - 0.07),
        '--forest': P, '--obsidian': P, '--ivory': B, '--ink': T, '--charcoal': T, '--gold': A, '--stone': mixHex(A, B, 0.55) });
    }
  }
  if (t.heading_font && t.heading_font !== d.heading_font && HEADING_STACK[t.heading_font]) v['--serif'] = HEADING_STACK[t.heading_font];
  if (t.body_font && t.body_font !== d.body_font && BODY_STACK[t.body_font]) v['--sans'] = BODY_STACK[t.body_font];
  if (t.radius === 'soft') { v['--r'] = '10px'; v['--rs'] = '8px'; } else if (t.radius === 'round') { v['--r'] = '18px'; v['--rs'] = '14px'; }
  return v;
}
export function siteThemeCss(ui) {
  const t = ui.theme, v = siteThemeVars(t);
  let css = '';
  if (t.heading_font === 'playfair') css += FONT_FACES.playfair;
  if (t.body_font === 'poppins') css += FONT_FACES.poppins;
  const keys = Object.keys(v);
  if (keys.length) css += ':root{' + keys.map((k) => k + ':' + v[k]).join(';') + '}';
  if (t.site_mode === 'dark') css += 'body{color-scheme:dark}.site-header,.announce{background:var(--bg)}';
  if (keys.includes('--r')) css += '.btn,.card,.field input,.field select,.field textarea,.cat-tile,.p-card,.product-card{border-radius:var(--r)}';
  // home page section order / visibility
  const lay = ui.layout.home_web, def = HOME_WEB_SECTIONS;
  const changed = lay.some((x, i) => !x.on || x.id !== def[i]);
  if (changed) {
    css += 'body.home main#main{display:flex;flex-direction:column}';
    lay.forEach((x, i) => { css += `body.home [data-sec="${x.id}"]{order:${i + 1}${x.on ? '' : ';display:none!important'}}`; });
  }
  return css + siteV5Css(ui);
}
const safeLink = (u) => { u = String(u || '').trim(); return /^(\/(?!\/)[^\s]*|https:\/\/[^\s]+)$/.test(u) ? u : ''; };
const safeImg = (u) => { u = String(u || '').trim(); return /^(\/(media|img|assets)\/[A-Za-z0-9_./-]+)$/.test(u) ? u : ''; };
// the public part of the live config (website + app); never contains keys, floors or private notes
export function publicUi(ui) {
  const loc = ui.location;
  return {
    theme: ui.theme, layout: ui.layout, brand: ui.brand, hero: ui.hero,
    banners: ui.banners.filter((b) => b && b.on !== false && (b.title || b.image)).map((b) => ({ title: b.title || '', text: b.text || '', image: safeImg(b.image), link: safeLink(b.link), cta: b.cta || '' })),
    contact: ui.contact,
    location: loc.show ? { name: loc.name, address: loc.address, city: loc.city, pincode: loc.pincode, lat: loc.lat, lng: loc.lng, hours: loc.hours, note: loc.note,
      open_now: openNow(loc.hours) } : null,
    delivery: { mode: ui.delivery.mode, message: ui.delivery.message },
    features: ui.features, chat: { name: ui.chat.name, greeting: ui.chat.greeting, ai: false },
    ar: ui.ar, bargain: { on: !!(ui.bargain.on && ui.features.bargain) },
    style: ui.style, app_css: appThemeCss(ui)
  };
}
export function openNow(hours, now = Date.now()) {
  if (!Array.isArray(hours) || hours.length !== 7) return null;
  const ist = new Date(now + 330 * 60000); const day = (ist.getUTCDay() + 6) % 7; const h = hours[day];
  if (!h || h.closed) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const toM = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const o = toM(h.open), c = toM(h.close); if (o == null || c == null) return null;
  return c > o ? mins >= o && mins < c : mins >= o || mins < c;
}
export function uiVersion(pub) { let h = 0; const s = JSON.stringify(pub); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

// ---------- delivery areas ----------
// areas: "221001, 221002" exact pincodes, "221*" or "221" a prefix, "221001-221099" a range; mode all | list | except
export function parseAreas(text) {
  const out = []; const bad = [];
  for (const tok of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    let m;
    if ((m = /^(\d{6})-(\d{6})$/.exec(tok)) && +m[1] <= +m[2]) out.push({ from: +m[1], to: +m[2] });
    else if ((m = /^(\d{1,5})\*?$/.exec(tok))) out.push({ prefix: m[1] });
    else if (/^\d{6}$/.test(tok)) out.push({ from: +tok, to: +tok });
    else bad.push(tok);
  }
  return { areas: out, bad };
}
export function pincodeServiceable(delivery, pin) {
  pin = String(pin || '').trim();
  if (!/^[1-9][0-9]{5}$/.test(pin)) return { ok: false, valid: false };
  if (!delivery || delivery.mode === 'all') return { ok: true, valid: true };
  const { areas } = parseAreas(delivery.areas);
  const hit = areas.some((a) => (a.prefix ? pin.startsWith(a.prefix) : +pin >= a.from && +pin <= a.to));
  return { ok: delivery.mode === 'list' ? hit : !hit, valid: true };
}
async function deliveryCheck(request, env, url) {
  await rateLimit(env, 'pin', clientIp(request), 60, 600);
  const ui = await getUi(env);
  const pin = url.searchParams.get('pincode') || '';
  const r = pincodeServiceable(ui.delivery, pin);
  if (!r.valid) throw new HttpError(400, 'invalid_input', 'Enter a valid 6-digit pincode.', null, { pincode: 'Enter a valid 6-digit pincode.' });
  const { settings } = await loadCatalog(env, request.url);
  return json(200, { ok: true, pincode: pin, serviceable: r.ok, cod: r.ok,
    message: r.ok ? `Delivery available to ${pin} \u00B7 usually 4\u20138 working days \u00B7 Cash on Delivery` : (ui.delivery.message || `Sorry, we don't deliver to ${pin} yet.`),
    free_shipping_from: settings.free_shipping_from });
}

// ---------- the public config ----------
async function publicConfigV4(request, env) {
  const s = await getSettings(env);
  const { settings } = await loadCatalog(env, request.url);
  const ui = await getUi(env);
  const pub = publicUi(ui);
  pub.chat.ai = !!(await llmConfig(env, ui)).key;
  return json(200, { ok: true, config: { whatsapp_number: s.whatsapp_number || '', announcement: s.announcement || '', support_email: s.support_email, gstin: s.gstin || '', gst_rate: Number(s.gst_rate) || 18,
    free_shipping_from: settings.free_shipping_from, shipping_fee: settings.shipping_fee, max_qty_per_item: settings.max_qty_per_item || 10, ui: pub, ui_version: uiVersion(pub) } }, { 'Cache-Control': 'public, max-age=30' });
}

// ---------- owner: customise ----------
function cleanHex(v, fallback) { v = str(v); return HEX.test(v) ? v.toUpperCase() : fallback; }
function hhmm(v) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(str(v)) ? str(v) : null; }
export function validateUi(section, b, cur) {
  const f = {}; let v;
  const bool = (x, d) => (x === undefined ? d : x === true || x === 'true' || x === 1);
  if (section === 'theme') {
    v = { ...cur };
    if (b.preset !== undefined) { if (!THEME_PRESETS[b.preset] && b.preset !== 'custom') f.preset = 'Unknown preset.'; else v.preset = b.preset; }
    for (const k of ['primary', 'accent', 'background', 'text']) if (b[k] !== undefined) { if (!HEX.test(str(b[k]))) f[k] = 'Use a colour like #C6A16A.'; else v[k] = str(b[k]).toUpperCase(); }
    if (b.site_mode !== undefined) { if (!['light', 'dark', 'auto'].includes(b.site_mode)) f.site_mode = 'Light, dark or auto.'; else v.site_mode = b.site_mode; }
    if (b.app_mode !== undefined) { if (!['light', 'dark', 'auto'].includes(b.app_mode)) f.app_mode = 'Light, dark or auto.'; else v.app_mode = b.app_mode; }
    // v5: optional colours ('' = worked out from the four main colours), font size + weights
    for (const k of OPT_COLOURS) if (b[k] !== undefined) { const x = str(b[k]); if (x && !HEX.test(x)) f[k] = 'Use a colour like #C6A16A (or leave empty for automatic).'; else v[k] = x.toUpperCase(); }
    if (b.font_scale !== undefined) { const n = Number(b.font_scale); if (!Number.isInteger(n) || n < 85 || n > 130) f.font_scale = 'Text size 85-130%.'; else v.font_scale = n; }
    for (const k of ['heading_weight', 'body_weight']) if (b[k] !== undefined) { const n = b[k] === '' || b[k] === null ? '' : Number(b[k]); if (n !== '' && ![300, 400, 500, 600, 700].includes(n)) f[k] = 'Pick 300-700.'; else v[k] = n; }
    if (b.heading_font !== undefined) { if (!FONTS.heading.includes(b.heading_font)) f.heading_font = 'Pick a font from the list.'; else v.heading_font = b.heading_font; }
    if (b.body_font !== undefined) { if (!FONTS.body.includes(b.body_font)) f.body_font = 'Pick a font from the list.'; else v.body_font = b.body_font; }
    if (b.radius !== undefined) { if (!['sharp', 'soft', 'round'].includes(b.radius)) f.radius = 'Sharp, soft or round.'; else v.radius = b.radius; }
    if (!Object.keys(f).length) {
      if (v.site_mode !== 'dark' && contrast(v.text, v.background) < 4.5) f.text = 'Text and background are too close in colour to read easily. Pick a darker text or lighter background.';
      if (contrast(v.primary, v.accent) < 1.8) f.accent = 'Accent is too close to the brand colour; buttons would be hard to see.';
    }
  } else if (section === 'layout') {
    v = { ...cur };
    for (const [k, all] of [['home_web', HOME_WEB_SECTIONS], ['home_app', HOME_APP_SECTIONS]]) {
      if (b[k] === undefined) continue;
      if (!Array.isArray(b[k]) || b[k].some((x) => !x || !all.includes(x.id))) { f[k] = 'Unknown section.'; continue; }
      v[k] = b[k].map((x) => ({ id: x.id, on: x.on !== false }));
      if (k === 'home_web' && !v[k].some((x) => x.on)) f[k] = 'Keep at least one section on.';
    }
  } else if (section === 'brand') {
    v = { ...cur };
    if (b.store_name !== undefined) { const s = clamp(b.store_name, 40); if (s.length < 2) f.store_name = 'Store name: 2-40 characters.'; else v.store_name = s; }
    if (b.tagline !== undefined) v.tagline = clamp(b.tagline, 80);
    for (const k of ['logo_url', 'favicon_url']) if (b[k] !== undefined) { const u = str(b[k]); if (u && !safeImg(u)) f[k] = 'Upload the image here first.'; else v[k] = u; }
    if (b.app_icon !== undefined) { if (!APP_ICONS.includes(b.app_icon)) f.app_icon = 'Pick one of the app icons.'; else v.app_icon = b.app_icon; }
  } else if (section === 'hero') {
    v = { ...cur };
    for (const [k, n] of [['eyebrow', 60], ['title', 80], ['subtitle', 160], ['cta_text', 30]]) if (b[k] !== undefined) v[k] = clamp(b[k], n);
    if (b.cta_link !== undefined) { const u = str(b.cta_link); if (u && !safeLink(u)) f.cta_link = 'Use a link like /shop or https://\u2026'; else v.cta_link = u; }
    if (b.image !== undefined) { const u = str(b.image); if (u && !safeImg(u)) f.image = 'Upload the image here first.'; else v.image = u; }
  } else if (section === 'banners') {
    if (!Array.isArray(b.banners) || b.banners.length > 6) { f.banners = 'Up to 6 banners.'; v = cur; }
    else v = b.banners.map((x, i) => {
      const o = { title: clamp(x.title, 60), text: clamp(x.text, 140), cta: clamp(x.cta, 24), link: str(x.link), image: str(x.image), on: x.on !== false };
      if (o.link && !safeLink(o.link)) f['banner_' + i] = 'Banner ' + (i + 1) + ': link must start with / or https://';
      if (o.image && !safeImg(o.image)) f['banner_' + i] = 'Banner ' + (i + 1) + ': upload the image here first.';
      if (!o.title && !o.image) f['banner_' + i] = 'Banner ' + (i + 1) + ': add a title or an image.';
      return o;
    });
  } else if (section === 'contact') {
    v = { ...cur };
    if (b.phone !== undefined) { const p = str(b.phone).replace(/[^\d+]/g, ''); if (p && !/^\+?\d{10,13}$/.test(p)) f.phone = 'Phone with country code, e.g. +919876543210 (or empty).'; else v.phone = p; }
    if (b.email !== undefined) { const e = str(b.email); if (e && !isEmail(e)) f.email = 'Enter a valid email (or empty).'; else v.email = e; }
    for (const k of ['instagram', 'facebook', 'youtube']) if (b[k] !== undefined) { const u = str(b[k]); if (u && !/^https:\/\/(www\.)?(instagram\.com|facebook\.com|youtube\.com|youtu\.be)\/[^\s]*$/.test(u)) f[k] = 'Paste the full https:// link of your page.'; else v[k] = u; }
  } else if (section === 'location') {
    v = { ...cur };
    if (b.show !== undefined) v.show = bool(b.show, false);
    for (const [k, n] of [['name', 60], ['address', 200], ['city', 60], ['note', 140]]) if (b[k] !== undefined) v[k] = clamp(b[k], n);
    if (b.pincode !== undefined) { const p = str(b.pincode); if (p && !/^[1-9]\d{5}$/.test(p)) f.pincode = '6-digit pincode.'; else v.pincode = p; }
    for (const [k, lim] of [['lat', 90], ['lng', 180]]) if (b[k] !== undefined) { if (b[k] === null || b[k] === '') v[k] = null; else { const n = Number(b[k]); if (!isFinite(n) || Math.abs(n) > lim) f[k] = 'Pick the spot on the map.'; else v[k] = Math.round(n * 1e6) / 1e6; } }
    if (b.hours !== undefined) {
      if (!Array.isArray(b.hours) || b.hours.length !== 7) f.hours = 'Hours for all 7 days.';
      else v.hours = b.hours.map((h, i) => { const o = { day: DAY_KEYS[i], open: hhmm(h.open) || '10:00', close: hhmm(h.close) || '19:00', closed: !!h.closed }; if ((h.open && !hhmm(h.open)) || (h.close && !hhmm(h.close))) f.hours = 'Use times like 10:00 and 19:30.'; return o; });
    }
    if (v.show && !v.address) f.address = 'Add the address to show your location.';
    if (/[<>]/.test([v.name, v.address, v.city, v.note].join(''))) f.address = 'Please remove < and > characters.';
  } else if (section === 'delivery') {
    v = { ...cur };
    if (b.mode !== undefined) { if (!['all', 'list', 'except'].includes(b.mode)) f.mode = 'Choose a delivery mode.'; else v.mode = b.mode; }
    if (b.areas !== undefined) { v.areas = clamp(b.areas, 4000); const p = parseAreas(v.areas); if (p.bad.length) f.areas = 'Not a pincode, prefix or range: ' + p.bad.slice(0, 3).join(', '); }
    if (b.message !== undefined) v.message = clamp(b.message, 160);
    if (v.mode !== 'all' && !parseAreas(v.areas).areas.length) f.areas = 'Add at least one pincode, prefix (like 221*) or range (221001-221010).';
  } else if (section === 'features') {
    v = { ...cur }; for (const k of Object.keys(UI_DEFAULTS.features)) if (b[k] !== undefined) v[k] = bool(b[k], true);
  } else if (section === 'chat') {
    v = { ...cur };
    if (b.name !== undefined) { const s = clamp(b.name, 40); if (s.length < 2) f.name = 'Assistant name: 2-40 characters.'; else v.name = s; }
    if (b.greeting !== undefined) v.greeting = clamp(b.greeting, 200);
    if (b.provider !== undefined) { if (!['', 'gemini', 'openai', 'groq'].includes(b.provider)) f.provider = 'Choose Gemini, OpenAI, Groq or none.'; else v.provider = b.provider; }
    if (b.model !== undefined) { const m = str(b.model); if (m && !/^[A-Za-z0-9._:\/-]{2,60}$/.test(m)) f.model = 'Model name looks wrong.'; else v.model = m; }
  } else if (section === 'ar') {
    v = { ...cur }; for (const k of ['viewer', 'selfie', 'scan']) if (b[k] !== undefined) v[k] = bool(b[k], true);
    if (b.caption !== undefined) v.caption = clamp(b.caption, 40);
  } else if (section === 'bargain') {
    v = { ...cur };
    if (b.on !== undefined) v.on = bool(b.on, true);
    for (const [k, lo, hi] of [['deal_minutes', 5, 1440], ['per_customer_daily', 1, 20], ['daily_cap', 1, 10000], ['max_discount_pct', 1, 60], ['start_discount_pct', 0, 30], ['max_rounds', 1, 8]]) {
      if (b[k] === undefined) continue; const n = Number(b[k]); if (!Number.isInteger(n) || n < lo || n > hi) f[k] = `Whole number ${lo}-${hi}.`; else v[k] = n;
    }
    if (v.start_discount_pct > v.max_discount_pct) f.start_discount_pct = 'Opening discount cannot be more than the maximum discount.';
  } else f.section = 'Unknown section.';
  if (v && !Array.isArray(v)) for (const [k, val] of Object.entries(v)) if (typeof val === 'string' && /[<>]/.test(val)) f[k] = 'Please remove < and > characters.';
  if (Array.isArray(v) && v.some((o) => Object.values(o).some((x) => typeof x === 'string' && /[<>]/.test(x)))) f.banners = 'Please remove < and > characters.';
  return { value: v, fields: f };
}
async function adminGetUi(request, env) {
  await requireAdmin(env, request);
  const ui = await getUi(env, true);
  const llm = await llmConfig(env, ui);
  return json(200, { ok: true, ui, presets: THEME_PRESETS, fonts: FONTS, app_icons: APP_ICONS, sections: { home_web: HOME_WEB_SECTIONS, home_app: HOME_APP_SECTIONS },
    chat_key: { set: !!llm.key, hint: llm.key ? '****' + llm.key.slice(-4) : '' }, version: uiVersion(publicUi(ui)) });
}
async function adminPutUi(request, env, section) {
  await requireAdmin(env, request);
  const b = await readJson(request, 20000);
  const ui = await getUi(env, true);
  if (!UI_SECTIONS.includes(section)) throw new HttpError(404, 'not_found', 'No such settings section.');
  const { value, fields } = validateUi(section, b, ui[section]);
  assertValid(fields);
  const t = nowIso();
  const up = 'INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at';
  const stmts = [env.DB.prepare(up).bind('ui:' + section, JSON.stringify(value), t)];
  if (section === 'chat') {
    const key = typeof b.api_key === 'string' ? b.api_key.trim() : '';
    if (key && (key.length < 10 || key.length > 300 || /\s/.test(key))) throw new HttpError(400, 'invalid_input', 'That API key does not look right.', null, { api_key: 'That API key does not look right.' });
    if (key) stmts.push(env.DB.prepare(up).bind('secret:chat_llm_key', key, t));
    if (b.remove_api_key === true) stmts.push(env.DB.prepare("DELETE FROM settings WHERE key = 'secret:chat_llm_key'"));
  }
  await env.DB.batch(stmts);
  uiCache = { at: 0, v: null };
  return adminGetUi(request, env);
}
// live preview in the dashboard: the exact CSS the site would get for a draft (nothing is saved)
async function adminUiPreview(request, env) {
  await requireAdmin(env, request);
  const b = await readJson(request, 20000);
  const ui = await getUi(env, true);
  const draft = { ...ui };
  for (const sec of ['theme', 'layout']) if (b[sec]) { const { value, fields } = validateUi(sec, b[sec], ui[sec]); if (Object.keys(fields).length) return json(200, { ok: true, css: siteThemeCss(ui), fields }); draft[sec] = value; }
  return json(200, { ok: true, css: siteThemeCss(draft), fields: {} });
}
async function adminResetUi(request, env, section) {
  await requireAdmin(env, request);
  checkOrigin(request);
  if (!UI_SECTIONS.includes(section)) throw new HttpError(404, 'not_found', 'No such settings section.');
  await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind('ui:' + section).run();
  uiCache = { at: 0, v: null };
  return adminGetUi(request, env);
}

// ---------- pages: the live look is applied on the server, so there is no flash of the old colours ----------
const LIVE_V = '5.0.0';
export function personalizePage(html, ui, cfg, path) {
  const css = siteThemeCss(ui);
  const pub = publicUi(ui);
  const b = ui.brand;
  let out = html;
  const head = (css ? '<style id="avm-theme">' + css + '</style>' : '') +
    '<script id="avm-cfg" type="application/json">' + JSON.stringify({ ui: pub, whatsapp: cfg.whatsapp_number || '', email: cfg.support_email || '', page: path }).replace(/</g, '\\u003c') + '</script>';
  out = out.replace('</head>', head + '</head>');
  if (!/assets\/live\.js/.test(out)) { out = out.replace('</head>', '<link rel="stylesheet" href="/assets/live.css?v=' + LIVE_V + '"></head>'); out = out.replace('</body>', '<script src="/assets/live.js?v=' + LIVE_V + '" defer></script></body>'); }
  if (ui.style && ui.style.announce_text) out = out.replace(/(<span id="announce-text">)[\s\S]*?(<\/span>)/, `$1${escHtml(ui.style.announce_text)}$2`);
  if (ui.style && ui.style.header_layout === 'center') out = out.replace('<header class="site-header">', '<header class="site-header hdr-center">');
  if (b.favicon_url && safeImg(b.favicon_url)) out = out.replace(/<link rel="icon" href="[^"]*"[^>]*>/, `<link rel="icon" href="${escHtml(b.favicon_url)}">`);
  // logo / store name in the header
  if (b.logo_url && safeImg(b.logo_url)) out = out.replace(/(<a class="logo"[^>]*>)AVER<span>MONTIS<\/span>(<\/a>)/g, `$1<img class="logo-img" src="${escHtml(b.logo_url)}" alt="${escHtml(b.store_name)}" height="34">$2`);
  else if (b.store_name && b.store_name.toUpperCase() !== 'AVERMONTIS') out = out.replace(/(<a class="logo"[^>]*>)AVER<span>MONTIS<\/span>(<\/a>)/g, `$1${escHtml(b.store_name)}$2`);
  if (path === '/index') {
    const h = ui.hero;
    if (h.eyebrow) out = out.replace(/(<span class="eyebrow" data-edit="hero-eyebrow">)[\s\S]*?(<\/span>)/, `$1${escHtml(h.eyebrow)}$2`);
    if (h.title) out = out.replace(/(<h1 data-edit="hero-title">)[\s\S]*?(<\/h1>)/, `$1${escHtml(h.title)}$2`);
    if (h.subtitle) out = out.replace(/(<p data-edit="hero-sub">)[\s\S]*?(<\/p>)/, `$1${escHtml(h.subtitle)}$2`);
    if (h.cta_text) out = out.replace(/(<a class="btn lg" data-edit="hero-cta" href=")[^"]*(">)[\s\S]*?(<\/a>)/, `$1${escHtml(safeLink(h.cta_link) || '/shop')}$2${escHtml(h.cta_text)}$3`);
    else if (h.cta_link && safeLink(h.cta_link)) out = out.replace(/(<a class="btn lg" data-edit="hero-cta" href=")[^"]*(")/, `$1${escHtml(safeLink(h.cta_link))}$2`);
    if (h.image && safeImg(h.image)) out = out.replace(/<picture data-edit="hero-img">[\s\S]*?<\/picture>/, `<picture data-edit="hero-img"><img src="${escHtml(h.image)}" alt="" width="1536" height="1024" fetchpriority="high"></picture>`);
    const bn = pub.banners;
    const bhtml = bn.length ? '<section class="block avm-banners" data-sec="banners" aria-label="Offers"><div class="wrap"><div class="avm-banner-row">' + bn.map((x) =>
      `<a class="avm-banner${x.image ? ' has-img' : ''}" href="${escHtml(x.link || '/shop')}">${x.image ? `<img src="${escHtml(x.image)}" alt="" loading="lazy">` : ''}<span class="avm-bt"><b>${escHtml(x.title)}</b>${x.text ? `<span>${escHtml(x.text)}</span>` : ''}${x.cta ? `<em>${escHtml(x.cta)} \u2192</em>` : ''}</span></a>`).join('') + '</div></div></section>' : '';
    out = out.replace('<!--avm:banners-->', bhtml);
  }
  return out;
}

// ---------- store assistant (chat) ----------
// Two engines. "faq": a rules engine grounded ONLY in the live catalogue, the store's own policy pages and the owner's
// settings (always available, no outside service). "llm": used only when the owner adds his own AI key in admin; it gets
// the same facts, must answer in JSON, and any reply that mentions a price not in the catalogue is thrown away.
const HINGLISH = /\b(hai|hain|kya|kaise|kaisa|kitna|kitne|kitni|mujhe|muje|chahiye|karo|karna|batao|bataiye|bata|mera|meri|mere|nahi|nhi|haan|han|acha|accha|aacha|kab|kaun|konsa|kaunsa|lagaye|lagana|lagau|wala|wali|daam|bhai|hoga|milega|milegi|dikhao|kahan|kaha|aap|tum|apna|kuch|sabse|liye|chehra|chehre|daag|daane|muhase|dhoop|rukhi|tel|chamak|nikhar|paise|bhejo|chalega)\b/i;
export function detectLang(t) { t = String(t || ''); if (/[\u0900-\u097F]/.test(t)) return 'hi'; return HINGLISH.test(t) ? 'hinglish' : 'en'; }
const PRODUCT_ALIASES = [
  ['vitamin-c-serum', /vit(amin)?[\s-]*c\b|विटामिन\s*सी|ascorb/i],
  ['niacinamide-serum', /niacin|niacinamide|नियासिन/i],
  ['hydrating-face-wash', /face\s*wash|facewash|cleanser|फेस\s*वॉश|cleansing/i],
  ['daily-moisturi[sz]er', /moisturi[sz]er|moisturi[sz]ing|cream|मॉइस्चराइज़?र|क्रीम/i],
  ['sunscreen-spf50', /sun\s*screen|sunscreen|sunblock|spf|सनस्क्रीन/i]
];
const CONCERNS = [
  ['glow', /dull|glow|bright|radian|tan\b|chamak|nikhar|ग्लो|चमक|निखार|रौनक/i, ['vitamin-c-serum', 'sunscreen-spf50']],
  ['spots', /dark\s*spot|pigment|daag|blemish|uneven|दाग|धब्बे|झाइयां/i, ['vitamin-c-serum', 'niacinamide-serum', 'sunscreen-spf50']],
  ['oily', /oily|oil\b|greasy|pore|acne|pimple|breakout|daane|muhase|chipchip|tel\b|तैलीय|ऑयली|मुंहासे|दाने|पिंपल/i, ['niacinamide-serum', 'hydrating-face-wash']],
  ['dry', /dry|dehydrat|flaky|tight|rukh|rookh|रूखी|ड्राई|खुश्क/i, ['daily-moisturizer', 'hydrating-face-wash']],
  ['sun', /sun\b|sunburn|dhoop|outdoor|धूप/i, ['sunscreen-spf50']],
  ['sensitive', /sensitive|redness|sensitiv|संवेदनशील/i, ['hydrating-face-wash', 'daily-moisturizer']]
];
const INGREDIENT_WORDS = [['vitamin c', /vit(amin)?[\s-]*c\b|ascorb/i], ['niacinamide', /niacinamide|niacin/i], ['hyaluronic acid', /hyaluronic|\bha\b/i], ['ceramides', /ceramide/i], ['squalane', /squalane/i],
  ['zinc', /zinc/i], ['glycerin', /glycerin|glycerine/i], ['aloe vera', /aloe/i], ['vitamin e', /vit(amin)?[\s-]*e\b|tocopher/i], ['titanium dioxide', /titanium/i], ['shea butter', /shea/i], ['panthenol', /panthenol/i], ['cucumber', /cucumber|kheera/i]];
const MEDICAL = /pregnan|breastfeed|eczema|psoria|infection|infected|rash|allerg|burn(t|ed|ing)?\b|medicine|dermatolog|prescription|steroid|bleed|pus\b|cure|disease|rosacea|melasma|vitiligo|fungal|doctor|garbh|गर्भ|एलर्जी|इन्फेक्शन|दवा|डॉक्टर|जलन|खुजली|itching|khujli|jalan|ilaa?j|इलाज|बीमारी|bimari|एक्ज़?िमा|एक्जिमा|सोरायसिस|संक्रमण|रैश|दवाई|davai|dawai/i;
const T = {
  greet: { en: ['Hi! I\u2019m {name}. Ask me about our products, your routine, an order, shipping or returns.', 'Hello! I\u2019m {name} \u2014 happy to help you pick a product, plan a routine or check an order.'],
    hinglish: ['Namaste! Main {name} hoon. Products, routine, order status, shipping ya returns \u2014 kuch bhi poochiye.', 'Hi! Main {name}. Product chunna ho, routine banana ho ya order check karna ho \u2014 batao!'],
    hi: ['\u0928\u092E\u0938\u094D\u0924\u0947! \u092E\u0948\u0902 {name} \u0939\u0942\u0901\u0964 \u092A\u094D\u0930\u094B\u0921\u0915\u094D\u091F, \u0930\u0942\u091F\u0940\u0928, \u0911\u0930\u094D\u0921\u0930, \u0936\u093F\u092A\u093F\u0902\u0917 \u092F\u093E \u0930\u093F\u091F\u0930\u094D\u0928 \u2014 \u0915\u0941\u091B \u092D\u0940 \u092A\u0942\u091B\u093F\u090F\u0964'] },
  thanks: { en: ['You\u2019re welcome! Anything else?'], hinglish: ['Aapka swagat hai! Aur kuch help chahiye?'], hi: ['\u0906\u092A\u0915\u093E \u0938\u094D\u0935\u093E\u0917\u0924 \u0939\u0948! \u0914\u0930 \u0915\u0941\u091B?'] },
  fallback: { en: ['I can help with products, ingredients, routines, order status, shipping, returns and payment. For anything else our team is happy to help:'],
    hinglish: ['Main products, ingredients, routine, order status, shipping, returns aur payment mein help kar sakta hoon. Baaki ke liye hamari team se baat kijiye:'],
    hi: ['\u092E\u0948\u0902 \u092A\u094D\u0930\u094B\u0921\u0915\u094D\u091F, \u0907\u0902\u0917\u094D\u0930\u0940\u0921\u093F\u090F\u0902\u091F, \u0930\u0942\u091F\u0940\u0928, \u0911\u0930\u094D\u0921\u0930, \u0936\u093F\u092A\u093F\u0902\u0917 \u0914\u0930 \u0930\u093F\u091F\u0930\u094D\u0928 \u092E\u0947\u0902 \u092E\u0926\u0926 \u0915\u0930 \u0938\u0915\u0924\u093E \u0939\u0942\u0901\u0964 \u092C\u093E\u0915\u0940 \u0915\u0947 \u0932\u093F\u090F \u0939\u092E\u093E\u0930\u0940 \u091F\u0940\u092E \u0938\u0947 \u092C\u093E\u0924 \u0915\u0940\u091C\u093F\u090F:'] },
  human: { en: ['Sure \u2014 you can reach our team directly:'], hinglish: ['Bilkul \u2014 hamari team se seedha baat kijiye:'], hi: ['\u091C\u093C\u0930\u0942\u0930 \u2014 \u0939\u092E\u093E\u0930\u0940 \u091F\u0940\u092E \u0938\u0947 \u0938\u0940\u0927\u0947 \u092C\u093E\u0924 \u0915\u0940\u091C\u093F\u090F:'] },
  medical: { en: ['Our products are everyday skincare, not medicines, so I can\u2019t advise on a skin condition, pregnancy or an allergy. Please check with a dermatologist first, patch test every new product, and stop if irritation occurs.'],
    hinglish: ['Hamare products roz ki skincare hain, dawai nahi, isliye skin problem, pregnancy ya allergy par main salah nahi de sakta. Pehle dermatologist se poochiye, har naya product patch test kijiye, aur jalan ho to band kar dijiye.'],
    hi: ['\u0939\u092E\u093E\u0930\u0947 \u092A\u094D\u0930\u094B\u0921\u0915\u094D\u091F \u0930\u094B\u091C\u093C \u0915\u0940 \u0938\u094D\u0915\u093F\u0928\u0915\u0947\u092F\u0930 \u0939\u0948\u0902, \u0926\u0935\u093E \u0928\u0939\u0940\u0902\u0964 \u0938\u094D\u0915\u093F\u0928 \u0915\u0940 \u0938\u092E\u0938\u094D\u092F\u093E, \u092A\u094D\u0930\u0947\u0917\u094D\u0928\u0947\u0902\u0938\u0940 \u092F\u093E \u090F\u0932\u0930\u094D\u091C\u0940 \u092E\u0947\u0902 \u092A\u0939\u0932\u0947 \u0921\u0930\u094D\u092E\u0947\u091F\u094B\u0932\u0949\u091C\u093F\u0938\u094D\u091F \u0938\u0947 \u092A\u0942\u091B\u093F\u090F, \u0939\u0930 \u0928\u092F\u093E \u092A\u094D\u0930\u094B\u0921\u0915\u094D\u091F \u092A\u0948\u091A \u091F\u0947\u0938\u094D\u091F \u0915\u0940\u091C\u093F\u090F\u0964'] },
  ask_concern: { en: ['Happy to suggest! What would you like your routine to focus on?'], hinglish: ['Zaroor! Aapki skin ke liye kis cheez par focus karna hai?'], hi: ['\u091C\u093C\u0930\u0942\u0930! \u0906\u092A\u0915\u0940 \u0938\u094D\u0915\u093F\u0928 \u0915\u0947 \u0932\u093F\u090F \u0915\u093F\u0938 \u092A\u0930 \u0927\u094D\u092F\u093E\u0928 \u0926\u0947\u0928\u093E \u0939\u0948?'] },
  recommend: { en: ['For {concern}, these from our range fit well:'], hinglish: ['{concern} ke liye hamari range mein ye sahi rahenge:'], hi: ['{concern} \u0915\u0947 \u0932\u093F\u090F \u0939\u092E\u093E\u0930\u0940 \u0930\u0947\u0902\u091C \u092E\u0947\u0902 \u092F\u0947 \u0920\u0940\u0915 \u0930\u0939\u0947\u0902\u0917\u0947:'] },
  acne_note: { en: ['For active acne, please see a dermatologist \u2014 these are everyday care, not treatment.'], hinglish: ['Zyada acne ho to dermatologist ko dikhaiye \u2014 ye roz ki care hai, ilaaj nahi.'], hi: ['\u091C\u093C\u094D\u092F\u093E\u0926\u093E \u092E\u0941\u0902\u0939\u093E\u0938\u0947 \u0939\u094B\u0902 \u0924\u094B \u0921\u0930\u094D\u092E\u0947\u091F\u094B\u0932\u0949\u091C\u093F\u0938\u094D\u091F \u0915\u094B \u0926\u093F\u0916\u093E\u090F\u0901\u0964'] },
  routine: { en: ['A simple routine with our range:\nMorning: {am}\nEvening: {pm}\nPatch test anything new first.'], hinglish: ['Hamari range se simple routine:\nSubah: {am}\nRaat: {pm}\nNaya product pehle patch test zaroor karein.'], hi: ['\u0939\u092E\u093E\u0930\u0940 \u0930\u0947\u0902\u091C \u0938\u0947 \u0906\u0938\u093E\u0928 \u0930\u0942\u091F\u0940\u0928:\n\u0938\u0941\u092C\u0939: {am}\n\u0930\u093E\u0924: {pm}\n\u0928\u092F\u093E \u092A\u094D\u0930\u094B\u0921\u0915\u094D\u091F \u092A\u0939\u0932\u0947 \u092A\u0948\u091A \u091F\u0947\u0938\u094D\u091F \u0915\u0930\u0947\u0902\u0964'] },
  product: { en: ['{name} ({size}): {price}{mrp}. {short}\nKey ingredients: {ing}.\nHow to use: {how}'], hinglish: ['{name} ({size}): {price}{mrp}. {short}\nKey ingredients: {ing}.\nKaise lagayein: {how}'], hi: ['{name} ({size}): {price}{mrp}\u0964 {short}\n\u092E\u0941\u0916\u094D\u092F \u0907\u0902\u0917\u094D\u0930\u0940\u0921\u093F\u090F\u0902\u091F: {ing}\u0964\n\u0915\u0948\u0938\u0947 \u0932\u0917\u093E\u090F\u0901: {how}'] },
  price_only: { en: ['{name} ({size}) is {price}{mrp}.'], hinglish: ['{name} ({size}) {price} ka hai{mrp}.'], hi: ['{name} ({size}) \u0915\u0940 \u0915\u0940\u092E\u0924 {price} \u0939\u0948{mrp}\u0964'] },
  how_only: { en: ['How to use {name}: {how}'], hinglish: ['{name} kaise lagayein: {how}'], hi: ['{name} \u0915\u0948\u0938\u0947 \u0932\u0917\u093E\u090F\u0901: {how}'] },
  ingredient: { en: ['{ing} is in: {list}.'], hinglish: ['{ing} in products mein hai: {list}.'], hi: ['{ing} \u0907\u0928 \u092A\u094D\u0930\u094B\u0921\u0915\u094D\u091F \u092E\u0947\u0902 \u0939\u0948: {list}\u0964'] },
  ingredient_none: { en: ['None of our current products list {ing}.'], hinglish: ['Hamare abhi ke kisi product mein {ing} nahi hai.'], hi: ['\u0939\u092E\u093E\u0930\u0947 \u0915\u093F\u0938\u0940 \u092A\u094D\u0930\u094B\u0921\u0915\u094D\u091F \u092E\u0947\u0902 {ing} \u0928\u0939\u0940\u0902 \u0939\u0948\u0964'] },
  shipping: { en: ['Shipping is free on orders of {free} or more; {fee} below that. Orders are usually dispatched in 1\u20133 working days and delivered in 4\u20138 working days, depending on the pincode. Cash on Delivery is available.'],
    hinglish: ['{free} ya usse zyada ke order par shipping free hai, usse kam par {fee}. Order aam taur par 1\u20133 working days mein dispatch hota hai aur pincode ke hisaab se 4\u20138 working days mein pahunchta hai. Cash on Delivery available hai.'],
    hi: ['{free} \u092F\u093E \u0909\u0938\u0938\u0947 \u091C\u093C\u094D\u092F\u093E\u0926\u093E \u0915\u0947 \u0911\u0930\u094D\u0921\u0930 \u092A\u0930 \u0936\u093F\u092A\u093F\u0902\u0917 \u092E\u0941\u092B\u093C\u094D\u0924, \u0909\u0938\u0938\u0947 \u0915\u092E \u092A\u0930 {fee}\u0964 \u0906\u092E \u0924\u094C\u0930 \u092A\u0930 1\u20133 \u0935\u0930\u094D\u0915\u093F\u0902\u0917 \u0926\u093F\u0928 \u092E\u0947\u0902 \u0921\u093F\u0938\u094D\u092A\u0948\u091A \u0914\u0930 4\u20138 \u0935\u0930\u094D\u0915\u093F\u0902\u0917 \u0926\u093F\u0928 \u092E\u0947\u0902 \u0921\u093F\u0932\u0940\u0935\u0930\u0940\u0964 \u0915\u0948\u0936 \u0911\u0928 \u0921\u093F\u0932\u0940\u0935\u0930\u0940 \u0909\u092A\u0932\u092C\u094D\u0927 \u0939\u0948\u0964'] },
  pin_ok: { en: ['Good news: we deliver to {pin} (Cash on Delivery available).'], hinglish: ['{pin} par delivery ho jaayegi (Cash on Delivery bhi).'], hi: ['{pin} \u092A\u0930 \u0921\u093F\u0932\u0940\u0935\u0930\u0940 \u0939\u094B \u091C\u093E\u090F\u0917\u0940 (\u0915\u0948\u0936 \u0911\u0928 \u0921\u093F\u0932\u0940\u0935\u0930\u0940 \u092D\u0940)\u0964'] },
  pin_no: { en: ['Sorry, we don\u2019t deliver to {pin} yet. {msg}'], hinglish: ['Maaf kijiye, {pin} par abhi delivery nahi hai. {msg}'], hi: ['\u092E\u093E\u092B\u093C \u0915\u0940\u091C\u093F\u090F, {pin} \u092A\u0930 \u0905\u092D\u0940 \u0921\u093F\u0932\u0940\u0935\u0930\u0940 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964 {msg}'] },
  returns: { en: ['Unopened products can be returned within 7 days of delivery. Damaged, leaking or wrong items: email us within 48 hours of delivery with your order number and a photo and we\u2019ll replace or refund. Opened products can\u2019t be returned unless they arrived damaged. COD refunds go by bank transfer or UPI within 7 working days after we receive the return.'],
    hinglish: ['Bina khole product delivery ke 7 din ke andar return ho sakte hain. Damaged, leak ya galat item mila ho to 48 ghante ke andar order number aur photo ke saath email kijiye \u2014 replace ya refund ho jaayega. Khula hua product return nahi hota (jab tak damaged na aaya ho). COD refund return milne ke 7 working days mein bank transfer ya UPI se.'],
    hi: ['\u092C\u093F\u0928\u093E \u0916\u094B\u0932\u0947 \u092A\u094D\u0930\u094B\u0921\u0915\u094D\u091F \u0921\u093F\u0932\u0940\u0935\u0930\u0940 \u0915\u0947 7 \u0926\u093F\u0928 \u092E\u0947\u0902 \u0930\u093F\u091F\u0930\u094D\u0928 \u0939\u094B \u0938\u0915\u0924\u0947 \u0939\u0948\u0902\u0964 \u0916\u0930\u093E\u092C, \u0932\u0940\u0915 \u092F\u093E \u0917\u0932\u0924 \u0906\u0907\u091F\u092E: 48 \u0918\u0902\u091F\u0947 \u092E\u0947\u0902 \u0911\u0930\u094D\u0921\u0930 \u0928\u0902\u092C\u0930 \u0914\u0930 \u092B\u093C\u094B\u091F\u094B \u0915\u0947 \u0938\u093E\u0925 \u0908\u092E\u0947\u0932 \u0915\u0940\u091C\u093F\u090F\u0964 \u0916\u0941\u0932\u093E \u0939\u0941\u0906 \u092A\u094D\u0930\u094B\u0921\u0915\u094D\u091F \u0930\u093F\u091F\u0930\u094D\u0928 \u0928\u0939\u0940\u0902 \u0939\u094B\u0924\u093E\u0964 COD \u0930\u093F\u092B\u093C\u0902\u0921 7 \u0935\u0930\u094D\u0915\u093F\u0902\u0917 \u0926\u093F\u0928 \u092E\u0947\u0902 \u092C\u0948\u0902\u0915/UPI \u0938\u0947\u0964'] },
  payment: { en: ['Right now we take Cash on Delivery across India. UPI and card payments are coming soon. All prices include GST and every order gets a GST invoice.'],
    hinglish: ['Abhi poore India mein Cash on Delivery hai. UPI aur card payment jaldi aa raha hai. Saare prices GST ke saath hain aur har order ka GST invoice milta hai.'],
    hi: ['\u0905\u092D\u0940 \u092A\u0942\u0930\u0947 \u092D\u093E\u0930\u0924 \u092E\u0947\u0902 \u0915\u0948\u0936 \u0911\u0928 \u0921\u093F\u0932\u0940\u0935\u0930\u0940 \u0939\u0948\u0964 UPI \u0914\u0930 \u0915\u093E\u0930\u094D\u0921 \u091C\u0932\u094D\u0926 \u0906 \u0930\u0939\u093E \u0939\u0948\u0964 \u0938\u092D\u0940 \u0915\u0940\u092E\u0924\u0947\u0902 GST \u0938\u0939\u093F\u0924 \u0939\u0948\u0902\u0964'] },
  offers: { en: ['Current offers: {ann}{bargain}'], hinglish: ['Abhi ke offers: {ann}{bargain}'], hi: ['\u0905\u092D\u0940 \u0915\u0947 \u0911\u092B\u093C\u0930: {ann}{bargain}'] },
  bargain_hint: { en: [' You can also tap \u201CMake an offer\u201D on a product page to bargain for a deal.'], hinglish: [' Product page par \u201CMake an offer\u201D daba ke bargaining bhi kar sakte hain.'], hi: [' \u092A\u094D\u0930\u094B\u0921\u0915\u094D\u091F \u092A\u0947\u091C \u092A\u0930 \u201CMake an offer\u201D \u0938\u0947 \u092E\u094B\u0932-\u092D\u093E\u0935 \u092D\u0940 \u0915\u0930 \u0938\u0915\u0924\u0947 \u0939\u0948\u0902\u0964'] },
  order_ask: { en: ['Sure \u2014 please share your order number (like AV-261026-ABC123) and the phone number or email used at checkout.'], hinglish: ['Zaroor \u2014 apna order number (jaise AV-261026-ABC123) aur checkout wala phone number ya email bhejiye.'], hi: ['\u091C\u093C\u0930\u0942\u0930 \u2014 \u0905\u092A\u0928\u093E \u0911\u0930\u094D\u0921\u0930 \u0928\u0902\u092C\u0930 (\u091C\u0948\u0938\u0947 AV-261026-ABC123) \u0914\u0930 \u091A\u0947\u0915\u0906\u0909\u091F \u0935\u093E\u0932\u093E \u092B\u093C\u094B\u0928 \u0928\u0902\u092C\u0930 \u092F\u093E \u0908\u092E\u0947\u0932 \u092D\u0947\u091C\u093F\u090F\u0964'] },
  order_contact: { en: ['Thanks! Now the phone number or email used at checkout for {id}, please.'], hinglish: ['Shukriya! Ab {id} ke checkout wala phone number ya email bhejiye.'], hi: ['\u0927\u0928\u094D\u092F\u0935\u093E\u0926! \u0905\u092C {id} \u0915\u093E \u092B\u093C\u094B\u0928 \u0928\u0902\u092C\u0930 \u092F\u093E \u0908\u092E\u0947\u0932 \u092D\u0947\u091C\u093F\u090F\u0964'] },
  order_status: { en: ['Order {id}: {status} (last update {when}). Total {total}, {items}.'], hinglish: ['Order {id}: {status} (last update {when}). Total {total}, {items}.'], hi: ['\u0911\u0930\u094D\u0921\u0930 {id}: {status} (\u0906\u0916\u093F\u0930\u0940 \u0905\u092A\u0921\u0947\u091F {when})\u0964 \u0915\u0941\u0932 {total}, {items}\u0964'] },
  order_none: { en: ['I couldn\u2019t find that order with those details. Please check the order number and the phone/email used at checkout.'], hinglish: ['In details ke saath order nahi mila. Order number aur checkout wala phone/email dobara check kijiye.'], hi: ['\u0907\u0928 \u0921\u093F\u091F\u0947\u0932\u094D\u0938 \u0915\u0947 \u0938\u093E\u0925 \u0911\u0930\u094D\u0921\u0930 \u0928\u0939\u0940\u0902 \u092E\u093F\u0932\u093E\u0964 \u0915\u0943\u092A\u092F\u093E \u0926\u094B\u092C\u093E\u0930\u093E \u091C\u093E\u0901\u091A\u0947\u0902\u0964'] },
  my_orders: { en: ['Your recent orders:\n{list}'], hinglish: ['Aapke recent orders:\n{list}'], hi: ['\u0906\u092A\u0915\u0947 \u0939\u093E\u0932 \u0915\u0947 \u0911\u0930\u094D\u0921\u0930:\n{list}'] },
  location: { en: ['{name}{address}. Today: {today}.'], hinglish: ['{name}{address}. Aaj: {today}.'], hi: ['{name}{address}\u0964 \u0906\u091C: {today}\u0964'] },
  online_only: { en: ['We\u2019re an online store and ship across India.'], hinglish: ['Hum online store hain aur poore India mein ship karte hain.'], hi: ['\u0939\u092E \u0911\u0928\u0932\u093E\u0907\u0928 \u0938\u094D\u091F\u094B\u0930 \u0939\u0948\u0902 \u0914\u0930 \u092A\u0942\u0930\u0947 \u092D\u093E\u0930\u0924 \u092E\u0947\u0902 \u0936\u093F\u092A \u0915\u0930\u0924\u0947 \u0939\u0948\u0902\u0964'] },
  password: { en: ['Use \u201CForgot password\u201D on the sign-in page. If no email arrives, contact us and we\u2019ll send a reset link.'], hinglish: ['Sign-in page par \u201CForgot password\u201D dabaiye. Email na aaye to humse contact kijiye, hum reset link bhej denge.'], hi: ['\u0938\u093E\u0907\u0928-\u0907\u0928 \u092A\u0947\u091C \u092A\u0930 \u201CForgot password\u201D \u0926\u092C\u093E\u0907\u090F\u0964'] },
  patch: { en: ['Always patch test a new product on a small area first and stop if irritation occurs.'], hinglish: ['Naya product pehle thodi si jagah par patch test karein, jalan ho to band kar dein.'], hi: ['\u0928\u092F\u093E \u092A\u094D\u0930\u094B\u0921\u0915\u094D\u091F \u092A\u0939\u0932\u0947 \u0925\u094B\u0921\u093C\u0940 \u0938\u0940 \u091C\u0917\u0939 \u092A\u0930 \u092A\u0948\u091A \u091F\u0947\u0938\u094D\u091F \u0915\u0930\u0947\u0902\u0964'] }
};
const CONCERN_LABEL = { glow: { en: 'a brighter-looking glow', hinglish: 'glow / nikhar', hi: '\u0928\u093F\u0916\u093E\u0930' }, spots: { en: 'an even-looking tone', hinglish: 'daag-dhabbe / uneven tone', hi: '\u0926\u093E\u0917-\u0927\u092C\u094D\u092C\u0947' },
  oily: { en: 'oily skin', hinglish: 'oily skin', hi: '\u0924\u0948\u0932\u0940\u092F \u0924\u094D\u0935\u091A\u093E' }, dry: { en: 'dry skin', hinglish: 'rukhi skin', hi: '\u0930\u0942\u0916\u0940 \u0924\u094D\u0935\u091A\u093E' },
  sun: { en: 'sun care', hinglish: 'dhoop se bachav', hi: '\u0927\u0942\u092A \u0938\u0947 \u092C\u091A\u093E\u0935' }, sensitive: { en: 'sensitive skin', hinglish: 'sensitive skin', hi: '\u0938\u0902\u0935\u0947\u0926\u0928\u0936\u0940\u0932 \u0924\u094D\u0935\u091A\u093E' } };
const STATUS_WORD = { new: { en: 'received, waiting for confirmation', hinglish: 'mil gaya, confirm hona baaki', hi: '\u092E\u093F\u0932 \u0917\u092F\u093E, \u0915\u0928\u094D\u092B\u093C\u0930\u094D\u092E \u0939\u094B\u0928\u093E \u092C\u093E\u0915\u0940' },
  confirmed: { en: 'confirmed, being packed', hinglish: 'confirm ho gaya, pack ho raha hai', hi: '\u0915\u0928\u094D\u092B\u093C\u0930\u094D\u092E, \u092A\u0948\u0915 \u0939\u094B \u0930\u0939\u093E \u0939\u0948' },
  shipped: { en: 'shipped, on the way', hinglish: 'ship ho gaya, raste mein hai', hi: '\u0936\u093F\u092A \u0939\u094B \u0917\u092F\u093E, \u0930\u093E\u0938\u094D\u0924\u0947 \u092E\u0947\u0902' },
  delivered: { en: 'delivered', hinglish: 'deliver ho gaya', hi: '\u0921\u093F\u0932\u0940\u0935\u0930 \u0939\u094B \u0917\u092F\u093E' }, cancelled: { en: 'cancelled', hinglish: 'cancel ho gaya', hi: '\u0930\u0926\u094D\u0926' } };
const QUICK = { en: ['Suggest for oily skin', 'Morning routine', 'Track my order', 'Shipping & COD', 'Returns', 'Talk to a person'],
  hinglish: ['Oily skin ke liye', 'Subah ka routine', 'Mera order kahan hai', 'Shipping aur COD', 'Return kaise kare', 'Insaan se baat'],
  hi: ['\u0911\u092F\u0932\u0940 \u0938\u094D\u0915\u093F\u0928 \u0915\u0947 \u0932\u093F\u090F', '\u0938\u0941\u092C\u0939 \u0915\u093E \u0930\u0942\u091F\u0940\u0928', '\u092E\u0947\u0930\u093E \u0911\u0930\u094D\u0921\u0930', '\u0936\u093F\u092A\u093F\u0902\u0917', '\u0930\u093F\u091F\u0930\u094D\u0928', '\u091F\u0940\u092E \u0938\u0947 \u092C\u093E\u0924'] };
function pick(arr, seed) { return arr[Math.abs(seed | 0) % arr.length]; }
function fill(s, vars) { return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? '' : String(vars[k]))); }
function say(key, lang, vars, seed) { const set = T[key]; const arr = set[lang] || set.hinglish || set.en; return fill(pick(arr, seed || 0), vars || {}); }
function findProducts(text, products) {
  const hits = [];
  for (const [id, re] of PRODUCT_ALIASES) { const p = products.find((x) => new RegExp('^' + id + '$').test(x.id)); if (p && re.test(text) && !hits.includes(p)) hits.push(p); }
  for (const p of products) if (!hits.includes(p) && text.toLowerCase().includes(p.name.toLowerCase())) hits.push(p);
  return hits;
}
export function digitsAscii(s) { return String(s || '').replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x0966)); }
function cardOf(p) { return { id: p.id, name: p.name, size: p.size, price: p.price, mrp: p.mrp, image: p.image, in_stock: p.in_stock }; }
function routineText(products, lang) {
  const has = (id) => products.find((p) => p.id === id);
  const am = ['hydrating-face-wash', 'vitamin-c-serum', 'daily-moisturizer', 'sunscreen-spf50'].map(has).filter(Boolean);
  const pm = ['hydrating-face-wash', 'niacinamide-serum', 'daily-moisturizer'].map(has).filter(Boolean);
  return { am: am.map((p) => p.name).join(' \u2192 '), pm: pm.map((p) => p.name).join(' \u2192 '), products: [...new Set([...am, ...pm])] };
}
// the rules engine: returns { text, intent, products, quick, handoff, ctx }
export async function faqReply(env, ctxIn, message, lang, facts) {
  const raw = digitsAscii(String(message || '').slice(0, 600));
  const text = raw.toLowerCase();
  const ctx = { ...(ctxIn || {}) };
  const seed = raw.length + (ctx.n || 0);
  const { products, cfg, ui, user } = facts;
  const out = { products: [], quick: [], handoff: false, intent: 'fallback' };
  const orderId = (raw.toUpperCase().match(/\bAV-?\d{6}-?[A-Z0-9]{6}\b/) || [])[0];
  const phone = (raw.replace(/[\s-]/g, '').match(/(?:\+?91)?([6-9]\d{9})/) || [])[1];
  const email = (raw.match(/[^\s@]+@[^\s@]+\.[^\s@]+/) || [])[0];
  const pin = (raw.match(/\b([1-9]\d{5})\b/) || [])[1];
  // 1. order status (deterministic; uses the same check as Track order)
  const wantsOrder = /order|track|parcel|delivery\s*(kab|status)|kahan\s*(hai|h)|where\s*is\s*my|status|ऑर्डर|पार्सल/i.test(text);
  if (orderId || (ctx.pending_order && (phone || email))) {
    const id = (orderId || ctx.pending_order).replace(/^AV-?(\d{6})-?([A-Z0-9]{6})$/, 'AV-$1-$2');
    let o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
    const owner = o && user && o.user_id === user.id;
    if (o && !owner && !(phone || email)) { ctx.pending_order = id; out.intent = 'order_status'; out.text = say('order_contact', lang, { id }, seed); return { ...out, ctx }; }
    if (!o || !(owner || contactMatches(o, phone || email))) { delete ctx.pending_order; out.intent = 'order_status'; out.text = say('order_none', lang, {}, seed); out.handoff = true; return { ...out, ctx }; }
    delete ctx.pending_order;
    const items = (await loadItems(env, [id]))[id] || [];
    const ev = await env.DB.prepare('SELECT created_at FROM order_events WHERE order_id = ? ORDER BY id DESC LIMIT 1').bind(id).first();
    out.intent = 'order_status';
    out.text = say('order_status', lang, { id, status: (STATUS_WORD[o.status] || {})[lang] || o.status, when: istString((ev && ev.created_at) || o.updated_at), total: inr(o.total), items: items.map((i) => i.name + ' \u00D7' + i.qty).join(', ') }, seed);
    out.order = { id, status: o.status };
    return { ...out, ctx };
  }
  if (wantsOrder && !/return|refund|wapas/i.test(text) && !/shipping|charge|kitne din|how long|days/i.test(text)) {
    out.intent = 'order_status';
    if (user) {
      const rows = (await env.DB.prepare('SELECT id, status, total, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 3').bind(user.id).all()).results;
      if (rows.length) { out.text = say('my_orders', lang, { list: rows.map((r) => `${r.id}: ${(STATUS_WORD[r.status] || {})[lang] || r.status} \u00B7 ${inr(r.total)}`).join('\n') }, seed); return { ...out, ctx }; }
    }
    ctx.pending_order = null; out.text = say('order_ask', lang, {}, seed); return { ...out, ctx };
  }
  // 2. safety first
  if (MEDICAL.test(text)) { out.intent = 'medical'; out.text = say('medical', lang, {}, seed); out.handoff = true; return { ...out, ctx }; }
  // 3. a person
  if (/human|agent|person|insaan|real\s*person|baat\s*kar|call\s*(me|karo)|contact|complain|shikayat|owner|whatsapp|टीम|बात/i.test(text)) { out.intent = 'human'; out.text = say('human', lang, {}, seed); out.handoff = true; return { ...out, ctx }; }
  if (/^(hi+|hello|hey|namaste|namaskar|hii|helo|नमस्ते|नमस्कार|good\s*(morning|evening|afternoon))\b/i.test(text.trim()) && text.length < 30) {
    out.intent = 'greet'; out.text = say('greet', lang, { name: ui.chat.name }, seed); out.quick = QUICK[lang] || QUICK.en; return { ...out, ctx };
  }
  if (/^(thanks|thank\s*you|thx|shukriya|dhanyavad|dhanyawad|ok\s*thanks|धन्यवाद|शुक्रिया)/i.test(text.trim())) { out.intent = 'thanks'; out.text = say('thanks', lang, {}, seed); return { ...out, ctx }; }
  // 4. delivery to a pincode
  if (pin && /pin|deliver|delivery|ship|aata|aayega|pahunch|available|डिलीवरी|पिन/i.test(text)) {
    const r = pincodeServiceable(ui.delivery, pin); out.intent = 'pincode';
    out.text = r.ok ? say('pin_ok', lang, { pin }, seed) : say('pin_no', lang, { pin, msg: ui.delivery.message || '' }, seed);
    return { ...out, ctx };
  }
  const prods = findProducts(text, products);
  const ingHit = INGREDIENT_WORDS.find(([, re]) => re.test(text));
  // 5. policies
  if (/return|refund|replace|exchange|wapas|lautana|रिटर्न|रिफंड|वापस/i.test(text)) { out.intent = 'returns'; out.text = say('returns', lang, {}, seed); return { ...out, ctx }; }
  if (/ship|delivery|deliver|courier|kitne\s*din|how\s*long|dispatch|शिपिंग|डिलीवरी/i.test(text) && !prods.length) {
    out.intent = 'shipping'; out.text = say('shipping', lang, { free: inr(cfg.free_shipping_from), fee: inr(cfg.shipping_fee) }, seed); return { ...out, ctx };
  }
  if (/\bcod\b|cash\s*on|payment|pay\b|upi|card|gst|invoice|bill|पेमेंट|कैश/i.test(text)) { out.intent = 'payment'; out.text = say('payment', lang, {}, seed); return { ...out, ctx }; }
  if (/offer|discount|coupon|code|sale|deal|chhoot|chut|ऑफ़र|छूट|bargain|mol\s*bhav|kam\s*karo|sasta/i.test(text) && !prods.length) {
    out.intent = 'offers';
    const bargainOn = ui.bargain.on && ui.features.bargain;
    out.text = say('offers', lang, { ann: cfg.announcement || (lang === 'en' ? 'see the banner on our home page.' : 'home page ka banner dekhiye.'), bargain: bargainOn ? say('bargain_hint', lang, {}, seed) : '' }, seed);
    return { ...out, ctx };
  }
  if (/password|login|sign\s*in|account|पासवर्ड|लॉगिन/i.test(text)) { out.intent = 'account'; out.text = say('password', lang, {}, seed); return { ...out, ctx }; }
  if (/address|location|store\s*(kahan|where)|shop\s*(kahan|where)|visit|timing|hours|open|band|khula|पता|दुकान/i.test(text)) {
    out.intent = 'location';
    const loc = ui.location;
    if (loc.show && loc.address) {
      const today = loc.hours[(new Date(Date.now() + 330 * 60000).getUTCDay() + 6) % 7];
      out.text = say('location', lang, { name: loc.name ? loc.name + ', ' : '', address: [loc.address, loc.city, loc.pincode].filter(Boolean).join(', '), today: today.closed ? (lang === 'en' ? 'closed' : 'band') : today.open + '\u2013' + today.close }, seed);
      if (loc.lat != null && loc.lng != null) out.map = `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`;
    } else out.text = say('online_only', lang, {}, seed);
    return { ...out, ctx };
  }
  // 6. a specific product
  if (prods.length) {
    const p = prods[0]; out.intent = 'product'; out.products = prods.slice(0, 3).map(cardOf);
    const mrp = p.mrp && p.mrp > p.price ? (lang === 'hi' ? ` (MRP ${inr(p.mrp)})` : ` (MRP ${inr(p.mrp)})`) : '';
    const vars = { name: p.name, size: p.size || '', price: inr(p.price), mrp, short: p.short || '', ing: (p.ingredients || []).join(', '), how: p.how_to_use || '' };
    if (/price|kitn|daam|cost|rate|rs\b|rupe|₹|कीमत|दाम|कितने/i.test(text) && prods.length === 1) { out.text = say('price_only', lang, vars, seed); }
    else if (/how\s*to|use|apply|lagay|lagana|lagau|kaise|कैसे|लगाएं/i.test(text)) out.text = say('how_only', lang, vars, seed);
    else out.text = say('product', lang, vars, seed);
    if (prods.length > 1) out.text = prods.slice(0, 3).map((x) => say('price_only', lang, { name: x.name, size: x.size || '', price: inr(x.price), mrp: '' }, seed)).join('\n');
    if (p.in_stock === false) out.text += lang === 'en' ? '\n(It is out of stock right now.)' : '\n(Abhi stock mein nahi hai.)';
    return { ...out, ctx };
  }
  // 7. an ingredient
  if (ingHit) {
    const [name, re] = ingHit; const list = products.filter((p) => (p.ingredients || []).some((i) => re.test(i)));
    out.intent = 'ingredient'; out.products = list.slice(0, 3).map(cardOf);
    out.text = list.length ? say('ingredient', lang, { ing: name, list: list.map((p) => p.name).join(', ') }, seed) + ' ' + say('patch', lang, {}, seed) : say('ingredient_none', lang, { ing: name }, seed);
    return { ...out, ctx };
  }
  // 8. routine
  if (/routine|regime|step|morning|night|evening|subah|raat|shaam|रूटीन|सुबह|रात/i.test(text)) {
    const r = routineText(products, lang); out.intent = 'routine'; out.products = r.products.slice(0, 4).map(cardOf);
    out.text = say('routine', lang, { am: r.am, pm: r.pm }, seed); return { ...out, ctx };
  }
  // 9. concern -> recommendation
  const concern = CONCERNS.find(([, re]) => re.test(text));
  if (concern) {
    const list = concern[2].map((id) => products.find((p) => p.id === id)).filter(Boolean);
    out.intent = 'recommend'; out.products = list.map(cardOf);
    out.text = say('recommend', lang, { concern: CONCERN_LABEL[concern[0]][lang] }, seed) + '\n' + list.map((p) => '\u2022 ' + p.name + ' \u2014 ' + inr(p.price) + ': ' + (p.short || '')).join('\n') + '\n' + say('patch', lang, {}, seed);
    if (concern[0] === 'oily' && /acne|pimple|breakout|daane|muhase|मुंहासे|दाने|पिंपल/i.test(text)) out.text += '\n' + say('acne_note', lang, {}, seed);
    return { ...out, ctx };
  }
  if (/suggest|recommend|best|kya\s*(lu|lun|loon|use)|which|kaunsa|konsa|kon\s*sa|product|skin|सुझाव|कौन/i.test(text)) {
    out.intent = 'ask_concern'; out.text = say('ask_concern', lang, {}, seed);
    out.quick = lang === 'en' ? ['Glow', 'Oily skin', 'Dry skin', 'Dark spots', 'Sun care', 'Sensitive skin'] : lang === 'hi' ? ['\u0928\u093F\u0916\u093E\u0930', '\u0911\u092F\u0932\u0940 \u0938\u094D\u0915\u093F\u0928', '\u0930\u0942\u0916\u0940 \u0938\u094D\u0915\u093F\u0928', '\u0926\u093E\u0917-\u0927\u092C\u094D\u092C\u0947', '\u0927\u0942\u092A', 'Sensitive skin'] : ['Glow / nikhar', 'Oily skin', 'Rukhi skin', 'Daag-dhabbe', 'Dhoop', 'Sensitive skin'];
    return { ...out, ctx };
  }
  out.text = say('fallback', lang, {}, seed); out.handoff = true; out.quick = QUICK[lang] || QUICK.en;
  return { ...out, ctx };
}

// ---------- the owner's own AI key (optional) ----------
async function llmConfig(env, ui) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'secret:chat_llm_key'").first();
  const provider = ui.chat.provider || '';
  return { provider, key: provider && row ? row.value : '', model: ui.chat.model || ({ gemini: 'gemini-2.5-flash', openai: 'gpt-4o-mini', groq: 'llama-3.3-70b-versatile' })[provider] || '' };
}
export function llmSystemPrompt(facts, lang) {
  const { products, cfg, ui } = facts;
  const cat = products.map((p) => `- id ${p.id}: ${p.name} (${p.size || ''}) price ${inr(p.price)}${p.mrp ? ', MRP ' + inr(p.mrp) : ''}${p.in_stock === false ? ', OUT OF STOCK' : ''}. ${p.short || ''} Ingredients: ${(p.ingredients || []).join(', ')}. How to use: ${p.how_to_use || ''}`).join('\n');
  return `You are "${ui.chat.name}", the shopping assistant of the ${ui.brand.store_name || 'AVERMONTIS'} skincare store (India).
Answer in the customer's language and script (${lang === 'hi' ? 'Hindi in Devanagari' : lang === 'hinglish' ? 'Hinglish, Hindi in Roman letters' : 'English'}). Be warm, short (max 80 words) and plain.
FACTS (the only facts you may use):
Products:
${cat}
Shipping: free on orders of ${inr(cfg.free_shipping_from)} or more, ${inr(cfg.shipping_fee)} below that; dispatch 1-3 working days; delivery 4-8 working days by pincode. Payment: Cash on Delivery only (UPI/card coming soon). Prices include GST; every order has a GST invoice.
Returns: unopened products within 7 days of delivery; damaged/leaking/wrong items: email within 48 hours with order number and photo for replacement or refund; opened products cannot be returned unless damaged; COD refunds by bank transfer/UPI within 7 working days of receiving the return.
Current announcement: ${cfg.announcement || 'none'}.
RULES: Never invent prices, discounts, ingredients, results or claims. Never promise to cure or treat anything; these are everyday cosmetics, not medicines. For skin conditions, pregnancy, allergies or medical questions, say to consult a dermatologist and patch test. Recommend only products from the list, by id. For order status you cannot look anything up: ask them to type their order number and phone. If unsure, offer the team on WhatsApp/email.
Reply ONLY as JSON: {"reply": "...", "product_ids": ["id", ...]}`;
}
export function allowedAmounts(facts) {
  const s = new Set([facts.cfg.free_shipping_from, facts.cfg.shipping_fee]);
  for (const p of facts.products) { s.add(p.price); if (p.mrp) s.add(p.mrp); }
  return s;
}
// every rupee amount in an AI reply must be a real catalogue/shipping number, or the reply is not used
export function amountsOk(text, facts) {
  const ok = allowedAmounts(facts);
  const re = /(?:₹|rs\.?|inr|rupees?)\s*([0-9][0-9,]*)/gi; let m;
  while ((m = re.exec(text))) { const n = Number(m[1].replace(/,/g, '')); if (!ok.has(n)) return false; }
  return true;
}
async function llmReply(env, llm, facts, history, message, lang) {
  const sys = llmSystemPrompt(facts, lang);
  const turns = history.slice(-8).concat([{ role: 'user', text: message }]);
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    let content = '';
    const base = env.CHAT_LLM_BASE || null;   // tests only
    if (llm.provider === 'gemini') {
      const url = (base || 'https://generativelanguage.googleapis.com') + '/v1beta/models/' + encodeURIComponent(llm.model) + ':generateContent';
      const r = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': llm.key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: turns.map((t) => ({ role: t.role === 'bot' ? 'model' : 'user', parts: [{ text: t.text }] })),
          generationConfig: { temperature: 0.3, maxOutputTokens: 500, responseMimeType: 'application/json' } }) });
      if (!r.ok) throw new Error('llm_http_' + r.status);
      const j = await r.json(); content = (((j.candidates || [])[0] || {}).content || {}).parts ? j.candidates[0].content.parts.map((p) => p.text || '').join('') : '';
    } else {
      const url = (base || (llm.provider === 'groq' ? 'https://api.groq.com/openai' : 'https://api.openai.com')) + '/v1/chat/completions';
      const r = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + llm.key },
        body: JSON.stringify({ model: llm.model, temperature: 0.3, max_tokens: 500, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: sys }].concat(turns.map((t) => ({ role: t.role === 'bot' ? 'assistant' : 'user', content: t.text }))) }) });
      if (!r.ok) throw new Error('llm_http_' + r.status);
      const j = await r.json(); content = ((j.choices || [])[0] || {}).message ? j.choices[0].message.content || '' : '';
    }
    const m = /\{[\s\S]*\}/.exec(content); if (!m) throw new Error('llm_no_json');
    const o = JSON.parse(m[0]); const reply = str(o.reply).slice(0, 900);
    if (!reply) throw new Error('llm_empty');
    if (!amountsOk(reply, facts)) throw new Error('llm_bad_amount');
    const ids = Array.isArray(o.product_ids) ? o.product_ids.filter((x) => facts.products.some((p) => p.id === x)).slice(0, 3) : [];
    return { text: reply, products: ids.map((id) => cardOf(facts.products.find((p) => p.id === id))) };
  } finally { clearTimeout(timer); }
}
const PUBLIC_STORE_EMAIL = 'avermontis@mail.tab.bot';
async function chatFacts(env, request) {
  const rows = await dbProducts(env, request.url, false);
  const products = rows.map((r) => shapeProduct(r));
  const s = await getSettings(env); const { settings } = await loadCatalog(env, request.url);
  const ui = await getUi(env);
  // the public store mailbox (shown on the contact page), never a private address unless the owner typed it under Customize -> Contact
  return { products, ui, cfg: { announcement: s.announcement || '', whatsapp_number: s.whatsapp_number || '', support_email: ui.contact.email || PUBLIC_STORE_EMAIL, free_shipping_from: settings.free_shipping_from, shipping_fee: settings.shipping_fee } };
}
function handoffLinks(cfg, lang) {
  const out = {};
  if (cfg.whatsapp_number) out.whatsapp = 'https://wa.me/' + cfg.whatsapp_number + '?text=' + encodeURIComponent(lang === 'en' ? 'Hi AVERMONTIS, I need help with' : 'Hi AVERMONTIS, mujhe help chahiye:');
  if (cfg.support_email) out.email = cfg.support_email;
  return out;
}
async function chatRoute(request, env) {
  const b = await readJson(request);
  await rateLimit(env, 'chat', clientIp(request), 40, 600);
  const facts = await chatFacts(env, request);
  if (!facts.ui.features.chat) throw new HttpError(403, 'chat_off', 'The assistant is switched off right now.');
  const message = clamp(b.message, 600);
  if (!message) throw new HttpError(400, 'invalid_input', 'Type a message.', null, { message: 'Type a message.' });
  const user = await currentUser(env, request);
  facts.user = user;
  let sid = /^[A-Za-z0-9_-]{16,40}$/.test(str(b.session_id)) ? str(b.session_id) : null;
  let sess = sid ? await env.DB.prepare('SELECT * FROM chat_sessions WHERE id = ?').bind(sid).first() : null;
  const t = nowIso();
  if (!sess) { sid = randToken(18); sess = { id: sid, ctx: '{}', msgs: 0 }; await env.DB.prepare('INSERT INTO chat_sessions (id, user_id, lang, source, ip, msgs, handoff, ctx, created_at, updated_at) VALUES (?,?,?,?,?,0,0,?,?,?)').bind(sid, user ? user.id : null, null, isAppRequest(request) ? 'app' : clamp(b.source, 20) || 'web', clientIp(request), '{}', t, t).run(); }
  if (sess.msgs >= 80) throw new HttpError(429, 'rate_limited', 'This chat is very long. Please start a new chat or contact us on WhatsApp/email.');
  const lang = ['en', 'hinglish', 'hi'].includes(b.lang) ? b.lang : detectLang(message);
  const ctx = { ...jparse(sess.ctx, {}), n: sess.msgs };
  const rules = await faqReply(env, ctx, message, lang, facts);
  let reply = rules, engine = 'faq';
  const llm = await llmConfig(env, facts.ui);
  const deterministic = ['order_status', 'medical', 'human', 'pincode', 'greet', 'thanks'].includes(rules.intent);
  if (llm.key && !deterministic) {
    try {
      const hist = (await env.DB.prepare('SELECT role, text FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 8').bind(sid).all()).results.reverse();
      const r = await llmReply(env, llm, facts, hist, message, lang);
      reply = { ...rules, text: r.text, products: r.products.length ? r.products : rules.products }; engine = 'llm';
    } catch (e) { engine = 'faq'; console.log(JSON.stringify({ level: 'warn', where: 'chat_llm', error: String(e && e.message || e).slice(0, 120) })); }
  }
  const links = handoffLinks(facts.cfg, lang);
  if (reply.text && /^[a-z]/.test(reply.text)) reply = { ...reply, text: reply.text.charAt(0).toUpperCase() + reply.text.slice(1) };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO chat_messages (session_id, role, text, intent, engine, created_at) VALUES (?,?,?,?,?,?)').bind(sid, 'user', message, rules.intent, null, t),
    env.DB.prepare('INSERT INTO chat_messages (session_id, role, text, intent, engine, created_at) VALUES (?,?,?,?,?,?)').bind(sid, 'bot', reply.text, rules.intent, engine, t),
    env.DB.prepare('UPDATE chat_sessions SET msgs = msgs + 2, lang = ?, ctx = ?, handoff = MAX(handoff, ?), user_id = COALESCE(user_id, ?), updated_at = ? WHERE id = ?')
      .bind(lang, JSON.stringify(rules.ctx || {}), rules.handoff ? 1 : 0, user ? user.id : null, t, sid)
  ]);
  return json(200, { ok: true, session_id: sid, lang, engine, reply: { text: reply.text, intent: rules.intent, products: reply.products || [], quick: reply.quick || [], map: reply.map || null,
    handoff: rules.handoff ? links : null } });
}
async function adminChats(request, env, url) {
  await requireAdmin(env, request);
  const { limit, offset } = pageArgs(url);
  const sessions = (await env.DB.prepare('SELECT s.*, u.email AS account_email FROM chat_sessions s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.updated_at DESC LIMIT ? OFFSET ?').bind(limit, offset).all()).results;
  const ids = sessions.map((s) => s.id);
  const msgs = ids.length ? (await env.DB.prepare(`SELECT session_id, role, text, intent, engine, created_at FROM chat_messages WHERE session_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).bind(...ids).all()).results : [];
  const by = {}; for (const m of msgs) (by[m.session_id] = by[m.session_id] || []).push({ ...m, time_ist: istString(m.created_at) });
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const st = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(handoff),0) AS h FROM chat_sessions WHERE created_at >= ?').bind(since).first();
  const top = (await env.DB.prepare("SELECT intent, COUNT(*) AS n FROM chat_messages WHERE role = 'user' AND created_at >= ? GROUP BY intent ORDER BY n DESC LIMIT 8").bind(since).all()).results;
  return json(200, { ok: true, stats: { chats_7d: st.n, handoffs_7d: st.h, top_intents: top }, chats: sessions.map((s) => ({ id: s.id, source: s.source, lang: s.lang, account: s.account_email || null, msgs: s.msgs, handoff: !!s.handoff,
    started_ist: istString(s.created_at), updated_ist: istString(s.updated_at), messages: by[s.id] || [] })) });
}
async function adminChatTest(request, env) {
  await requireAdmin(env, request);
  checkOrigin(request);
  await rateLimit(env, 'chattest', clientIp(request), 10, 3600);
  const facts = await chatFacts(env, request); const llm = await llmConfig(env, facts.ui);
  if (!llm.key) throw new HttpError(400, 'no_key', 'Choose an AI provider and save your API key first.');
  try { const r = await llmReply(env, llm, facts, [], 'Which serum is good for a dull-looking skin? Give the price.', 'en'); return json(200, { ok: true, works: true, sample: r.text }); }
  catch (e) { return json(200, { ok: true, works: false, error: String(e && e.message || e).replace('llm_http_', 'The AI service answered HTTP ').slice(0, 120) }); }
}

// ---------- notifications (offers/news from the owner + the customer's own order updates) ----------
async function notificationsRoute(request, env) {
  const ui = await getUi(env);
  const now = nowIso();
  const list = ui.features.notifications ? (await env.DB.prepare('SELECT id, title, body, link, kind, created_at FROM notifications WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY id DESC LIMIT 20').bind(now).all()).results : [];
  const items = list.map((n) => ({ id: 'n' + n.id, kind: n.kind, title: n.title, body: n.body || '', link: safeLink(n.link), at: n.created_at }));
  const user = await currentUser(env, request);
  if (user) {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const ev = (await env.DB.prepare("SELECT e.id, e.order_id, e.status, e.note, e.created_at FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.user_id = ? AND e.created_at >= ? ORDER BY e.id DESC LIMIT 20").bind(user.id, since).all()).results;
    for (const e of ev) items.push({ id: 'o' + e.id, kind: 'order', title: 'Order ' + e.order_id + ': ' + (STATUS_WORD[e.status] ? STATUS_WORD[e.status].en : e.status), body: e.note || '', link: '', order_id: e.order_id, at: e.created_at });
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return json(200, { ok: true, items: items.slice(0, 30) }, { 'Cache-Control': 'private, no-store' });
}
async function adminNotifications(request, env) {
  await requireAdmin(env, request);
  const rows = (await env.DB.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 100').all()).results;
  return json(200, { ok: true, notifications: rows.map((r) => ({ ...r, active: !!r.active, created_ist: istString(r.created_at), expires_ist: r.expires_at ? istString(r.expires_at) : null })) });
}
async function adminCreateNotification(request, env) {
  await requireAdmin(env, request);
  const b = await readJson(request);
  const f = {}; const title = clamp(b.title, 80), body = clamp(b.body, 240), link = str(b.link), kind = ['offer', 'news', 'tip'].includes(b.kind) ? b.kind : 'news';
  if (title.length < 3) f.title = 'Title: at least 3 characters.';
  if (link && !safeLink(link)) f.link = 'Link must start with / or https://';
  if (/[<>]/.test(title + body)) f.body = 'Please remove < and > characters.';
  let exp = null; const days = Number(b.days || 0);
  if (days) { if (!Number.isInteger(days) || days < 1 || days > 365) f.days = 'Show for 1-365 days (or 0 for no end).'; else exp = new Date(Date.now() + days * 864e5).toISOString(); }
  assertValid(f);
  await env.DB.prepare('INSERT INTO notifications (title, body, link, kind, active, expires_at, created_at) VALUES (?,?,?,?,1,?,?)').bind(title, body || null, link || null, kind, exp, nowIso()).run();
  return adminNotifications(request, env);
}
async function adminPatchNotification(request, env, id) {
  await requireAdmin(env, request);
  const b = await readJson(request);
  if (b.delete === true) await env.DB.prepare('DELETE FROM notifications WHERE id = ?').bind(id).run();
  else await env.DB.prepare('UPDATE notifications SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, id).run();
  return adminNotifications(request, env);
}

// ---------- insights for the dashboard ----------
async function adminInsights(request, env, url) {
  await requireAdmin(env, request);
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10) || 30));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const tot = await env.DB.prepare("SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(discount),0) AS discounts FROM orders WHERE status != 'cancelled' AND created_at >= ?").bind(since).first();
  const byStatus = (await env.DB.prepare('SELECT status, COUNT(*) AS n FROM orders WHERE created_at >= ? GROUP BY status').bind(since).all()).results;
  const top = (await env.DB.prepare("SELECT i.product_id AS id, i.name, SUM(i.qty) AS qty, SUM(i.line_total) AS revenue FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status != 'cancelled' AND o.created_at >= ? GROUP BY i.product_id, i.name ORDER BY revenue DESC LIMIT 6").bind(since).all()).results;
  const rep = await env.DB.prepare("SELECT COUNT(*) AS n FROM (SELECT phone FROM orders WHERE status != 'cancelled' GROUP BY phone HAVING COUNT(*) > 1)").first();
  const cust = await env.DB.prepare("SELECT COUNT(DISTINCT phone) AS n FROM orders WHERE status != 'cancelled'").first();
  const chats = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(handoff),0) AS h FROM chat_sessions WHERE created_at >= ?').bind(since).first();
  const bg = await bargainStats(env, since);
  const wl = await env.DB.prepare('SELECT COUNT(*) AS n FROM wishlist').first();
  return json(200, { ok: true, days, revenue: tot.revenue, orders: tot.orders, aov: tot.orders ? Math.round(tot.revenue / tot.orders) : 0, discounts: tot.discounts,
    status_counts: Object.fromEntries(byStatus.map((r) => [r.status, r.n])), top_products: top, repeat_customers: rep.n, customers_with_orders: cust.n, chats: { sessions: chats.n, handoffs: chats.h }, bargain: bg, wishlist_items: wl.n });
}
async function adminOrderNote(request, env, id) {
  await requireAdmin(env, request);
  const b = await readJson(request);
  const admin_note = clamp(b.admin_note, 500), refund_note = clamp(b.refund_note, 500);
  const r = await env.DB.prepare('UPDATE orders SET admin_note = ?, refund_note = ?, updated_at = updated_at WHERE id = ?').bind(admin_note || null, refund_note || null, id).run();
  if (!r.meta || r.meta.changes !== 1) throw new HttpError(404, 'not_found', 'Order not found.');
  if (refund_note && b.log_event === true) await env.DB.prepare('INSERT INTO order_events (order_id, status, note, created_at) SELECT id, status, ?, ? FROM orders WHERE id = ?').bind('Refund: ' + refund_note.slice(0, 200), nowIso(), id).run();
  const events = (await env.DB.prepare('SELECT status, note, created_at FROM order_events WHERE order_id = ? ORDER BY id').bind(id).all()).results;
  return json(200, { ok: true, admin_note, refund_note, events: events.map((e) => ({ ...e, time_ist: istString(e.created_at) })) });
}
async function adminOrderEvents(request, env, id) {
  await requireAdmin(env, request);
  const o = await env.DB.prepare('SELECT admin_note, refund_note FROM orders WHERE id = ?').bind(id).first();
  if (!o) throw new HttpError(404, 'not_found', 'Order not found.');
  const events = (await env.DB.prepare('SELECT status, note, created_at FROM order_events WHERE order_id = ? ORDER BY id').bind(id).all()).results;
  return json(200, { ok: true, admin_note: o.admin_note || '', refund_note: o.refund_note || '', events: events.map((e) => ({ ...e, time_ist: istString(e.created_at) })) });
}

// ---------- bargaining ("Make an offer") ----------
// The floor price lives only here on the server and is never sent to any browser or app. Prices are decided by these rules,
// never by an AI. A deal becomes a one-time coupon locked to that customer and that product, valid for a short time.
const BARGAIN_LINES = {
  open: { en: ['This one is {list}. For you I can start at {counter}. What would you like to pay?', 'List price is {list}, but let\u2019s talk \u2014 I can do {counter}. Your offer?'],
    hinglish: ['Iska price {list} hai. Aapke liye {counter} se shuru karte hain. Aap kitna doge?', '{list} ka product hai, par chaliye baat karte hain \u2014 {counter} mein de sakta hoon. Aapka offer?'] },
  counter: { en: ['Hmm, {offer} is a little low. I can meet you at {counter}.', 'You drive a hard bargain! How about {counter}?', 'Let\u2019s find a middle: {counter} works for me.'],
    hinglish: ['Hmm, {offer} thoda kam hai. {counter} kar deta hoon.', 'Aap toh pakke bargainer ho! {counter} chalega?', 'Beech ka raasta: {counter} mein de deta hoon.'] },
  lowball: { en: ['{offer} is too low for this one, sorry \u2014 my best right now is {counter}.', 'I wish I could, but {offer} won\u2019t work. {counter} is a fair deal.'],
    hinglish: ['{offer} bahut kam hai, sorry \u2014 abhi best {counter} hai.', 'Kaash de pata, par {offer} mein nahi hoga. {counter} fair deal hai.'] },
  final: { en: ['Final offer: {counter}. That\u2019s the lowest I can go today. Deal?'], hinglish: ['Final offer: {counter}. Aaj isse kam nahi ho payega. Deal?'] },
  final_hold: { en: ['I\u2019ve already given my best: {counter}. Shall we lock it?'], hinglish: ['Main best de chuka hoon: {counter}. Lock kar dein?'] },
  accept: { en: ['Deal! \uD83E\uDD1D {price} it is. Your coupon {code} is valid for {mins} minutes \u2014 it\u2019s added to your bag.', 'Done! {price} for you. Coupon {code}, valid {mins} minutes.'],
    hinglish: ['Deal pakki! \uD83E\uDD1D {price} mein. Coupon {code} {mins} minute ke liye valid hai \u2014 bag mein add kar diya.', 'Ho gaya! {price} aapke liye. Coupon {code}, {mins} minute tak valid.'] },
  above: { en: ['No need to pay more than the price \uD83D\uDE04 \u2014 {counter} is yours if you want it.'], hinglish: ['Itna dene ki zarurat nahi \uD83D\uDE04 \u2014 {counter} mein le lijiye.'] },
  ask: { en: ['Tell me a price (like {hint}) and I\u2019ll see what I can do.'], hinglish: ['Ek price bataiye (jaise {hint}), main dekhta hoon kya ho sakta hai.'] },
  declined: { en: ['No problem! The offer stays open for a little while if you change your mind.'], hinglish: ['Koi baat nahi! Mann badle to thodi der tak offer khula hai.'] },
  closed: { en: ['This negotiation has ended. You can start a new one later.'], hinglish: ['Ye negotiation khatam ho gaya. Baad mein naya shuru kar sakte hain.'] }
};
function bline(key, lang, vars, seed) { const set = BARGAIN_LINES[key]; const arr = set[lang === 'en' ? 'en' : 'hinglish']; return fill(pick(arr, seed), vars); }
export function bargainRules(prod, global) {
  const b = jparse(prod.bargain, {}) || {};
  const P = prod.price;
  const maxPct = Number.isInteger(b.max_discount_pct) ? b.max_discount_pct : global.max_discount_pct;
  let floor = Number.isInteger(b.floor_price) && b.floor_price > 0 ? b.floor_price : Math.ceil(P * (1 - maxPct / 100));
  floor = Math.max(1, Math.min(P, floor));
  const startPct = Number.isInteger(b.start_discount_pct) ? b.start_discount_pct : global.start_discount_pct;
  const rounds = Number.isInteger(b.max_rounds) ? b.max_rounds : global.max_rounds;
  return { on: b.on !== false && global.on, P, floor, open: Math.max(floor, Math.round(P * (1 - startPct / 100))), rounds };
}
// a friendly price: ends in 9 when that stays within [lo, hi]
export function nicePrice(x, lo, hi) { x = Math.round(x); const n9 = Math.floor(x / 10) * 10 + 9; const c = n9 > x ? n9 - 10 : n9; for (const v of [n9, c]) if (v >= lo && v <= hi) return v; return Math.max(lo, Math.min(hi, x)); }
export function parseOffer(text) {
  const t = digitsAscii(String(text || '')).replace(/,/g, '');
  const k = /(\d+(?:\.\d+)?)\s*k\b/i.exec(t); if (k) return Math.round(parseFloat(k[1]) * 1000);
  const m = t.match(/\d{2,6}(?:\.\d+)?/g); if (!m) return null;
  return Math.round(parseFloat(m[0]));
}
// one step of the negotiation. state: {rounds, counter}; returns {action, counter, price, line}
export function negotiate(rules, state, offer, seed = 0) {
  const { P, floor, rounds: maxR } = rules;
  let counter = state.counter == null ? rules.open : state.counter;
  const r = (state.rounds || 0) + 1;
  if (offer >= counter) return { action: 'accept', price: Math.min(counter, Math.max(offer, floor)), counter, rounds: r, kind: offer >= P ? 'above' : 'accept' };
  if (r > maxR) return { action: 'final_hold', counter, rounds: r };
  if (offer < P * 0.5) return { action: 'counter', counter, rounds: r, kind: 'lowball' };
  const gap = counter - Math.max(floor, offer);
  const frac = [0.5, 0.45, 0.4, 0.35, 0.3, 0.3, 0.3, 0.3][r - 1] || 0.3;
  let next = counter - Math.ceil(gap * frac);
  if (r >= maxR) next = Math.max(floor, Math.min(next, Math.max(floor, offer)));     // last round: our best
  next = nicePrice(Math.max(floor, next), floor, counter);
  if (offer >= next) return { action: 'accept', price: Math.max(offer, floor), counter: next, rounds: r, kind: 'accept' };
  return { action: 'counter', counter: next, rounds: r, kind: r >= maxR ? 'final' : 'counter' };
}
async function bargainRoute(request, env) {
  const b = await readJson(request);
  await rateLimit(env, 'bargain', clientIp(request), 60, 600);
  const user = await currentUser(env, request);
  if (!user) throw new HttpError(401, 'login_required', 'Please sign in to make an offer \u2014 the deal is saved to your account.');
  const ui = await getUi(env);
  if (!ui.bargain.on || !ui.features.bargain) throw new HttpError(403, 'bargain_off', 'Offers are switched off right now.');
  const lang = b.lang === 'en' ? 'en' : (b.lang === 'hinglish' || b.lang === 'hi' ? 'hinglish' : detectLang(b.message) === 'en' ? 'en' : 'hinglish');
  const t = nowIso(); const mins = ui.bargain.deal_minutes;
  let bg = null;
  if (b.bargain_id) {
    bg = await env.DB.prepare('SELECT * FROM bargains WHERE id = ? AND user_id = ?').bind(str(b.bargain_id), user.id).first();
    if (!bg) throw new HttpError(404, 'not_found', 'Offer not found. Start a new one.');
  }
  const pid = bg ? bg.product_id : str(b.product_id);
  const prod = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND active = 1').bind(pid).first();
  if (!prod) throw new HttpError(404, 'not_found', 'Product not found.');
  if (prod.stock < 1) throw new HttpError(409, 'sold_out', 'This product is out of stock right now.');
  const rules = bargainRules(prod, ui.bargain);
  if (!rules.on) throw new HttpError(403, 'bargain_off', 'Offers are not available on this product.');
  const pub = (row, extra) => ({ id: row.id, product_id: row.product_id, list_price: row.list_price, counter: row.counter, rounds_left: Math.max(0, rules.rounds - row.rounds), status: row.status,
    agreed_price: row.agreed_price || null, coupon: row.coupon_code ? { code: row.coupon_code } : null, log: jparse(row.log, []).slice(-20), ...(extra || {}) });
  const today = istMidnightUtcIso();
  if (!bg) {
    // an agreed deal for this product today is reused (no second coupon)
    const deal = await env.DB.prepare("SELECT b.*, c.expires_at AS c_exp, c.used_count AS c_used FROM bargains b LEFT JOIN coupons c ON c.code = b.coupon_code WHERE b.user_id = ? AND b.product_id = ? AND b.status = 'agreed' AND b.created_at >= ? ORDER BY b.created_at DESC LIMIT 1").bind(user.id, pid, today).first();
    if (deal) {
      const live = deal.coupon_code && deal.c_exp > t && !deal.c_used;
      return json(200, { ok: true, bargain: pub(deal, { coupon: live ? { code: deal.coupon_code, expires_at: deal.c_exp, price: deal.agreed_price } : null }),
        message: live ? (lang === 'en' ? `You already have a deal on this today: ${inr(deal.agreed_price)} with coupon ${deal.coupon_code}.` : `Aaj is product par aapki deal pehle se hai: ${inr(deal.agreed_price)}, coupon ${deal.coupon_code}.`)
          : (lang === 'en' ? 'You\u2019ve already made a deal on this product today. Come back tomorrow!' : 'Aaj is product par deal ho chuki hai. Kal phir try kijiye!'), done: true });
    }
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM bargains WHERE user_id = ? AND created_at >= ?').bind(user.id, today).first();
    if (n.n >= ui.bargain.per_customer_daily) throw new HttpError(429, 'bargain_limit', lang === 'en' ? 'You\u2019ve used today\u2019s offers. Try again tomorrow!' : 'Aaj ke offers ho gaye. Kal phir try kijiye!');
    const cap = await env.DB.prepare("SELECT COUNT(*) AS n FROM bargains WHERE status = 'agreed' AND created_at >= ?").bind(today).first();
    if (cap.n >= ui.bargain.daily_cap) throw new HttpError(429, 'bargain_limit', lang === 'en' ? 'Today\u2019s deals are all taken. Try again tomorrow!' : 'Aaj ki saari deals ho gayi. Kal try kijiye!');
    const id = 'BG' + randToken(12);
    const line = bline('open', lang, { list: inr(rules.P), counter: inr(rules.open) }, Date.now());
    const log = [{ by: 'bot', text: line, price: rules.open, at: t }];
    await env.DB.prepare('INSERT INTO bargains (id, product_id, user_id, status, list_price, rounds, counter, log, ip, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(id, pid, user.id, 'open', rules.P, 0, rules.open, JSON.stringify(log), clientIp(request), t, t).run();
    bg = await env.DB.prepare('SELECT * FROM bargains WHERE id = ?').bind(id).first();
    if (!b.message && b.offer == null) return json(200, { ok: true, bargain: pub(bg), message: line });
  }
  if (bg.status !== 'open') return json(200, { ok: true, bargain: pub(bg), message: bline(bg.status === 'agreed' ? 'closed' : 'closed', lang, {}, 0), done: true });
  if (Date.parse(bg.created_at) < Date.now() - 2 * 3600e3) { await env.DB.prepare("UPDATE bargains SET status = 'closed', updated_at = ? WHERE id = ?").bind(t, bg.id).run(); return json(200, { ok: true, bargain: pub({ ...bg, status: 'closed' }), message: bline('closed', lang, {}, 0), done: true }); }
  const log = jparse(bg.log, []);
  const msg = clamp(b.message, 200);
  const seed = log.length + (msg || '').length;
  let accept = b.action === 'accept' || (/^\s*(yes|ok|okay|deal|done|haan|han|theek|thik|chalega|pakka|accept|ठीक|हाँ)\b/i.test(msg || '') && parseOffer(msg) == null);
  const declineIt = b.action === 'decline' || /^\s*(no|nahi|nhi|nope|rehne do|cancel)\b/i.test(msg || '');
  if (msg) log.push({ by: 'user', text: msg, at: t });
  if (declineIt) {
    const line = bline('declined', lang, {}, seed); log.push({ by: 'bot', text: line, at: t });
    await env.DB.prepare('UPDATE bargains SET log = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(log.slice(-40)), t, bg.id).run();
    return json(200, { ok: true, bargain: pub({ ...bg, log: JSON.stringify(log) }), message: line });
  }
  let res;
  if (accept) res = { action: 'accept', price: bg.counter, counter: bg.counter, rounds: bg.rounds, kind: 'accept' };
  else {
    const offer = b.offer != null ? Math.round(Number(b.offer)) : parseOffer(msg);
    if (!offer || !isFinite(offer) || offer < 1) {
      const line = bline('ask', lang, { hint: inr(nicePrice(bg.counter * 0.97, 1, bg.counter)) }, seed); log.push({ by: 'bot', text: line, at: t });
      await env.DB.prepare('UPDATE bargains SET log = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(log.slice(-40)), t, bg.id).run();
      return json(200, { ok: true, bargain: pub({ ...bg, log: JSON.stringify(log) }), message: line });
    }
    if (!msg) log.push({ by: 'user', text: inr(offer), price: offer, at: t });
    else log[log.length - 1].price = offer;
    res = negotiate(rules, { rounds: bg.rounds, counter: bg.counter }, offer, seed);
    res.offer = offer;
  }
  if (res.action === 'accept') {
    const price = Math.max(rules.floor, Math.min(rules.P, res.price));      // the floor is enforced here, whatever happened before
    const value = rules.P - price;
    let code = null, exp = null;
    if (value > 0) {
      code = 'DEAL' + randToken(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X').slice(0, 8);
      exp = new Date(Date.now() + mins * 60000).toISOString();
      await env.DB.prepare("INSERT INTO coupons (code, kind, value, min_order, max_discount, expires_at, usage_limit, used_count, active, note, created_at, product_id, user_id, source) VALUES (?,?,?,?,?,?,?,0,1,?,?,?,?,'bargain')")
        .bind(code, 'flat', value, 0, value, exp, 1, 'Bargain ' + bg.id, t, rules.P ? pid : null, user.id).run();
    }
    const line = res.kind === 'above' ? bline('above', lang, { counter: inr(price) }, seed) + ' ' + (code ? bline('accept', lang, { price: inr(price), code, mins }, seed) : '') : (code ? bline('accept', lang, { price: inr(price), code, mins }, seed) : (lang === 'en' ? 'Deal at the list price!' : 'List price par deal!'));
    log.push({ by: 'bot', text: line, price, at: t });
    await env.DB.prepare("UPDATE bargains SET status = 'agreed', agreed_price = ?, coupon_code = ?, last_offer = COALESCE(?, last_offer), rounds = ?, log = ?, updated_at = ? WHERE id = ? AND status = 'open'")
      .bind(price, code, res.offer || null, res.rounds, JSON.stringify(log.slice(-40)), t, bg.id).run();
    const row = await env.DB.prepare('SELECT * FROM bargains WHERE id = ?').bind(bg.id).first();
    return json(200, { ok: true, bargain: pub(row, { coupon: code ? { code, expires_at: exp, price } : null }), message: line, done: true });
  }
  const key = res.action === 'final_hold' ? 'final_hold' : res.kind;
  const line = bline(key, lang, { offer: inr(res.offer), counter: inr(res.counter) }, seed);
  log.push({ by: 'bot', text: line, price: res.counter, at: t });
  await env.DB.prepare('UPDATE bargains SET counter = ?, rounds = ?, last_offer = ?, log = ?, updated_at = ? WHERE id = ?').bind(res.counter, Math.min(res.rounds, rules.rounds), res.offer, JSON.stringify(log.slice(-40)), t, bg.id).run();
  const row = await env.DB.prepare('SELECT * FROM bargains WHERE id = ?').bind(bg.id).first();
  return json(200, { ok: true, bargain: pub(row, { final: res.rounds >= rules.rounds }), message: line });
}
async function bargainStats(env, since) {
  const s = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'agreed' THEN 1 ELSE 0 END) AS agreed, AVG(CASE WHEN status = 'agreed' THEN 100.0 * (list_price - agreed_price) / list_price END) AS avg_pct FROM bargains WHERE created_at >= ?").bind(since).first();
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE coupon_code LIKE 'DEAL%' AND status != 'cancelled' AND created_at >= ?").bind(since).first();
  return { total: s.total || 0, agreed: s.agreed || 0, rate: s.total ? Math.round(100 * (s.agreed || 0) / s.total) : 0, avg_discount_pct: s.avg_pct ? Math.round(s.avg_pct * 10) / 10 : 0, coupons_used: used.n };
}
async function adminBargains(request, env, url) {
  await requireAdmin(env, request);
  const { limit, offset } = pageArgs(url);
  const rows = (await env.DB.prepare('SELECT b.*, u.email, p.name AS product_name, c.used_count AS c_used FROM bargains b LEFT JOIN users u ON u.id = b.user_id LEFT JOIN products p ON p.id = b.product_id LEFT JOIN coupons c ON c.code = b.coupon_code ORDER BY b.created_at DESC LIMIT ? OFFSET ?').bind(limit, offset).all()).results;
  const ui = await getUi(env, true);
  const prods = (await env.DB.prepare('SELECT id, name, price, bargain FROM products ORDER BY sort, name').all()).results.map((p) => { const r = bargainRules(p, { ...ui.bargain, on: true }); return { id: p.id, name: p.name, price: p.price, rules: { ...(jparse(p.bargain, {}) || {}) }, effective: { on: r.on, floor: r.floor, open: r.open, rounds: r.rounds } }; });
  return json(200, { ok: true, settings: ui.bargain, stats_30d: await bargainStats(env, new Date(Date.now() - 30 * 864e5).toISOString()), products: prods,
    bargains: rows.map((r) => ({ id: r.id, product: r.product_name || r.product_id, email: r.email, status: r.status, list_price: r.list_price, agreed_price: r.agreed_price, rounds: r.rounds, coupon: r.coupon_code, coupon_used: !!r.c_used, log: jparse(r.log, []), created_ist: istString(r.created_at) })) });
}
async function adminProductBargain(request, env, id) {
  await requireAdmin(env, request);
  const b = await readJson(request);
  const p = await env.DB.prepare('SELECT id, price FROM products WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'not_found', 'Product not found.');
  const f = {}; const v = { on: b.on !== false };
  const num = (x) => (x === '' || x == null ? null : Number(x));
  for (const [k, lo, hi] of [['floor_price', 1, p.price], ['max_discount_pct', 1, 60], ['start_discount_pct', 0, 30], ['max_rounds', 1, 8]]) {
    const n = num(b[k]); if (n == null) continue; if (!Number.isInteger(n) || n < lo || n > hi) f[k] = `Whole number ${lo}-${hi}.`; else v[k] = n;
  }
  if (v.floor_price != null && v.max_discount_pct != null) delete v.max_discount_pct;   // a set floor price wins
  assertValid(f);
  await env.DB.prepare('UPDATE products SET bargain = ? WHERE id = ?').bind(JSON.stringify(v), id).run();
  return adminBargains(request, env, new URL(request.url));
}

// ---------- AR assets ----------
export const AR_BUILTIN = ['vitamin-c-serum', 'niacinamide-serum', 'hydrating-face-wash', 'daily-moisturizer', 'sunscreen-spf50'];
export function arOf(r) {
  const a = jparse(r.ar, {}) || {};
  const model = a.model_url && /^\/media\/models\/[A-Za-z0-9_.-]+\.glb$/.test(a.model_url) ? a.model_url : (AR_BUILTIN.includes(r.id) ? '/assets/ar/models/' + r.id + '.glb' : '');
  return { on: a.on !== false && !!model, model, poster: AR_BUILTIN.includes(r.id) && !a.model_url ? '/assets/ar/posters/' + r.id + '.png' : '' };
}
async function adminProductAr(request, env, id) {
  await requireAdmin(env, request);
  const b = await readJson(request);
  const p = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'not_found', 'Product not found.');
  const v = { on: b.on !== false };
  if (b.model_url) { if (!/^\/media\/models\/[A-Za-z0-9_.-]+\.glb$/.test(str(b.model_url))) throw new HttpError(400, 'invalid_input', 'Upload a .glb 3D model here first.', null, { model_url: 'Upload a .glb file first.' }); v.model_url = str(b.model_url); }
  await env.DB.prepare('UPDATE products SET ar = ? WHERE id = ?').bind(JSON.stringify(v), id).run();
  const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  return json(200, { ok: true, ar: arOf(row) });
}
// uploads for brand images (logo, favicon, banners) and 3D models (.glb) — same storage as product photos
const MODEL_MAX_BYTES = 8 * 1024 * 1024;
async function adminUploadV4(request, env, url) {
  const kind = url.searchParams.get('kind') || 'products';
  if (kind === 'products') return adminUpload(request, env);
  await requireAdmin(env, request);
  checkOrigin(request);
  if (!env.MEDIA) throw new HttpError(503, 'no_storage', 'File storage is not connected.');
  const max = kind === 'model' ? MODEL_MAX_BYTES : UPLOAD_MAX_BYTES;
  if (Number(request.headers.get('content-length') || 0) > max) throw new HttpError(413, 'too_large', `File is too large (max ${max / 1048576} MB).`);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length > max) throw new HttpError(413, 'too_large', `File is too large (max ${max / 1048576} MB).`);
  if (buf.length < 100) throw new HttpError(400, 'bad_file', 'That file is empty.');
  let ext, type, folder;
  if (kind === 'model') {
    if (!(buf[0] === 0x67 && buf[1] === 0x6C && buf[2] === 0x54 && buf[3] === 0x46)) throw new HttpError(415, 'bad_file', 'Only .glb 3D model files are allowed.');
    ext = 'glb'; type = 'model/gltf-binary'; folder = 'models';
  } else if (kind === 'brand') {
    const k = sniffImage(buf); if (!k) throw new HttpError(415, 'bad_file', 'Only JPG, PNG or WebP images are allowed.');
    ext = k[0]; type = k[1]; folder = 'brand';
  } else throw new HttpError(400, 'invalid_input', 'Unknown upload kind.');
  const key = `${folder}/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 12)}.${ext}`;
  await env.MEDIA.put(key, buf, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
  return json(201, { ok: true, url: '/media/' + key, bytes: buf.length });
}
async function serveMediaV4(request, env, key) {
  if (!env.MEDIA || !/^(products|brand|models)\/[A-Za-z0-9_.-]{5,80}$/.test(key)) return null;
  const obj = await env.MEDIA.get(key);
  if (!obj) return null;
  const h = { 'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', ...SEC_HEADERS };
  if (key.startsWith('models/') || key.startsWith('brand/') || key.startsWith('products/')) { h['Access-Control-Allow-Origin'] = '*'; h['Cross-Origin-Resource-Policy'] = 'cross-origin'; }
  return new Response(obj.body, { status: 200, headers: h });
}
// the PWA manifest follows the owner's store name and uploaded icon
async function manifestV4(request, env) {
  const res = await env.ASSETS.fetch(new Request(new URL(request.url).origin + '/manifest.webmanifest'));
  let m; try { m = await res.json(); } catch { return null; }
  try {
    await ensureSchema(env);
    const ui = await getUi(env);
    if (ui.brand.store_name && ui.brand.store_name.toUpperCase() !== 'AVERMONTIS') { m.name = ui.brand.store_name; m.short_name = ui.brand.store_name.slice(0, 12); }
    if (ui.brand.favicon_url && safeImg(ui.brand.favicon_url)) m.icons = [{ src: ui.brand.favicon_url, sizes: '512x512', type: 'image/png', purpose: 'any' }].concat(m.icons || []);
  } catch { /* the static manifest */ }
  return new Response(JSON.stringify(m), { status: 200, headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache', ...SEC_HEADERS } });
}


// =====================================================================================================================
// v5 (Oct 2026): the owner signs in from the NORMAL login (username "admin" + the same owner password, same hash),
// admin security (lockout, optional PIN, idle timeout, sign out everywhere, owner sign-in history), a full design
// studio (every colour + dark palette, self-hosted fonts incl. Hindi, presets + saved themes, layout/cards/buttons/
// header/bottom bar/announcement/custom CSS, draft -> publish, version history, undo, reset, export/import) and an
// audit log of every owner change. Additive only: new tables + one new column. Nothing existing is dropped.
// =====================================================================================================================
export const MIGRATION_5_SQL = `-- 0005_v5.sql : design versions, audit log, admin PIN challenges + one-time app handoff codes
CREATE TABLE IF NOT EXISTS ui_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, ip TEXT);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, area TEXT, summary TEXT, detail TEXT, ip TEXT, device TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log (created_at DESC);
CREATE TABLE IF NOT EXISTS admin_tokens (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('pin','handoff')), tries INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL, ip TEXT, created_at TEXT NOT NULL);
`;
async function migrateV5(env) {
  const have = await env.DB.prepare('SELECT version FROM schema_migrations WHERE version = 5').first();
  if (have) return;
  const stmts = splitSql(MIGRATION_5_SQL).map((q) => env.DB.prepare(q));
  const cols = (await env.DB.prepare('PRAGMA table_info(sessions)').all()).results.map((c) => c.name);
  if (!cols.includes('last_seen_at')) stmts.push(env.DB.prepare('ALTER TABLE sessions ADD COLUMN last_seen_at TEXT'));
  stmts.push(env.DB.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (5, datetime('now'))"));
  await env.DB.batch(stmts);
}

// ---------- reserved names (nobody can sign up as "admin" or a look-alike) ----------
const LOOKALIKE = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', l: 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g',
  '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p', '\u0441': 'c', '\u0445': 'x', '\u0456': 'i', '\u0410': 'a', '\u0415': 'e', '\u041E': 'o', '\u0406': 'i', '\u043C': 'm', '\u041C': 'm', '\u043D': 'h', '\u0442': 't' };
export function normaliseHandle(s) {
  let t = String(s || '').normalize('NFKC').toLowerCase().replace(/[\u0300-\u036f\u200b-\u200d\ufeff]/g, '');
  t = [...t].map((c) => LOOKALIKE[c] || c).join('');
  return t.replace(/[^a-z]/g, '');
}
const RESERVED = ['admin', 'administrator', 'admins', 'adminuser', 'theadmin', 'siteadmin', 'superadmin', 'sysadmin', 'root', 'owner', 'storeowner', 'superuser', 'moderator', 'avermontis', 'avermontisadmin', 'support', 'staff'].map(normaliseHandle);
export function isReservedName(s) {
  const raw = String(s || '');
  if (raw.replace(/[\d\s._-]+$/, '') !== raw && isReservedName(raw.replace(/[\d\s._-]+$/, ''))) return true;   // "admin99", "admin_1"
  const n = normaliseHandle(s);
  if (!n) return false;
  return RESERVED.includes(n) || /^(the)?(site|store|shop|super|sys)?adm[il]n(istrator)?\d*$/.test(n) || /^ad+m+i+n+$/.test(n);
}
// the owner's username on the normal login form: "admin" in any letter case, nothing else
export function isAdminIdentifier(v) { return typeof v === 'string' && v.trim().toLowerCase() === 'admin'; }

// ---------- owner sign-in: one path for the normal login, the app and the old /admin page ----------
const ADMIN_FAIL_LIMIT = 5, ADMIN_LOCK_S = 15 * 60;            // 5 wrong tries -> locked for 15 minutes (per device/network)
const ADMIN_FAIL_GLOBAL = 30;                                  // 30 wrong tries from anywhere in 15 minutes -> owner login paused
const ADMIN_IDLE_DEFAULT_MIN = 30, ADMIN_IDLE_CHOICES = [15, 30, 60, 120];
const GENERIC_LOGIN_ERROR = 'Username/email or password is incorrect.';
async function settingGet(env, key) { const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first(); return r ? r.value : null; }
async function settingPut(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(key, value, nowIso()).run();
}
async function adminSecurity(env) {
  const raw = jparse(await settingGet(env, 'admin_security'), null) || {};
  const idle = ADMIN_IDLE_CHOICES.includes(raw.idle_minutes) ? raw.idle_minutes : ADMIN_IDLE_DEFAULT_MIN;
  return { pin_enabled: !!(raw.pin_enabled && raw.pin_hash), pin_hash: raw.pin_hash || '', idle_minutes: idle };
}
async function failCount(env, key) {
  const now = Math.floor(Date.now() / 1000);
  const r = await env.DB.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').bind(key).first();
  return r && r.reset_at > now ? { count: r.count, reset_at: r.reset_at } : { count: 0, reset_at: 0 };
}
async function adminLockCheck(env, request) {
  const now = Math.floor(Date.now() / 1000);
  for (const [key, lim] of [['adminfail:' + clientIp(request), ADMIN_FAIL_LIMIT], ['adminfail:*', ADMIN_FAIL_GLOBAL]]) {
    const f = await failCount(env, key);
    if (f.count >= lim) {
      const mins = Math.max(1, Math.ceil((f.reset_at - now) / 60));
      throw new HttpError(429, 'locked', `Too many wrong attempts. Sign-in is locked for ${mins} minute${mins === 1 ? '' : 's'}. Please try again later.`, { 'Retry-After': String(Math.max(1, f.reset_at - now)) });
    }
  }
}
async function adminFail(env, request, reason) {
  const now = Math.floor(Date.now() / 1000);
  for (const key of ['adminfail:' + clientIp(request), 'adminfail:*']) {
    const f = await failCount(env, key);
    if (f.count === 0) await env.DB.prepare('INSERT INTO rate_limits (key, count, reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at').bind(key, now + ADMIN_LOCK_S).run();
    else await env.DB.prepare('UPDATE rate_limits SET count = count + 1, reset_at = ? WHERE key = ?').bind(f.count + 1 >= (key.endsWith('*') ? ADMIN_FAIL_GLOBAL : ADMIN_FAIL_LIMIT) ? now + ADMIN_LOCK_S : f.reset_at, key).run();
  }
  await logAttempt(env, request, { email: 'admin', kind: 'admin', event: 'admin_login', success: false, reason });
}
async function adminClear(env, request) { await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind('adminfail:' + clientIp(request)).run(); }
async function newAdminToken(env, request, kind, ttlS) {
  const token = b64u(crypto.getRandomValues(new Uint8Array(24)));
  const t = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_tokens WHERE expires_at < ?').bind(new Date(t).toISOString()),
    env.DB.prepare('INSERT INTO admin_tokens (id, kind, expires_at, ip, created_at) VALUES (?,?,?,?,?)').bind(await sha256hex(token), kind, new Date(t + ttlS * 1000).toISOString(), clientIp(request), new Date(t).toISOString())
  ]);
  return token;
}
async function takeAdminToken(env, kind, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const id = await sha256hex(token);
  const row = await env.DB.prepare('SELECT id, tries, used, expires_at FROM admin_tokens WHERE id = ? AND kind = ?').bind(id, kind).first();
  if (!row || row.used || row.expires_at < nowIso()) return null;
  return row;
}
// the step after a correct password (and PIN): the website gets the HttpOnly owner cookie; the installed app gets a
// one-time code (2 minutes) that its WebView swaps for that same cookie on the site's own /admin/handoff page.
// The app never holds an owner token, and a customer bearer token never opens anything owner-only.
async function adminGrant(env, request) {
  await adminClear(env, request);
  await logAttempt(env, request, { email: 'admin', kind: 'admin', event: 'admin_login', success: true });
  // v6: never from the customer app (its requests are refused before they get here); no hand-off codes any more
  if (isAppRequest(request)) throw new HttpError(401, 'invalid_credentials', GENERIC_LOGIN_ERROR);
  const cookie = await createSession(env, request, 'admin', null);
  return json(200, { ok: true, admin: true, redirect: request.__adminApp ? '/admin/app' : '/admin' }, { 'Set-Cookie': cookie });
}
async function adminPasswordStep(env, request, password) {
  await adminLockCheck(env, request);
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").first();
  if (!row) { await dummyVerify(String(password || 'x')); await adminFail(env, request, 'setup_required'); throw new HttpError(401, 'invalid_credentials', GENERIC_LOGIN_ERROR); }
  if (typeof password !== 'string' || !password || password.length > 128 || !(await verifyPassword(password, row.value))) {
    await adminFail(env, request, 'wrong_password');
    throw new HttpError(401, 'invalid_credentials', GENERIC_LOGIN_ERROR);
  }
  const sec = await adminSecurity(env);
  if (sec.pin_enabled) {
    const challenge = await newAdminToken(env, request, 'pin', 300);
    return json(200, { ok: true, step: 'pin', challenge, message: 'Enter your owner PIN.' });
  }
  return adminGrant(env, request);
}
async function adminPinStep(request, env) {
  const b = await readJson(request);
  await adminLockCheck(env, request);
  if (b.app === 'admin') request.__adminApp = true;
  const row = await takeAdminToken(env, 'pin', b.challenge);
  if (!row) throw new HttpError(401, 'pin_expired', 'That sign-in has expired. Please enter your username and password again.');
  const sec = await adminSecurity(env);
  const pin = str(b.pin);
  const ok = /^\d{4,6}$/.test(pin) && sec.pin_hash && await verifyPassword(pin, sec.pin_hash);
  if (!ok) {
    await env.DB.prepare('UPDATE admin_tokens SET tries = tries + 1, used = CASE WHEN tries + 1 >= 3 THEN 1 ELSE used END WHERE id = ?').bind(row.id).run();
    await adminFail(env, request, 'wrong_pin');
    throw new HttpError(401, 'wrong_pin', row.tries + 1 >= 3 ? 'Wrong PIN. Please sign in again.' : 'Wrong PIN. Please try again.');
  }
  await env.DB.prepare('UPDATE admin_tokens SET used = 1 WHERE id = ?').bind(row.id).run();
  return adminGrant(env, request);
}
// v6: the customer app no longer opens the owner area, so the one-time hand-off is gone for good
async function adminHandoff(request, env) {
  throw new HttpError(410, 'gone', 'Owner sign-in has moved to the Avermontis Admin app.');
}
// POST /api/auth/login : customers sign in with email + password.
// v6: the owner can NOT sign in here any more (website or app). "admin" - like any other username that is not an
// e-mail address - gets exactly the same answer as a wrong password, so nothing hints that an owner account exists.
// The owner signs in on /admin (laptop browser) or in the separate "Avermontis Admin" app (/admin/app).
async function loginV5(request, env) {
  const body = await readJson(request);
  await rateLimit(env, 'auth', clientIp(request), AUTH_LIMIT, AUTH_WINDOW_S);
  const ident = typeof body.username === 'string' && !body.email ? body.username : body.email;
  if (typeof ident === 'string' && ident.trim() && !ident.includes('@') && ident.length <= 254) {
    await dummyVerify(typeof body.password === 'string' && body.password ? body.password.slice(0, 128) : 'x');
    await logAttempt(env, request, { email: ident.trim().slice(0, 60), kind: 'customer', event: 'login', success: false, reason: 'no_account' });
    throw new HttpError(401, 'invalid_credentials', GENERIC_LOGIN_ERROR);
  }
  const { value, fields } = validateLogin({ email: ident, password: body.password });
  assertValid(fields);
  const u = await env.DB.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').bind(value.email).first();
  let ok = false;
  if (u) ok = await verifyPassword(value.password, u.password_hash); else await dummyVerify(value.password);
  if (!ok) {
    await logAttempt(env, request, { user_id: u ? u.id : null, email: value.email, kind: 'customer', event: 'login', success: false, reason: u ? 'wrong_password' : 'no_account' });
    throw new HttpError(401, 'invalid_credentials', GENERIC_LOGIN_ERROR);
  }
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowIso(), u.id).run();
  await logAttempt(env, request, { user_id: u.id, email: u.email, kind: 'customer', event: 'login', success: true });
  const cookie = await createSession(env, request, 'customer', u.id);
  return json(200, withAppToken(request, { ok: true, user: { id: u.id, email: u.email, name: u.name } }), { 'Set-Cookie': cookie });
}
// the old /admin page (password only) keeps working, with the same lockout + PIN
async function adminLoginV5(request, env) {
  const body = await readJson(request);
  const row = await env.DB.prepare("SELECT 1 AS x FROM settings WHERE key = 'admin_password_hash'").first();
  if (!row) throw new HttpError(409, 'setup_required', 'The owner password has not been created yet. Open /admin/setup first.');
  // v6: the Admin app's sign-in screen sends a username too; anything but "admin" is a failed owner attempt
  // (counts towards the 5-try lock, same generic message)
  if (body.username !== undefined && !isAdminIdentifier(body.username)) {
    await adminLockCheck(env, request);
    await dummyVerify(typeof body.password === 'string' && body.password ? body.password.slice(0, 128) : 'x');
    await adminFail(env, request, 'wrong_username');
    throw new HttpError(401, 'invalid_credentials', GENERIC_LOGIN_ERROR);
  }
  if (body.app === 'admin') request.__adminApp = true;
  return adminPasswordStep(env, request, body.password);
}

// ---------- owner: security settings ----------
function maskIp(ip) { ip = String(ip || ''); if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + ':…'; const p = ip.split('.'); return p.length === 4 ? p[0] + '.' + p[1] + '.' + p[2] + '.x' : ip; }
async function adminGetSecurity(request, env) {
  const s = await requireAdmin(env, request);
  const sec = await adminSecurity(env);
  const sessions = (await env.DB.prepare("SELECT id, created_at, expires_at, last_seen_at, ip, user_agent FROM sessions WHERE kind = 'admin' AND expires_at > ? ORDER BY created_at DESC LIMIT 20").bind(nowIso()).all()).results
    .map((x) => ({ current: x.id === s.id, signed_in: x.created_at, last_active: x.last_seen_at || x.created_at, device: deviceFromUA(x.user_agent || ''), ip: maskIp(x.ip) }));
  const logins = (await env.DB.prepare("SELECT success, reason, ip, device, user_agent, created_at FROM login_history WHERE kind = 'admin' ORDER BY id DESC LIMIT 40").all()).results
    .map((x) => ({ time: x.created_at, success: !!x.success, reason: x.reason || '', device: x.device || deviceFromUA(x.user_agent || ''), ip: maskIp(x.ip) }));
  const here = await failCount(env, 'adminfail:' + clientIp(request)), all = await failCount(env, 'adminfail:*');
  return json(200, { ok: true, security: { pin_enabled: sec.pin_enabled, idle_minutes: sec.idle_minutes, idle_choices: ADMIN_IDLE_CHOICES, lock_after: ADMIN_FAIL_LIMIT, lock_minutes: ADMIN_LOCK_S / 60,
    failed_recently: all.count, username: 'admin' }, sessions, logins });
}
async function adminPutSecurity(request, env) {
  await requireAdmin(env, request);
  const b = await readJson(request);
  const sec = await adminSecurity(env);
  const raw = jparse(await settingGet(env, 'admin_security'), null) || {};
  const f = {}; const changed = [];
  const needPw = b.pin_enabled !== undefined || b.pin !== undefined || b.new_password !== undefined;
  if (needPw) {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").first();
    await adminLockCheck(env, request);
    if (!row || typeof b.current_password !== 'string' || !(await verifyPassword(b.current_password, row.value))) {
      await adminFail(env, request, 'wrong_password');
      throw new HttpError(400, 'invalid_input', 'Your current owner password is not correct.', null, { current_password: 'Your current owner password is not correct.' });
    }
  }
  if (b.idle_minutes !== undefined) { const n = Number(b.idle_minutes); if (!ADMIN_IDLE_CHOICES.includes(n)) f.idle_minutes = 'Pick 15, 30, 60 or 120 minutes.'; else if (n !== sec.idle_minutes) { raw.idle_minutes = n; changed.push('auto sign-out ' + n + ' min'); } }
  if (b.pin_enabled === true) {
    const pin = str(b.pin);
    if (!/^\d{4,6}$/.test(pin)) f.pin = 'PIN must be 4 to 6 digits.';
    else if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) f.pin = 'Pick a PIN that is not a simple pattern (like 1111 or 1234).';
    else { raw.pin_hash = await hashPassword(pin); raw.pin_enabled = true; changed.push('owner PIN on'); }
  } else if (b.pin_enabled === false && sec.pin_enabled) { raw.pin_enabled = false; raw.pin_hash = ''; changed.push('owner PIN off'); }
  let newHash = null;
  if (b.new_password !== undefined) {
    const p = typeof b.new_password === 'string' ? b.new_password : '';
    if (p.length < 10 || p.length > 128 || !/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) f.new_password = 'At least 10 characters, with a letter and a number.';
    else if (p !== b.confirm_password) f.confirm_password = 'The two passwords do not match.';
    else { newHash = await hashPassword(p); changed.push('owner password changed'); }
  }
  assertValid(f);
  await settingPut(env, 'admin_security', JSON.stringify(raw));
  if (newHash) {
    await settingPut(env, 'admin_password_hash', newHash);
    // a new password signs out every other owner session
    const cur = await getSession(env, request, 'admin');
    await env.DB.prepare("DELETE FROM sessions WHERE kind = 'admin' AND id != ?").bind(cur ? cur.id : '').run();
    await settingPut(env, 'admin_alert_keys', '[]');
  }
  request.__audit = changed.join(', ') || 'no change';
  return adminGetSecurity(request, env);
}
async function adminLogoutAll(request, env) {
  await requireAdmin(env, request);
  checkOrigin(request);
  const r = await env.DB.prepare("DELETE FROM sessions WHERE kind = 'admin'").run();
  await settingPut(env, 'admin_alert_keys', '[]');     // v6: background new-order checks stop too
  request.__audit = 'signed out of every device';
  return json(200, { ok: true, signed_out: r.meta ? r.meta.changes : null }, { 'Set-Cookie': setCookie(cookieName('admin'), '', 0) });
}

// ---------- audit log (every successful owner change, written by handleApi) ----------
const AUDIT_AREAS = [[/^\/api\/admin\/design/, 'Design'], [/^\/api\/admin\/ui/, 'Customize'], [/^\/api\/admin\/(security|logout-all)/, 'Security'], [/^\/api\/admin\/orders/, 'Orders'],
  [/^\/api\/admin\/products/, 'Products'], [/^\/api\/admin\/upload/, 'Uploads'], [/^\/api\/admin\/coupons/, 'Coupons'], [/^\/api\/admin\/reviews/, 'Reviews'], [/^\/api\/admin\/(customers|resets)/, 'Customers'],
  [/^\/api\/admin\/(messages|subscribers)/, 'Messages'], [/^\/api\/admin\/settings/, 'Settings'], [/^\/api\/admin\/(restore|backup)/, 'Backup'], [/^\/api\/admin\/notifications/, 'Notify'],
  [/^\/api\/admin\/(bargains|chat)/, 'Assistant'], [/^\/api\/admin\/app/, 'Admin app'], [/^\/api\/admin\/email/, 'Email']];
async function writeAudit(env, request, url, status) {
  try {
    const p = url.pathname; if (!/^\/api\/admin\//.test(p) || /\/(login|setup|handoff|ui-preview|design\/preview|chat-test|email-test)$/.test(p)) return;
    const area = (AUDIT_AREAS.find((a) => a[0].test(p)) || [null, 'Other'])[1];
    const verb = { POST: 'created', PUT: 'saved', PATCH: 'updated', DELETE: 'deleted' }[request.method] || request.method;
    const tail = decodeURIComponent(p.replace(/^\/api\/admin\//, '')).slice(0, 120);
    const ua = clientUA(request);
    await env.DB.prepare('INSERT INTO audit_log (action, area, summary, detail, ip, device, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(tail + ' ' + verb, area, String(request.__audit || '').slice(0, 500), request.__auditDetail ? JSON.stringify(request.__auditDetail).slice(0, 4000) : null, clientIp(request), deviceFromUA(ua), nowIso()).run();
    await env.DB.prepare('DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT 2000)').run();
  } catch (e) { /* the audit log never blocks the change itself */ }
}
async function adminAudit(request, env, url) {
  await requireAdmin(env, request);
  const area = url.searchParams.get('area') || '';
  const rows = (await (area ? env.DB.prepare('SELECT * FROM audit_log WHERE area = ? ORDER BY id DESC LIMIT 200').bind(area) : env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200')).all()).results;
  return json(200, { ok: true, entries: rows.map((r) => ({ id: r.id, time: r.created_at, area: r.area, action: r.action, summary: r.summary || '', detail: jparse(r.detail, null), device: r.device || '' })) });
}

// ---------- design studio ----------
export const DESIGN_SECTIONS = ['theme', 'layout', 'style'];
export const BOTTOM_NAV_ITEMS = ['home', 'routine', 'diary', 'shop', 'me'];
export const FONT_LABELS = { cormorant: 'Cormorant (elegant serif)', playfair: 'Playfair Display (serif)', georgia: 'Georgia (classic serif)', system: 'Phone default (sans)', poppins: 'Poppins + Hindi', montserrat: 'Montserrat (modern sans)',
  lora: 'Lora (soft serif)', dmserif: 'DM Serif Display (bold serif)', hind: 'Hind (Hindi + English)', mukta: 'Mukta (Hindi + English)', noto: 'Noto Sans (Hindi + English)', rozha: 'Rozha One (Hindi display)' };
export const FONT_DEVANAGARI = ['poppins', 'hind', 'mukta', 'noto', 'rozha'];
const FONT_FILES = {"montserrat":[["Montserrat","400 700","montserrat-lati.woff2","L"]],"lora":[["Lora","400 600","lora-lati.woff2","L"]],"dmserif":[["DM Serif Display","400","dmserif-400-lati.woff2","L"]],"hind":[["Hind","400","hind-400-deva.woff2","D"],["Hind","400","hind-400-lati.woff2","L"],["Hind","600","hind-600-deva.woff2","D"],["Hind","600","hind-600-lati.woff2","L"]],"mukta":[["Mukta","400","mukta-400-deva.woff2","D"],["Mukta","400","mukta-400-lati.woff2","L"],["Mukta","700","mukta-700-deva.woff2","D"],["Mukta","700","mukta-700-lati.woff2","L"]],"rozha":[["Rozha One","400","rozha-400-deva.woff2","D"],["Rozha One","400","rozha-400-lati.woff2","L"]],"poppins":[["Poppins","400","poppins-400.woff2",""],["Poppins","500 700","poppins-600.woff2",""],["Poppins","400","poppinsdeva-400-deva.woff2","D"],["Poppins","600","poppinsdeva-600-deva.woff2","D"]],"playfair":[["Playfair Display","500 700","playfair-600.woff2",""]],"noto":[["Noto Sans","400 600","notosans-lati.woff2","L"],["Noto Sans","400 600","notodeva-deva.woff2","D"]]};
const LAT_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const DEV_RANGE = 'U+0900-097F, U+1CD0-1CF4, U+1CF7-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B0A';
const STACK_V5 = { montserrat: '"Montserrat",system-ui,Arial,sans-serif', lora: '"Lora",Georgia,serif', dmserif: '"DM Serif Display",Georgia,serif', hind: '"Hind",system-ui,Arial,sans-serif',
  mukta: '"Mukta",system-ui,Arial,sans-serif', noto: '"Noto Sans",system-ui,Arial,sans-serif', rozha: '"Rozha One",Georgia,serif', poppins: '"Poppins",system-ui,-apple-system,Roboto,Arial,sans-serif',
  cormorant: '"Cormorant","Cormorant Garamond",Georgia,"Times New Roman",serif', playfair: '"Playfair Display",Georgia,serif', georgia: 'Georgia,"Times New Roman",serif', system: 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif' };
export function fontFaces(key, skip) {
  return (FONT_FILES[key] || []).filter((f) => !(skip && skip.includes(f[2]))).map((f) => `@font-face{font-family:"${f[0]}";src:url(/assets/fonts/${f[2]}) format("woff2");font-weight:${f[1]};font-display:swap${f[3] === 'L' ? ';unicode-range:' + LAT_RANGE : f[3] === 'D' ? ';unicode-range:' + DEV_RANGE : ''}}`).join('');
}
const OPT_COLOURS = ['secondary', 'surface', 'button_bg', 'button_text', 'link', 'header_bg', 'header_text', 'footer_bg', 'footer_text', 'success', 'error', 'dark_background', 'dark_surface', 'dark_text', 'dark_accent'];
export const STYLE_DEFAULTS = { grid_mobile: 2, grid_desktop: 4, app_grid: 2, card_radius: null, card_shadow: 'none', card_border: true, button_shape: 'default', header_layout: 'left', density: 'comfortable',
  animations: true, announce_text: '', announce_bg: '', announce_fg: '', bottom_nav: BOTTOM_NAV_ITEMS.slice(), custom_css: '' };
// CSS the owner types in "Advanced": no way to load outside files, run script or break out of the style tag
export function sanitizeCss(css) {
  let c = String(css || '').slice(0, 12000).replace(/\u0000/g, '');
  c = c.replace(/<\/?\s*style/gi, '').replace(/[<>]/g, '');
  c = c.replace(/@import[^;]*;?/gi, '').replace(/@charset[^;]*;?/gi, '').replace(/@namespace[^;]*;?/gi, '');
  c = c.replace(/expression\s*\(/gi, '(').replace(/javascript\s*:/gi, '').replace(/vbscript\s*:/gi, '').replace(/-moz-binding/gi, '').replace(/behavior\s*:/gi, '');
  c = c.replace(/url\s*\(\s*(['"]?)\s*([^'")]*)\1\s*\)/gi, (m, q, u) => (/^\/(?!\/)[A-Za-z0-9_./-]*$/.test(u) ? `url(${u})` : 'none'));
  c = c.replace(/\\/g, '');
  let depth = 0; for (const ch of c) { if (ch === '{') depth++; else if (ch === '}') depth--; if (depth < 0) break; }
  if (depth !== 0) return { css: '', error: 'Your CSS has unbalanced { } brackets.' };
  return { css: c.trim(), error: null };
}
export function validateStyle(b, cur) {
  const f = {}, v = { ...STYLE_DEFAULTS, ...(cur || {}) };
  const pick = (k, list) => { if (b[k] === undefined) return; if (!list.includes(b[k])) f[k] = 'Pick one of: ' + list.join(', ') + '.'; else v[k] = b[k]; };
  const num = (k, list) => { if (b[k] === undefined) return; const n = Number(b[k]); if (!list.includes(n)) f[k] = 'Pick ' + list.join(', ') + '.'; else v[k] = n; };
  num('grid_mobile', [1, 2, 3]); num('grid_desktop', [2, 3, 4, 5]); num('app_grid', [1, 2, 3]);
  if (b.card_radius !== undefined) { if (b.card_radius === null || b.card_radius === '') v.card_radius = null; else { const n = Number(b.card_radius); if (!Number.isInteger(n) || n < 0 || n > 32) f.card_radius = 'Corner radius 0-32 px.'; else v.card_radius = n; } }
  pick('card_shadow', ['none', 'soft', 'strong']); pick('button_shape', ['default', 'square', 'rounded', 'pill']); pick('header_layout', ['left', 'center']); pick('density', ['comfortable', 'compact']);
  for (const k of ['card_border', 'animations']) if (b[k] !== undefined) v[k] = b[k] === true || b[k] === 'true' || b[k] === 1;
  if (b.announce_text !== undefined) v.announce_text = clamp(b.announce_text, 140);
  for (const k of ['announce_bg', 'announce_fg']) if (b[k] !== undefined) { const x = str(b[k]); if (x && !HEX.test(x)) f[k] = 'Use a colour like #C6A16A.'; else v[k] = x.toUpperCase(); }
  if (b.bottom_nav !== undefined) {
    if (!Array.isArray(b.bottom_nav) || b.bottom_nav.some((x) => !BOTTOM_NAV_ITEMS.includes(x)) || new Set(b.bottom_nav).size !== b.bottom_nav.length) f.bottom_nav = 'Unknown bottom bar item.';
    else if (!b.bottom_nav.includes('home') || !b.bottom_nav.includes('me')) f.bottom_nav = 'Home and Me always stay in the bottom bar.';
    else if (b.bottom_nav.length < 3) f.bottom_nav = 'Keep at least 3 items.';
    else v.bottom_nav = b.bottom_nav.slice();
  }
  if (b.custom_css !== undefined) { const r = sanitizeCss(b.custom_css); if (r.error) f.custom_css = r.error; else v.custom_css = r.css; }
  return { value: v, fields: f };
}
// warnings never block saving (the one hard rule, text vs background, is checked in validateUi like v4)
export function designWarnings(t, st) {
  const w = [];
  const chk = (a, b, what, min = 4.5) => { if (HEX.test(a || '') && HEX.test(b || '')) { const c = contrast(a, b); if (c < min) w.push({ field: what, ratio: Math.round(c * 10) / 10, message: `${what}: colours are hard to read (contrast ${Math.round(c * 10) / 10}:1, aim for ${min}:1).` }); } };
  const bg = t.background, tx = t.text;
  chk(tx, bg, 'Text on background');
  if (t.button_bg || t.button_text) chk(t.button_text || autoInk(t.button_bg || t.accent), t.button_bg || t.accent, 'Button text', 3);
  if (t.link) chk(t.link, bg, 'Links', 3);
  if (t.header_bg) chk(t.header_text || (luminance(t.header_bg) > 0.45 ? '#111111' : '#F5F0E7'), t.header_bg, 'Header');
  if (t.footer_bg) chk(t.footer_text || (luminance(t.footer_bg) > 0.45 ? '#111111' : '#F5F0E7'), t.footer_bg, 'Footer');
  if (t.surface) chk(tx, t.surface, 'Text on cards');
  if (t.dark_background || t.dark_text) chk(t.dark_text || '#F5F0E7', t.dark_background || mixHex(t.primary, '#000000', 0.15), 'Dark mode text');
  if (st && st.announce_bg) chk(st.announce_fg || '#FFFFFF', st.announce_bg, 'Announcement bar');
  return w;
}
const shade = (h, d) => withLightness(h, (l) => l + d);
const autoInk = (bg) => (luminance(bg) > 0.45 ? '#16130F' : '#FFFFFF');
// extra website CSS for v5 settings (appended after the v4 CSS; the default design adds nothing)
export function siteV5Css(ui) {
  const t = ui.theme, st = { ...STYLE_DEFAULTS, ...(ui.style || {}) };
  let css = '';
  for (const k of [t.heading_font, t.body_font]) if (k && !['cormorant', 'georgia', 'system'].includes(k)) css += fontFaces(k, ['playfair-600.woff2', 'poppins-400.woff2', 'poppins-600.woff2']);
  if (t.heading_font && STACK_V5[t.heading_font] && !HEADING_STACK[t.heading_font]) css += ':root{--serif:' + STACK_V5[t.heading_font] + '}';
  if (t.body_font && STACK_V5[t.body_font] && !BODY_STACK[t.body_font]) css += ':root{--sans:' + STACK_V5[t.body_font] + '}';
  const v = {};
  if (t.surface) v['--surface'] = t.surface;
  if (t.secondary) { v['--bg2'] = mixHex(t.background, t.secondary, 0.12); v['--stone'] = t.secondary; v['--surface2'] = mixHex(t.background, t.secondary, 0.2); }
  if (t.button_bg) { v['--green'] = t.button_bg; v['--green-d'] = shade(t.button_bg, -0.08); }
  if (t.success) v['--ok'] = t.success;
  if (t.error) v['--err'] = t.error;
  if (Object.keys(v).length) css += ':root{' + Object.entries(v).map(([k, x]) => k + ':' + x).join(';') + '}';
  if (t.button_bg || t.button_text) css += `.btn:not(.ghost):not(.danger){color:${t.button_text || autoInk(t.button_bg || t.accent)}}`;
  if (t.secondary) css += `.btn.ghost{color:${t.secondary};border-color:${t.secondary}}`;
  if (t.link) css += `main p a:not(.btn),main li a:not(.btn),.prose a,.note a,.small a:not(.btn){color:${t.link}}`;
  if (t.header_bg) css += `.site-header,.site-header.scrolled,body.home .site-header,body.home .site-header.scrolled{background:${t.header_bg}}`;
  if (t.header_bg || t.header_text) { const ink = t.header_text || autoInk(t.header_bg); css += `.site-header,body.home .site-header,.site-header .menu>li>a,.site-header .logo,.site-header .logo span,.site-header .icon-btn,.site-header .menu-btn{color:${ink}}`; }
  if (t.footer_bg) css += `.site-footer{background:${t.footer_bg}}`;
  if (t.footer_bg || t.footer_text) css += `.site-footer,.site-footer a,.site-footer h2,.site-footer h3,.site-footer h4{color:${t.footer_text || autoInk(t.footer_bg)}}`;
  if (Number(t.font_scale) && Number(t.font_scale) !== 100) css += `html{font-size:${Number(t.font_scale)}%}`;
  if (t.heading_weight) css += `h1,h2,h3,.h1,.h2,.h3,.display{font-weight:${t.heading_weight}}`;
  if (t.body_weight) css += `body{font-weight:${t.body_weight}}`;
  // dark mode: "auto" follows the visitor's phone setting
  if (t.site_mode === 'auto' || (t.site_mode === 'dark' && (t.dark_background || t.dark_surface || t.dark_text || t.dark_accent))) {
    const dv = siteThemeVars({ ...t, site_mode: 'dark', primary: t.dark_background || t.primary });
    if (t.dark_surface) { dv['--surface'] = t.dark_surface; dv['--surface2'] = mixHex(t.dark_surface, '#ffffff', 0.05); }
    if (t.dark_text) { dv['--text'] = t.dark_text; dv['--ink'] = t.dark_text; dv['--ivory'] = t.dark_text; dv['--charcoal'] = t.dark_text; dv['--muted'] = mixHex(t.dark_text, t.dark_background || t.primary, 0.38); }
    if (t.dark_accent) { dv['--accent'] = t.dark_accent; dv['--gold'] = t.dark_accent; dv['--green'] = t.dark_accent; dv['--green-d'] = shade(t.dark_accent, -0.08); }
    const body = ':root{' + Object.entries(dv).map(([k, x]) => k + ':' + x).join(';') + '}body{color-scheme:dark}.site-header,.announce{background:var(--bg)}';
    css += t.site_mode === 'auto' ? '@media (prefers-color-scheme:dark){' + body + '}' : body;
  }
  // layout + UI extras
  if (st.grid_mobile !== 2) css += `@media (max-width:759px){main .grid{grid-template-columns:repeat(${st.grid_mobile},minmax(0,1fr))}}`;
  if (st.grid_desktop !== 4) css += `@media (min-width:1080px){main .grid{grid-template-columns:repeat(${st.grid_desktop},minmax(0,1fr))}}@media (min-width:760px) and (max-width:1079px){main .grid{grid-template-columns:repeat(${Math.min(st.grid_desktop, 3)},minmax(0,1fr))}}`;
  if (st.card_radius !== null && st.card_radius !== undefined) css += `main .card,main .card img,.p-card,.product-card,.cat-tile,.avm-banner{border-radius:${st.card_radius}px}main .card{overflow:hidden}`;
  if (st.card_shadow === 'soft') css += 'main .card{box-shadow:0 6px 22px rgba(0,0,0,.08)!important}';
  if (st.card_shadow === 'strong') css += 'main .card{box-shadow:0 14px 40px rgba(0,0,0,.18)!important}';
  if (st.card_border === false) css += 'main .card{border-color:transparent!important}';
  if (st.button_shape !== 'default') css += `.btn{border-radius:${{ square: '0', rounded: '10px', pill: '999px' }[st.button_shape]}}`;
  if (st.header_layout === 'center') css += '@media (min-width:980px){.site-header .nav{display:grid;grid-template-columns:1fr auto 1fr;grid-template-areas:"menu logo icons"}.site-header .logo{grid-area:logo;justify-self:center}.site-header .menu-wrap{grid-area:menu;justify-self:start}.site-header .hdr-icons{grid-area:icons;justify-self:end}}@media (max-width:979px){.site-header .logo{position:absolute;left:50%;transform:translateX(-50%)}.site-header .nav{position:relative}}';
  if (st.density === 'compact') css += 'main section{padding-top:clamp(24px,4vw,48px)!important;padding-bottom:clamp(24px,4vw,48px)!important}main .grid{gap:12px 10px}.field{margin-bottom:10px}';
  if (st.animations === false) css += '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}.reveal,[data-reveal]{opacity:1!important;transform:none!important}';
  // the v3 design hides the thin top bar; the owner's own announcement brings it back (above the fixed header on home)
  if (st.announce_text) css += '.announce{display:block;position:relative;z-index:41}body.home .announce{position:fixed;top:0;left:0;right:0}body.home .site-header{top:33px}';
  if (st.announce_bg) css += `.announce{background:${st.announce_bg}}`;
  if (st.announce_bg || st.announce_fg) css += `.announce,.announce a{color:${st.announce_fg || autoInk(st.announce_bg)}}`;
  if (st.custom_css) css += '\n/* owner custom CSS */\n' + st.custom_css;
  return css;
}
// the whole look of the phone app as one CSS string, made here so a new look never needs a new APK.
// (the v5 app applies this as is; the v4 app keeps using its own built-in rules from the same theme fields)
export function appThemeCss(ui) {
  const t = ui.theme, st = { ...STYLE_DEFAULTS, ...(ui.style || {}) };
  const ok = [t.primary, t.accent, t.background, t.text].every((x) => HEX.test(x || ''));
  let css = '';
  for (const k of [t.heading_font, t.body_font]) if (k && !['cormorant', 'georgia', 'system'].includes(k)) css += fontFaces(k);
  const vars = (mode, dark) => {
    const v = {}; if (!ok) return v;
    const pr = t.primary, ac = t.accent, bg = t.background, tx = t.text;
    if (mode === 'light') {
      Object.assign(v, { '--ob': bg, '--ob2': mixHex(bg, pr, 0.035), '--card': t.surface || mixHex(bg, '#FFFFFF', 0.7), '--card2': mixHex(t.surface || bg, pr, 0.06), '--line': rgba(pr, 0.10), '--line2': rgba(pr, 0.2),
        '--ivory': pr, '--text': tx, '--muted': mixHex(tx, bg, 0.38), '--muted2': mixHex(tx, bg, 0.52), '--gold': mixHex(ac, pr, 0.25), '--gold2': ac, '--goldd': mixHex(ac, pr, 0.45), '--ok': t.success || '#2F6B45', '--err': t.error || '#B3261E' });
    } else {
      const base = dark.bg || mixHex(pr, '#000000', 0.15), a2 = dark.accent || ac, fg = dark.text || '#EFE9DE';
      Object.assign(v, { '--ob': base, '--ob2': mixHex(base, '#FFFFFF', 0.03), '--card': dark.surface || mixHex(base, '#FFFFFF', 0.055), '--card2': mixHex(dark.surface || base, '#FFFFFF', 0.09), '--line': rgba(fg, 0.10), '--line2': rgba(fg, 0.18),
        '--gold': a2, '--gold2': mixHex(a2, '#FFFFFF', 0.3), '--goldd': mixHex(a2, '#000000', 0.25), '--text': fg, '--ivory': mixHex(fg, '#FFFFFF', 0.4), '--muted': mixHex(fg, base, 0.35), '--muted2': mixHex(fg, base, 0.5) });
      if (t.success) v['--ok'] = t.success; if (t.error) v['--err'] = t.error;
    }
    return v;
  };
  const block = (v) => (Object.keys(v).length ? ':root{' + Object.entries(v).map(([k, x]) => k + ':' + x).join(';') + '}' : '');
  const themed = '.today{background:radial-gradient(120% 90% at 100% 0%,color-mix(in srgb,var(--gold) 25%,transparent),transparent 55%),linear-gradient(160deg,var(--card2),var(--ob2))}.ring>div{background:var(--ob2)}' +
    '.sk{background:linear-gradient(90deg,var(--card) 0%,var(--card2) 40%,var(--card) 80%);background-size:300% 100%}.sheet,.sheet .sfoot{background:var(--ob2)}.tabbar{background:color-mix(in srgb,var(--ob) 88%,transparent)}html,body{background:var(--ob)}' +
    '.tile::after{background:linear-gradient(180deg,transparent 20%,color-mix(in srgb,var(--ob) 88%,transparent))}';
  const light = '.slide h1,.slide .wordmark{color:#F5F0E7}.slide p{color:#D9D2C6}.icon{background:rgba(0,0,0,.04)}.tile::after{background:linear-gradient(180deg,transparent 15%,rgba(255,255,255,.92))}.tile img{opacity:.5}.btn{color:#fff;background:linear-gradient(180deg,var(--gold2),var(--gold))}.sheet,.tabbar{background:var(--card)}.badge{color:#fff}';
  const dk = { bg: t.dark_background, surface: t.dark_surface, text: t.dark_text, accent: t.dark_accent };
  const original = t.preset === 'obsidian' && t.app_mode === 'dark' && !Object.values(dk).some(Boolean) && !t.surface && !t.success && !t.error;
  if (!original && ok) {
    if (t.app_mode === 'light') css += block(vars('light')) + themed + light;
    else if (t.app_mode === 'auto') css += block(vars('light')) + themed + '@media (prefers-color-scheme:light){' + light + '}@media (prefers-color-scheme:dark){' + block(vars('dark', dk)) + '}';
    else css += block(vars('dark', dk)) + themed;
  }
  const fv = {};
  if (t.heading_font && t.heading_font !== 'cormorant' && STACK_V5[t.heading_font]) fv['--serif'] = STACK_V5[t.heading_font];
  if (t.body_font && t.body_font !== 'system' && STACK_V5[t.body_font]) fv['--sans'] = STACK_V5[t.body_font];
  css += block(fv);
  if (t.button_bg) css += `.btn:not(.ghost){background:${t.button_bg};color:${t.button_text || autoInk(t.button_bg)}}`;
  else if (t.button_text) css += `.btn:not(.ghost){color:${t.button_text}}`;
  if (t.link) css += `a:not(.btn):not(.li):not(.tile){color:${t.link}}`;
  if (t.header_bg) css += `.appbar,.top,header.top,.head{background:${t.header_bg}}`;
  if (t.header_bg || t.header_text) css += `.appbar,.top,header.top,.head,.wordmark{color:${t.header_text || autoInk(t.header_bg)}}`;
  if (t.footer_bg) css += `.tabbar{background:${t.footer_bg}!important}`;
  if (t.footer_bg || t.footer_text) { const ink = t.footer_text || autoInk(t.footer_bg); css += `.tabbar button{color:${mixHex(ink, t.footer_bg || '#000000', 0.35)}}.tabbar button.on{color:${ink}}`; }
  if (Number(t.font_scale) && Number(t.font_scale) !== 100) css += `html,body{font-size:${Math.round(15 * Number(t.font_scale)) / 100}px}`;
  if (t.heading_weight) css += `h1,h2,h3,.h1,.h2{font-weight:${t.heading_weight}}`;
  if (t.body_weight) css += `body{font-weight:${t.body_weight}}`;
  if (st.app_grid !== 2) css += `.grid{grid-template-columns:repeat(${st.app_grid},minmax(0,1fr))}`;
  if (st.card_radius !== null && st.card_radius !== undefined) css += `.pcard,.card,.tile,.today,.li,.list{border-radius:${st.card_radius}px}`;
  if (st.card_shadow === 'soft') css += '.pcard,.card{box-shadow:0 6px 20px rgba(0,0,0,.12)}';
  if (st.card_shadow === 'strong') css += '.pcard,.card{box-shadow:0 12px 34px rgba(0,0,0,.28)}';
  if (st.card_border === false) css += '.pcard,.card{border-color:transparent}';
  if (st.button_shape !== 'default') css += `.btn{border-radius:${{ square: '0', rounded: '12px', pill: '999px' }[st.button_shape]}}`;
  if (st.header_layout === 'center') css += '.appbar,.top{justify-content:center;text-align:center}';
  if (st.density === 'compact') css += '.sec{margin-top:16px}.grid{gap:8px}.view{--pad:12px}';
  if (st.animations === false) css += '*,*::before,*::after{animation:none!important;transition:none!important}';
  const nav = (st.bottom_nav && st.bottom_nav.length ? st.bottom_nav : BOTTOM_NAV_ITEMS);
  if (nav.join() !== BOTTOM_NAV_ITEMS.join()) {
    css += `.tabbar{grid-template-columns:repeat(${nav.length},1fr)}`;
    for (const id of BOTTOM_NAV_ITEMS) css += nav.includes(id) ? `.tabbar button[data-go="${id}"]{order:${nav.indexOf(id) + 1}}` : `.tabbar button[data-go="${id}"]{display:none}`;
  }
  if (st.custom_css) css += '\n/* owner custom CSS */\n' + st.custom_css;
  return css;
}
function designOf(ui) { const o = {}; for (const k of DESIGN_SECTIONS) o[k] = JSON.parse(JSON.stringify(ui[k])); return o; }
function diffKeys(a, b, prefix = '') {
  const out = [];
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const x = a ? a[k] : undefined, y = b ? b[k] : undefined;
    if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x)) out.push(...diffKeys(x, y, prefix + k + '.'));
    else if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ key: prefix + k, from: typeof x === 'string' && x.length > 60 ? x.slice(0, 60) + '…' : x, to: typeof y === 'string' && y.length > 60 ? y.slice(0, 60) + '…' : y });
  }
  return out;
}
// validate a whole design (theme + layout + style) against the live one; returns the merged value
function validateDesign(b, ui) {
  const out = {}, fields = {};
  for (const sec of DESIGN_SECTIONS) {
    if (!b || b[sec] === undefined) { out[sec] = ui[sec]; continue; }
    if (!b[sec] || typeof b[sec] !== 'object' || Array.isArray(b[sec])) { fields[sec] = 'Invalid ' + sec + '.'; continue; }
    const r = sec === 'style' ? validateStyle(b[sec], ui.style) : validateUi(sec, b[sec], ui[sec]);
    for (const [k, m] of Object.entries(r.fields)) fields[sec + '.' + k] = m;
    out[sec] = r.value;
  }
  return { value: out, fields };
}
async function writeDesign(env, design) {
  const up = 'INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at';
  const t = nowIso();
  await env.DB.batch(DESIGN_SECTIONS.map((k) => env.DB.prepare(up).bind('ui:' + k, JSON.stringify(design[k]), t)));
  uiCache = { at: 0, v: null };
}
async function recordVersion(env, request, label) {
  const ui = await getUi(env, true);
  const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM ui_versions').first()).n;
  await env.DB.prepare('INSERT INTO ui_versions (label, data, created_at, ip) VALUES (?,?,?,?)').bind(String(label).slice(0, 80), JSON.stringify(designOf(ui)), nowIso(), clientIp(request)).run();
  await env.DB.prepare('DELETE FROM ui_versions WHERE id NOT IN (SELECT id FROM ui_versions ORDER BY id DESC LIMIT 25)').run();
  return count;
}
// before the very first change, the look as it was is kept as version 1 so "Undo" always has somewhere to go
async function ensureBaseVersion(env, request) {
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM ui_versions').first()).n;
  if (!n) await recordVersion(env, request, 'Look before the design studio');
}
async function publishDesign(env, request, design, label) {
  const before = designOf(await getUi(env, true));
  await ensureBaseVersion(env, request);
  await writeDesign(env, design);
  await recordVersion(env, request, label);
  const changes = diffKeys(before, designOf(await getUi(env, true)));
  request.__audit = label + ' — ' + (changes.length ? changes.slice(0, 12).map((c) => c.key).join(', ') + (changes.length > 12 ? ` (+${changes.length - 12} more)` : '') : 'no change');
  request.__auditDetail = changes.slice(0, 60);
  return changes;
}
function previewOf(ui, design) {
  const d = { ...ui, ...design };
  return { css: siteThemeCss(d), app_css: appThemeCss(d), warnings: designWarnings(d.theme, d.style) };
}
async function designState(env) {
  const ui = await getUi(env, true);
  const draft = jparse(await settingGet(env, 'ui_draft'), null);
  const versions = (await env.DB.prepare('SELECT id, label, created_at FROM ui_versions ORDER BY id DESC LIMIT 20').all()).results;
  const themes = jparse(await settingGet(env, 'ui_themes'), []) || [];
  const live = designOf(ui);
  return { live, draft: draft && draft.design ? { ...draft.design, saved_at: draft.saved_at } : null, versions, themes,
    presets: THEME_PRESETS, fonts: FONTS, font_labels: FONT_LABELS, font_devanagari: FONT_DEVANAGARI, sections: { home_web: HOME_WEB_SECTIONS, home_app: HOME_APP_SECTIONS }, bottom_nav_items: BOTTOM_NAV_ITEMS,
    defaults: designOf(mergeUi({})), preview: previewOf(ui, draft && draft.design ? validateDesign(draft.design, ui).value : live) };
}
async function adminDesign(request, env) { await requireAdmin(env, request); return json(200, { ok: true, ...(await designState(env)) }); }
async function adminDesignPreview(request, env) {
  await requireAdmin(env, request);
  const b = await readJson(request, 40000);
  const ui = await getUi(env, true);
  const { value, fields } = validateDesign(b, ui);
  const p = previewOf(ui, value);
  return json(200, { ok: true, ...p, fields });
}
async function adminDesignDraft(request, env) {
  await requireAdmin(env, request);
  const b = await readJson(request, 40000);
  const ui = await getUi(env, true);
  const { value, fields } = validateDesign(b, ui);
  assertValid(fields);
  await settingPut(env, 'ui_draft', JSON.stringify({ design: value, saved_at: nowIso() }));
  request.__audit = 'draft saved (not live)';
  return json(200, { ok: true, ...(await designState(env)) });
}
async function adminDesignDiscard(request, env) {
  await requireAdmin(env, request); checkOrigin(request);
  await env.DB.prepare("DELETE FROM settings WHERE key = 'ui_draft'").run();
  request.__audit = 'draft discarded';
  return json(200, { ok: true, ...(await designState(env)) });
}
async function adminDesignPublish(request, env) {
  await requireAdmin(env, request);
  const b = await readJson(request, 40000);
  const ui = await getUi(env, true);
  let src = b.design;
  if (!src) { const d = jparse(await settingGet(env, 'ui_draft'), null); if (!d || !d.design) throw new HttpError(400, 'no_draft', 'There is no draft to publish.'); src = d.design; }
  const { value, fields } = validateDesign(src, ui);
  assertValid(fields);
  const changes = await publishDesign(env, request, value, clamp(b.label || '', 60) || 'Published');
  await env.DB.prepare("DELETE FROM settings WHERE key = 'ui_draft'").run();
  return json(200, { ok: true, changes: changes.length, ...(await designState(env)) });
}
async function adminDesignRestore(request, env, id) {
  await requireAdmin(env, request); checkOrigin(request);
  const row = await env.DB.prepare('SELECT id, label, data, created_at FROM ui_versions WHERE id = ?').bind(Number(id)).first();
  if (!row) throw new HttpError(404, 'not_found', 'That version is no longer kept.');
  const ui = await getUi(env, true);
  const { value } = validateDesign(jparse(row.data, {}), { ...ui, theme: UI_DEFAULTS.theme, layout: UI_DEFAULTS.layout, style: STYLE_DEFAULTS });
  await publishDesign(env, request, value, 'Restored version #' + row.id);
  return json(200, { ok: true, ...(await designState(env)) });
}
async function adminDesignUndo(request, env) {
  await requireAdmin(env, request); checkOrigin(request);
  const rows = (await env.DB.prepare('SELECT id FROM ui_versions ORDER BY id DESC LIMIT 2').all()).results;
  if (rows.length < 2) throw new HttpError(400, 'nothing_to_undo', 'Nothing to undo yet.');
  return adminDesignRestore(request, env, rows[1].id);
}
async function adminDesignReset(request, env) {
  await requireAdmin(env, request); checkOrigin(request);
  await publishDesign(env, request, designOf(mergeUi({})), 'Reset to default');
  return json(200, { ok: true, ...(await designState(env)) });
}
async function adminDesignExport(request, env) {
  await requireAdmin(env, request);
  const ui = await getUi(env, true);
  const body = JSON.stringify({ format: 'avermontis-theme', version: 1, exported_at: nowIso(), ...designOf(ui) }, null, 2);
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="avermontis-theme.json"', 'Cache-Control': 'no-store', ...SEC_HEADERS } });
}
async function adminDesignImport(request, env) {
  await requireAdmin(env, request);
  const b = await readJson(request, 40000);
  const data = b.data && typeof b.data === 'object' ? b.data : b;
  if (data.format !== 'avermontis-theme') throw new HttpError(400, 'invalid_input', 'This is not an AVERMONTIS theme file.');
  const ui = await getUi(env, true);
  const { value, fields } = validateDesign({ theme: data.theme, layout: data.layout, style: data.style }, ui);
  assertValid(fields);
  await settingPut(env, 'ui_draft', JSON.stringify({ design: value, saved_at: nowIso() }));
  request.__audit = 'theme file imported as a draft';
  return json(200, { ok: true, ...(await designState(env)) });
}
async function adminDesignSaveTheme(request, env) {
  await requireAdmin(env, request);
  const b = await readJson(request, 40000);
  const name = clamp(b.name, 40);
  if (name.length < 2) throw new HttpError(400, 'invalid_input', 'Give the theme a name (2-40 characters).', null, { name: 'Give the theme a name.' });
  const ui = await getUi(env, true);
  const { value, fields } = validateDesign({ theme: b.theme, style: b.style }, ui);
  assertValid(fields);
  const list = (jparse(await settingGet(env, 'ui_themes'), []) || []).filter((x) => x.name.toLowerCase() !== name.toLowerCase());
  if (list.length >= 30) throw new HttpError(400, 'too_many', 'You can keep up to 30 saved themes. Delete one first.');
  list.unshift({ id: crypto.randomUUID().slice(0, 8), name, theme: { ...value.theme, preset: 'custom' }, style: value.style, created_at: nowIso() });
  await settingPut(env, 'ui_themes', JSON.stringify(list));
  request.__audit = 'saved theme "' + name + '"';
  return json(200, { ok: true, ...(await designState(env)) });
}
async function adminDesignDeleteTheme(request, env, id) {
  await requireAdmin(env, request); checkOrigin(request);
  const list = jparse(await settingGet(env, 'ui_themes'), []) || [];
  const gone = list.find((x) => x.id === id);
  await settingPut(env, 'ui_themes', JSON.stringify(list.filter((x) => x.id !== id)));
  request.__audit = 'deleted saved theme "' + (gone ? gone.name : id) + '"';
  return json(200, { ok: true, ...(await designState(env)) });
}
// v4's per-section Save (Customize > Colours/Layout) now also keeps a version, so Undo covers it too
async function adminPutUiV5(request, env, section) {
  const design = DESIGN_SECTIONS.includes(section);
  const before = await getUi(env, true);
  if (design) await ensureBaseVersion(env, request);
  const res = await adminPutUi(request, env, section);
  if (res.status === 200) {
    const after = await getUi(env, true);
    const ch = diffKeys(before[section], after[section]);
    if (design) await recordVersion(env, request, 'Saved ' + section);
    request.__audit = section + ': ' + (ch.length ? ch.slice(0, 10).map((c) => c.key).join(', ') : 'no change');
    request.__auditDetail = section === 'chat' ? null : ch.slice(0, 40);
  }
  return res;
}
async function adminResetUiV5(request, env, section) {
  const design = DESIGN_SECTIONS.includes(section);
  if (design) await ensureBaseVersion(env, request);
  const res = await adminResetUi(request, env, section);
  if (res.status === 200 && design) await recordVersion(env, request, 'Reset ' + section);
  request.__audit = section + ' back to original';
  return res;
}
const ROUTES_V5 = [
  ['POST', /^\/api\/auth\/admin-pin$/, adminPinStep],
  ['POST', /^\/api\/admin\/handoff$/, adminHandoff],
  ['GET', /^\/api\/admin\/security$/, adminGetSecurity],
  ['PUT', /^\/api\/admin\/security$/, adminPutSecurity],
  ['POST', /^\/api\/admin\/logout-all$/, adminLogoutAll],
  ['GET', /^\/api\/admin\/audit$/, adminAudit],
  ['GET', /^\/api\/admin\/design$/, adminDesign],
  ['POST', /^\/api\/admin\/design\/preview$/, adminDesignPreview],
  ['PUT', /^\/api\/admin\/design\/draft$/, adminDesignDraft],
  ['DELETE', /^\/api\/admin\/design\/draft$/, adminDesignDiscard],
  ['POST', /^\/api\/admin\/design\/publish$/, adminDesignPublish],
  ['POST', /^\/api\/admin\/design\/versions\/(\d+)\/restore$/, (r, env, u, m) => adminDesignRestore(r, env, m[1])],
  ['POST', /^\/api\/admin\/design\/undo$/, adminDesignUndo],
  ['POST', /^\/api\/admin\/design\/reset$/, adminDesignReset],
  ['GET', /^\/api\/admin\/design\/export$/, adminDesignExport],
  ['POST', /^\/api\/admin\/design\/import$/, adminDesignImport],
  ['POST', /^\/api\/admin\/design\/themes$/, adminDesignSaveTheme],
  ['DELETE', /^\/api\/admin\/design\/themes\/([a-z0-9-]{4,12})$/, (r, env, u, m) => adminDesignDeleteTheme(r, env, m[1])]
];
ROUTES.push(...ROUTES_V5);

// =====================================================================================================================
// v6 (Oct 2026): the owner area leaves the customer app. The owner now uses the separate "Avermontis Admin" Android app
// (it opens /admin/app on this site) or /admin in a laptop browser. Extra owner endpoints for that app:
//   GET   /api/admin/app/summary?days=7|30  today's orders/revenue, open order counts, low stock, daily sales
//   GET   /api/admin/app/pulse              new-order check for the open app; does NOT count as activity (idle sign-out still works)
//   PATCH /api/admin/products/:id/quick     quick stock / price / on-off change from the phone
//   POST  /api/admin/app/alert-key          a read-only key for the app's background new-order check (counts only, no names)
//   DELETE /api/admin/app/alert-key         switch background checks off on every phone
//   GET   /api/admin/app/peek               (header X-Alert-Key) how many new orders + time of the newest; nothing else
// =====================================================================================================================
const LOW_STOCK_AT = 5;
async function adminAppSummary(request, env, url) {
  await requireAdmin(env, request);
  const days = url.searchParams.get('days') === '30' ? 30 : 7;
  const today = istMidnightUtcIso();
  const since = new Date(Date.parse(today) - (days - 1) * 86400000).toISOString();
  const r = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END),0) AS s FROM orders WHERE created_at >= ?").bind(today),
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM orders GROUP BY status"),
    env.DB.prepare("SELECT id, name, stock, active FROM products WHERE active = 1 AND stock <= ? ORDER BY stock ASC, name LIMIT 20").bind(LOW_STOCK_AT),
    env.DB.prepare("SELECT date(created_at, '+330 minutes') AS d, COUNT(*) AS n, COALESCE(SUM(total),0) AS s FROM orders WHERE status != 'cancelled' AND created_at >= ? GROUP BY d ORDER BY d").bind(since),
    env.DB.prepare("SELECT id, created_at FROM orders ORDER BY created_at DESC LIMIT 1"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'new'"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'")
  ]);
  const by = Object.fromEntries(r[1].results.map((x) => [x.status, x.n]));
  const map = Object.fromEntries(r[3].results.map((x) => [x.d, x]));
  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.parse(since) + 330 * 60000 + i * 86400000).toISOString().slice(0, 10);
    series.push({ date: d, orders: map[d] ? map[d].n : 0, sales: map[d] ? map[d].s : 0 });
  }
  const latest = r[4].results[0] || null;
  return json(200, { ok: true, summary: {
    today: { orders: (r[0].results[0] || {}).n || 0, revenue: (r[0].results[0] || {}).s || 0 },
    open: { new: by.new || 0, confirmed: by.confirmed || 0, shipped: by.shipped || 0 },
    totals: { delivered: by.delivered || 0, cancelled: by.cancelled || 0, all: Object.values(by).reduce((a, b) => a + b, 0) },
    period: { days, orders: series.reduce((a, x) => a + x.orders, 0), revenue: series.reduce((a, x) => a + x.sales, 0) },
    series, low_stock_at: LOW_STOCK_AT, low_stock: r[2].results.map((p) => ({ id: p.id, name: p.name, stock: p.stock })),
    latest_order: latest ? { id: latest.id, created_at: latest.created_at } : null,
    new_messages: (r[5].results[0] || {}).n || 0, pending_reviews: (r[6].results[0] || {}).n || 0 } });
}
async function newOrderPulse(env) {
  const r = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'new'"),
    env.DB.prepare("SELECT id, created_at FROM orders ORDER BY created_at DESC LIMIT 1")
  ]);
  const latest = r[1].results[0] || null;
  return { new_orders: (r[0].results[0] || {}).n || 0, latest_at: latest ? latest.created_at : null, latest_id: latest ? latest.id : null };
}
async function adminAppPulse(request, env) {
  await requireAdmin(env, request, { noTouch: true });     // polling must not keep an idle owner signed in
  return json(200, { ok: true, ...(await newOrderPulse(env)) });
}
async function adminQuickProduct(request, env, id) {
  await requireAdmin(env, request);
  const b = await readJson(request);
  const p = await env.DB.prepare('SELECT id, name, price, stock, active FROM products WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'not_found', 'Product not found.');
  const f = {}, sets = [], args = [], changed = [];
  if (b.stock !== undefined) { const n = Number(b.stock); if (!Number.isInteger(n) || n < 0 || n > 1000000) f.stock = 'Stock must be a whole number, 0 or more.'; else { sets.push('stock = ?'); args.push(n); changed.push('stock ' + p.stock + ' -> ' + n); } }
  if (b.price !== undefined) { const n = Number(b.price); if (!Number.isInteger(n) || n < 1 || n > 10000000) f.price = 'Price must be a whole number of rupees, at least 1.'; else { sets.push('price = ?'); args.push(n); changed.push('price ' + p.price + ' -> ' + n); } }
  if (b.active !== undefined) { if (typeof b.active !== 'boolean') f.active = 'On/off must be true or false.'; else { sets.push('active = ?'); args.push(b.active ? 1 : 0); changed.push(b.active ? 'shown in store' : 'hidden from store'); } }
  assertValid(f);
  if (!sets.length) throw new HttpError(400, 'invalid_input', 'Nothing to change.');
  await env.DB.prepare('UPDATE products SET ' + sets.join(', ') + ', updated_at = ? WHERE id = ?').bind(...args, nowIso(), id).run();
  request.__audit = p.name + ': ' + changed.join(', ');
  const n = await env.DB.prepare('SELECT id, name, price, stock, active FROM products WHERE id = ?').bind(id).first();
  return json(200, { ok: true, product: { id: n.id, name: n.name, price: n.price, stock: n.stock, active: !!n.active } });
}
async function alertKeys(env) { const v = jparse(await settingGet(env, 'admin_alert_keys'), null); return Array.isArray(v) ? v : []; }
async function adminAlertKeyCreate(request, env) {
  await requireAdmin(env, request);
  checkOrigin(request);
  const token = randToken(32);
  const keys = (await alertKeys(env)).slice(-4);
  keys.push({ h: await sha256hex(token), device: deviceFromUA(clientUA(request)), created_at: nowIso() });
  await settingPut(env, 'admin_alert_keys', JSON.stringify(keys));
  request.__audit = 'background new-order alerts switched on (' + deviceFromUA(clientUA(request)) + ')';
  return json(200, { ok: true, key: token, note: 'This key can only read how many new orders there are. Sign out all devices or turn alerts off to cancel it.' });
}
async function adminAlertKeyRevoke(request, env) {
  await requireAdmin(env, request);
  checkOrigin(request);
  await settingPut(env, 'admin_alert_keys', '[]');
  request.__audit = 'background new-order alerts switched off on every phone';
  return json(200, { ok: true });
}
async function adminAlertPeek(request, env) {
  await rateLimit(env, 'peek', clientIp(request), 120, 3600);
  const k = request.headers.get('x-alert-key') || '';
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(k)) throw new HttpError(403, 'forbidden', 'Owner access only.');
  const h = await sha256hex(k);
  if (!(await alertKeys(env)).some((x) => x.h === h)) throw new HttpError(403, 'forbidden', 'Owner access only.');
  return json(200, { ok: true, ...(await newOrderPulse(env)) });
}
const ROUTES_V6 = [
  ['GET', /^\/api\/admin\/app\/summary$/, adminAppSummary],
  ['GET', /^\/api\/admin\/app\/pulse$/, adminAppPulse],
  ['GET', /^\/api\/admin\/app\/peek$/, adminAlertPeek],
  ['POST', /^\/api\/admin\/app\/alert-key$/, adminAlertKeyCreate],
  ['DELETE', /^\/api\/admin\/app\/alert-key$/, adminAlertKeyRevoke],
  ['PATCH', /^\/api\/admin\/products\/([A-Za-z0-9_-]{2,60})\/quick$/, (r, env, u, m) => adminQuickProduct(r, env, m[1])]
];
ROUTES.unshift(...ROUTES_V6);

