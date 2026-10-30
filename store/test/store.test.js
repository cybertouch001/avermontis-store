// Store upgrade (v2) tests of the real _worker.js against an in-memory SQLite database that behaves like D1.
// Run: npm test   (node --test test/)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const SITE = path.join(__dirname, '..', 'site');
const ORIGIN = 'https://avermontis.sites.tab.bot';

function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const exec = (sql, args) => {
    const st = db.prepare(sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql) || /RETURNING/i.test(sql)) { const rows = st.all(...args); return { results: rows, meta: { changes: 0 } }; }
    const r = st.run(...args); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => { const r = exec(sql, args).results; return r.length ? { ...r[0] } : null; },
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    _x: () => exec(sql, args)
  });
  return { _db: db, prepare: (sql) => stmt(sql), batch: async (list) => { db.exec('BEGIN'); try { const out = list.map((s) => s._x()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
const ASSETS = { fetch: async (req) => {
  const u = new URL(req.url); let p = u.pathname; if (p.endsWith('/')) p += 'index.html';
  let f = path.join(SITE, p); const isFile = (x) => fs.existsSync(x) && fs.statSync(x).isFile(); if (!isFile(f) && isFile(f + '.html')) f += '.html';
  if (!isFile(f)) return new Response('nf', { status: 404, headers: { 'content-type': 'text/html' } });
  return new Response(fs.readFileSync(f), { status: 200, headers: { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/javascript' } });
} };

let mod, env;
let ipCounter = 1;
function client(ip) {
  const jar = {};
  ip = ip || ('10.0.0.' + (ipCounter++));
  async function call(method, p, body, opts = {}) {
    const headers = { 'cf-connecting-ip': ip, 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' };
    if (opts.origin !== null) headers.origin = opts.origin || ORIGIN;
    if (body !== undefined) headers['content-type'] = opts.ct || 'application/json';
    const ck = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '); if (ck) headers.cookie = ck;
    const res = await mod.default.fetch(new Request(ORIGIN + p, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }), env);
    const sc = res.headers.get('set-cookie');
    if (sc) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0/.test(sc)) delete jar[k]; else jar[k] = v; }
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, setCookie: sc, body: ct.includes('json') ? await res.json() : await res.text() };
  }
  return { call, jar, ip };
}
const ADDR = { name: 'Test Buyer', phone: '9876543210', address: '12 MG Road, Indiranagar', pincode: '560038', city: 'Bengaluru', state: 'Karnataka' };


const OWNER_PW = 'ownerpass123';
let owner;
test.before(async () => {
  const tmp = path.join(os.tmpdir(), 'avermontis-store-e2e-' + process.pid + '.mjs');
  fs.copyFileSync(path.join(SITE, '_worker.js'), tmp);
  mod = await import(tmp);
  // start from a v1 database with real-looking existing data, exactly like the live store before this upgrade
  const db = makeD1();
  for (const q of mod.splitSql(mod.MIGRATION_SQL)) db._db.exec(q);
  db._db.prepare("INSERT INTO users (email, name, password_hash, created_at) VALUES ('old@example.com', 'Old Customer', 'pbkdf2_sha256$100000$x$y', '2026-10-25T10:00:00.000Z')").run();
  db._db.prepare("INSERT INTO orders (id, user_id, status, payment, subtotal, shipping, total, name, phone, email, address, city, state, pincode, created_at, updated_at) VALUES ('AV-251026-OLD001', 1, 'new', 'cod', 549, 0, 549, 'Old Customer', '9876543210', 'old@example.com', '1 Old Street, Old Town', 'Pune', 'Maharashtra', '411001', '2026-10-25T10:05:00.000Z', '2026-10-25T10:05:00.000Z')").run();
  db._db.prepare("INSERT INTO order_items (order_id, product_id, name, size, unit_price, qty, line_total) VALUES ('AV-251026-OLD001', 'vitamin-c-serum', 'Vitamin C Face Serum', '30 ml', 549, 1, 549)").run();
  db._db.prepare("INSERT INTO login_history (user_id, email, kind, event, success, created_at) VALUES (1, 'old@example.com', 'customer', 'login', 1, '2026-10-25T10:00:00.000Z')").run();
  db._db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('admin_password_hash', 'keep-me', '2026-10-25T10:00:00.000Z')").run();
  env = { DB: db, ASSETS, MEDIA: makeR2() };
});
function makeR2() { const m = new Map(); return { put: async (k, v, o) => { m.set(k, { v, o }); }, get: async (k) => (m.has(k) ? { body: m.get(k).v, httpMetadata: m.get(k).o.httpMetadata } : null), _m: m }; }
async function makeOwner() {
  // the real owner hash is kept untouched; tests swap in a known one on a copy only
  const saved = env.DB._db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get().value;
  env.DB._db.prepare("UPDATE settings SET value = ? WHERE key = 'admin_password_hash'").run(await mod.hashPassword(OWNER_PW, 1000));
  const o = client(); const r = await o.call('POST', '/api/admin/login', { password: OWNER_PW }); assert.strictEqual(r.status, 200);
  return { o, saved };
}

test('migration v2 keeps old data, adds invoice numbers, seeds products; admin password untouched', async () => {
  const r = await client().call('GET', '/api/catalog');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.products.length, 5);
  assert.ok(r.body.products.every((p) => p.in_stock));
  const o = env.DB._db.prepare("SELECT * FROM orders WHERE id = 'AV-251026-OLD001'").get();
  assert.strictEqual(o.total, 549); assert.strictEqual(o.name, 'Old Customer');
  assert.strictEqual(o.invoice_no, 'INV-2026-0001'); assert.ok(o.invoice_token.length > 20);
  assert.strictEqual(env.DB._db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.strictEqual(env.DB._db.prepare('SELECT COUNT(*) AS n FROM login_history').get().n, 1);
  assert.strictEqual(env.DB._db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get().value, 'keep-me');
  assert.strictEqual(env.DB._db.prepare('SELECT COUNT(*) AS n FROM order_events').get().n, 1);
  const file = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0002_store.sql'), 'utf8');
  assert.ok(file.startsWith(mod.MIGRATION_2_SQL.trim().slice(0, 200)));
});

test('owner: coupons, stock, order with coupon, invoice, tracking, cancel restores stock', async () => {
  const { o, saved } = await makeOwner();
  owner = o;
  let r = await o.call('POST', '/api/admin/coupons', { code: 'QATEST10', kind: 'percent', value: 10, min_order: 500, usage_limit: 1 });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  r = await o.call('POST', '/api/admin/coupons', { code: 'OLDONE', kind: 'flat', value: 50, expires: '2020-01-01' }); assert.strictEqual(r.status, 201);
  r = await o.call('POST', '/api/admin/coupons', { code: 'BAD', kind: 'percent', value: 95 }); assert.strictEqual(r.status, 400);
  // price check by the server; browser prices ignored
  const c = client();
  r = await c.call('POST', '/api/quote', { items: [{ id: 'hydrating-face-wash', qty: 1, price: 1 }], coupon: 'QATEST10' });
  assert.strictEqual(r.status, 400); assert.match(r.body.error.message, /minimum order/);
  r = await c.call('POST', '/api/quote', { items: [{ id: 'vitamin-c-serum', qty: 1 }], coupon: 'OLDONE' }); assert.match(r.body.error.message, /expired/);
  r = await c.call('POST', '/api/quote', { items: [{ id: 'vitamin-c-serum', qty: 1 }], coupon: 'qatest10' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.quote.discount, 54); assert.strictEqual(r.body.quote.total, 495 + 49);
  // stock: set face wash stock to 1
  const pr = (await o.call('GET', '/api/admin/products')).body.products.find((p) => p.id === 'hydrating-face-wash');
  r = await o.call('PUT', '/api/admin/products/hydrating-face-wash', { ...pr, stock: 1 }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.product.stock, 1);
  r = await c.call('POST', '/api/orders', { items: [{ id: 'hydrating-face-wash', qty: 2 }], customer: ADDR }); assert.strictEqual(r.status, 400); assert.match(r.body.error.message, /Only 1 left/);
  r = await c.call('POST', '/api/orders', { items: [{ id: 'vitamin-c-serum', qty: 1 }, { id: 'hydrating-face-wash', qty: 1 }], coupon: 'QATEST10', customer: { ...ADDR, email: 'buyer@example.com' } });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const ord = r.body.order;
  assert.strictEqual(ord.items_subtotal, 848); assert.strictEqual(ord.discount, 84); assert.strictEqual(ord.shipping, 0); assert.strictEqual(ord.total, 764);
  assert.strictEqual(ord.invoice_no, 'INV-2026-0002');
  const row = env.DB._db.prepare('SELECT subtotal, shipping, total FROM orders WHERE id = ?').get(ord.id);
  assert.strictEqual(row.subtotal + row.shipping, row.total);
  // coupon used up (limit 1)
  r = await c.call('POST', '/api/quote', { items: [{ id: 'vitamin-c-serum', qty: 1 }], coupon: 'QATEST10' }); assert.match(r.body.error.message, /usage limit/);
  // out of stock now
  r = await client().call('GET', '/api/catalog'); assert.strictEqual(r.body.products.find((p) => p.id === 'hydrating-face-wash').in_stock, false);
  r = await c.call('POST', '/api/orders', { items: [{ id: 'hydrating-face-wash', qty: 1 }], customer: ADDR }); assert.strictEqual(r.status, 400); assert.match(r.body.error.message, /out of stock/);
  // invoice
  const path1 = new URL(ord.invoice_url).pathname + new URL(ord.invoice_url).search;
  r = await client().call('GET', path1); assert.strictEqual(r.status, 200);
  assert.match(r.body, /INV-2026-0002/); assert.match(r.body, /Rupees Seven Hundred Sixty Four Only/); assert.match(r.body, /GSTIN: \(to be added\)/); assert.match(r.body, /avermontis@mail\.tab\.bot/);
  r = await client().call('GET', '/invoice/' + ord.id); assert.strictEqual(r.status, 404);
  r = await client().call('GET', '/invoice/' + ord.id + '?t=wrongtokenwrongtokenwrong'); assert.strictEqual(r.status, 404);
  r = await o.call('GET', '/invoice/' + ord.id); assert.strictEqual(r.status, 200);
  // tracking
  r = await client().call('POST', '/api/track', { order_id: ord.id, contact: '98765 43210' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.order.events.length, 1);
  assert.ok(!JSON.stringify(r.body).includes('MG Road'));
  r = await client().call('POST', '/api/track', { order_id: ord.id, contact: 'BUYER@example.com' }); assert.strictEqual(r.status, 200);
  r = await client().call('POST', '/api/track', { order_id: ord.id, contact: '9999999999' }); assert.strictEqual(r.status, 404);
  // confirm -> email attempt (not configured) + mail draft for the mailto fallback
  r = await o.call('PATCH', '/api/admin/orders/' + ord.id, { status: 'confirmed' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.email.reason, 'not_configured'); assert.match(r.body.mail.subject, /confirmed/); assert.match(r.body.mail.body, /invoice/i);
  r = await client().call('POST', '/api/track', { order_id: ord.id, contact: '9876543210' }); assert.strictEqual(r.body.order.events.length, 2);
  // cancel restores stock
  r = await o.call('PATCH', '/api/admin/orders/' + ord.id, { status: 'cancelled' }); assert.strictEqual(r.status, 200);
  assert.strictEqual(env.DB._db.prepare("SELECT stock FROM products WHERE id = 'hydrating-face-wash'").get().stock, 1);
  // delete test order + coupons
  r = await o.call('DELETE', '/api/admin/orders/' + ord.id); assert.strictEqual(r.status, 200);
  r = await o.call('DELETE', '/api/admin/coupons/QATEST10'); assert.strictEqual(r.status, 200);
  r = await o.call('DELETE', '/api/admin/coupons/OLDONE'); assert.strictEqual(r.status, 200);
  env._saved = saved;
});

test('email: key stays on the server, provider gets it in its header; order confirmation is sent', async () => {
  const o = owner;
  let r = await o.call('PUT', '/api/admin/settings', { email_provider: 'brevo', email_from: 'orders@example.com', email_api_key: 'xkeysib-TESTKEY-1234567890' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.email.configured, true);
  assert.ok(!JSON.stringify(r.body).includes('TESTKEY'));
  r = await client().call('GET', '/api/config'); assert.ok(!JSON.stringify(r.body).includes('TESTKEY'));
  const calls = [];
  globalThis.__avFetch = async (u, init) => { calls.push({ u, init }); return new Response('{"messageId":"x"}', { status: 201 }); };
  const c = client();
  r = await c.call('POST', '/api/orders', { items: [{ id: 'vitamin-c-serum', qty: 1 }], customer: { ...ADDR, email: 'buyer@example.com' } });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0].u, 'https://api.brevo.com/v3/smtp/email'); assert.strictEqual(calls[0].init.headers['api-key'], 'xkeysib-TESTKEY-1234567890');
  assert.match(JSON.parse(calls[0].init.body).subject, /received/);
  r = await o.call('PATCH', '/api/admin/orders/' + r.body.order.id, { status: 'confirmed' });
  assert.strictEqual(r.body.email.sent, true); assert.strictEqual(calls.length, 2); assert.match(JSON.parse(calls[1].init.body).htmlContent, /View \/ download invoice/);
  globalThis.__avFetch = async () => new Response('{"message":"Key not found xkeysib-TESTKEY-1234567890"}', { status: 401 });
  r = await o.call('POST', '/api/admin/email-test', { to: 'me@example.com' }); assert.strictEqual(r.body.result.sent, false); assert.ok(!JSON.stringify(r.body).includes('TESTKEY'));
  delete globalThis.__avFetch;
  r = await o.call('PUT', '/api/admin/settings', { email_provider: '', remove_email_api_key: true }); assert.strictEqual(r.body.email.configured, false);
});

test('reviews (moderated), wishlist (own only), newsletter, contact, forgot/reset', async () => {
  const o = owner;
  const anon = client();
  let r = await anon.call('GET', '/api/products/vitamin-c-serum/reviews'); assert.strictEqual(r.body.count, 0);
  r = await anon.call('POST', '/api/products/vitamin-c-serum/reviews', { rating: 5, body: 'Lovely serum, light.' }); assert.strictEqual(r.status, 401);
  const u = client(); await u.call('POST', '/api/auth/signup', { name: 'Rev Iewer', email: 'rev@example.com', password: 'abcd1234' });
  r = await u.call('POST', '/api/products/vitamin-c-serum/reviews', { rating: 6, body: 'x' }); assert.strictEqual(r.status, 400);
  r = await u.call('POST', '/api/products/vitamin-c-serum/reviews', { rating: 5, title: 'Nice', body: 'Lovely serum, light texture.' }); assert.strictEqual(r.status, 201);
  r = await u.call('POST', '/api/products/vitamin-c-serum/reviews', { rating: 4, body: 'Second try here.' }); assert.strictEqual(r.status, 409);
  r = await anon.call('GET', '/api/products/vitamin-c-serum/reviews'); assert.strictEqual(r.body.count, 0);
  const rv = (await o.call('GET', '/api/admin/reviews?status=pending')).body.reviews[0];
  r = await o.call('PATCH', '/api/admin/reviews/' + rv.id, { status: 'approved' }); assert.strictEqual(r.status, 200);
  r = await anon.call('GET', '/api/products/vitamin-c-serum/reviews'); assert.strictEqual(r.body.count, 1); assert.strictEqual(r.body.avg, 5);
  r = await anon.call('GET', '/product?id=vitamin-c-serum'); assert.match(r.body, /"aggregateRating"/); assert.match(r.body, /<title>Vitamin C Face Serum \(30 ml\) \| Avermontis<\/title>/);
  // wishlist
  r = await anon.call('POST', '/api/account/wishlist', { product_id: 'vitamin-c-serum' }); assert.strictEqual(r.status, 401);
  r = await u.call('POST', '/api/account/wishlist', { product_id: 'vitamin-c-serum' }); assert.strictEqual(r.status, 200);
  r = await u.call('GET', '/api/account/wishlist'); assert.deepStrictEqual(r.body.items, ['vitamin-c-serum']);
  const u2 = client(); await u2.call('POST', '/api/auth/signup', { name: 'Other One', email: 'other@example.com', password: 'abcd1234' });
  r = await u2.call('GET', '/api/account/wishlist'); assert.deepStrictEqual(r.body.items, []);
  r = await u.call('DELETE', '/api/account/wishlist/vitamin-c-serum'); assert.strictEqual(r.status, 200);
  // newsletter + contact
  r = await anon.call('POST', '/api/newsletter', { email: 'nope' }); assert.strictEqual(r.status, 400);
  r = await anon.call('POST', '/api/newsletter', { email: 'News@Example.com' }); assert.strictEqual(r.status, 200);
  r = await anon.call('POST', '/api/newsletter', { email: 'news@example.com' }); assert.strictEqual(r.status, 200);
  r = await o.call('GET', '/api/admin/subscribers'); assert.strictEqual(r.body.subscribers.length, 1);
  r = await o.call('GET', '/api/admin/export/subscribers.csv'); assert.match(r.body, /news@example.com/);
  r = await anon.call('POST', '/api/contact', { name: 'A', email: 'x', message: 'short' }); assert.strictEqual(r.status, 400); assert.ok(r.body.error.fields.email && r.body.error.fields.message);
  r = await anon.call('POST', '/api/contact', { name: 'Asha', email: 'asha@example.com', message: 'Is the serum okay for oily skin?' }); assert.strictEqual(r.status, 201);
  r = await o.call('GET', '/api/admin/messages'); assert.strictEqual(r.body.messages.length, 1);
  // forgot / reset
  r = await anon.call('POST', '/api/auth/forgot', { email: 'nobody@example.com' }); const msgA = r.body.message;
  r = await anon.call('POST', '/api/auth/forgot', { email: 'rev@example.com' }); assert.strictEqual(r.body.message, msgA);
  const uid = env.DB._db.prepare("SELECT id FROM users WHERE email = 'rev@example.com'").get().id;
  r = await o.call('POST', `/api/admin/customers/${uid}/reset-link`, {}); assert.strictEqual(r.status, 201);
  const token = new URL(r.body.link).searchParams.get('token');
  r = await anon.call('POST', '/api/auth/reset', { token, password: 'newpass123' }); assert.strictEqual(r.status, 200);
  r = await anon.call('POST', '/api/auth/reset', { token, password: 'newpass456' }); assert.strictEqual(r.status, 400);
  r = await u.call('GET', '/api/auth/me'); assert.strictEqual(r.body.user, null);    // old sessions signed out
  r = await client().call('POST', '/api/auth/login', { email: 'rev@example.com', password: 'newpass123' }); assert.strictEqual(r.status, 200);
});

test('backup: xlsx is a real workbook, json has everything but no admin secrets; restore only adds missing rows', async () => {
  const o = owner;
  let res = await mod.default.fetch(new Request(ORIGIN + '/api/admin/backup.xlsx', { headers: { cookie: 'av_admin=' + o.jar.av_admin, 'cf-connecting-ip': o.ip } }), env);
  assert.strictEqual(res.status, 200); assert.match(res.headers.get('content-disposition'), /avermontis-backup-\d{4}-\d{2}-\d{2}\.xlsx/);
  const buf = Buffer.from(await res.arrayBuffer()); assert.strictEqual(buf.slice(0, 2).toString(), 'PK');
  fs.writeFileSync(path.join(os.tmpdir(), 'avermontis-test-backup.xlsx'), buf);
  let r = await o.call('GET', '/api/admin/backup.json');
  const backup = typeof r.body === 'string' ? JSON.parse(r.body) : r.body;
  assert.strictEqual(backup.format, 'avermontis-backup');
  assert.ok(backup.data.orders.find((x) => x.id === 'AV-251026-OLD001'));
  const s = JSON.stringify(backup); assert.ok(!s.includes('admin_password_hash') && !s.includes('secret:email'));
  // lose a message, then restore
  env.DB._db.prepare('DELETE FROM messages').run();
  r = await o.call('POST', '/api/admin/restore', { backup }); assert.strictEqual(r.status, 400);
  r = await o.call('POST', '/api/admin/restore', { backup, confirm: 'RESTORE' }); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.report.messages.added, 1); assert.strictEqual(r.body.report.orders.added, 0);
  assert.strictEqual(env.DB._db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
});

test('every new owner API is 403 for guests and customers; upload checks file bytes', async () => {
  const cust = client(); await cust.call('POST', '/api/auth/signup', { name: 'Sneaky', email: 'sneaky@example.com', password: 'abcd1234' });
  const routes = [['GET', '/api/admin/products'], ['POST', '/api/admin/products', { id: 'x1', name: 'X', price: 1, stock: 1 }], ['PUT', '/api/admin/products/vitamin-c-serum', { name: 'X', price: 1, stock: 1 }],
    ['GET', '/api/admin/coupons'], ['POST', '/api/admin/coupons', {}], ['PATCH', '/api/admin/coupons/X', { active: false }], ['DELETE', '/api/admin/coupons/X'], ['GET', '/api/admin/reviews'], ['PATCH', '/api/admin/reviews/1', { status: 'approved' }],
    ['DELETE', '/api/admin/messages/1'], ['GET', '/api/admin/subscribers'], ['GET', '/api/admin/messages'], ['GET', '/api/admin/settings'], ['PUT', '/api/admin/settings', {}], ['POST', '/api/admin/email-test', { to: 'a@b.co' }],
    ['GET', '/api/admin/backup.xlsx'], ['GET', '/api/admin/backup.json'], ['POST', '/api/admin/restore', {}], ['GET', '/api/admin/sales'], ['GET', '/api/admin/resets'], ['POST', '/api/admin/customers/1/reset-link', {}],
    ['GET', '/api/admin/export/subscribers.csv'], ['POST', '/api/admin/upload', 'x']];
  for (const c of [client(), cust]) for (const [m, p, b] of routes) { const r = await c.call(m, p, b); assert.strictEqual(r.status, 403, m + ' ' + p); }
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(200)]);
  const up = async (body, ct) => mod.default.fetch(new Request(ORIGIN + '/api/admin/upload', { method: 'POST', body, headers: { origin: ORIGIN, 'content-type': ct, cookie: 'av_admin=' + owner.jar.av_admin, 'cf-connecting-ip': owner.ip } }), env);
  let res = await up(png, 'image/png'); assert.strictEqual(res.status, 201); const j = await res.json(); assert.match(j.url, /^\/media\/products\/.+\.png$/);
  res = await mod.default.fetch(new Request(ORIGIN + j.url), env); assert.strictEqual(res.status, 200);
  res = await up(Buffer.from('<?php echo 1; ?>' + 'x'.repeat(200)), 'image/png'); assert.strictEqual(res.status, 415);
  const r = await owner.call('GET', '/api/admin/sales'); assert.strictEqual(r.body.days.length, 30);
});

test('SEO files and pages', async () => {
  let r = await client().call('GET', '/robots.txt'); assert.match(r.body, /Sitemap: https:\/\/avermontis.sites.tab.bot\/sitemap.xml/); assert.match(r.body, /Disallow: \/admin/);
  r = await client().call('GET', '/sitemap.xml'); assert.match(r.body, /product\?id=vitamin-c-serum/);
  for (const p of ['/', '/shop', '/track', '/forgot', '/reset', '/product?id=niacinamide-serum', '/account', '/admin']) { r = await client().call('GET', p); assert.strictEqual(r.status, 200, p); assert.ok(r.headers.get('content-security-policy'), p); }
  r = await client().call('GET', '/no-such-page'); assert.strictEqual(r.status, 404);
  env.DB._db.prepare("UPDATE settings SET value = ? WHERE key = 'admin_password_hash'").run(env._saved);
});
