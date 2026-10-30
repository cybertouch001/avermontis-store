// v4 (Oct 2026): owner dashboard customise (live look), delivery areas, assistant chat, notifications, bargaining, AR, insights.
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

test.before(async () => {
  const tmp = path.join(os.tmpdir(), 'avermontis-v4-e2e-' + process.pid + '.mjs');
  fs.copyFileSync(path.join(SITE, '_worker.js'), tmp);
  mod = await import(tmp);
  env = { DB: makeD1(), ASSETS };
  ADMIN = await adminClient();
});


async function adminClient() {
  const a = client();
  let r = await a.call('POST', '/api/admin/setup', { password: 'OwnerPass123', confirm: 'OwnerPass123' });
  if (r.status !== 201) { r = await a.call('POST', '/api/admin/login', { password: 'OwnerPass123' }); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); }
  return a;
}
let ADMIN;

test('v4 admin endpoints: closed to visitors, customers and the app\'s bearer token', async () => {
  const g = client();
  for (const [m, p] of [['GET', '/api/admin/ui'], ['GET', '/api/admin/insights'], ['GET', '/api/admin/chats'], ['GET', '/api/admin/bargains'], ['GET', '/api/admin/notifications']]) {
    const r = await g.call(m, p); assert.ok(r.status === 401 || r.status === 403, p + ' ' + r.status);
  }
  const app = client();
  const r1 = await app.call('POST', '/api/auth/signup', { name: 'App User', email: 'appuser@example.com', password: 'abcd1234' }, { origin: 'https://localhost' });
  assert.strictEqual(r1.status, 201); assert.ok(r1.body.token, 'the app gets a bearer token');
  const r2 = await app.call('PUT', '/api/admin/ui/theme', { preset: 'rose' }, { origin: 'https://localhost', noCookies: true, headers: { authorization: 'Bearer ' + r1.body.token } });
  assert.ok(r2.status === 401 || r2.status === 403, 'bearer token must not open admin: ' + r2.status);
  const r3 = await app.call('GET', '/api/admin/ui', undefined, { origin: 'https://localhost', noCookies: true, headers: { authorization: 'Bearer ' + r1.body.token } });
  assert.ok(r3.status === 401 || r3.status === 403);
  const page = await g.call('GET', '/admin'); assert.strictEqual(page.headers.get('x-frame-options'), 'DENY');
});

