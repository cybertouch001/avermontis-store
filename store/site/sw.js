/* Avermontis app service worker.
   - App shell + catalogue images are cached so the app opens instantly and can be browsed offline.
   - Prices, stock, cart checks, orders, accounts and admin always come from the network (never served stale).
   - Private pages (account, checkout, admin, invoices...) are never stored on the device. */
var VERSION = 'avm-v7.0';
var SHELL = VERSION + '-shell', PAGES = VERSION + '-pages', IMG = VERSION + '-img', DATA = VERSION + '-data';
var PRECACHE = ['/app', '/assets/m/app.css?v=5.0.0', '/assets/m/app.js?v=5.0.0', '/assets/live.css?v=5.0.0', '/assets/live.js?v=5.0.0', '/img/campaign-tall.webp', '/img/ritual.webp', '/img/story.webp', '/', '/shop', '/cart', '/concerns', '/offline', '/assets/styles.css', '/assets/app.js?v=5.0.0', '/assets/pwa.js', '/products.js',
  '/assets/fonts/cg-500.woff2', '/assets/fonts/cg-600.woff2', '/assets/fonts/cg-500-italic.woff2',
  '/icons/icon-192.png', '/icons/apple-touch-icon.png', '/img/favicon.png', '/manifest.webmanifest'];
var PRIVATE = /^\/(admin|account|login|signup|reset|forgot|checkout|order-success|track|invoice|media\/admin)(\/|$)/;
var NETWORK_ONLY_API = /^\/api\//;          // every API call goes to the server
var CACHEABLE_API = /^\/api\/catalog(\/|$|\?)/; // ...but the last catalogue answer is kept for offline browsing only

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return Promise.all(PRECACHE.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(VERSION) !== 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.registration.navigationPreload ? self.registration.navigationPreload.enable() : null; })
    .then(function () { return self.clients.claim(); }));
});

function put(cacheName, req, res) {
  if (!res || res.status !== 200 || res.type === 'opaque') return;
  var cc = res.headers.get('Cache-Control') || '';
  if (/no-store/.test(cc) && cacheName !== DATA) return;
  var copy = res.clone();
  caches.open(cacheName).then(function (c) { c.put(req, copy); });
}

function networkFirst(req, cacheName, fallbackUrl, preload) {
  var net = Promise.resolve(preload).then(function (p) { return p || fetch(req); });
  return net.then(function (res) { put(cacheName, req, res); return res; }).catch(function () {
    var opts = { ignoreSearch: req.mode === 'navigate' };
    // this strategy's own (freshest) copy first, then anything else saved, e.g. the install-time shell
    return caches.open(cacheName).then(function (c) { return c.match(req, opts); }).then(function (hit) {
      return hit || caches.match(req, opts);
    }).then(function (hit) {
      if (hit) return hit;
      if (fallbackUrl) return caches.match(fallbackUrl);
      return Response.error();
    });
  });
}

function cacheFirst(req, cacheName) {
  return caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) { put(cacheName, req, res); return res; });
    if (hit) { net.catch(function () {}); return hit; }
    return net;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // orders, sign-in, cart checks: straight to the server
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var p = url.pathname;

  if (NETWORK_ONLY_API.test(p)) {
    if (CACHEABLE_API.test(p)) {
      // always the live catalogue when online; the last copy only when there is no connection
      e.respondWith(fetch(req).then(function (res) { put(DATA, req, res); return res; }).catch(function () {
        return caches.match(req).then(function (hit) { return hit || Response.error(); });
      }));
    }
    return;
  }
  if (PRIVATE.test(p)) {
    if (req.mode === 'navigate') {
      e.respondWith(Promise.resolve(e.preloadResponse).then(function (pr) { return pr || fetch(req); })
        .catch(function () { return caches.match('/offline'); }));
    }
    return;
  }
  if (p === '/sw.js') return;

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1) {
    e.respondWith(networkFirst(req, PAGES, '/offline', e.preloadResponse));
    return;
  }
  if (/^\/(img|media|icons)\//.test(p) || /\.(webp|png|jpe?g|avif|svg|woff2)$/.test(p)) {
    e.respondWith(cacheFirst(req, IMG));
    return;
  }
  if (/^\/assets\//.test(p) || p === '/products.js' || p === '/manifest.webmanifest') {
    // code and styles: fresh when online, cached copy when not
    e.respondWith(networkFirst(req, SHELL));
    return;
  }
});

// a ritual reminder shown by the app opens the routine screen when tapped
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || '/app#routine';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if (/\/app/.test(list[i].url) && 'focus' in list[i]) { list[i].navigate(target).catch(function () {}); return list[i].focus(); } }
    return self.clients.openWindow ? self.clients.openWindow(target) : null;
  }));
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
