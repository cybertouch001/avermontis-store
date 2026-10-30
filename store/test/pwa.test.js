// v4 app layer (PWA): manifest, icons, service worker behaviour, install UI, tab bar, worker headers.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const SITE = path.join(__dirname, '..', 'site');
const ORIGIN = 'https://avermontis.sites.tab.bot';
const read = (f) => fs.readFileSync(path.join(SITE, f), 'utf8');
const pngSize = (f) => { const b = fs.readFileSync(path.join(SITE, f)); assert.strictEqual(b.toString('ascii', 1, 4), 'PNG', f + ' is a PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const builtPages = (() => { const out = []; const walk = (d) => { for (const n of fs.readdirSync(path.join(SITE, '_pages', d))) { const r = path.join(d, n); if (fs.statSync(path.join(SITE, '_pages', r)).isDirectory()) walk(r); else if (n.endsWith('.html') && !r.startsWith('admin') && r !== 'app.html' && r !== path.join('download', 'admin.html')) out.push(r); /* app.html is the app's own UI, tested in app.test.js */ } }; walk(''); return out; })();

test('manifest: installable fields, brand, colours, icons that exist at their stated sizes', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.strictEqual(m.name, 'AVERMONTIS');
  assert.strictEqual(m.short_name, 'Avermontis');
  assert.strictEqual(m.display, 'standalone');
  assert.strictEqual(m.orientation, 'portrait');
  assert.strictEqual(m.scope, '/');
  assert.ok(m.start_url.startsWith('/'), 'start_url inside scope');
  assert.ok(m.id, 'stable app id');
  assert.match(m.theme_color, /^#0B0C0B$/i, 'theme colour is the site obsidian');
  assert.match(m.background_color, /^#[0-9A-F]{6}$/i);
  assert.ok(read('assets/styles.css').includes('--obsidian:' + m.background_color), 'background colour comes from the site palette');
  const css = read('_pages/index.html');
  assert.ok(css.includes('<meta name="theme-color" content="' + m.theme_color + '">'), 'page theme-color matches the manifest');
  const any = m.icons.filter((i) => (i.purpose || 'any').includes('any'));
  const mask = m.icons.filter((i) => (i.purpose || '').includes('maskable'));
  for (const s of ['192x192', '512x512']) {
    assert.ok(any.some((i) => i.sizes === s), 'any icon ' + s);
    assert.ok(mask.some((i) => i.sizes === s), 'maskable icon ' + s);
  }
  for (const i of m.icons) { const [w, h] = pngSize(i.src.slice(1)); assert.strictEqual(w + 'x' + h, i.sizes, i.src); assert.strictEqual(i.type, 'image/png'); }
  assert.deepStrictEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]);
  for (const s of m.shortcuts || []) { const p = new URL(s.url, ORIGIN).pathname.slice(1); assert.ok(fs.existsSync(path.join(SITE, '_pages', p + '.html')), 'shortcut target ' + s.url); }
  assert.ok(!JSON.stringify(m).match(/@gmail\.com|\b[6-9]\d{9}\b/), 'no personal details in the manifest');
});

test('every storefront page links the manifest, the iPhone icon, the app scripts and carries the 5-tab bar', () => {
  assert.ok(builtPages.length >= 37, 'all built pages checked: ' + builtPages.length);
  for (const p of builtPages) {
    const h = read(path.join('_pages', p));
    assert.ok(h.includes('<link rel="manifest" href="/manifest.webmanifest">'), p + ' manifest');
    assert.ok(h.includes('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">'), p + ' apple-touch-icon');
    assert.ok(h.includes('<meta name="apple-mobile-web-app-capable" content="yes">'), p + ' iOS standalone');
    assert.ok(h.indexOf('/assets/pwa-boot.js') < h.indexOf('</head>'), p + ' boot script in head');
    assert.ok(h.includes('<script src="/assets/pwa.js"></script>'), p + ' pwa.js');
    assert.ok(/viewport-fit=cover/.test(h), p + ' safe-area viewport');
    const bar = h.slice(h.indexOf('<nav class="tabbar"'), h.indexOf('</nav>', h.indexOf('<nav class="tabbar"')));
    const tabs = [...bar.matchAll(/data-tab="([a-z]+)"/g)].map((x) => x[1]);
    assert.deepStrictEqual(tabs, ['home', 'shop', 'concerns', 'bag', 'account'], p + ' tabs');
    assert.ok(bar.includes('class="cart-count'), p + ' bag count badge (updated by app.js)');
    assert.ok(h.includes('id="install-banner"') && h.includes('data-install'), p + ' install banner');
  }
  for (const f of ['assets/pwa.js', 'assets/pwa-boot.js', 'sw.js', 'offline.html'.replace(/^/, '_pages/')]) assert.ok(fs.existsSync(path.join(SITE, f)), f);
});

