// v5/v6 (Oct 2026): owner login (v6: Admin app screen or /admin only, never the customer login), admin security, design studio, versions, audit log.
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
  const tmp = path.join(os.tmpdir(), 'avermontis-v5-e2e-' + process.pid + '.mjs');
  fs.copyFileSync(path.join(SITE, '_worker.js'), tmp);
  mod = await import(tmp);
  env = { DB: makeD1(), ASSETS };
  const a = client();
  const r = await a.call('POST', '/api/admin/setup', { password: OWNER_PW, confirm: OWNER_PW });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
});
// v6: the owner signs in through the Admin app's screen (username + password) or the old /admin page (password)
async function ownerViaNormalLogin(ip) {
  const c = client(ip);
  const r = await c.call('POST', '/api/admin/login', { username: 'Admin', password: OWNER_PW, app: 'admin' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.admin, true); assert.strictEqual(r.body.redirect, '/admin/app');
  assert.ok(c.jar.av_admin, 'owner cookie set'); assert.ok(!c.jar.av_sess, 'no customer cookie');
  assert.match(r.setCookie, /HttpOnly; Secure; SameSite=Lax/);
  return c;
}


test('v6: owner sign-in (admin app screen + old /admin page) with the existing owner password; same hash, nothing reset', async () => {
  const before = env.DB._db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get().value;
  const c = await ownerViaNormalLogin();
  let r = await c.call('GET', '/api/admin/me'); assert.strictEqual(r.status, 200);
  r = await c.call('GET', '/api/admin/stats'); assert.strictEqual(r.status, 200);
  const c2 = client(); r = await c2.call('POST', '/api/admin/login', { username: '  ADMIN ', password: OWNER_PW }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.redirect, '/admin');
  assert.strictEqual(env.DB._db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get().value, before);
  // the old /admin page still works with the same password (no username field)
  const c3 = client(); r = await c3.call('POST', '/api/admin/login', { password: OWNER_PW }); assert.strictEqual(r.status, 200); assert.ok(c3.jar.av_admin);
  r = await c.call('GET', '/api/admin/security'); assert.strictEqual(r.status, 200);
  assert.ok(r.body.logins.some((l) => l.success)); assert.strictEqual(r.body.security.username, 'admin');
});

test('v6: the normal customer login no longer opens the owner area - "admin" gets the same generic error as any wrong login', async () => {
  const cust = client();
  await cust.call('POST', '/api/auth/signup', { name: 'Riya Shah', email: 'riya5@example.com', password: 'Customer123' });
  const k = client(); let r = await k.call('POST', '/api/auth/login', { email: 'riya5@example.com', password: 'nopenope1' });
  assert.strictEqual(r.status, 401); const generic = r.body.error.message;
  for (const body of [{ email: 'admin', password: OWNER_PW }, { email: 'Admin', password: OWNER_PW }, { username: ' ADMIN ', password: OWNER_PW }, { email: 'admin', password: 'wrong' }, { email: 'somebody', password: 'x1234567' }]) {
    const c = client();
    r = await c.call('POST', '/api/auth/login', body);
    assert.strictEqual(r.status, 401, JSON.stringify(body)); assert.strictEqual(r.body.error.message, generic, 'same words as a customer typo');
    assert.ok(!c.jar.av_admin && !c.jar.av_sess, 'no cookie at all'); assert.ok(!r.body.admin && !r.body.step && !r.body.handoff && !r.body.redirect);
  }
  // the app (origin https://localhost) gets the same answer and no token
  r = await client().call('POST', '/api/auth/login', { email: 'admin', password: OWNER_PW }, { origin: 'https://localhost' });
  assert.strictEqual(r.status, 401); assert.strictEqual(r.body.error.message, generic); assert.ok(!r.body.token && !r.body.handoff);
  // trying "admin" on the customer login does not lock the owner out
  const bad = client('10.9.9.8');
  for (let i = 0; i < 6; i++) await bad.call('POST', '/api/auth/login', { email: 'admin', password: 'wrong-' + i });
  r = await bad.call('POST', '/api/admin/login', { username: 'admin', password: OWNER_PW }); assert.strictEqual(r.status, 200);
});

test('wrong owner password: generic message, and 5 wrong tries (password or username) lock that device for 15 minutes', async () => {
  const generic = 'Username/email or password is incorrect.';
  const bad = client('10.9.9.9');
  let r;
  for (let i = 0; i < 5; i++) {
    r = await bad.call('POST', '/api/admin/login', i === 4 ? { username: 'owner', password: OWNER_PW } : { username: 'admin', password: 'wrong-' + i });
    assert.strictEqual(r.status, 401, 'try ' + i); assert.strictEqual(r.body.error.message, generic, 'no hint');
  }
  r = await bad.call('POST', '/api/admin/login', { username: 'admin', password: OWNER_PW });
  assert.strictEqual(r.status, 429); assert.match(r.body.error.message, /locked for 15 minutes/);
  r = await bad.call('POST', '/api/admin/login', { password: OWNER_PW }); assert.strictEqual(r.status, 429, 'the old page shares the lock');
  // another device is not locked out by this one
  await ownerViaNormalLogin('10.9.9.10');
  // a successful login clears that device's counter
  const g = client('10.9.9.11');
  for (let i = 0; i < 3; i++) await g.call('POST', '/api/admin/login', { username: 'admin', password: 'x' + i });
  r = await g.call('POST', '/api/admin/login', { username: 'admin', password: OWNER_PW }); assert.strictEqual(r.status, 200);
  assert.strictEqual(env.DB._db.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE key = 'adminfail:10.9.9.11'").get().n, 0);
});

test('customers can never become admin: reserved names, bearer tokens, customer cookies, look-alike usernames', async () => {
  const c = client();
  for (const name of ['admin', 'ADMIN', 'Adm1n', 'ad min', '\u0430dmin', 'Administrator', 'owner', 'aDmIn99']) {
    const r = await c.call('POST', '/api/auth/signup', { name, email: 'x' + Math.random().toString(36).slice(2) + '@example.com', password: 'Customer123' });
    assert.strictEqual(r.status, 400, name); assert.match(r.body.error.fields.name, /reserved/);
  }
  let r = await c.call('POST', '/api/auth/signup', { name: 'Adarsh Mehta', email: 'adarsh5@example.com', password: 'Customer123' }); assert.strictEqual(r.status, 201, 'normal names still fine');
  for (const p of ['/api/admin/me', '/api/admin/design', '/api/admin/security', '/api/admin/audit', '/api/admin/app/summary']) { r = await c.call('GET', p); assert.strictEqual(r.status, 403, p); }
  r = await c.call('PUT', '/api/admin/design/draft', { theme: { primary: '#111111' } }); assert.strictEqual(r.status, 403);
  // the app: a customer bearer token never opens owner routes
  const app = client();
  r = await app.call('POST', '/api/auth/login', { email: 'adarsh5@example.com', password: 'Customer123' }, { origin: 'https://localhost' });
  assert.ok(r.body.token);
  r = await app.call('GET', '/api/admin/design', undefined, { origin: 'https://localhost', headers: { authorization: 'Bearer ' + r.body.token }, noCookies: true }); assert.strictEqual(r.status, 403);
  // look-alike usernames on the owner screen are not the owner
  for (const u of ['adm1n', 'administrator', 'admin2', '\u0430dmin']) { r = await client().call('POST', '/api/admin/login', { username: u, password: OWNER_PW }); assert.strictEqual(r.status, 401, u); }
  // customer APIs never carry owner settings
  r = await client().call('GET', '/api/config'); const s = JSON.stringify(r.body);
  assert.ok(!/admin_password|pin_hash|admin_security|admin_alert_keys|secret:/.test(s));
});

test('v6: the customer app cannot reach any owner API or hand-off; /admin/handoff is retired', async () => {
  const app = client();
  for (const [m, p, b] of [['POST', '/api/admin/login', { username: 'admin', password: OWNER_PW }], ['POST', '/api/auth/admin-pin', { challenge: 'x', pin: '1234' }], ['POST', '/api/admin/handoff', { code: 'abc' }], ['GET', '/api/admin/me'], ['GET', '/api/admin/app/summary']]) {
    const r = await app.call(m, p, b, { origin: 'https://localhost' });
    assert.strictEqual(r.status, 403, p); assert.ok(!r.setCookie, 'no cookie for ' + p);
  }
  let r = await client().call('POST', '/api/admin/handoff', { code: 'abcdefghijklmnopqrstuvwxyz' }); assert.strictEqual(r.status, 410);
  r = await client().call('GET', '/admin/handoff'); assert.strictEqual(r.status, 302); assert.match(r.headers.get('location'), /\/admin$/);
});

test('owner PIN (optional second step), idle timeout, sign out everywhere, password change keeps working', async () => {
  const o = await ownerViaNormalLogin();
  let r = await o.call('PUT', '/api/admin/security', { pin_enabled: true, pin: '1234', current_password: OWNER_PW }); assert.strictEqual(r.status, 400, 'simple PIN refused');
  r = await o.call('PUT', '/api/admin/security', { pin_enabled: true, pin: '4826', current_password: 'wrong' }); assert.strictEqual(r.status, 400);
  r = await o.call('PUT', '/api/admin/security', { pin_enabled: true, pin: '4826', current_password: OWNER_PW, idle_minutes: 15 }); assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.security.pin_enabled, true); assert.strictEqual(r.body.security.idle_minutes, 15);
  const c = client();
  r = await c.call('POST', '/api/admin/login', { username: 'admin', password: OWNER_PW, app: 'admin' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.step, 'pin'); assert.ok(!c.jar.av_admin, 'no session before the PIN');
  const ch = r.body.challenge;
  r = await c.call('POST', '/api/auth/admin-pin', { challenge: ch, pin: '0000' }); assert.strictEqual(r.status, 401);
  r = await c.call('POST', '/api/auth/admin-pin', { challenge: ch, pin: '4826' }); assert.strictEqual(r.status, 200); assert.ok(c.jar.av_admin);
  // idle: an owner session idle for longer than the setting ends
  env.DB._db.prepare("UPDATE sessions SET last_seen_at = ? WHERE kind = 'admin'").run(new Date(Date.now() - 16 * 60000).toISOString());
  r = await c.call('GET', '/api/admin/me'); assert.strictEqual(r.status, 403);
  // PIN off again, new sessions, then sign out everywhere
  const a = client(); r = await a.call('POST', '/api/admin/login', { username: 'admin', password: OWNER_PW }); r = await a.call('POST', '/api/auth/admin-pin', { challenge: r.body.challenge, pin: '4826' });
  r = await a.call('PUT', '/api/admin/security', { pin_enabled: false, current_password: OWNER_PW, idle_minutes: 30 }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.security.pin_enabled, false);
  const b = await ownerViaNormalLogin();
  r = await b.call('GET', '/api/admin/security'); assert.ok(r.body.sessions.length >= 2);
  r = await b.call('POST', '/api/admin/logout-all', {}); assert.strictEqual(r.status, 200);
  r = await a.call('GET', '/api/admin/me'); assert.strictEqual(r.status, 403);
  r = await b.call('GET', '/api/admin/me'); assert.strictEqual(r.status, 403);
  assert.strictEqual(env.DB._db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE kind = 'admin'").get().n, 0);
});

test('design studio: draft is private until Publish; publish reaches the website and the app config', async () => {
  const o = await ownerViaNormalLogin();
  let r = await o.call('GET', '/api/admin/design'); assert.strictEqual(r.status, 200);
  assert.ok(r.body.presets.fresh_green && r.body.presets.dark_luxe && r.body.presets.minimal_white && r.body.presets.classic_gold && r.body.presets.rose_blush);
  assert.ok(r.body.fonts.body.includes('hind') && r.body.fonts.heading.includes('noto'));
  const draft = { theme: { ...r.body.presets.fresh_green, preset: 'fresh_green', button_bg: '#1F5E3B', button_text: '#FFFFFF', header_bg: '#FFFFFF', font_scale: 110 },
    layout: { home_web: r.body.live.layout.home_web.slice().reverse() }, style: { grid_mobile: 1, grid_desktop: 3, button_shape: 'pill', card_radius: 16, card_shadow: 'soft', announce_text: 'Diwali offer: 10% off', announce_bg: '#1F5E3B', bottom_nav: ['home', 'shop', 'me'], custom_css: '.hero h1{letter-spacing:.02em}' } };
  delete draft.theme.label;
  r = await o.call('POST', '/api/admin/design/preview', draft); assert.strictEqual(r.status, 200);
  assert.match(r.body.css, /montserrat/i); assert.match(r.body.app_css, /tabbar button\[data-go="diary"\]\{display:none\}/);
  r = await o.call('PUT', '/api/admin/design/draft', draft); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.draft);
  let page = await client().call('GET', '/'); assert.ok(!/Diwali offer/.test(page.body), 'draft not live');
  r = await o.call('POST', '/api/admin/design/publish', {}); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.draft, null);
  page = await client().call('GET', '/');
  assert.match(page.body, /Diwali offer: 10% off/); assert.match(page.body, /--green:#1F5E3B/); assert.match(page.body, /html\{font-size:110%\}/);
  assert.match(page.body, /grid-template-columns:repeat\(1,minmax\(0,1fr\)\)/); assert.match(page.body, /\.hero h1\{letter-spacing:\.02em\}/); assert.match(page.body, /montserrat-lati\.woff2/);
  const cfg = await client().call('GET', '/api/config');
  const ui = cfg.body.config.ui; assert.strictEqual(ui.theme.preset, 'fresh_green'); assert.deepStrictEqual(ui.style.bottom_nav, ['home', 'shop', 'me']);
  assert.match(ui.app_css, /--ob:#F4FAF5/); assert.match(ui.app_css, /\.btn:not\(\.ghost\)\{background:#1F5E3B/);
  assert.ok(fs.existsSync(path.join(SITE, 'assets/fonts/montserrat-lati.woff2')));
});

test('design studio: contrast warnings, unreadable text refused, unsafe custom CSS cleaned', async () => {
  const o = await ownerViaNormalLogin();
  let r = await o.call('POST', '/api/admin/design/preview', { theme: { button_bg: '#EEEEEE', button_text: '#FFFFFF', header_bg: '#222222', header_text: '#333333' } });
  assert.ok(r.body.warnings.some((w) => w.field === 'Button text')); assert.ok(r.body.warnings.some((w) => w.field === 'Header'));
  r = await o.call('PUT', '/api/admin/design/draft', { theme: { text: '#EEEEEE', background: '#FFFFFF', site_mode: 'light' } }); assert.strictEqual(r.status, 400);
  const bad = '@import url(https://evil.example/x.css); body{background:url(https://evil.example/a.png)} </style><script>alert(1)</script> .x{behavior:url(x.htc);color:red}';
  r = await o.call('POST', '/api/admin/design/preview', { style: { custom_css: bad } }); assert.strictEqual(r.status, 200);
  assert.ok(!/evil\.example|<script|<\/style|@import|behavior:/i.test(r.body.css + r.body.app_css), r.body.css.slice(-300));
  r = await o.call('POST', '/api/admin/design/preview', { style: { custom_css: '.a{color:red' } }); assert.ok(r.body.fields['style.custom_css']);
});

test('design studio: version history, undo, restore, reset to default, export/import, saved themes, audit log', async () => {
  const o = await ownerViaNormalLogin();
  let r = await o.call('POST', '/api/admin/design/reset', {}); assert.strictEqual(r.status, 200);
  r = await o.call('POST', '/api/admin/design/publish', { design: { theme: { preset: 'dark_luxe', primary: '#0A0A0C', accent: '#D4AF6A', background: '#F3EEE4', text: '#1A1814', site_mode: 'dark', app_mode: 'dark', heading_font: 'dmserif' } }, label: 'Dark Luxe' });
  assert.strictEqual(r.status, 200);
  r = await o.call('POST', '/api/admin/design/publish', { design: { theme: { preset: 'rose_blush', primary: '#4A2530', accent: '#C76B7E', background: '#FFF5F6', text: '#3A1F27', site_mode: 'light' } }, label: 'Rose' });
  const vs = r.body.versions; assert.ok(vs.length >= 3); assert.strictEqual(vs[0].label, 'Rose');
  r = await o.call('POST', '/api/admin/design/undo', {}); assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.live.theme.preset, 'dark_luxe');
  let page = await client().call('GET', '/'); assert.match(page.body, /color-scheme:dark/);
  const rose = vs.find((v) => v.label === 'Rose');
  r = await o.call('POST', '/api/admin/design/versions/' + rose.id + '/restore', {}); assert.strictEqual(r.body.live.theme.preset, 'rose_blush');
  // export -> reset -> import as draft -> publish
  const ex = await o.call('GET', '/api/admin/design/export'); assert.strictEqual(ex.status, 200); assert.strictEqual(ex.body.format, 'avermontis-theme');
  r = await o.call('POST', '/api/admin/design/reset', {}); assert.strictEqual(r.body.live.theme.preset, 'obsidian'); assert.strictEqual(r.body.live.style.grid_mobile, 2);
  page = await client().call('GET', '/'); assert.ok(!/<style id="avm-theme">/.test(page.body), 'default look adds no CSS');
  r = await o.call('POST', '/api/admin/design/import', { data: { ...ex.body, theme: { ...ex.body.theme, text: '#ZZZZZZ' } } }); assert.strictEqual(r.status, 400);
  r = await o.call('POST', '/api/admin/design/import', { data: ex.body }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.draft.theme.preset, 'rose_blush'); assert.strictEqual(r.body.live.theme.preset, 'obsidian');
  r = await o.call('DELETE', '/api/admin/design/draft'); assert.strictEqual(r.body.draft, null);
  r = await o.call('POST', '/api/admin/design/themes', { name: 'Festive', theme: { primary: '#5A1010', accent: '#E0A030', background: '#FFF8EE', text: '#2A1010' } }); assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.themes[0].name, 'Festive');
  r = await o.call('DELETE', '/api/admin/design/themes/' + r.body.themes[0].id); assert.strictEqual(r.body.themes.length, 0);
  // the v4 Save buttons still work and are versioned too
  r = await o.call('PUT', '/api/admin/ui/theme', { preset: 'sage', primary: '#26352C', accent: '#A8B58F', background: '#F3F1EA', text: '#26352C' }); assert.strictEqual(r.status, 200);
  r = await o.call('GET', '/api/admin/design'); assert.strictEqual(r.body.versions[0].label, 'Saved theme'); assert.ok(r.body.versions.length <= 20);
  r = await o.call('GET', '/api/admin/audit'); assert.strictEqual(r.status, 200);
  const areas = r.body.entries.map((e) => e.area); assert.ok(areas.includes('Design') && areas.includes('Customize') && areas.includes('Security'));
  const pub = r.body.entries.find((e) => /Rose/.test(e.summary)); assert.ok(pub && Array.isArray(pub.detail) && pub.detail.some((d) => d.key === 'theme.primary'));
  assert.ok(!JSON.stringify(r.body).includes(OWNER_PW));
  r = await client().call('GET', '/api/admin/audit'); assert.strictEqual(r.status, 403);
});

test('app (v6 client): no owner entry at all in the customer app or the website login; server look applied; full admin kept', () => {
  const app = fs.readFileSync(path.join(SITE, 'assets/m/app.js'), 'utf8');
  assert.match(app, /APP_VERSION = '6\.0\.0'/); assert.match(app, /app_css/);
  assert.ok(!/admin\/handoff|Store owner\?|ownerSignedIn|admin-pin|data-act="owner"|Email or username|\/admin['"]/.test(app), 'no owner sign-in, menu or /admin link in the customer app');
  const login = fs.readFileSync(path.join(SITE, '_pages/login.html'), 'utf8'); assert.ok(!/username|admin/i.test(login.replace(/autocomplete="username"/, '')), 'website login says Email only');
  const web = fs.readFileSync(path.join(SITE, 'assets/app.js'), 'utf8'); assert.ok(!/ownerPin|admin-pin|r\.admin/.test(web), 'website login never sends anyone to /admin');
  const adm = fs.readFileSync(path.join(SITE, 'assets/admin.js'), 'utf8'); assert.match(adm, /designTab/); assert.match(adm, /securityTab/); assert.match(adm, /auditTab/); assert.ok(!/localhost/.test(adm), 'no way back into the customer app');
});
