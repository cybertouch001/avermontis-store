// v6 (Oct 2026): endpoints for the separate Avermontis Admin app + its unlisted download, admin security, design studio, versions, audit log.
// Same harness as worker.test.js: the real _worker.js against an in-memory SQLite database that behaves like D1.
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
    if (/^\s*(SELECT|WITH)/i.test(sql) || /RETURNING/i.test(sql)) { const rows = st.all(...args); return { results: rows, meta: { changes: 0 } }; }
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
    if (opts.noCookies) delete headers.cookie;
    Object.assign(headers, opts.headers || {});
    const res = await mod.default.fetch(new Request(ORIGIN + p, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }), env);
    const sc = res.headers.get('set-cookie');
    if (sc) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0/.test(sc)) delete jar[k]; else jar[k] = v; }
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, setCookie: sc, body: ct.includes('json') ? await res.json() : await res.text() };
  }
  return { call, jar, ip };
}
const ADDR = { name: 'Test Buyer', phone: '9876543210', address: '12 MG Road, Indiranagar', pincode: '560038', city: 'Bengaluru', state: 'Karnataka' };


const OWNER_PW = 'OwnerPass123';
test.before(async () => {
  const tmp = path.join(os.tmpdir(), 'avermontis-v6-' + process.pid + '.mjs');
  fs.copyFileSync(path.join(SITE, '_worker.js'), tmp);
  mod = await import(tmp);
  env = { DB: makeD1(), ASSETS };
  const r = await client().call('POST', '/api/admin/setup', { password: OWNER_PW, confirm: OWNER_PW });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
});
async function owner() {
  const c = client();
  const r = await c.call('POST', '/api/admin/login', { username: 'admin', password: OWNER_PW, app: 'admin' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body)); return c;
}
async function placeOrder(name, phone) {
  const c = client();
  const prods = (await (await owner()).call('GET', '/api/admin/products')).body.products;
  const p = prods.filter((x) => x.active !== false).sort((a, b) => b.stock - a.stock)[0];
  const r = await c.call('POST', '/api/orders', { items: [{ id: p.id, qty: 1 }], customer: { ...ADDR, name, phone, email: name.split(' ')[0].toLowerCase() + '@example.com' }, payment: 'cod' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  return r.body.order;
}

test('admin app summary: today, open orders, 7/30-day series, low stock - all from real orders', async () => {
  const o = await owner();
  let r = await o.call('GET', '/api/admin/app/summary?days=7'); assert.strictEqual(r.status, 200);
  const before = r.body.summary; assert.strictEqual(before.series.length, 7);
  const ord = await placeOrder('Kavya Rao', '9812345678');
  r = await o.call('GET', '/api/admin/app/summary?days=30'); const s = r.body.summary;
  assert.strictEqual(s.series.length, 30); assert.strictEqual(s.period.days, 30);
  assert.strictEqual(s.today.orders, before.today.orders + 1); assert.strictEqual(s.today.revenue, before.today.revenue + ord.total);
  assert.strictEqual(s.open.new, before.open.new + 1);
  assert.strictEqual(s.series[29].orders, s.today.orders, 'today is the last bar');
  assert.strictEqual(s.latest_order.id, ord.id);
  assert.ok(Array.isArray(s.low_stock));
  // low stock: set a product to 2 and it shows up
  const pid = (await o.call('GET', '/api/admin/products')).body.products[0].id;
  r = await o.call('PATCH', '/api/admin/products/' + pid + '/quick', { stock: 2 }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.product.stock, 2);
  r = await o.call('GET', '/api/admin/app/summary'); assert.ok(r.body.summary.low_stock.some((x) => x.id === pid && x.stock === 2));
  r = await client().call('GET', '/api/admin/app/summary'); assert.strictEqual(r.status, 403);
});

test('quick product change: stock / price / on-off validated and written to the audit log', async () => {
  const o = await owner();
  const p = (await o.call('GET', '/api/admin/products')).body.products[1];
  let r = await o.call('PATCH', '/api/admin/products/' + p.id + '/quick', { stock: -1 }); assert.strictEqual(r.status, 400);
  r = await o.call('PATCH', '/api/admin/products/' + p.id + '/quick', { price: 0 }); assert.strictEqual(r.status, 400);
  r = await o.call('PATCH', '/api/admin/products/' + p.id + '/quick', { stock: 40, price: 599 }); assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.product.stock, 40); assert.strictEqual(r.body.product.price, 599);
  r = await o.call('PATCH', '/api/admin/products/nope-nope/quick', { stock: 3 }); assert.strictEqual(r.status, 404);
  r = await o.call('GET', '/api/admin/audit'); assert.ok(JSON.stringify(r.body).includes('price ' + p.price + ' -> 599'));
  r = await client().call('PATCH', '/api/admin/products/' + p.id + '/quick', { stock: 1 }); assert.strictEqual(r.status, 403);
});

test('order search by id, name, phone, city + status filter', async () => {
  const o = await owner();
  const a = await placeOrder('Zoravar Gill', '9898989898');
  let r = await o.call('GET', '/api/admin/orders?q=zoravar'); assert.ok(r.body.orders.length >= 1 && r.body.orders.every((x) => /zoravar/i.test(x.customer.name)));
  r = await o.call('GET', '/api/admin/orders?q=98989898'); assert.ok(r.body.orders.some((x) => x.id === a.id));
  r = await o.call('GET', '/api/admin/orders?q=' + encodeURIComponent(a.id)); assert.strictEqual(r.body.orders[0].id, a.id);
  r = await o.call('GET', '/api/admin/orders?q=zoravar&status=delivered'); assert.strictEqual(r.body.orders.length, 0);
  r = await o.call('PATCH', '/api/admin/orders/' + encodeURIComponent(a.id), { status: 'shipped' }); assert.strictEqual(r.status, 200);
  r = await o.call('GET', '/api/admin/orders?q=zoravar&status=shipped'); assert.strictEqual(r.body.orders[0].id, a.id);
  r = await o.call('GET', '/api/admin/orders?q=%25'); assert.strictEqual(r.status, 200, 'a % sign is searched literally');
});

test('pulse (new-order check) does not keep an idle owner signed in', async () => {
  const o = await owner();
  let r = await o.call('GET', '/api/admin/app/pulse'); assert.strictEqual(r.status, 200); assert.ok('new_orders' in r.body && 'latest_at' in r.body);
  const old = new Date(Date.now() - 10 * 60000).toISOString();
  env.DB._db.prepare("UPDATE sessions SET last_seen_at = ? WHERE kind = 'admin'").run(old);
  await o.call('GET', '/api/admin/app/pulse');
  assert.ok(env.DB._db.prepare("SELECT last_seen_at FROM sessions WHERE kind = 'admin' ORDER BY created_at DESC LIMIT 1").get().last_seen_at <= old, 'pulse did not refresh activity');
  env.DB._db.prepare("UPDATE sessions SET last_seen_at = ? WHERE kind = 'admin'").run(new Date(Date.now() - 31 * 60000).toISOString());
  r = await o.call('GET', '/api/admin/app/pulse'); assert.strictEqual(r.status, 403, 'idle sign-out still happens');
});

test('background alert key: reads only counts, revoked by "off" and by sign out everywhere', async () => {
  const o = await owner();
  let r = await o.call('POST', '/api/admin/app/alert-key', {}); assert.strictEqual(r.status, 200); const key = r.body.key; assert.ok(key.length > 30);
  const peek = (k, ip) => client(ip).call('GET', '/api/admin/app/peek', undefined, { origin: null, headers: { 'x-alert-key': k } });
  r = await peek(key); assert.strictEqual(r.status, 200); assert.deepStrictEqual(Object.keys(r.body).sort(), ['latest_at', 'latest_id', 'new_orders', 'ok']);
  r = await peek(key.slice(0, -2) + 'zz'); assert.strictEqual(r.status, 403);
  r = await peek(''); assert.strictEqual(r.status, 403);
  // the key never opens anything else
  r = await client().call('GET', '/api/admin/orders', undefined, { headers: { 'x-alert-key': key } }); assert.strictEqual(r.status, 403);
  r = await o.call('DELETE', '/api/admin/app/alert-key'); assert.strictEqual(r.status, 200);
  r = await peek(key); assert.strictEqual(r.status, 403);
  r = await o.call('POST', '/api/admin/app/alert-key', {}); const k2 = r.body.key;
  r = await peek(k2); assert.strictEqual(r.status, 200);
  r = await o.call('POST', '/api/admin/logout-all', {}); assert.strictEqual(r.status, 200);
  r = await peek(k2); assert.strictEqual(r.status, 403, 'sign out everywhere stops background checks');
  // the customer app can never ask for a key
  r = await client().call('POST', '/api/admin/app/alert-key', {}, { origin: 'https://localhost' }); assert.strictEqual(r.status, 403);
});

test('admin app page + unlisted admin download: noindex, never framed, not linked from the store', async () => {
  let r = await client().call('GET', '/admin/app'); assert.strictEqual(r.status, 200);
  assert.match(r.body, /Avermontis Admin/); assert.strictEqual(r.headers.get('x-frame-options'), 'DENY'); assert.match(r.headers.get('x-robots-tag'), /noindex/);
  r = await client().call('GET', '/download/admin'); assert.strictEqual(r.status, 200); assert.match(r.headers.get('x-robots-tag'), /noindex/); assert.match(r.body, /noindex/);
  assert.match(r.body, /avermontis-admin\.apk/);
  const dl = fs.existsSync(path.join(SITE, '_dl', 'avermontis-admin.apk'));
  r = await client().call('GET', '/download/avermontis-admin.apk');
  if (dl) { assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('content-type'), 'application/vnd.android.package-archive'); assert.match(r.headers.get('content-disposition'), /Avermontis-Admin\.apk/); }
  for (const p of ['/', '/download', '/shop', '/login', '/sitemap.xml', '/robots.txt']) {
    r = await client().call('GET', p); assert.ok(!/download\/admin|avermontis-admin\.apk|admin\/app/.test(typeof r.body === 'string' ? r.body : JSON.stringify(r.body)), p + ' must not link the admin app');
  }
});
