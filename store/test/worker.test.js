// End-to-end tests of the real _worker.js against an in-memory SQLite database that behaves like D1.
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

test.before(async () => {
  const tmp = path.join(os.tmpdir(), 'avermontis-worker-e2e-' + process.pid + '.mjs');
  fs.copyFileSync(path.join(SITE, '_worker.js'), tmp);
  mod = await import(tmp);
  env = { DB: makeD1(), ASSETS };
});

test('migration file and the SQL inside the worker are the same', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf8');
  assert.strictEqual(mod.MIGRATION_SQL.trim(), file.trim());
});

test('signup -> me -> logout -> wrong password (logged as failed) -> login', async () => {
  const a = client();
  let r = await a.call('POST', '/api/auth/signup', { name: 'Asha', email: 'Asha@Example.com', password: 'secret123', role: 'admin' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.match(r.setCookie, /HttpOnly/); assert.match(r.setCookie, /Secure/); assert.match(r.setCookie, /SameSite=Lax/);
  const row = env.DB._db.prepare('SELECT password_hash FROM users WHERE email = ?').get('asha@example.com');
  assert.ok(row.password_hash.startsWith('pbkdf2_sha256$') && !row.password_hash.includes('secret123'));
  r = await a.call('GET', '/api/auth/me'); assert.strictEqual(r.body.user.email, 'asha@example.com');
  r = await a.call('POST', '/api/auth/logout', {}); assert.strictEqual(r.status, 200);
  r = await a.call('GET', '/api/auth/me'); assert.strictEqual(r.body.user, null);
  r = await a.call('POST', '/api/auth/login', { email: 'asha@example.com', password: 'wrongpass1' });
  assert.strictEqual(r.status, 401); assert.strictEqual(r.body.error.code, 'invalid_credentials');
  r = await a.call('POST', '/api/auth/login', { email: 'asha@example.com', password: 'secret123' }); assert.strictEqual(r.status, 200);
  const hist = env.DB._db.prepare("SELECT event, success, reason, device FROM login_history WHERE email = 'asha@example.com' ORDER BY id").all();
  assert.deepStrictEqual(hist.map((h) => [h.event, h.success]), [['signup', 1], ['login', 0], ['login', 1]]);
  assert.strictEqual(hist[1].reason, 'wrong_password'); assert.strictEqual(hist[0].device, 'iPhone · Safari');
});

test('signup validation, duplicate email and uniform error format', async () => {
  const c = client();
  let r = await c.call('POST', '/api/auth/signup', { name: 'x', email: 'bad', password: 'short' });
  assert.strictEqual(r.status, 400); assert.strictEqual(r.body.ok, false); assert.ok(r.body.error.fields.name && r.body.error.fields.email && r.body.error.fields.password);
  await c.call('POST', '/api/auth/signup', { name: 'Dup One', email: 'dup@example.com', password: 'abcd1234' });
  const c2 = client();
  r = await c2.call('POST', '/api/auth/signup', { name: 'Dup Two', email: 'DUP@example.com', password: 'abcd1234' });
  assert.strictEqual(r.status, 409); assert.strictEqual(r.body.error.code, 'email_taken');
  r = await c2.call('POST', '/api/auth/signup', '{not json');
  assert.strictEqual(r.status, 400); assert.strictEqual(r.body.error.code, 'bad_json'); assert.ok(!/at |stack/i.test(JSON.stringify(r.body)));
});

test('CSRF: POST from another origin, without origin, or as a form is refused', async () => {
  const c = client();
  let r = await c.call('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' }, { origin: 'https://evil.example' });
  assert.strictEqual(r.status, 403); assert.strictEqual(r.body.error.code, 'bad_origin');
  r = await c.call('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' }, { origin: null }); assert.strictEqual(r.status, 403);
  r = await c.call('POST', '/api/auth/login', 'email=a', { ct: 'application/x-www-form-urlencoded' }); assert.strictEqual(r.status, 415);
});

