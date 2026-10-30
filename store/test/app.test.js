// v5: the AVERMONTIS app's own UI at /app (onboarding, ritual, diary, shop) on the same backend.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const SITE = path.join(__dirname, '..', 'site');
const ORIGIN = 'https://avermontis.sites.tab.bot';
const read = (f) => fs.readFileSync(path.join(SITE, f), 'utf8');
const APP = read('assets/m/app.js'), HTML = read('_pages/app.html'), CSS = read('assets/m/app.css');

function loadApp() {
  const store = {};
  const products = (() => { const ctx = { window: {} }; vm.runInNewContext(read('products.js'), ctx); return ctx.window.AVERMONTIS_PRODUCTS; })();
  const noop = () => {};
  const document = { readyState: 'loading', addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], documentElement: { classList: { add: noop } } };
  const window = { addEventListener: noop, AVERMONTIS_PRODUCTS: [] };
  const ctx = { window, document, navigator: { onLine: true }, location: { hash: '', search: '' }, history: {}, setTimeout, clearTimeout, URLSearchParams, Promise, JSON, Math, Date, Object, Array, String, Number,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    fetch: async (u) => ({ ok: true, status: 200, json: async () => (u === '/api/catalog' ? { ok: true, products: products.map((p) => ({ ...p, in_stock: true })), settings: { free_shipping_from: 499, shipping_fee: 49, max_qty_per_item: 10 } } : { ok: true }) }) };
  ctx.self = ctx; vm.runInNewContext(APP, ctx);
  return { app: window.AVERMONTIS_APP, products, store };
}

test('/app page: its own app shell (5 tabs, sheet, camera input), brand, manifest, no inline script, no website header', () => {
  assert.match(HTML, /<title>AVERMONTIS App/);
  assert.ok(HTML.includes('<link rel="manifest" href="/manifest.webmanifest">'));
  assert.ok(HTML.includes('viewport-fit=cover'));
  // v4: a version query busts the 1-day asset cache on update
  assert.ok(/<link rel="stylesheet" href="\/assets\/m\/app\.css(\?v=[\w.]+)?">/.test(HTML) && /<script src="\/assets\/m\/app\.js(\?v=[\w.]+)?" defer><\/script>/.test(HTML));
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(HTML), 'no inline scripts (CSP script-src self)');
  for (const t of ['home', 'routine', 'diary', 'shop', 'me']) assert.ok(HTML.includes('data-go="' + t + '"'), 'tab ' + t);
  for (const v of ['home', 'routine', 'diary', 'shop', 'me', 'bag', 'checkout', 'learn', 'done']) assert.ok(HTML.includes('id="v-' + v + '"'), 'view ' + v);
  assert.ok(HTML.includes('id="sheet"') && HTML.includes('capture="user"'));
  assert.ok(!HTML.includes('class="site-header"') && !HTML.includes('/assets/styles.css'), 'not the website layout');
  assert.ok(!/AVERMONTI[^S]|AVERMENTIS|Avermentis/.test(HTML + APP + CSS), 'brand spelled AVERMONTIS');
});

test('manifest opens the app at /app (same id so installed apps update), shortcuts into app screens', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.strictEqual(new URL(m.start_url, ORIGIN).pathname, '/app');
  assert.strictEqual(m.id, '/?source=pwa', 'app id unchanged, so this is an update not a new app');
  assert.ok(m.shortcuts.length >= 3 && m.shortcuts.every((s) => new URL(s.url, ORIGIN).pathname === '/app'));
});

test('website stays the website; only the installed app\'s old start URL is sent to /app', () => {
  const boot = read('assets/pwa-boot.js');
  const run = (pathname, search) => { let to = null; const d = { classList: { add() {} } }; vm.runInNewContext(boot, { document: { documentElement: d }, window: { sessionStorage: null, matchMedia: () => ({ matches: false }), navigator: {} }, navigator: { userAgent: 'x', platform: 'x' }, location: { pathname, search, hash: '', replace: (u) => { to = u; } }, matchMedia: () => ({ matches: false }) }); return to; };
  assert.strictEqual(run('/', '?source=pwa'), '/app?source=pwa');
  assert.strictEqual(run('/', ''), null, 'normal visitors keep the website');
  assert.strictEqual(run('/', '?view=site&source=pwa'), null);
  assert.strictEqual(run('/shop', '?source=pwa'), null);
  const idx = read('_pages/index.html');
  assert.ok(idx.includes('/assets/styles.css') && !idx.includes('/assets/m/app.js'), 'website home unchanged');
});