test('install UI: Android prompt, iPhone Share hint, standalone detection, safe areas', () => {
  const js = read('assets/pwa.js'), boot = read('assets/pwa-boot.js'), css = read('assets/styles.css');
  assert.match(js, /beforeinstallprompt/); assert.match(js, /\.prompt\(\)/); assert.match(js, /appinstalled/);
  assert.match(js, /Add to Home Screen/); assert.match(js, /serviceWorker\.register\('\/sw\.js'/);
  assert.match(boot, /display-mode: standalone/); assert.match(boot, /navigator\.standalone/);
  assert.match(css, /safe-area-inset-bottom/); assert.match(css, /html\.is-app \.tabbar/);
  assert.match(css, /@view-transition\{navigation:auto\}/);
});

// ---------- service worker, executed in a sandbox with fake caches and network ----------
function loadSW(net) {
  const store = new Map(); // cacheName -> Map(url -> Response)
  const keyOf = (r, ignoreSearch) => { const u = new URL(typeof r === 'string' ? new URL(r, ORIGIN) : r.url); return ignoreSearch ? u.origin + u.pathname : u.href; };
  const caches = {
    open: async (n) => { if (!store.has(n)) store.set(n, new Map()); const m = store.get(n); return {
      put: async (r, res) => { m.set(keyOf(r), res); }, add: async (r) => { const res = await net(r); m.set(keyOf(r), res); },
      match: async (r, o = {}) => { for (const [k, v] of m) { if (k === keyOf(r) || (o.ignoreSearch && keyOf(k, true) === keyOf(r, true))) return v.clone(); } },
    }; },
    match: async (r, o = {}) => { for (const m of store.values()) for (const [k, v] of m) { if (k === keyOf(r) || (o.ignoreSearch && keyOf(k, true) === keyOf(r, true))) return v.clone(); } },
    keys: async () => [...store.keys()], delete: async (n) => store.delete(n),
  };
  const listeners = {};
  const self = { addEventListener: (t, f) => { listeners[t] = f; }, location: new URL(ORIGIN + '/sw.js'), skipWaiting: () => {}, clients: { claim: async () => {} }, registration: {} };
  class SWRequest extends Request { constructor(u, o) { super(new URL(u, ORIGIN).href, o); } }
  const ctx = { self, caches, fetch: (r) => net(r), Request: SWRequest, Response, URL, Promise, console };
  vm.runInNewContext(read('sw.js'), ctx);
  return { store, listeners, caches, async go(url, init = {}) {
    const { mode, ...rest } = init;
    const real = new Request(ORIGIN + url, rest);
    const req = { url: real.url, method: real.method, headers: real.headers, mode: mode || 'cors' };
    let responded = null;
    const ev = { request: req,
      respondWith: (p) => { responded = p; }, preloadResponse: Promise.resolve(undefined), waitUntil: () => {} };
    listeners.fetch(ev);
    return responded ? await responded : 'not-intercepted';
  } };
}
const ok = (body, h = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html', ...h } });

test('service worker: orders, auth and admin always go to the server; never served from cache', async () => {
  let online = true; const net = async (r) => { if (!online) throw new TypeError('offline'); return ok('net:' + new URL(r.url || r, ORIGIN).pathname, { 'cache-control': 'no-store' }); };
  const sw = loadSW(net);
  for (const [m, u] of [['POST', '/api/orders'], ['POST', '/api/auth/login'], ['GET', '/api/orders/AV-1'], ['GET', '/api/auth/me'], ['GET', '/api/admin/orders'], ['POST', '/api/cart/quote']]) {
    assert.strictEqual(await sw.go(u, { method: m, body: m === 'POST' ? '{}' : undefined }), 'not-intercepted', m + ' ' + u);
  }
  // private pages: fetched live, nothing stored
  const r = await sw.go('/account', { mode: 'navigate' }); assert.strictEqual(await r.text(), 'net:/account');
  await sw.go('/checkout', { mode: 'navigate' }); await sw.go('/admin', { mode: 'navigate' });
  for (const m of sw.store.values()) for (const k of m.keys()) assert.ok(!/\/(account|checkout|admin|api\/(orders|auth|admin))/.test(k), 'stored ' + k);
});

test('service worker: catalogue is network-first (live prices online), last copy only offline', async () => {
  let online = true, price = 549;
  const net = async (r) => { if (!online) throw new TypeError('offline'); const p = new URL(r.url || r, ORIGIN).pathname; if (p === '/api/catalog') return new Response(JSON.stringify({ price }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } }); return ok('page:' + p); };
  const sw = loadSW(net);
  assert.strictEqual((await (await sw.go('/api/catalog')).json()).price, 549);
  await new Promise((r) => setTimeout(r, 5));
  price = 499; // the owner changes a price
  assert.strictEqual((await (await sw.go('/api/catalog')).json()).price, 499, 'online always shows the live price');
  await new Promise((r) => setTimeout(r, 5));
  online = false;
  assert.strictEqual((await (await sw.go('/api/catalog')).json()).price, 499, 'offline shows the last price seen');
});

test('service worker: app shell precached; pages network-first with offline fallback; images cache-first', async () => {
  let online = true, hits = 0;
  const net = async (r) => { if (!online) throw new TypeError('offline'); hits++; const p = new URL(r.url || r, ORIGIN).pathname; return ok('v' + hits + ':' + p, p.startsWith('/img') ? { 'content-type': 'image/webp' } : {}); };
  const sw = loadSW(net);
  await new Promise((done) => sw.listeners.install({ waitUntil: (p) => p.then(done) }));
  const shell = [...sw.store.values()].flatMap((m) => [...m.keys()]).map((k) => new URL(k).pathname);
  for (const p of ['/', '/shop', '/cart', '/offline', '/assets/styles.css', '/assets/app.js', '/products.js']) assert.ok(shell.includes(p), 'precached ' + p);
  for (const p of shell) { const f = p === '/' ? '_pages/index.html' : fs.existsSync(path.join(SITE, p.slice(1))) ? p.slice(1) : '_pages' + p + '.html'; assert.ok(fs.existsSync(path.join(SITE, f)), 'precache entry exists: ' + p); }
  const first = await (await sw.go('/shop', { mode: 'navigate' })).text();
  const second = await (await sw.go('/shop', { mode: 'navigate' })).text();
  assert.notStrictEqual(first, second, 'online pages come from the network each time');
  const img1 = await (await sw.go('/img/vitamin-c-serum.webp')).text();
  await new Promise((r) => setTimeout(r, 5));
  const img2 = await (await sw.go('/img/vitamin-c-serum.webp')).text();
  assert.strictEqual(img1, img2, 'images come from cache once seen');
  online = false;
  assert.strictEqual(await (await sw.go('/shop?source=pwa', { mode: 'navigate' })).text(), second, 'offline: last copy of a visited page');
  assert.match(await (await sw.go('/never-visited', { mode: 'navigate' })).text(), /:\/offline$/, 'offline: friendly offline page');
  assert.match(await (await sw.go('/account', { mode: 'navigate' })).text(), /:\/offline$/, 'offline private page: offline page, not a stale account');
});

test('worker serves the app files with the right headers', async () => {
  const tmp = path.join(os.tmpdir(), 'avermontis-pwa-' + process.pid + '.mjs');
  fs.copyFileSync(path.join(SITE, '_worker.js'), tmp);
  const mod = await import(tmp);
  const ASSETS = { fetch: async (req) => { const u = new URL(req.url); let p = u.pathname; if (p.endsWith('/')) p += 'index.html'; let f = path.join(SITE, p); if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html'; if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return new Response('nf', { status: 404, headers: { 'content-type': 'text/html' } }); return new Response(fs.readFileSync(f), { status: 200, headers: { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' } }); } };
  const get = (p) => mod.default.fetch(new Request(ORIGIN + p), { ASSETS });
  let r = await get('/sw.js');
  assert.strictEqual(r.status, 200); assert.match(r.headers.get('content-type'), /javascript/); assert.strictEqual(r.headers.get('cache-control'), 'no-cache'); assert.strictEqual(r.headers.get('service-worker-allowed'), '/');
  r = await get('/manifest.webmanifest');
  assert.match(r.headers.get('content-type'), /application\/manifest\+json/); assert.strictEqual(JSON.parse(await r.text()).name, 'AVERMONTIS');
  r = await get('/offline'); assert.strictEqual(r.status, 200); assert.match(await r.text(), /offline/i);
  r = await get('/'); assert.match(r.headers.get('content-security-policy'), /worker-src 'self'/); assert.match(r.headers.get('content-security-policy'), /manifest-src 'self'/);
  r = await get('/icons/icon-512.png'); assert.strictEqual(r.status, 200);
  r = await get('/.well-known/assetlinks.json'); assert.strictEqual(r.status, 200);
  const al = JSON.parse(await r.text());
  assert.strictEqual(al[0].target.package_name, 'bot.tab.sites.avermontis.twa'); assert.match(al[0].target.sha256_cert_fingerprints[0], /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});