test('rate limit: 11th login try from one IP in 2 minutes gets 429 with Retry-After', async () => {
  const c = client('10.9.9.9');
  let last;
  for (let i = 0; i < 11; i++) last = await c.call('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'nope12345' });
  assert.strictEqual(last.status, 429); assert.ok(Number(last.headers.get('retry-after')) > 0); assert.match(last.body.error.message, /try again in/);
});

test('orders: server prices, saved, linked to account; guest order still works; users see only their own', async () => {
  const txt = fs.readFileSync(path.join(SITE, 'products.js'), 'utf8');
  const ps = JSON.parse(txt.slice(txt.indexOf('[', txt.indexOf('AVERMONTIS_PRODUCTS')), txt.lastIndexOf(']') + 1));
  const a = client(), b = client(), g = client();
  await a.call('POST', '/api/auth/signup', { name: 'User A', email: 'a@example.com', password: 'abcd1234' });
  await b.call('POST', '/api/auth/signup', { name: 'User B', email: 'b@example.com', password: 'abcd1234' });
  let r = await a.call('POST', '/api/orders', { items: [{ id: ps[0].id, qty: 2, price: 1 }], customer: ADDR, payment: 'cod', total: 1, user_id: 999 });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const idA = r.body.order.id; assert.strictEqual(r.body.order.subtotal, ps[0].price * 2); assert.strictEqual(r.body.order.account, 'a@example.com');
  r = await g.call('POST', '/api/orders', { items: [{ id: ps[1].id, qty: 1 }], customer: ADDR });
  assert.strictEqual(r.status, 201); const idG = r.body.order.id;
  assert.strictEqual(env.DB._db.prepare('SELECT user_id FROM orders WHERE id = ?').get(idG).user_id, null);
  r = await a.call('GET', '/api/account/orders'); assert.deepStrictEqual(r.body.orders.map((o) => o.id), [idA]);
  r = await b.call('GET', '/api/account/orders'); assert.strictEqual(r.body.orders.length, 0);
  r = await b.call('GET', '/api/account/orders/' + idA); assert.strictEqual(r.status, 404);       // B cannot read A's order
  r = await b.call('GET', '/api/account/orders/' + idG); assert.strictEqual(r.status, 404);       // nor a guest order
  r = await a.call('GET', '/api/account/orders/' + idA); assert.strictEqual(r.status, 200);
  r = await b.call('GET', '/api/account/logins'); assert.ok(r.body.logins.every((l) => l.event === 'signup' || l.event === 'login')); assert.strictEqual(r.body.logins.length, 1);
  r = await g.call('GET', '/api/account/orders'); assert.strictEqual(r.status, 401);
  r = await a.call('POST', '/api/orders', { items: [{ id: 'fake', qty: 1 }], customer: ADDR }); assert.strictEqual(r.status, 400);
  r = await a.call('POST', '/api/orders', { items: [{ id: ps[0].id, qty: 99 }], customer: ADDR }); assert.strictEqual(r.status, 400);
  r = await a.call('POST', '/api/orders', { items: [{ id: ps[0].id, qty: 1 }], customer: { ...ADDR, phone: '123' } }); assert.strictEqual(r.status, 400); assert.ok(r.body.error.fields.phone);
});

test('admin: every admin API is 403 for guests and customers; setup works once; owner sees everything', async () => {
  const cust = client(); await cust.call('POST', '/api/auth/signup', { name: 'Cheater', email: 'cheat@example.com', password: 'abcd1234' });
  const anon = client();
  const adminRoutes = [['GET', '/api/admin/me'], ['GET', '/api/admin/stats'], ['GET', '/api/admin/orders'], ['GET', '/api/admin/customers'], ['GET', '/api/admin/logins'],
    ['GET', '/api/admin/export/orders.csv'], ['GET', '/api/admin/export/logins.csv'], ['PATCH', '/api/admin/orders/AV-000000-AAAAAA', { status: 'cancelled' }], ['DELETE', '/api/admin/orders/AV-000000-AAAAAA']];
  for (const c of [anon, cust]) for (const [m, p, b] of adminRoutes) {
    const r = await c.call(m, p, b); assert.strictEqual(r.status, 403, m + ' ' + p); assert.strictEqual(r.body.error.code, 'forbidden');
  }
  // a customer cookie pasted into the admin cookie name does not work either
  const forged = client(); forged.jar.av_admin = cust.jar.av_sess;
  assert.strictEqual((await forged.call('GET', '/api/admin/stats')).status, 403);
  let r = await anon.call('GET', '/api/admin/setup-status'); assert.strictEqual(r.body.setup_open, true);
  r = await anon.call('POST', '/api/admin/login', { password: 'whatever123' }); assert.strictEqual(r.status, 409);
  const owner = client();
  r = await owner.call('POST', '/api/admin/setup', { password: 'short', confirm: 'short' }); assert.strictEqual(r.status, 400);
  r = await owner.call('POST', '/api/admin/setup', { password: 'ownerpass123', confirm: 'different123' }); assert.strictEqual(r.status, 400);
  r = await owner.call('POST', '/api/admin/setup', { password: 'ownerpass123', confirm: 'ownerpass123' }); assert.strictEqual(r.status, 201);
  r = await anon.call('POST', '/api/admin/setup', { password: 'hijack12345', confirm: 'hijack12345' }); assert.strictEqual(r.status, 409); assert.strictEqual(r.body.error.code, 'setup_closed');
  r = await owner.call('GET', '/api/admin/stats'); assert.strictEqual(r.status, 200); assert.ok(r.body.stats.users >= 4 && r.body.stats.orders_total >= 2);
  r = await owner.call('GET', '/api/admin/orders'); assert.ok(r.body.orders.length >= 2);
  const ts = r.body.orders.map((o) => o.created_at); assert.deepStrictEqual(ts, ts.slice().sort().reverse());
  const id = r.body.orders[0].id;
  r = await owner.call('PATCH', '/api/admin/orders/' + id, { status: 'shipped' }); assert.strictEqual(r.status, 200);
  r = await owner.call('PATCH', '/api/admin/orders/' + id, { status: 'lost' }); assert.strictEqual(r.status, 400);
  r = await owner.call('GET', '/api/admin/logins?result=fail'); assert.ok(r.body.logins.length >= 1 && r.body.logins.every((l) => !l.success)); assert.match(r.body.logins[0].time_ist, /IST$/);
  r = await owner.call('GET', '/api/admin/customers'); assert.ok(r.body.customers.some((c) => c.email === 'a@example.com'));
  r = await owner.call('GET', '/api/admin/export/orders.csv'); assert.strictEqual(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/); assert.match(r.body, /order_id,time_ist,status/);
  r = await owner.call('GET', '/api/admin/export/logins.csv'); assert.match(r.body, /wrong_password/);
  r = await owner.call('POST', '/api/admin/login', { password: 'wrongwrong1' }); assert.strictEqual(r.status, 401);
  r = await anon.call('POST', '/api/admin/login', { password: 'ownerpass123' }); assert.strictEqual(r.status, 200);
  assert.strictEqual((await cust.call('GET', '/api/admin/orders')).status, 403);
});

test('helpers: CSV formula injection blocked, device names, IST', () => {
  assert.strictEqual(mod.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.strictEqual(mod.deviceFromUA('Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/120 Mobile Safari/537.36'), 'Android · Chrome');
  assert.strictEqual(mod.istString('2026-10-26T18:45:00.000Z'), '2026-10-27 00:15 IST');
});

test('pages get security headers; unknown API is JSON 404; wrong method is 405', async () => {
  const c = client();
  let r = await c.call('GET', '/admin');
  assert.strictEqual(r.status, 200); assert.match(r.body, /Owner dashboard/);
  assert.match((await c.call('GET', '/admin/setup')).body, /Owner setup/);
  assert.match((await c.call('GET', '/')).body, /AVER<span>MONTIS/);
  assert.match((await c.call('GET', '/login.html')).body, /Sign in/);
  assert.strictEqual((await c.call('GET', '/no-such-page')).status, 404);
  assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'none'/); assert.strictEqual(r.headers.get('x-frame-options'), 'DENY');
  r = await c.call('GET', '/api/nope'); assert.strictEqual(r.status, 404); assert.strictEqual(r.body.error.code, 'not_found');
  r = await c.call('GET', '/api/auth/login'); assert.strictEqual(r.status, 405);
});

// ---------- native Android app (Capacitor, bundled screens at https://localhost, bearer token instead of cookies) ----------
const APP = 'https://localhost';
test('native app: CORS preflight, token on signup/login only for the app, bearer works for me/orders/logout', async () => {
  const c = client();
  const app = (m, p, b, h) => c.call(m, p, b, { origin: APP, noCookies: true, headers: h || {} });
  let r = await c.call('OPTIONS', '/api/auth/login', undefined, { origin: APP, headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, authorization' } });
  assert.strictEqual(r.status, 204); assert.strictEqual(r.headers.get('access-control-allow-origin'), APP);
  assert.match(r.headers.get('access-control-allow-headers'), /Authorization/);
  r = await app('POST', '/api/auth/signup', { name: 'Neha App', email: 'neha.app@example.com', password: 'secret123' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.match(r.body.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), APP); assert.strictEqual(r.headers.get('access-control-allow-credentials'), null);
  const tok = r.body.token, auth = { authorization: 'Bearer ' + tok };
  r = await app('GET', '/api/auth/me', undefined, auth); assert.strictEqual(r.body.user.email, 'neha.app@example.com');
  r = await app('GET', '/api/auth/me'); assert.strictEqual(r.body.user, null, 'no bearer, no cookie -> signed out');
  const ps = (await app('GET', '/api/catalog')).body.products.filter((p) => p.active !== false && p.in_stock !== false);
  r = await app('POST', '/api/orders', { items: [{ id: ps[0].id, qty: 1 }], customer: ADDR, payment: 'cod' }, auth);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  r = await app('GET', '/api/account/orders', undefined, auth); assert.strictEqual(r.body.orders.length, 1);
  r = await app('POST', '/api/auth/login', { email: 'neha.app@example.com', password: 'secret123' }); assert.ok(r.body.token && r.body.token !== tok);
  r = await app('POST', '/api/auth/logout', {}, auth); assert.strictEqual(r.status, 200);
  r = await app('GET', '/api/auth/me', undefined, auth); assert.strictEqual(r.body.user, null, 'logged-out token is dead');
  // the website itself never receives a token in the body and gets no CORS headers
  const web = client();
  r = await web.call('POST', '/api/auth/login', { email: 'neha.app@example.com', password: 'secret123' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.token, undefined); assert.match(r.setCookie, /HttpOnly/);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), null);
});

test('native app: other origins still refused, bearer never opens admin, junk bearer ignored', async () => {
  const c = client();
  let r = await c.call('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' }, { origin: 'http://localhost' });
  assert.strictEqual(r.status, 403);
  r = await c.call('OPTIONS', '/api/auth/login', undefined, { origin: 'https://evil.example' }); assert.notStrictEqual(r.status, 204);
  r = await c.call('POST', '/api/auth/signup', { name: 'Ravi App', email: 'ravi.app@example.com', password: 'secret123' }, { origin: APP, noCookies: true });
  const auth = { authorization: 'Bearer ' + r.body.token };
  r = await c.call('GET', '/api/admin/orders', undefined, { origin: APP, noCookies: true, headers: auth }); assert.strictEqual(r.status, 403);
  r = await c.call('GET', '/api/auth/me', undefined, { origin: APP, noCookies: true, headers: { authorization: 'Bearer x"; DROP' } }); assert.strictEqual(r.body.user, null);
});

test('Android app download: /download page and the APK served as an attachment with the APK type', async () => {
  const c = client();
  let r = await c.call('GET', '/download');
  assert.strictEqual(r.status, 200); assert.match(r.body, /href="\/download\/avermontis\.apk"/); assert.match(r.body, /Install/); assert.match(r.body, /AVERMONTIS/);
  r = await c.call('GET', '/download/avermontis.apk');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.match(r.headers.get('content-disposition'), /attachment; filename="AVERMONTIS\.apk"/);
  const file = fs.readFileSync(path.join(SITE, '_dl', 'avermontis.apk'));
  assert.ok(file.length > 1e6 && file.slice(0, 2).toString() === 'PK', 'a real APK (zip) is shipped');
});