test('service worker: precaches the app shell, new cache version, reminder taps open the routine', () => {
  const sw = read('sw.js');
  assert.match(sw, /VERSION = 'avm-v7/);   // v5 release bumps the cache so phones drop the old shell
  for (const u of ['/app', '/assets/m/app.css?v=5.0.0', '/assets/m/app.js?v=5.0.0']) assert.ok(sw.includes("'" + u + "'"), 'precache ' + u);
  assert.ok(sw.includes("addEventListener('notificationclick'") && sw.includes('/app#routine'));
});

test('app talks only to API routes the store already has, with the website\'s cart key', () => {
  const worker = read('_worker.js');
  const used = [...new Set((APP.match(/'\/api\/[a-z\/]+/g) || []).map((s) => s.slice(1).replace(/\/$/, '')))];
  assert.ok(used.length >= 9, used.join(' '));
  for (const u of used) {
    const probe = u === '/api/account/wishlist' ? u : u;
    assert.ok(worker.includes('^\\/api' + probe.slice(4).replace(/\//g, '\\/')) || worker.includes("'^" + probe), 'route exists: ' + u);
  }
  assert.ok(APP.includes("'avermontis_cart_v1'"), 'same bag as the website');
  assert.ok(APP.includes("payment: 'cod'"), 'Cash on Delivery');
});

test('no invented claims, ratings, reviews or owner details; ingredient notes are the website\'s own words', () => {
  const all = APP + HTML;
  assert.ok(!/dermatologist[- ](tested|approved|recommended)|clinically|proven|\b\d+% (of users|saw|reported)|★|stars?\b|testimonial/i.test(all), 'no claims or ratings');
  assert.ok(!/@gmail\.com|\b[6-9]\d{9}\b|Varanasi/i.test(all), 'no owner details');
  const site = read('assets/app.js');
  const texts = [...APP.matchAll(/text: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(texts.length >= 10);
  for (const t of texts) assert.ok(site.includes(t), 'ingredient text comes from the website: ' + t.slice(0, 40));
});

test('skin diary: photos stay on the phone (IndexedDB), never uploaded', () => {
  assert.ok(APP.includes("indexedDB.open('avermontis_diary'"));
  assert.ok(!/FormData|\/api\/[a-z]*(upload|diary|photo)/i.test(APP), 'no upload path');
  assert.ok(/never uploaded/i.test(APP), 'says so to the user');
});

test('ritual engine: built from real products in the right order; sunscreen last in the morning, none at night', async () => {
  const { app, products } = loadApp();
  await app.loadCatalog();
  const ids = new Set(products.map((p) => p.id));
  const full = { concerns: ['dullness'], style: 'complete' };
  const am = app.routineFor(full, 'am'), pm = app.routineFor(full, 'pm');
  assert.strictEqual(am.map((s) => s.step).join(','), 'Cleanse,Treat,Moisturise,Protect');
  assert.strictEqual(am[am.length - 1].id, 'sunscreen-spf50');
  assert.strictEqual(am[1].id, 'vitamin-c-serum', 'vitamin C in the morning, as its directions say');
  assert.ok(!pm.some((s) => s.id === 'sunscreen-spf50'));
  for (const s of am.concat(pm)) assert.ok(ids.has(s.id), s.id);
  const quick = app.routineFor({ concerns: ['dehydration'], style: 'essential' }, 'am');
  assert.ok(quick.length < am.length && quick[quick.length - 1].id === 'sunscreen-spf50');
  assert.strictEqual(app.routineFor({ concerns: ['uneven-tone'], style: 'complete' }, 'am')[1].id, 'niacinamide-serum');
  assert.strictEqual(app.picksFor({ concerns: ['dark-spots'] })[0].id, 'vitamin-c-serum');
  const tip = app.tipFor(products.find((p) => p.id === 'vitamin-c-serum'), 'am');
  assert.ok(tip.length > 10 && !/patch test/i.test(tip));
});

test('streak counts consecutive days with a full ritual, from the phone\'s own log', async () => {
  const { app, store } = loadApp();
  await app.loadCatalog();
  const key = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  const log = {}; const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return key(d); };
  log[day(1)] = { full: { am: true, pm: false } }; log[day(2)] = { full: { am: false, pm: true } }; log[day(4)] = { full: { am: true, pm: true } };
  store.avm_app_log = JSON.stringify(log);
  assert.strictEqual(app.streak(), 2, 'yesterday + the day before; today not done yet does not break it');
  log[day(0)] = { full: { am: true, pm: false } }; store.avm_app_log = JSON.stringify(log);
  assert.strictEqual(app.streak(), 3);
});

test('worker serves /app with security headers and keeps app files fresh', async () => {
  const tmp = path.join(os.tmpdir(), 'avermontis-app-e2e-' + process.pid + '.mjs');
  fs.copyFileSync(path.join(SITE, '_worker.js'), tmp);
  const mod = await import(tmp);
  const ASSETS = { fetch: async (req) => { const u = new URL(req.url); let f = path.join(SITE, u.pathname); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f += '.html'; if (!fs.existsSync(f)) return new Response('nf', { status: 404, headers: { 'content-type': 'text/html' } }); return new Response(fs.readFileSync(f), { status: 200, headers: { 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.css') ? 'text/css' : 'application/javascript' } }); } };
  const env = { ASSETS, DB: { prepare() { throw new Error('no db needed'); } } };
  const r = await mod.default.fetch(new Request(ORIGIN + '/app?source=pwa'), env);
  assert.strictEqual(r.status, 200);
  const body = await r.text();
  assert.ok(body.includes('data-app="avermontis"'));
  assert.ok(r.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.strictEqual(r.headers.get('cache-control'), 'no-cache');
  const js = await mod.default.fetch(new Request(ORIGIN + '/assets/m/app.js'), env);
  assert.strictEqual(js.status, 200); assert.strictEqual(js.headers.get('cache-control'), 'no-cache');
  const home = await mod.default.fetch(new Request(ORIGIN + '/'), env);
  assert.ok((await home.text()).includes('/assets/styles.css'), 'website home still the website');
});

// v6: the same app.js also runs inside the native Android app (Capacitor), with the screens bundled in the APK
function loadNative(withToken) {
  const store = {}, calls = [];
  if (withToken) store.avm_app_token = JSON.stringify('tok_abcdefghijklmnopqrstuvwxyz0123456789');
  const noop = () => {};
  const document = { readyState: 'loading', addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], documentElement: { classList: { add: noop } } };
  const window = { addEventListener: noop, AVERMONTIS_PRODUCTS: [], AVM_BUNDLED: ['/img/vitamin-c-serum.webp'], Capacitor: { isNativePlatform: () => true, Plugins: {} } };
  const ctx = { window, document, navigator: { onLine: true }, location: { hash: '', search: '' }, history: {}, setTimeout, clearTimeout, URLSearchParams, Promise, JSON, Math, Date, Object, Array, String, Number,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    fetch: async (u, opt) => { calls.push({ u, opt }); return { ok: true, status: 200, json: async () => ({ ok: true, products: [{ id: 'x', name: 'X', price: 1, image: '/media/x.webp' }], settings: {} }) }; } };
  ctx.self = ctx; vm.runInNewContext(APP, ctx);
  return { app: window.AVERMONTIS_APP, calls, store };
}
test('native app: API calls go to the store over HTTPS with the bearer token, never cookies; catalogue kept for offline', async () => {
  const n = loadNative(true);
  await n.app.loadCatalog(true);
  const c = n.calls.find((x) => /\/api\/catalog$/.test(x.u));
  assert.strictEqual(c.u, 'https://avermontis.sites.tab.bot/api/catalog');
  assert.strictEqual(c.opt.credentials, 'omit');
  assert.strictEqual(c.opt.headers.Authorization, 'Bearer tok_abcdefghijklmnopqrstuvwxyz0123456789');
  assert.ok(JSON.parse(n.store.avm_app_catalog).products.length === 1, 'last catalogue saved on the phone for offline');
  const { calls } = loadApp_calls();
  assert.ok(calls.every((x) => x.u.startsWith('/api/') && x.opt.credentials === 'same-origin' && !x.opt.headers.Authorization), 'website /app unchanged: same-origin cookies');
});
function loadApp_calls() {
  const calls = []; const noop = () => {};
  const window = { addEventListener: noop, AVERMONTIS_PRODUCTS: [] };
  const ctx = { window, document: { readyState: 'loading', addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], documentElement: { classList: { add: noop } } }, navigator: { onLine: true }, location: { hash: '', search: '' }, history: {}, setTimeout, clearTimeout, URLSearchParams, Promise, JSON, Math, Date, Object, Array, String, Number,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    fetch: async (u, opt) => { calls.push({ u, opt }); return { ok: true, status: 200, json: async () => ({ ok: true, products: [] }) }; } };
  ctx.self = ctx; vm.runInNewContext(APP, ctx); window.AVERMONTIS_APP.loadCatalog(true);
  return { calls };
}
test('native app: back button, outside links, splash, status bar and real scheduled notifications are wired', () => {
  for (const s of ["addListener('backButton'", 'App.exitApp()', 'closeSheet()', 'AL.openUrl', "SS.hide(", "SB.setBackgroundColor({ color: '#0B0C0B' })",
    'LN.schedule(', 'allowWhileIdle: true', "LN.addListener('localNotificationActionPerformed'", 'LN.requestPermissions()', 'LN.createChannel(']) assert.ok(APP.includes(s), s);
  assert.ok(/if \(NATIVE\) nativeBoot\(\);\s*else if \('serviceWorker' in navigator\)/.test(APP), 'no service worker inside the native app');
});