test('customise: default look leaves pages untouched; a preset goes live on the website and in /api/config for the app', async () => {
  const v = client();
  let home = await v.call('GET', '/');
  assert.ok(!/<style id="avm-theme">[^<]*--obsidian/.test(home.body), 'default theme adds no colour overrides');
  let cfg = (await v.call('GET', '/api/config')).body.config;
  assert.strictEqual(cfg.ui.theme.preset, 'obsidian'); const ver0 = cfg.ui_version;
  let r = await ADMIN.call('PUT', '/api/admin/ui/theme', { preset: 'avr_green', primary: '#123F2E', accent: '#C6A16A', background: '#F7F6F1', text: '#1E2A24', app_mode: 'dark', heading_font: 'playfair' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  cfg = (await v.call('GET', '/api/config')).body.config;
  assert.strictEqual(cfg.ui.theme.primary, '#123F2E'); assert.notStrictEqual(cfg.ui_version, ver0, 'version changes so the app refreshes');
  home = await v.call('GET', '/');
  assert.match(home.body, /<style id="avm-theme">[^<]*#123F2E/i); assert.match(home.body, /Playfair/);
  r = await ADMIN.call('PUT', '/api/admin/ui/theme', { primary: 'green' });
  assert.strictEqual(r.status, 400); assert.ok(r.body.error.fields.primary);
  r = await ADMIN.call('POST', '/api/admin/ui-preview', { theme: { preset: 'rose', primary: '#2E2224', accent: '#C9908A', background: '#FBF3F0', text: '#2E2224' } });
  assert.strictEqual(r.status, 200); assert.match(r.body.css, /#2E2224/i);
  r = await ADMIN.call('DELETE', '/api/admin/ui/theme'); assert.strictEqual(r.status, 200);
  cfg = (await v.call('GET', '/api/config')).body.config; assert.strictEqual(cfg.ui.theme.preset, 'obsidian');
});

test('customise: home order and on/off, store name, hero text, banners, contact show up on the site', async () => {
  const v = client();
  let r = await ADMIN.call('PUT', '/api/admin/ui/layout', { home_web: [{ id: 'bogus', on: true }] });
  assert.strictEqual(r.status, 400, 'unknown sections refused');
  r = await ADMIN.call('PUT', '/api/admin/ui/layout', { home_web: [{ id: 'collection', on: true }, { id: 'hero', on: true }, { id: 'story', on: false }] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const L = r.body.ui.layout.home_web; assert.strictEqual(L[0].id, 'collection'); assert.strictEqual(L.find((x) => x.id === 'story').on, false);
  assert.ok(L.length >= 8, 'every known section kept exactly once');
  r = await ADMIN.call('PUT', '/api/admin/ui/hero', { title: 'Glow, the honest way.' }); assert.strictEqual(r.status, 200);
  r = await ADMIN.call('PUT', '/api/admin/ui/banners', { banners: [{ title: 'Diwali offer', text: '10% off serums', link: '/shop', on: true }, { title: 'Hidden', on: false }] }); assert.strictEqual(r.status, 200);
  r = await ADMIN.call('PUT', '/api/admin/ui/banners', { banners: [{ title: 'Bad link', link: 'javascript:alert(1)' }] }); assert.strictEqual(r.status, 400, 'unsafe banner link refused');
  const home = (await v.call('GET', '/')).body;
  assert.ok(home.includes('Glow, the honest way.')); assert.ok(home.includes('Diwali offer')); assert.ok(!home.includes('>Hidden<'));
  assert.match(home, /\[data-sec="story"\]\{order:\d+;display:none/); assert.match(home, /\[data-sec="collection"\]\{order:1\}/);
  const cfg = (await v.call('GET', '/api/config')).body.config;
  assert.deepStrictEqual(cfg.ui.banners.map((b) => b.title), ['Diwali offer']);
  assert.strictEqual(cfg.ui.location, null, 'no address is published until the owner switches it on');
  await ADMIN.call('DELETE', '/api/admin/ui/layout'); await ADMIN.call('DELETE', '/api/admin/ui/hero'); await ADMIN.call('DELETE', '/api/admin/ui/banners');
});

test('delivery areas: pincode check and checkout block unserved pincodes', async () => {
  const v = client();
  let r = await v.call('GET', '/api/delivery?pincode=560038'); assert.strictEqual(r.body.serviceable, true, 'default: all of India');
  r = await ADMIN.call('PUT', '/api/admin/ui/delivery', { mode: 'list', areas: '221*, 226001-226010, 110001', message: 'Abhi sirf Varanasi, Lucknow aur Delhi.' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  for (const [pin, ok] of [['221005', true], ['226005', true], ['226011', false], ['110001', true], ['560038', false]]) {
    r = await v.call('GET', '/api/delivery?pincode=' + pin); assert.strictEqual(r.body.serviceable, ok, pin);
  }
  r = await v.call('GET', '/api/delivery?pincode=12'); assert.strictEqual(r.status, 400);
  r = await v.call('POST', '/api/orders', { items: [{ id: 'vitamin-c-serum', qty: 1 }], customer: ADDR, payment: 'cod' });
  assert.strictEqual(r.status, 400); assert.match(r.body.error.message, /Varanasi/);
  r = await v.call('POST', '/api/orders', { items: [{ id: 'vitamin-c-serum', qty: 1 }], customer: { ...ADDR, pincode: '221005', city: 'Varanasi', state: 'Uttar Pradesh' }, payment: 'cod' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  r = await ADMIN.call('PUT', '/api/admin/ui/delivery', { mode: 'list', areas: 'abc' }); assert.strictEqual(r.status, 400);
  await ADMIN.call('DELETE', '/api/admin/ui/delivery');
});

test('assistant: catalogue prices only, Hinglish/Hindi, medical questions get no claims, orders need proof of ownership, logged for the owner', async () => {
  const c = client();
  let r = await c.call('POST', '/api/chat', { message: 'vitamin c serum ka price kya hai?' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.lang, 'hinglish'); assert.strictEqual(r.body.engine, 'faq');
  const prices = [...r.body.reply.text.matchAll(/\u20B9\s?([\d,]+)/g)].map((m) => +m[1].replace(/,/g, ''));
  assert.ok(prices.includes(549), r.body.reply.text);
  const sid = r.body.session_id;
  r = await c.call('POST', '/api/chat', { message: 'मेरे चेहरे पर एक्जिमा है, कौन सा सीरम इलाज करेगा?', session_id: sid });
  assert.strictEqual(r.body.lang, 'hi'); assert.strictEqual(r.body.reply.intent, 'medical');
  assert.ok(!/cure|treat|heal|ilaaj karega|इलाज करेगा/i.test(r.body.reply.text.replace(/इलाज नहीं|not .{0,20}treat|doesn.t treat|can.t treat/gi, '')), r.body.reply.text);
  r = await c.call('POST', '/api/chat', { message: 'Where is my order AVM-ZZZZ99?', session_id: sid });
  assert.strictEqual(r.body.reply.intent, 'order_status'); assert.ok(!/delivered|shipped/i.test(r.body.reply.text) || /phone|email/i.test(r.body.reply.text));
  r = await c.call('POST', '/api/chat', { message: 'I want to talk to a human', session_id: sid });
  assert.ok(r.body.reply.handoff && (r.body.reply.handoff.email || r.body.reply.handoff.whatsapp));
  const logs = await ADMIN.call('GET', '/api/admin/chats');
  assert.ok(logs.body.chats.some((s) => s.id === sid && s.messages.length >= 8 && s.handoff));
});

test('assistant with the owner\'s own AI key: answers used, but a reply with an invented price is thrown away', async () => {
  const realFetch = globalThis.fetch; let calls = 0, reply = '';
  globalThis.fetch = async (u, o) => { if (String(u).startsWith('http://llm.test')) { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200, headers: { 'content-type': 'application/json' } }); } return realFetch(u, o); };
  env.CHAT_LLM_BASE = 'http://llm.test';
  try {
    let r = await ADMIN.call('PUT', '/api/admin/ui/chat', { provider: 'openai', api_key: 'sk-test-1234567890abcdef' }); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const ui = await ADMIN.call('GET', '/api/admin/ui'); assert.ok(!JSON.stringify(ui.body).includes('sk-test-1234567890abcdef'), 'key never sent back');
    const pub = (await client().call('GET', '/api/config')).body; assert.ok(!JSON.stringify(pub).includes('sk-test'), 'key not public'); assert.strictEqual(pub.config.ui.chat.ai, true);
    const c = client();
    reply = JSON.stringify({ reply: 'Our Vitamin C Serum is a lovely morning pick at \u20B9549.', product_ids: ['vitamin-c-serum', 'made-up-id'] });
    r = await c.call('POST', '/api/chat', { message: 'which serum is good for dull skin?' });
    assert.strictEqual(r.body.engine, 'llm'); assert.match(r.body.reply.text, /549/); assert.deepStrictEqual(r.body.reply.products.map((p) => p.id), ['vitamin-c-serum'], 'unknown product ids dropped');
    reply = JSON.stringify({ reply: 'Today only, the Vitamin C Serum is just \u20B9199!', product_ids: [] });
    r = await c.call('POST', '/api/chat', { message: 'which serum is good for a dull look?', session_id: r.body.session_id });
    assert.strictEqual(r.body.engine, 'faq', 'invented price rejected'); assert.ok(!/199/.test(r.body.reply.text));
    const n = calls; r = await c.call('POST', '/api/chat', { message: 'track my order AVM-AAAA11' });
    assert.strictEqual(calls, n, 'order questions never go to the AI');
  } finally { globalThis.fetch = realFetch; delete env.CHAT_LLM_BASE; await ADMIN.call('PUT', '/api/admin/ui/chat', { provider: '', remove_api_key: true }); }
});

test('notifications: owner broadcasts for everyone, order updates only for the order\'s owner', async () => {
  let r = await ADMIN.call('POST', '/api/admin/notifications', { kind: 'offer', title: 'Weekend: free shipping', body: 'On every order', link: '/shop', days: 3 });
  assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.body));
  r = await ADMIN.call('POST', '/api/admin/notifications', { kind: 'offer', title: 'x', link: 'javascript:alert(1)' }); assert.strictEqual(r.status, 400);
  const a = client(), b = client();
  await a.call('POST', '/api/auth/signup', { name: 'Noti A', email: 'notia@example.com', password: 'abcd1234' });
  await b.call('POST', '/api/auth/signup', { name: 'Noti B', email: 'notib@example.com', password: 'abcd1234' });
  r = await a.call('POST', '/api/orders', { items: [{ id: 'niacinamide-serum', qty: 1 }], customer: ADDR, payment: 'cod' }); const oid = r.body.order.id;
  r = await ADMIN.call('PATCH', '/api/admin/orders/' + oid, { status: 'shipped', note: 'Courier: test' }); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const na = (await a.call('GET', '/api/notifications')).body.items, nb = (await b.call('GET', '/api/notifications')).body.items;
  assert.ok(na.some((n) => n.title === 'Weekend: free shipping') && nb.some((n) => n.title === 'Weekend: free shipping'));
  assert.ok(na.some((n) => n.order_id === oid)); assert.ok(!nb.some((n) => n.order_id === oid), 'B never sees A\'s order');
  r = await ADMIN.call('PUT', '/api/admin/orders/' + oid + '/note', { admin_note: 'gift wrap', refund_note: '' }); assert.strictEqual(r.status, 200);
  r = await ADMIN.call('GET', '/api/admin/orders/' + oid + '/events'); assert.ok(r.body.events.length >= 2); assert.strictEqual(r.body.admin_note, 'gift wrap');
  const mine = await a.call('GET', '/api/account/orders'); assert.ok(!JSON.stringify(mine.body).includes('gift wrap'), 'private note stays private');
});

test('bargaining: sign-in needed, never below the floor, the deal is a one-time coupon locked to that customer and product', async () => {
  const g = client();
  let r = await g.call('POST', '/api/bargain', { product_id: 'vitamin-c-serum' }); assert.strictEqual(r.status, 401);
  r = await ADMIN.call('PUT', '/api/admin/products/vitamin-c-serum/bargain', { on: true, floor_price: 499 }); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const a = client(), b = client();
  await a.call('POST', '/api/auth/signup', { name: 'Bargain A', email: 'bga@example.com', password: 'abcd1234' });
  await b.call('POST', '/api/auth/signup', { name: 'Bargain B', email: 'bgb@example.com', password: 'abcd1234' });
  r = await a.call('POST', '/api/bargain', { product_id: 'vitamin-c-serum', lang: 'en' }); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(!JSON.stringify(r.body).includes('499'), 'floor price is never shown');
  const id = r.body.bargain.id; let deal = null;
  for (const offer of [300, 420, 480]) {
    r = await a.call('POST', '/api/bargain', { bargain_id: id, offer });
    assert.ok(r.body.bargain.counter == null || r.body.bargain.counter >= 499, 'counter >= floor');
    if (r.body.bargain.coupon) { deal = r.body.bargain.coupon; break; }
  }
  assert.ok(!deal || deal.price >= 499, 'no deal under the floor');
  if (!deal) { r = await a.call('POST', '/api/bargain', { bargain_id: id, offer: r.body.bargain.counter }); deal = r.body.bargain.coupon; }
  assert.ok(deal && deal.code && deal.price >= 499 && deal.price < 549, JSON.stringify(r.body));
  const items = [{ id: 'vitamin-c-serum', qty: 1 }];
  r = await b.call('POST', '/api/quote', { items, coupon: deal.code }); assert.ok(r.status >= 400 || !r.body.quote.discount, 'another customer cannot use it');
  r = await a.call('POST', '/api/quote', { items: [{ id: 'niacinamide-serum', qty: 1 }], coupon: deal.code }); assert.ok(r.status >= 400 || !r.body.quote.discount, 'only for that product');
  r = await a.call('POST', '/api/quote', { items, coupon: deal.code }); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.quote.discount, 549 - deal.price);
  r = await a.call('POST', '/api/orders', { items, customer: ADDR, payment: 'cod', coupon: deal.code }); assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  r = await a.call('POST', '/api/quote', { items, coupon: deal.code }); assert.ok(r.status >= 400 || !r.body.quote.discount, 'one-time');
  const cl = await ADMIN.call('GET', '/api/admin/coupons'); assert.ok(!JSON.stringify(cl.body).includes(deal.code), 'deal coupons stay out of the coupon list');
  const bl = await ADMIN.call('GET', '/api/admin/bargains'); assert.ok(bl.body.bargains.some((x) => x.coupon === deal.code && x.coupon_used));
  r = await ADMIN.call('PUT', '/api/admin/ui/bargain', { on: false }); assert.strictEqual(r.status, 200);
  r = await b.call('POST', '/api/bargain', { product_id: 'vitamin-c-serum' }); assert.strictEqual(r.status, 403);
  await ADMIN.call('DELETE', '/api/admin/ui/bargain');
});

test('AR: built-in models for the five products, files exist and are real GLB, served cross-origin for the app', async () => {
  const cat = (await client().call('GET', '/api/catalog')).body.products;
  for (const p of cat) {
    assert.ok(p.ar && p.ar.model, p.id + ' has a 3D model');
    const f = path.join(SITE, p.ar.model); assert.ok(fs.existsSync(f), f);
    assert.strictEqual(fs.readFileSync(f).toString('ascii', 0, 4), 'glTF', 'binary glTF');
  }
  const r = await client().call('GET', cat[0].ar.model.replace('/assets/ar/', '/ar-files/'));   // static files skip the Worker live, so the app uses this path
  assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('access-control-allow-origin'), '*'); assert.match(r.headers.get('content-type'), /gltf-binary/);
  assert.strictEqual((await client().call('GET', '/ar-files/models/no-such-file.glb')).status, 404);
  const page = await client().call('GET', '/ar');
  assert.strictEqual(page.status, 200); assert.match(page.headers.get('permissions-policy'), /camera=\(self\)/);
  assert.match(page.body, /for fun/i, 'selfie is labelled as a fun filter');
  assert.ok(!/(brighter|clearer|younger) skin in|clinically|dermatologist[- ]approved/i.test(page.body), 'no skin claims');
});

test('owner insights and xlsx backup include the new data', async () => {
  let r = await ADMIN.call('GET', '/api/admin/insights?days=30'); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  for (const k of ['revenue', 'orders', 'aov', 'top_products', 'status_counts', 'chats', 'bargain']) assert.ok(k in r.body, k);
  assert.ok(r.body.orders >= 1);
});

test('v4 pages: brand spelled AVERMONTIS, no owner phone/address published by default', async () => {
  const v = client();
  for (const p of ['/', '/contact', '/product?id=vitamin-c-serum', '/ar']) {
    const r = await v.call('GET', p); assert.strictEqual(r.status, 200, p);
    assert.ok(!/AVERMONTI[^S]|AVERMENTIS|Avermentis/.test(r.body), p);
  }
  const cfg = (await v.call('GET', '/api/config')).body.config;
  assert.strictEqual(cfg.ui.contact.phone, ''); assert.strictEqual(cfg.ui.location, null);
});

test('AR/app pages get the camera + wasm policy; ordinary shop pages keep the strict CSP', async () => {
  const c = client();
  for (const p of ['/ar', '/app']) {
    const r = await c.call('GET', p);
    assert.match(r.headers.get('content-security-policy'), /wasm-unsafe-eval/, p); assert.match(r.headers.get('permissions-policy'), /camera=\(self\)/, p);
  }
  for (const p of ['/', '/shop', '/product?id=vitamin-c-serum', '/checkout']) {
    const r = await c.call('GET', p);
    assert.ok(!/wasm-unsafe-eval/.test(r.headers.get('content-security-policy') || ''), p);
    assert.strictEqual(r.headers.get('permissions-policy'), 'camera=(self), xr-spatial-tracking=(self), microphone=(), geolocation=(), payment=()', p);
  }
  const ar = await c.call('GET', '/ar');
  assert.match(ar.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.match(ar.headers.get('content-security-policy'), /media-src 'self' blob: mediastream:/);
  assert.strictEqual(ar.headers.get('permissions-policy'), 'camera=(self), xr-spatial-tracking=(self), microphone=(), geolocation=(), payment=()');
  assert.match((await c.call('GET', '/admin')).headers.get('permissions-policy'), /camera=\(\)/);   // the dashboard never needs the camera
});

test('app (v4 client): live look, banners, chat, AR, offers and icon choice wired; brand spelled right', () => {
  const APP = fs.readFileSync(path.join(SITE, 'assets/m/app.js'), 'utf8');
  for (const s of ["'/api/config'", "'/api/chat'", "'/api/notifications'", "'/api/bargain'", 'AvmAR', 'sceneViewer', 'setIcon', 'avm_app_cfg_v4']) assert.ok(APP.includes(s), s);
  assert.ok(/Automatic assistant/.test(APP) && /AI assistant/.test(APP), 'chat says which engine answers');
  assert.ok(/just for fun|fun filter/i.test(APP), 'selfie labelled as fun');
  const LIVE = fs.readFileSync(path.join(SITE, 'assets/live.js'), 'utf8');
  assert.ok(LIVE.includes("'/api/bargain'") && LIVE.includes('Make an offer'));
});

test('Make an offer is on the cart (website) and the bag (app) too', () => {
  const LIVE = fs.readFileSync(path.join(SITE, 'assets/live.js'), 'utf8'), APP = fs.readFileSync(path.join(SITE, 'assets/m/app.js'), 'utf8');
  assert.ok(LIVE.includes('avm-line-offer') && /\/cart/.test(LIVE)); assert.ok(APP.includes('v4-bl-offer') && APP.includes('canBargain(l.p)'));
});

test('bargaining: an expired deal coupon is refused at quote and at checkout, and a deal never goes below the floor even when offered more rounds', async () => {
  const c = client();
  await c.call('POST', '/api/auth/signup', { name: 'Bargain C', email: 'bgc@example.com', password: 'abcd1234' });
  await ADMIN.call('PUT', '/api/admin/products/niacinamide-serum/bargain', { on: true, floor_price: 459 });
  let r = await c.call('POST', '/api/bargain', { product_id: 'niacinamide-serum', lang: 'hinglish' }); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(!JSON.stringify(r.body).includes('459'), 'floor price is never shown');
  const id = r.body.bargain.id; let deal = null;
  for (const offer of [1, 100, 200, 300, 400]) {
    r = await c.call('POST', '/api/bargain', { bargain_id: id, offer });
    if (r.status !== 200) break;
    assert.ok(r.body.bargain.counter == null || r.body.bargain.counter >= 459, 'counter >= floor');
    if (r.body.bargain.coupon) { deal = r.body.bargain.coupon; break; }
  }
  if (!deal) { r = await c.call('POST', '/api/bargain', { bargain_id: id, offer: r.body.bargain.counter }); deal = r.body.bargain.coupon; }
  assert.ok(deal && deal.price >= 459, JSON.stringify(r.body));
  const exp = new Date(deal.expires_at).getTime() - Date.now(); assert.ok(exp > 25 * 60000 && exp <= 31 * 60000, 'about 30 minutes');
  env.DB._db.prepare('UPDATE coupons SET expires_at = ? WHERE code = ?').run('2000-01-01T00:00:00.000Z', deal.code);
  const items = [{ id: 'niacinamide-serum', qty: 1 }];
  r = await c.call('POST', '/api/quote', { items, coupon: deal.code }); assert.ok(r.status >= 400 || !r.body.quote.discount, 'expired deal gives no discount');
  r = await c.call('POST', '/api/orders', { items, customer: ADDR, payment: 'cod', coupon: deal.code });
  assert.ok(r.status >= 400 || !r.body.order || !r.body.order.discount, 'expired deal is not applied to an order: ' + JSON.stringify(r.body).slice(0, 200));
  await ADMIN.call('PUT', '/api/admin/products/niacinamide-serum/bargain', { on: true, floor_price: null });
});
