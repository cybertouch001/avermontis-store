/* AVERMONTIS app — the phone app's own UI (served at /app).
   Same backend as the website: /api/catalog, /api/auth/*, /api/account/*, /api/quote, /api/orders (Cash on Delivery), /api/track.
   Stored on THIS phone only: skin profile, routine check-offs + streak, reminder times, skin-diary photos and notes (IndexedDB).
   No invented claims, ratings or results: all product facts come from the store catalogue; ingredient notes are the website's own text. */
(function () {
'use strict';
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var CART = 'avermontis_cart_v1', ADDR = 'avermontis_address', LAST = 'avermontis_last_order', COUPON = 'avermontis_coupon';
var K = { profile: 'avm_app_profile', log: 'avm_app_log', rem: 'avm_app_reminders', wish: 'avm_app_wish', seen: 'avm_app_onboarded', remShown: 'avm_app_rem_shown' };
var SUPPORT = 'avermontis@mail.tab.bot';
var FALLBACK = window.AVERMONTIS_PRODUCTS || [];
var SET = { free_shipping_from: 499, shipping_fee: 49, max_qty_per_item: 10 };
var P = [], catalogP = null, meP = null, ordersP = null, wishSrv = null;
/* ---------- native Android app (Capacitor): screens are bundled in the APK, the store API is called over HTTPS with a token ---------- */
var CAP = window.Capacitor, NATIVE = !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform());
var PLUG = NATIVE ? (CAP.Plugins || {}) : {};
var BASE = NATIVE ? 'https://avermontis.sites.tab.bot' : '';
var TOKEN_KEY = 'avm_app_token', CAT_KEY = 'avm_app_catalog';
var PREVIEW = /[?&]avm_preview=1/.test(location.search) && window.parent !== window;   // shown inside the owner's design studio
function absUrl(u) { return /^\//.test(u) ? BASE + u : u; }

/* ---------- facts copied from the website (assets/app.js), not new claims ---------- */
var CONCERNS = [
  { slug: 'dullness', name: 'Dullness', line: 'Skin that looks tired or flat', ids: ['vitamin-c-serum', 'hydrating-face-wash', 'sunscreen-spf50'] },
  { slug: 'dark-spots', name: 'Dark spots', line: 'A routine built around brightness and daily sun protection', ids: ['vitamin-c-serum', 'sunscreen-spf50', 'niacinamide-serum'] },
  { slug: 'uneven-tone', name: 'Uneven tone', line: 'A smooth, even-looking routine', ids: ['niacinamide-serum', 'sunscreen-spf50', 'daily-moisturizer'] },
  { slug: 'dehydration', name: 'Dehydration', line: 'Skin that feels tight or thirsty', ids: ['hydrating-face-wash', 'daily-moisturizer', 'vitamin-c-serum'] }
];
var INGREDIENTS = [
  { key: 'vitamin c', name: 'Vitamin C', sub: 'as ascorbyl glucoside', text: 'A water-soluble form of vitamin C chosen for an everyday serum. It belongs in the morning, under sunscreen.' },
  { key: 'niacinamide', name: 'Niacinamide', sub: 'vitamin B3', text: 'Water-light and easy to layer, so it suits morning or evening routines and sits well under moisturiser.' },
  { key: 'hyaluronic', name: 'Hyaluronic acid', sub: 'humectant', text: 'Attracts and holds water, which is why it is used for a comfortable, hydrated feel.' },
  { key: 'ceramide', name: 'Ceramides', sub: 'skin lipids', text: 'Lipids that are naturally part of the skin\u2019s outer layer; moisturisers use them to help skin feel comfortable.' },
  { key: 'zinc oxide', name: 'Zinc oxide & titanium dioxide', sub: 'mineral UV filters', also: 'titanium dioxide', text: 'Mineral filters that sit on the skin and reflect and scatter UV light.' },
  { key: 'squalane', name: 'Squalane', sub: 'emollient', text: 'A light, non-greasy emollient that softens the skin\u2019s surface.' },
  { key: 'panthenol', name: 'Panthenol', sub: 'pro-vitamin B5', text: 'A humectant used for a soft, comfortable feel.' },
  { key: 'zinc pca', name: 'Zinc PCA', sub: 'zinc salt', text: 'Often paired with niacinamide in water-light serums.' },
  { key: 'glycerin', name: 'Glycerin', sub: 'humectant', text: 'A classic humectant that draws water into the skin\u2019s surface layers.' },
  { key: 'aloe', name: 'Aloe vera', sub: 'plant gel', text: 'Used for a fresh, light feel.' },
  { key: 'vitamin e', name: 'Vitamin E', sub: 'antioxidant vitamin', text: 'Often used alongside vitamin C and in sunscreens.' },
  { key: 'shea', name: 'Shea butter', sub: 'plant butter', text: 'Softens and cushions the skin.' },
  { key: 'cucumber', name: 'Cucumber extract', sub: 'plant extract', text: 'Used for a fresh feel in cleansers.' },
  { key: 'coconut', name: 'Coconut-derived cleansers', sub: 'mild surfactants', text: 'Gentle cleansing agents that lift away oil and the day.' }
];
var CATS = [{ k: 'all', n: 'All' }, { k: 'foryou', n: 'For you' }, { k: 'serum', n: 'Serums' }, { k: 'cleanser', n: 'Cleansers' }, { k: 'moistur', n: 'Moisturisers' }, { k: 'sunscreen', n: 'Sunscreens' }];
var STATES = ['Andaman and Nicobar Islands','Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jammu and Kashmir','Jharkhand','Karnataka','Kerala','Ladakh','Lakshadweep','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal'];
var STATUS = ['new', 'confirmed', 'shipped', 'delivered'], STATUS_LABEL = { 'new': 'Placed', confirmed: 'Confirmed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };

/* ---------- icons ---------- */
function ic(d, w) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 1.7) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; }
var I = {
  bag: ic('<path d="M6 7h12l1 13H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>', 2.2),
  heart: ic('<path d="M12 20s-7-4.4-9-8.6C1.6 8.3 3.6 5 7 5c2 0 3.3 1.1 5 3 1.7-1.9 3-3 5-3 3.4 0 5.4 3.3 4 6.4-2 4.2-9 8.6-9 8.6z"/>'),
  check: ic('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.6),
  sun: ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: ic('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  flame: ic('<path d="M12 22c4 0 7-2.8 7-7 0-3.5-2.3-6-4-8 0 2.5-1.5 4-3 4 0-3-1-6-4-9 .5 3.5-3 6.5-3 11 0 4.4 3 9 7 9z"/>'),
  cam: ic('<rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.5"/><path d="M8.5 6l1.5-2.5h4L15.5 6"/>'),
  lock: ic('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  search: ic('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  chev: ic('<path d="M9 6l6 6-6 6"/>'),
  down: ic('<path d="M6 9l6 6 6-6"/>'),
  backI: ic('<path d="M15 6l-6 6 6 6"/>', 2),
  bell: ic('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>'),
  leaf: ic('<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l7-7"/>'),
  box: ic('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>'),
  user: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  pin: ic('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  drop: ic('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
  repeat: ic('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'),
  help: ic('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/>'),
  doc: ic('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'),
  sparkle: ic('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
  trash: ic('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  globe: ic('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'),
  out: ic('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>'),
  truck: ic('<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
  compare: ic('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 4v16"/>')
};

/* ---------- small helpers ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function inr(n) { return '\u20B9' + Number(n || 0).toLocaleString('en-IN'); }
function img(p) {
  var s = typeof p === 'string' ? p : (p && p.image) || ''; s = /^(https?:|\/)/.test(s) ? s : '/' + s;
  // in the app, images shipped inside the APK load from the phone; anything newer (admin uploads) loads from the store
  if (NATIVE && s.charAt(0) === '/' && (window.AVM_BUNDLED || []).indexOf(s) < 0) s = BASE + s;
  return s;
}
function off(p) { return p.mrp && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0; }
function byId(id) { for (var i = 0; i < P.length; i++) if (P[i].id === id) return P[i]; return null; }
function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Storage is blocked on this phone.'); } }
function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) {} }
function dkey(d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return iso; } }
function shortDate(k) { var p = k.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
var toastT;
function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2400); }
function catKey(p) { var c = String(p.category || '').toLowerCase(); for (var i = 2; i < CATS.length; i++) if (c.indexOf(CATS[i].k) >= 0) return CATS[i].k; return 'other'; }
function hasIng(p, ing) { var l = (p.ingredients || []).join(' | ').toLowerCase(); return l.indexOf(ing.key) >= 0 || (ing.also && l.indexOf(ing.also) >= 0); }
function ingFor(p) { return INGREDIENTS.filter(function (i) { return hasIng(p, i); }); }
function firstName(s) { return String(s || '').trim().split(/\s+/)[0] || ''; }

/* ---------- API ---------- */
function api(method, path, body) {
  var opt = { method: method, headers: {}, credentials: NATIVE ? 'omit' : 'same-origin' };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  if (NATIVE) { var tk = get(TOKEN_KEY, null); if (tk) opt.headers.Authorization = 'Bearer ' + tk; }
  return fetch(BASE + path, opt).then(function (r) {
    return r.json().catch(function () { return { ok: false, error: { message: 'Unexpected answer from the store. Please try again.' } }; }).then(function (b) {
      if (!r.ok || !b || b.ok === false) { var e = new Error((b && b.error && b.error.message) || 'Something went wrong. Please try again.'); e.status = r.status; e.fields = b && b.error && b.error.fields; throw e; }
      if (NATIVE && b.token) put(TOKEN_KEY, b.token);
      return b;
    });
  }, function () { var e = new Error(navigator.onLine ? 'Could not reach the store. Check your connection and try again.' : 'You are offline. Connect to the internet and try again.'); e.code = 'network'; throw e; });
}
function loadCatalog(force) {
  if (!catalogP || force) catalogP = api('GET', '/api/catalog').then(function (b) {
    P = (b.products || []).filter(function (p) { return p.active !== false; });
    if (NATIVE) put(CAT_KEY, { products: b.products || [], settings: b.settings || null });
    if (b.settings) Object.keys(SET).forEach(function (k) { if (b.settings[k] != null) SET[k] = b.settings[k]; });
    return P;
  }).catch(function () {
    var last = NATIVE ? get(CAT_KEY, null) : null;   // offline in the app: the last catalogue this phone saw
    if (!P.length && last && last.products && last.products.length) P = last.products.filter(function (p) { return p.active !== false; });
    if (!P.length) P = FALLBACK.filter(function (p) { return p.active !== false; }).map(function (p) { return Object.assign({ in_stock: true, images: [p.image] }, p); });
    return P;
  });
  return catalogP;
}
function me(force) { if (!meP || force) meP = api('GET', '/api/auth/me').then(function (b) { return b.user || null; }, function () { return null; }); return meP; }
function orders(force) {
  if (!ordersP || force) ordersP = me().then(function (u) { return u ? api('GET', '/api/account/orders').then(function (b) { return b.orders || []; }) : []; }).catch(function () { return []; });
  return ordersP;
}

/* ---------- cart (shared with the website: product id -> qty; prices always from the store) ---------- */
function readCart() { var c = get(CART, {}); return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; }
function writeCart(c) {
  var out = {}; Object.keys(c).forEach(function (id) { var q = parseInt(c[id], 10); if (q > 0 && (byId(id) || !P.length)) out[id] = Math.min(q, SET.max_qty_per_item || 10); });
  put(CART, out); paintBadges();
}
function cartCount() { var c = readCart(); return Object.keys(c).reduce(function (s, k) { return s + (parseInt(c[k], 10) || 0); }, 0); }
function cartLines() { var c = readCart(); return Object.keys(c).map(function (id) { var p = byId(id); return p ? { p: p, qty: c[id], total: p.price * c[id] } : null; }).filter(Boolean); }
function addToBag(id, n, quiet) {
  var p = byId(id); if (!p) return;
  if (p.in_stock === false) { toast('This one is out of stock right now.'); return; }
  var c = readCart(); c[id] = Math.min((parseInt(c[id], 10) || 0) + (n || 1), SET.max_qty_per_item || 10); writeCart(c);
  buzz(12); if (!quiet) toast('Added to bag \u00B7 ' + p.name);
  $$('.bagbtn .badge').forEach(function (b) { b.animate && b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 400 }); });
}
function paintBadges() { var n = cartCount(); $$('.bagbtn .badge').forEach(function (b) { b.textContent = n || ''; b.setAttribute('data-n', n); }); }
function bagBtn() { return '<button type="button" class="icon bagbtn press" data-act="bag" aria-label="Bag">' + I.bag + '<span class="badge" data-n="0"></span></button>'; }

/* ---------- wishlist: on the account when signed in, on this phone otherwise ---------- */
function wishIds() { return wishSrv || get(K.wish, []); }
function loadWish() { return me().then(function (u) { if (!u) { wishSrv = null; return wishIds(); } return api('GET', '/api/account/wishlist').then(function (b) { wishSrv = b.items || []; return wishSrv; }, function () { return wishIds(); }); }); }
function toggleWish(id, el) {
  var on = wishIds().indexOf(id) < 0; buzz(on ? 15 : 6);
  if (el) { el.classList.toggle('on', on); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  me().then(function (u) {
    if (u) {
      wishSrv = (wishSrv || []).filter(function (x) { return x !== id; }); if (on) wishSrv.unshift(id);
      (on ? api('POST', '/api/account/wishlist', { product_id: id }) : api('DELETE', '/api/account/wishlist/' + encodeURIComponent(id))).catch(function (e) { toast(e.message); });
    } else { var w = get(K.wish, []).filter(function (x) { return x !== id; }); if (on) w.unshift(id); put(K.wish, w); }
    toast(on ? 'Saved to your wishlist' : 'Removed from wishlist');
  });
}

/* ---------- skin profile -> routine (built only from store products and their own directions) ---------- */
function profile() { var p = get(K.profile, null); return p || (PREVIEW ? { name: '', skin: 'normal', concerns: ['dullness'], style: 'simple' } : null); }
function routineFor(pr, when) {
  pr = pr || {}; var concerns = pr.concerns || [], essential = pr.style === 'essential';
  var onlyTone = concerns.length === 1 && concerns[0] === 'uneven-tone';
  var steps;
  if (when === 'am') {
    steps = [{ step: 'Cleanse', id: 'hydrating-face-wash' }, { step: 'Treat', id: onlyTone ? 'niacinamide-serum' : 'vitamin-c-serum' }];
    if (!essential) steps.push({ step: 'Moisturise', id: 'daily-moisturizer' });
    steps.push({ step: 'Protect', id: 'sunscreen-spf50' });
  } else {
    steps = [{ step: 'Cleanse', id: 'hydrating-face-wash' }];
    if (!essential || onlyTone || concerns.indexOf('uneven-tone') >= 0 || concerns.indexOf('dark-spots') >= 0) steps.push({ step: 'Treat', id: 'niacinamide-serum' });
    steps.push({ step: 'Moisturise', id: 'daily-moisturizer' });
  }
  return steps.filter(function (s) { var p = byId(s.id); return p && p.active !== false; });
}
function tipFor(p, when) {
  var t = String(p.how_to_use || p.short || '');
  var parts = t.split(/\.\s+/).map(function (x) { x = x.trim(); return /[.!?]$/.test(x) ? x : x + '.'; }).filter(function (x) { return x.length > 1 && !/patch test/i.test(x); });
  var pick = parts.filter(function (x) { return when === 'am' ? !/^night/i.test(x) : !/^morning:/i.test(x); });
  var out = (pick[0] || parts[0] || '').replace(/^Morning:\s*/i, ''); return out.charAt(0).toUpperCase() + out.slice(1);
}
function picksFor(pr) {
  var score = {}; (pr && pr.concerns || []).forEach(function (slug) { var c = CONCERNS.filter(function (x) { return x.slug === slug; })[0]; if (c) c.ids.forEach(function (id, i) { score[id] = (score[id] || 0) + (3 - i); }); });
  var ids = Object.keys(score).sort(function (a, b) { return score[b] - score[a]; });
  if (!ids.length) ids = ['vitamin-c-serum', 'sunscreen-spf50', 'hydrating-face-wash', 'daily-moisturizer', 'niacinamide-serum'];
  return ids.map(byId).filter(Boolean);
}
/* check-offs + streak */
function log() { return get(K.log, {}); }
function dayDone(entry, pr) {
  if (!entry) return { am: false, pm: false };
  if (entry.full) return { am: !!entry.full.am, pm: !!entry.full.pm };
  var am = routineFor(pr, 'am'), pm = routineFor(pr, 'pm');
  function full(list, done) { return list.length > 0 && list.every(function (s) { return (done || []).indexOf(s.id) >= 0; }); }
  return { am: full(am, entry.am), pm: full(pm, entry.pm) };
}
function streak() {
  var L = log(), pr = profile(), n = 0, d = new Date();
  var t = dayDone(L[dkey(d)], pr);
  if (!t.am && !t.pm) d = addDays(d, -1);
  for (var i = 0; i < 400; i++) { var r = dayDone(L[dkey(d)], pr); if (r.am || r.pm) { n++; d = addDays(d, -1); } else break; }
  return n;
}
function bestStreak() {
  var L = log(), pr = profile(), keys = Object.keys(L).sort(), best = 0, run = 0, prev = null;
  keys.forEach(function (k) { var r = dayDone(L[k], pr); if (r.am || r.pm) { var dt = new Date(k + 'T12:00:00'); run = prev && Math.round((dt - prev) / 864e5) === 1 ? run + 1 : 1; prev = dt; best = Math.max(best, run); } });
  return best;
}
function daysLogged() { var L = log(), pr = profile(); return Object.keys(L).filter(function (k) { var r = dayDone(L[k], pr); return r.am || r.pm; }).length; }
function toggleStep(when, id) {
  var L = log(), k = dkey(), e = L[k] || { am: [], pm: [] }; e[when] = e[when] || [];
  var i = e[when].indexOf(id); if (i >= 0) e[when].splice(i, 1); else e[when].push(id);
  delete e.full; var f = dayDone(e, profile()); e.full = { am: f.am, pm: f.pm };
  L[k] = e; put(K.log, L); if (NATIVE) nativeReminders(); return i < 0;
}
function nowWhen() { var h = new Date().getHours(); return h >= 4 && h < 15 ? 'am' : 'pm'; }

/* ---------- reminders: in-app, plus a notification while the app is running (no push server) ---------- */
function rems() { return get(K.rem, { on: false, am: '08:00', pm: '21:30' }); }
var remTimers = [];
function scheduleReminders() {
  remTimers.forEach(clearTimeout); remTimers = [];
  if (NATIVE) nativeReminders();
  var r = rems(); if (!r.on) return;
  ['am', 'pm'].forEach(function (w) {
    var hm = String(r[w] || '').split(':'); if (hm.length < 2) return;
    var at = new Date(); at.setHours(+hm[0], +hm[1], 0, 0); var ms = at - new Date();
    if (ms > 0 && ms < 864e5) remTimers.push(setTimeout(function () { fireReminder(w); }, ms));
  });
}
function fireReminder(w) {
  var r = dayDone(log()[dkey()], profile()); if (r[w]) return;
  var title = w === 'am' ? 'Your morning ritual' : 'Your evening ritual', body = 'A few minutes for your skin. Tap to check off your steps.';
  try {
    if (window.Notification && Notification.permission === 'granted' && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(function (reg) { reg.showNotification(title, { body: body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'avm-' + w, data: { url: '/app#routine' } }); });
    }
  } catch (e) {}
  if (document.visibilityState === 'visible') toast(title + ' is waiting');
  paintHome();
}
function dueReminder() {
  var r = rems(); if (!r.on) return null;
  var now = new Date(), done = dayDone(log()[dkey()], profile());
  var due = null;
  ['am', 'pm'].forEach(function (w) { var hm = String(r[w]).split(':'); var at = new Date(); at.setHours(+hm[0], +hm[1], 0, 0); if (now >= at && !done[w] && (w === 'pm' || now.getHours() < 15)) due = w; });
  return due;
}

/* native reminders: real Android notifications scheduled with the phone's alarm service, so they arrive even when the
   app is closed. The next 30 days are queued; a ritual already checked off today drops today's nudge; re-queued on every open. */
var LN = PLUG.LocalNotifications;
function nativeReminders() {
  if (!LN) return;
  var r = rems();
  LN.getPending().then(function (res) {
    var old = ((res && res.notifications) || []).filter(function (n) { return n.id >= 7000 && n.id < 7200; }).map(function (n) { return { id: n.id }; });
    return old.length ? LN.cancel({ notifications: old }) : null;
  }).catch(function () {}).then(function () {
    if (!r.on) return;
    return LN.checkPermissions().then(function (p) {
      if (p.display !== 'granted') return;
      var list = [], now = new Date(), done = dayDone(log()[dkey()], profile());
      for (var d = 0; d < 30; d++) {
        ['am', 'pm'].forEach(function (w, wi) {
          var hm = String(r[w] || '').split(':'); if (hm.length < 2) return;
          var at = addDays(now, d); at.setHours(+hm[0], +hm[1], 0, 0);
          if (at <= now || (d === 0 && done[w])) return;
          list.push({ id: 7000 + d * 2 + wi, title: w === 'am' ? 'Your morning ritual' : 'Your evening ritual', body: 'A few minutes for your skin. Tap to check off your steps.',
            schedule: { at: at, allowWhileIdle: true }, smallIcon: 'ic_stat_avermontis', iconColor: '#C9A96E', channelId: 'ritual', extra: { go: 'routine' } });
        });
      }
      return list.length ? LN.schedule({ notifications: list }) : null;
    });
  }).catch(function () {});
}
function askNotify() {
  if (NATIVE && LN) return LN.requestPermissions().then(function () { scheduleReminders(); }).catch(function () {});
  if (window.Notification && Notification.permission === 'default') { try { return Notification.requestPermission(); } catch (e) {} }
  return Promise.resolve();
}
function notifyPerm() {
  if (NATIVE && LN) return LN.checkPermissions().then(function (p) { return p.display === 'granted' ? 'granted' : p.display; }, function () { return 'unsupported'; });
  return Promise.resolve(window.Notification ? Notification.permission : 'unsupported');
}

/* ---------- skin diary: IndexedDB on this phone only ---------- */
var dbP = null;
function db() {
  if (!dbP) dbP = new Promise(function (res, rej) {
    if (!window.indexedDB) { rej(new Error('This phone does not allow saving photos in the app.')); return; }
    var r = indexedDB.open('avermontis_diary', 1);
    r.onupgradeneeded = function () { var s = r.result.createObjectStore('entries', { keyPath: 'id' }); s.createIndex('date', 'date'); };
    r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
  });
  return dbP;
}
function dbAll() { return db().then(function (d) { return new Promise(function (res, rej) { var q = d.transaction('entries').objectStore('entries').getAll(); q.onsuccess = function () { res((q.result || []).sort(function (a, b) { return b.ts - a.ts; })); }; q.onerror = function () { rej(q.error); }; }); }); }
function dbPut(e) { return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('entries', 'readwrite'); t.objectStore('entries').put(e); t.oncomplete = function () { res(e); }; t.onerror = function () { rej(t.error); }; }); }); }
function dbDel(id) { return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('entries', 'readwrite'); t.objectStore('entries').delete(id); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); }
var urls = {};
function blobUrl(e) { if (!urls[e.id]) urls[e.id] = URL.createObjectURL(e.blob); return urls[e.id]; }
function shrink(file) {
  return new Promise(function (res, rej) {
    var u = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      var max = 1280, w = im.naturalWidth, h = im.naturalHeight, s = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      c.toBlob(function (b) { b ? res(b) : rej(new Error('Could not read that photo.')); }, 'image/jpeg', 0.86);
    };
    im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('Could not read that photo.')); };
    im.src = u;
  });
}

/* ---------- router: #home #routine #diary #shop #me #bag #checkout #learn #done ---------- */
var VIEWS = ['home', 'routine', 'diary', 'shop', 'me', 'bag', 'checkout', 'learn', 'done'];
var RENDER = {}, current = null;
function go(name, replace) { if (VIEWS.indexOf(name) < 0) name = 'home'; if (('#' + name) === location.hash) { show(name); return; } if (replace) { history.replaceState(null, '', '#' + name); show(name); } else location.hash = name; }
function show(name) {
  if (VIEWS.indexOf(name) < 0) name = 'home';
  var el = $('#v-' + name);
  if (current !== name) {
    $$('.view').forEach(function (v) { v.classList.toggle('on', v === el); });
    var tab = el.getAttribute('data-tab');
    $$('#tabbar button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-go') === tab); });
    document.getElementById('app').classList.toggle('hide-tabs', name === 'checkout' || name === 'bag');
    current = name;
    if (RENDER[name]) RENDER[name](el);
    el.scrollTop = 0;
  }
  paintBadges();
}
window.addEventListener('hashchange', function () { closeSheet(true); show(location.hash.slice(1).split('/')[0]); });

/* ---------- bottom sheet (swipe down or back button closes it) ---------- */
var sheetOpen = false;
function openSheet(html, foot) {
  $('#sheet-body').innerHTML = html; $('#sheet-body').scrollTop = 0;
  var f = $('#sheet-foot'); if (foot) { f.innerHTML = foot; f.classList.remove('hidden'); } else { f.innerHTML = ''; f.classList.add('hidden'); }
  $('#scrim').classList.add('on'); $('#sheet').classList.add('on');
  if (!sheetOpen) { sheetOpen = true; history.pushState({ sheet: 1 }, '', location.hash || '#home'); }
  buzz(6);
}
function closeSheet(fromNav) {
  if (!sheetOpen) return; sheetOpen = false;
  $('#scrim').classList.remove('on'); var s = $('#sheet'); s.classList.remove('on'); s.style.transform = '';
  if (!fromNav && history.state && history.state.sheet) history.back();
}
window.addEventListener('popstate', function () { if (sheetOpen) closeSheet(true); });
function wireSheetDrag() {
  var s = $('#sheet'), body = $('#sheet-body'), y0 = null, dy = 0;
  function start(e) { if (body.scrollTop > 0 && !e.target.closest('.grab')) return; y0 = e.touches[0].clientY; dy = 0; }
  function move(e) { if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy > 0) { s.classList.add('drag'); s.style.transform = 'translateY(' + dy + 'px)'; if (e.cancelable && !e.target.closest('.sc') ) e.preventDefault(); } }
  function end() { if (y0 == null) return; s.classList.remove('drag'); if (dy > 110) closeSheet(); else s.style.transform = ''; y0 = null; }
  s.addEventListener('touchstart', start, { passive: true }); s.addEventListener('touchmove', move, { passive: false }); s.addEventListener('touchend', end);
  $('#scrim').addEventListener('click', function () { closeSheet(); }); $('#sheet-x').addEventListener('click', function () { closeSheet(); });
}

/* ---------- pull to refresh ---------- */
function ptr(view, refresh) {
  view.__refresh = refresh;
  if (!view.__bar) { var b0 = document.createElement('div'); b0.className = 'ptr'; b0.innerHTML = '<div class="ptr-in"></div>'; view.__bar = b0; }
  var bar = view.__bar; if (bar.parentNode !== view) view.insertBefore(bar, view.firstChild);
  if (view.__ptr) return; view.__ptr = true;
  var y0 = null, dy = 0, busy = false;
  view.addEventListener('touchstart', function (e) { if (view.scrollTop <= 0 && !busy && !sheetOpen) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  view.addEventListener('touchmove', function (e) { if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy > 0) { bar.style.transition = 'none'; bar.style.height = Math.min(dy * 0.5, 80) + 'px'; bar.firstChild.style.transform = 'rotate(' + dy * 2 + 'deg)'; } }, { passive: true });
  view.addEventListener('touchend', function () {
    if (y0 == null) return; y0 = null; bar.style.transition = '';
    if (dy * 0.5 > 56) { busy = true; buzz(10); bar.style.height = '54px'; bar.classList.add('spin'); Promise.resolve(view.__refresh()).then(function () { setTimeout(function () { bar.classList.remove('spin'); bar.style.height = '0'; busy = false; }, 350); }); }
    else bar.style.height = '0';
  });
}
function rerender(name) { var el = $('#v-' + name); if (current === name && RENDER[name]) RENDER[name](el); }

/* ---------- shared pieces ---------- */
function skeletonCards(n, grid) { var s = ''; for (var i = 0; i < n; i++) s += '<div class="sk" style="' + (grid ? 'height:270px' : 'width:200px;height:290px;flex:none') + '"></div>'; return s; }
function card(p) {
  var w = wishIds().indexOf(p.id) >= 0, o = off(p);
  return '<div class="pcard press" data-prod="' + esc(p.id) + '" role="button" tabindex="0" aria-label="' + esc(p.name) + '">' +
    '<button type="button" class="heart' + (w ? ' on' : '') + '" data-wish="' + esc(p.id) + '" aria-label="Save to wishlist">' + I.heart + '</button>' +
    (p.in_stock === false ? '<span class="oos">Out of stock</span>' : o ? '<span class="offtag">' + o + '% off</span>' : '') +
    '<div class="pimg"><img src="' + esc(img(p)) + '" alt="" loading="lazy" width="300" height="324"></div>' +
    '<div class="pb"><span class="ps">' + esc(p.category || '') + (p.size ? ' \u00B7 ' + esc(p.size) : '') + '</span><span class="pn">' + esc(p.name) + '</span>' +
    '<div class="price"><b>' + inr(p.price) + '</b>' + (o ? '<s>' + inr(p.mrp) + '</s>' : '') + '</div></div>' +
    (p.in_stock === false ? '' : '<button type="button" class="add press" data-add="' + esc(p.id) + '" aria-label="Add ' + esc(p.name) + ' to bag">' + I.plus + '</button>') + '</div>';
}
function head(title, sub, extra) { return '<div class="topbar"><span class="wordmark">Avermontis</span><span style="display:flex;gap:8px">' + (extra || '') + bagBtn() + '</span></div><h1 class="title">' + title + '</h1>' + (sub ? '<p class="sub-title">' + sub + '</p>' : ''); }
function subhead(title, backTo) { return '<div class="topbar"><button type="button" class="back press" data-back="' + backTo + '">' + I.backI + 'Back</button>' + (backTo === 'bag' || backTo === 'shop' && title === 'Bag' ? '' : bagBtn()) + '</div><h1 class="title">' + title + '</h1>'; }
function emptyBox(icon, t, s, btn) { return '<div class="empty"><div class="ei">' + icon + '</div><h3>' + t + '</h3><p>' + s + '</p>' + (btn || '') + '</div>'; }

/* ---------- HOME ---------- */
function greeting() { var h = new Date().getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
RENDER.home = function (el) {
  var pr = profile() || {};
  var SEC = {
    banners: function () { return '<div id="h-banners">' + bannersHtml() + '</div>'; },
    today: function () { return '<div id="h-today"><div class="sk" style="height:200px;margin-top:18px"></div></div><div id="h-rem"></div>'; },
    picks: function () { return '<div class="sec"><h2>For your skin</h2><button type="button" class="link" data-go="shop">See all</button></div><div class="hscroll" id="h-picks">' + skeletonCards(3) + '</div>'; },
    ar: function () { return arHomeHtml(); },
    order: function () { return '<div id="h-order"></div>'; },
    explore: function () { return '<div class="sec"><h2>Explore</h2></div><div class="tiles"><button type="button" class="tile press" data-go="diary"><img src="/img/story.webp" alt="">' + '<b>Skin diary</b><span>Private photos &amp; notes</span></button>' +
      '<button type="button" class="tile press" data-go="learn"><img src="/img/ritual.webp" alt=""><b>Ingredients</b><span>What\u2019s inside, plainly</span></button></div>'; },
    ingredient: function () { return '<div class="sec"><h2>Ingredient of the day</h2></div><div id="h-ing"></div>'; }
  };
  var order = (UI.layout && UI.layout.home_app) || ['banners', 'today', 'picks', 'ar', 'order', 'explore', 'ingredient'].map(function (id) { return { id: id, on: true }; });
  var body = order.filter(function (x) { return x.on !== false && SEC[x.id]; }).map(function (x) { return '<div class="v4-sec" data-sec="' + x.id + '">' + SEC[x.id]() + '</div>'; }).join('');
  el.innerHTML = '<div class="topbar"><span class="wordmark">' + esc(storeName()) + '</span><span style="display:flex;gap:8px">' + chatBtn() + bellBtn() + bagBtn() + '</span></div>' +
    '<p class="greet">' + greeting() + (pr.name ? ',<br><em>' + esc(pr.name) + '</em>' : '') + '</p>' +
    '<div class="profile-pill">' + profilePills(pr) + '</div>' + body;
  loadNotes();
  ptr(el, function () { return Promise.all([loadCatalog(true), orders(true)]).then(function () { rerender('home'); }); });
  loadCatalog().then(function () {
    paintHome();
    var picks = picksFor(pr);
    if ($('#h-picks')) $('#h-picks').innerHTML = picks.map(card).join('');
    var ings = INGREDIENTS.filter(function (i) { return P.some(function (p) { return hasIng(p, i); }); });
    var d = new Date(), idx = (d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate()) % (ings.length || 1), ing = ings[idx];
    if (ing && $('#h-ing')) $('#h-ing').innerHTML = '<button type="button" class="ing-day press" style="width:100%;text-align:left" data-ing="' + esc(ing.key) + '"><span class="eyebrow">' + esc(ing.sub) + '</span><h3>' + esc(ing.name) + '</h3><p>' + esc(ing.text) + '</p></button>';
  });
  orders().then(function (list) {
    var o = list[0]; if (!o || !$('#h-order')) return;
    $('#h-order').innerHTML = '<div class="sec"><h2>Your last order</h2><button type="button" class="link" data-go="me">All orders</button></div>' + orderCard(o);
  });
};
function profilePills(pr) {
  var out = [];
  if (pr.skin) out.push(pr.skin.charAt(0).toUpperCase() + pr.skin.slice(1) + ' skin');
  (pr.concerns || []).forEach(function (s) { var c = CONCERNS.filter(function (x) { return x.slug === s; })[0]; if (c) out.push(c.name); });
  return out.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('');
}
function paintHome() {
  var box = $('#h-today'); if (!box) return;
  var pr = profile(), w = nowWhen(), steps = routineFor(pr, w), e = log()[dkey()] || {}, done = (e[w] || []).filter(function (id) { return steps.some(function (s) { return s.id === id; }); }).length;
  var pct = steps.length ? Math.round(done / steps.length * 100) : 0, st = streak();
  box.innerHTML = '<div class="today"><div><span class="eyebrow">' + (w === 'am' ? 'Morning ritual' : 'Evening ritual') + '</span><h3>' + (pct === 100 ? 'Ritual complete' : done ? 'Keep going' : 'Ready when you are') + '</h3><p>' + done + ' of ' + steps.length + ' steps done today</p></div>' +
    '<div class="ring" style="--p:' + pct + '"><div><b>' + pct + '%</b><small>today</small></div></div>' +
    '<div class="row"><button type="button" class="btn press" data-go="routine">' + (pct === 100 ? 'View routine' : 'Start ' + (w === 'am' ? 'morning' : 'evening') + ' ritual') + '</button></div></div>' +
    '<div class="stats"><div class="stat"><b class="flame">' + st + '</b><span>day streak</span></div><div class="stat"><b>' + daysLogged() + '</b><span>days logged</span></div><div class="stat"><b id="h-photos">\u2013</b><span>diary photos</span></div></div>';
  dbAll().then(function (l) { var n = $('#h-photos'); if (n) n.textContent = l.length; }).catch(function () { var n = $('#h-photos'); if (n) n.textContent = '0'; });
  var due = dueReminder(), rb = $('#h-rem');
  if (rb) rb.innerHTML = due ? '<div class="banner">' + I.bell + '<span>It\u2019s past your ' + (due === 'am' ? 'morning' : 'evening') + ' reminder. Your ritual is waiting.</span></div>' : '';
}

/* ---------- ROUTINE ---------- */
var rWhen = null;
RENDER.routine = function (el) {
  rWhen = rWhen || nowWhen();
  var pr = profile() || {};
  el.innerHTML = head('My ritual', 'Built from your skin profile and each product\u2019s own directions.') +
    '<div class="streak" id="r-streak"></div>' +
    '<div class="week" id="r-week"></div>' +
    '<div class="seg" id="r-seg" data-v="' + rWhen + '"><span class="thumb"></span><button type="button" data-when="am" class="' + (rWhen === 'am' ? 'on' : '') + '">' + I.sun + 'Morning</button><button type="button" data-when="pm" class="' + (rWhen === 'pm' ? 'on' : '') + '">' + I.moon + 'Evening</button></div>' +
    '<div class="rprog"><div class="bar"><i id="r-bar"></i></div><span class="small muted" id="r-count"></span></div>' +
    '<ol class="rsteps" id="r-steps"><li class="sk" style="height:88px"></li><li class="sk" style="height:88px"></li><li class="sk" style="height:88px"></li></ol><div id="r-burst"></div>' +
    '<div id="r-buy"></div>' +
    '<div class="sec"><h2>Reminders</h2></div><div id="r-rem"></div>' +
    '<p class="small muted" style="margin-top:18px">New to a product? Patch test on your inner arm and wait 24 hours before first use.</p>';
  loadCatalog().then(function () { paintRoutine(); paintRemSettings($('#r-rem')); });
};
function paintRoutine() {
  var pr = profile(), steps = routineFor(pr, rWhen), e = log()[dkey()] || {}, done = e[rWhen] || [];
  var n = steps.filter(function (s) { return done.indexOf(s.id) >= 0; }).length;
  $('#r-steps').innerHTML = steps.map(function (s, i) {
    var p = byId(s.id), d = done.indexOf(s.id) >= 0;
    return '<li class="rstep press' + (d ? ' done' : '') + '" data-step="' + esc(s.id) + '"><span class="num">' + (i + 1) + '</span><img src="' + esc(img(p)) + '" alt="" width="64" height="64" data-prod="' + esc(p.id) + '"><span class="rt"><small>' + s.step + '</small><b>' + esc(p.name) + '</b><span>' + esc(tipFor(p, rWhen)) + '</span></span><button type="button" class="check" aria-label="Mark ' + esc(s.step) + ' done" aria-pressed="' + d + '">' + I.check + '</button></li>';
  }).join('');
  $('#r-bar').style.width = (steps.length ? n / steps.length * 100 : 0) + '%';
  $('#r-count').textContent = n + '/' + steps.length;
  $('#r-burst').innerHTML = steps.length && n === steps.length ? '<div class="done-burst"><b>' + (rWhen === 'am' ? 'Morning' : 'Evening') + ' ritual done</b><p class="small muted" style="margin:4px 0 0">' + (rWhen === 'am' ? 'Sunscreen on? Reapply every 2\u20133 hours when outdoors.' : 'See you in the morning.') + '</p></div>' : '';
  var st = streak(), best = bestStreak();
  $('#r-streak').innerHTML = '<div class="fl">' + I.flame + '</div><div><b>' + st + (st === 1 ? ' day' : ' days') + '</b><p>' + (st ? 'Current streak \u00B7 best ' + best : 'Finish a full morning or evening ritual to start your streak') + '</p></div>';
  var L = log(), today = new Date(), w = '';
  for (var i = 6; i >= 0; i--) { var d = addDays(today, -i), r = dayDone(L[dkey(d)], pr); w += '<div class="day' + (i === 0 ? ' today' : '') + '">' + d.toLocaleDateString('en-IN', { weekday: 'narrow' }) + '<b>' + d.getDate() + '</b><span class="dd"><i class="' + (r.am ? 'on' : '') + '"></i><i class="' + (r.pm ? 'on' : '') + '"></i></span></div>'; }
  $('#r-week').innerHTML = w;
  // products for the ritual that are not in the bag
  var all = routineFor(pr, 'am').concat(routineFor(pr, 'pm')), seen = {}, ids = [];
  all.forEach(function (s) { if (!seen[s.id]) { seen[s.id] = 1; ids.push(s.id); } });
  orders().then(function (os) {
    var owned = {}; os.forEach(function (o) { if (o.status !== 'cancelled') (o.items || []).forEach(function (it) { owned[it.id] = 1; }); });
    var need = ids.filter(function (id) { var p = byId(id); return p && p.in_stock !== false && !owned[id]; });
    var box = $('#r-buy'); if (!box) return;
    if (!need.length) { box.innerHTML = ''; return; }
    var sum = need.reduce(function (s, id) { return s + byId(id).price; }, 0);
    box.innerHTML = '<div class="sumbox" style="margin-top:16px;display:flex;align-items:center;gap:12px"><div style="flex:1"><b style="display:block;color:var(--ivory)">' + (os.length ? 'Complete your ritual' : 'Get your whole ritual') + '</b><span class="small muted">' + need.length + ' products \u00B7 ' + inr(sum) + ' at today\u2019s prices</span></div><button type="button" class="btn sm press" data-addall="' + esc(need.join(',')) + '">Add all</button></div>';
  });
}
function paintRemSettings(box) {
  if (!box) return;
  notifyPerm().then(function (perm) { paintRemBox(box, perm); });
}
function paintRemBox(box, perm) {
  var r = rems();
  var note = NATIVE ? (perm === 'granted' ? 'Your phone will notify you at these times, even when the app is closed. Already done for the day? That nudge is skipped.' : 'Turn reminders on and allow notifications so your phone can nudge you at these times, even when the app is closed.')
    : (perm === 'granted' ? 'You\u2019ll get a notification at these times while the app is open or running in the background, and a reminder on the home screen when you open it.' : 'You\u2019ll see a reminder on the home screen when you open the app after these times. Allow notifications to also get one while the app is running.');
  box.innerHTML = '<div class="list"><label class="li"><span class="lic">' + I.bell + '</span><span class="lt"><b>Ritual reminders</b><span>Morning and evening nudges</span></span><span class="tog"><input type="checkbox" id="rem-on"' + (r.on ? ' checked' : '') + ' aria-label="Ritual reminders"><span></span></span></label>' +
    '<div class="li"><span class="lic">' + I.sun + '</span><span class="lt"><b>Morning</b></span><input class="time" type="time" id="rem-am" value="' + esc(r.am) + '" aria-label="Morning reminder time"></div>' +
    '<div class="li"><span class="lic">' + I.moon + '</span><span class="lt"><b>Evening</b></span><input class="time" type="time" id="rem-pm" value="' + esc(r.pm) + '" aria-label="Evening reminder time"></div></div>' +
    '<p class="small muted" style="margin:8px 2px 0">' + note + '</p>';
  function save() { var v = { on: $('#rem-on').checked, am: $('#rem-am').value || '08:00', pm: $('#rem-pm').value || '21:30' }; put(K.rem, v); scheduleReminders(); }
  $('#rem-on').addEventListener('change', function () {
    buzz(10); save();
    if (this.checked) Promise.resolve(askNotify()).then(function () { paintRemSettings(box); });
    toast(this.checked ? 'Reminders on' : 'Reminders off');
  });
  $('#rem-am').addEventListener('change', save); $('#rem-pm').addEventListener('change', save);
}

/* ---------- DIARY (photos never leave the phone) ---------- */
var TAGS = ['Calm', 'Dry', 'Oily', 'Breakout', 'Sensitive', 'Glowing'];
var cmp = { a: null, b: null };
RENDER.diary = function (el) {
  el.innerHTML = head('Skin diary', 'Your progress, in your own photos.') +
    '<button type="button" class="capture press" data-act="snap"><span class="cam">' + I.cam + '</span><b>Add today\u2019s photo</b><span>Same light, same angle, no filter, so your photos compare fairly.</span></button>' +
    '<p class="lock">' + I.lock + '<span>Diary photos and notes are saved only on this phone. They are never uploaded to AVERMONTIS or anyone else.</span></p>' +
    '<div id="d-compare"></div><div id="d-list"><div class="dgrid"><div class="sk dthumb"></div><div class="sk dthumb"></div><div class="sk dthumb"></div></div></div>';
  paintDiary();
};
function paintDiary() {
  dbAll().then(function (list) {
    var c = $('#d-compare'), l = $('#d-list'); if (!l) return;
    var cap = $('#v-diary .capture'); if (cap) cap.classList.toggle('slim', list.length > 0);
    if (!list.length) { c.innerHTML = ''; l.innerHTML = emptyBox(I.cam, 'Your first photo starts the story', 'Take one today and another in a few weeks. Then slide between them to see your own before and after.'); return; }
    if (list.length >= 2) {
      if (!cmp.a || !list.some(function (e) { return e.id === cmp.a; })) cmp.a = list[list.length - 1].id;
      if (!cmp.b || !list.some(function (e) { return e.id === cmp.b; })) cmp.b = list[0].id;
      var A = list.filter(function (e) { return e.id === cmp.a; })[0], B = list.filter(function (e) { return e.id === cmp.b; })[0];
      var opts = function (sel) { return list.map(function (e) { return '<option value="' + e.id + '"' + (e.id === sel ? ' selected' : '') + '>' + shortDate(e.date) + '</option>'; }).join(''); };
      c.innerHTML = '<div class="sec"><h2>Before &amp; after</h2></div>' +
        '<div class="compare" id="cmp" style="--x:50%"><img src="' + blobUrl(A) + '" alt="Before photo, ' + shortDate(A.date) + '"><img class="after" src="' + blobUrl(B) + '" alt="After photo, ' + shortDate(B.date) + '"><span class="handle"></span><span class="lab l">' + shortDate(A.date) + '</span><span class="lab r">' + shortDate(B.date) + '</span><input type="range" min="0" max="100" value="50" aria-label="Slide to compare"></div>' +
        '<div class="cmp-pick"><div><label for="cmp-a">Before</label><select class="sel" id="cmp-a">' + opts(cmp.a) + '</select></div><div><label for="cmp-b">After</label><select class="sel" id="cmp-b">' + opts(cmp.b) + '</select></div></div>';
      var box = $('#cmp');
      box.querySelector('input').addEventListener('input', function () { box.style.setProperty('--x', this.value + '%'); });
      $('#cmp-a').addEventListener('change', function () { cmp.a = this.value; paintDiary(); });
      $('#cmp-b').addEventListener('change', function () { cmp.b = this.value; paintDiary(); });
    } else c.innerHTML = '<div class="banner" style="margin-top:18px">' + I.compare + '<span>Add one more photo on another day to unlock the before &amp; after slider.</span></div>';
    l.innerHTML = '<div class="sec"><h2>Timeline</h2><span class="small muted">' + list.length + (list.length === 1 ? ' entry' : ' entries') + '</span></div><div class="dgrid">' +
      list.map(function (e) { return '<button type="button" class="dthumb press" data-entry="' + e.id + '"><img src="' + blobUrl(e) + '" alt="Diary photo ' + shortDate(e.date) + '"><span>' + shortDate(e.date) + '</span></button>'; }).join('') + '</div>';
  }).catch(function (err) { var l = $('#d-list'); if (l) l.innerHTML = emptyBox(I.lock, 'Diary unavailable', esc(err.message || 'This phone blocked saving photos in the app.')); });
}
function newEntrySheet(blob) {
  var u = URL.createObjectURL(blob), sel = [];
  openSheet('<span class="eyebrow">' + new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) + '</span><h2>New diary entry</h2>' +
    '<img src="' + u + '" alt="Your new photo" style="width:100%;max-height:46vh;object-fit:cover;border-radius:20px;margin:10px 0 16px">' +
    '<div class="field"><label>How does your skin feel?</label><div class="tags" id="e-tags">' + TAGS.map(function (t) { return '<button type="button" class="chip" data-tag="' + t + '">' + t + '</button>'; }).join('') + '</div></div>' +
    '<div class="field"><label for="e-note">Note (optional)</label><textarea class="inp" id="e-note" maxlength="400" placeholder="Sleep, water, weather, anything you noticed\u2026"></textarea></div>' +
    '<p class="lock">' + I.lock + '<span>Saved only on this phone.</span></p>',
    '<button type="button" class="btn press" id="e-save">Save entry</button>');
  $$('#e-tags .chip').forEach(function (b) { b.addEventListener('click', function () { buzz(6); b.classList.toggle('on'); var t = b.getAttribute('data-tag'), i = sel.indexOf(t); if (i >= 0) sel.splice(i, 1); else sel.push(t); }); });
  $('#e-save').addEventListener('click', function () {
    var e = { id: 'e' + Date.now(), ts: Date.now(), date: dkey(), blob: blob, note: $('#e-note').value.trim(), tags: sel.slice(), routine: dayDone(log()[dkey()], profile()) };
    dbPut(e).then(function () { buzz(20); closeSheet(); toast('Saved to your diary'); cmp.b = e.id; if (current === 'diary') paintDiary(); else go('diary'); })
      .catch(function () { toast('Could not save on this phone. Is storage full?'); });
  });
}
function entrySheet(id) {
  dbAll().then(function (list) {
    var e = list.filter(function (x) { return x.id === id; })[0]; if (!e) return;
    var r = e.routine || {};
    openSheet('<span class="eyebrow">' + shortDate(e.date) + ' \u00B7 ' + new Date(e.ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + '</span><h2>Diary entry</h2>' +
      '<img src="' + blobUrl(e) + '" alt="Diary photo" style="width:100%;max-height:52vh;object-fit:cover;border-radius:20px;margin:10px 0 14px">' +
      (e.tags && e.tags.length ? '<div class="tags" style="margin-bottom:10px">' + e.tags.map(function (t) { return '<span class="chip on">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
      (e.note ? '<p style="color:var(--text)">' + esc(e.note) + '</p>' : '') +
      '<p class="small muted">Ritual that day: morning ' + (r.am ? '\u2713' : '\u2013') + ' \u00B7 evening ' + (r.pm ? '\u2713' : '\u2013') + '</p>',
      '<button type="button" class="btn ghost press" id="e-del" style="color:var(--err)">' + I.trash + ' Delete</button><button type="button" class="btn press" id="e-cmp">' + I.compare + ' Compare</button>');
    $('#e-del').addEventListener('click', function () {
      if (!confirm('Delete this diary entry from your phone?')) return;
      dbDel(e.id).then(function () { if (urls[e.id]) { URL.revokeObjectURL(urls[e.id]); delete urls[e.id]; } closeSheet(); toast('Entry deleted'); paintDiary(); });
    });
    $('#e-cmp').addEventListener('click', function () { if (list.length < 2) { toast('Add another photo first'); return; } if (e.id !== cmp.b) cmp.a = e.id; closeSheet(); paintDiary(); setTimeout(function () { var c = $('#cmp'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300); });
  });
}

/* ---------- SHOP ---------- */
var shopCat = 'all', shopQ = '';
RENDER.shop = function (el) {
  el.innerHTML = head('Shop', 'Cash on Delivery across India \u00B7 free shipping from ' + inr(SET.free_shipping_from)) +
    '<div class="search">' + I.search + '<input type="search" id="s-q" placeholder="Search products or ingredients" value="' + esc(shopQ) + '" aria-label="Search"></div>' +
    '<div class="chips" id="s-cats">' + CATS.map(function (c) { return '<button type="button" class="chip' + (c.k === shopCat ? ' on' : '') + '" data-cat="' + c.k + '">' + c.n + '</button>'; }).join('') + '</div>' +
    '<div class="grid" id="s-grid" style="margin-top:14px">' + skeletonCards(4, true) + '</div>' +
    '<div class="sec"><h2>Shop by concern</h2></div><div class="list" id="s-concerns"></div>';
  ptr(el, function () { return loadCatalog(true).then(function () { paintShop(); }); });
  $('#s-q').addEventListener('input', function () { shopQ = this.value; paintShop(); });
  Promise.all([loadCatalog(), loadWish()]).then(paintShop);
  $('#s-concerns').innerHTML = CONCERNS.map(function (c) { return '<button type="button" class="li press" data-concern="' + c.slug + '"><span class="lic">' + I.sparkle + '</span><span class="lt"><b>' + c.name + '</b><span>' + c.line + '</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</button>'; }).join('');
};
function paintShop() {
  var g = $('#s-grid'); if (!g) return;
  var q = shopQ.trim().toLowerCase(), pr = profile();
  var list = shopCat === 'foryou' ? picksFor(pr) : P.filter(function (p) { return shopCat === 'all' || catKey(p) === shopCat; });
  if (q) list = list.filter(function (p) { return (p.name + ' ' + p.category + ' ' + (p.ingredients || []).join(' ') + ' ' + (p.short || '')).toLowerCase().indexOf(q) >= 0; });
  g.innerHTML = list.length ? list.map(card).join('') : '<div style="grid-column:1/-1">' + (q ? emptyBox(I.search, 'Nothing found', 'Try another word, like \u201Cserum\u201D or \u201Cniacinamide\u201D.') : emptyBox(I.leaf, 'Coming soon', 'There are no products in this category yet.')) + '</div>';
}
function concernSheet(slug) {
  var c = CONCERNS.filter(function (x) { return x.slug === slug; })[0]; if (!c) return;
  loadCatalog().then(function () {
    var list = c.ids.map(byId).filter(Boolean);
    openSheet('<span class="eyebrow">Shop by concern</span><h2>' + c.name + '</h2><p class="muted">' + c.line + '.</p>' +
      (slug === 'dark-spots' ? '<p class="small muted">We make no promise to fade marks; for persistent spots, see a dermatologist.</p>' : '') +
      '<div class="grid" style="margin-top:12px">' + list.map(card).join('') + '</div>');
  });
}
function routinePlace(p) {
  var pr = profile(), out = [];
  ['am', 'pm'].forEach(function (w) { var st = routineFor(pr, w); st.forEach(function (s, i) { if (s.id === p.id) out.push((w === 'am' ? 'Morning' : 'Evening') + ' step ' + (i + 1)); }); });
  return out;
}
function productSheet(id) {
  var p = byId(id); if (!p) return;
  var o = off(p), w = wishIds().indexOf(p.id) >= 0, ings = ingFor(p), place = routinePlace(p), qty = 1;
  var keyNames = ings.map(function (i) { return i.key; });
  openSheet('<div class="pd-img"><img src="' + esc(img(p)) + '" alt="' + esc(p.name) + '"></div>' +
    '<div class="pd-meta"><span class="eyebrow">' + esc(p.category || '') + (p.size ? ' \u00B7 ' + esc(p.size) : '') + '</span><button type="button" class="heart' + (w ? ' on' : '') + '" style="position:static;background:var(--card2)" data-wish="' + esc(p.id) + '" aria-label="Save to wishlist">' + I.heart + '</button></div>' +
    '<h2>' + esc(p.name) + '</h2><p class="muted" style="margin:0 0 10px">' + esc(p.short || '') + '</p>' +
    '<div class="pd-price"><b>' + inr(p.price) + '</b>' + (o ? '<s>' + inr(p.mrp) + '</s><span class="off">' + o + '% off</span>' : '') + '</div><p class="small muted" style="margin:2px 0 0">Inclusive of GST \u00B7 Cash on Delivery</p>' +
    productExtras(p) +
    (place.length ? '<div class="fit">' + I.sparkle + '<span>In your ritual: <b>' + place.join(' \u00B7 ') + '</b></span></div>' : '') +
    '<details class="acc" open><summary>Key ingredients' + I.down + '</summary><div class="ab"><div class="ingchips">' + (p.ingredients || []).map(function (n) { var k = INGREDIENTS.filter(function (i) { return n.toLowerCase().indexOf(i.key) >= 0 || (i.also && n.toLowerCase().indexOf(i.also) >= 0); })[0]; return k ? '<button type="button" class="ingchip k" data-ing="' + esc(k.key) + '">' + esc(n) + '</button>' : '<span class="ingchip">' + esc(n) + '</span>'; }).join('') + '</div><p class="small" style="margin:8px 0 0">The complete ingredient list is printed on the pack.</p></div></details>' +
    '<details class="acc"><summary>How to use' + I.down + '</summary><div class="ab">' + esc(p.how_to_use || '') + '</div></details>' +
    '<details class="acc"><summary>About this product' + I.down + '</summary><div class="ab">' + esc(p.description || '') + '</div></details>' +
    (p.faqs && p.faqs.length ? '<details class="acc"><summary>FAQs' + I.down + '</summary><div class="ab">' + p.faqs.map(function (f) { return '<p><b style="color:var(--text)">' + esc(f.q) + '</b><br>' + esc(f.a) + '</p>'; }).join('') + '</div></details>' : '') +
    '<details class="acc"><summary>Delivery &amp; payment' + I.down + '</summary><div class="ab">Cash on Delivery across India. Free shipping on orders from ' + inr(SET.free_shipping_from) + '; below that, ' + inr(SET.shipping_fee) + '.</div></details>',
    p.in_stock === false ? '<button class="btn" disabled>Out of stock</button>' :
    '<div class="qty"><button type="button" id="pq-m" aria-label="Less">\u2212</button><span id="pq">1</span><button type="button" id="pq-p" aria-label="More">+</button></div><button type="button" class="btn press" id="p-add">Add to bag \u00B7 ' + inr(p.price) + '</button>');
  if (p.in_stock === false) return;
  function paint() { $('#pq').textContent = qty; $('#p-add').textContent = 'Add to bag \u00B7 ' + inr(p.price * qty); }
  $('#pq-m').addEventListener('click', function () { if (qty > 1) { qty--; buzz(5); paint(); } });
  $('#pq-p').addEventListener('click', function () { if (qty < (SET.max_qty_per_item || 10)) { qty++; buzz(5); paint(); } });
  $('#p-add').addEventListener('click', function () { addToBag(p.id, qty); closeSheet(); });
}

/* ---------- INGREDIENTS ---------- */
RENDER.learn = function (el) {
  el.innerHTML = subhead('Ingredients', 'home') + '<p class="sub-title">Only ingredients that are actually in the collection, in plain words, and where you\u2019ll find each one.</p>' +
    '<div class="search">' + I.search + '<input type="search" id="l-q" placeholder="Search an ingredient" aria-label="Search ingredients"></div><div id="l-list"></div>';
  loadCatalog().then(function () {
    var all = INGREDIENTS.filter(function (i) { return P.some(function (p) { return hasIng(p, i); }); });
    function paint(q) {
      q = (q || '').toLowerCase();
      var list = all.filter(function (i) { return !q || (i.name + ' ' + i.sub).toLowerCase().indexOf(q) >= 0; });
      $('#l-list').innerHTML = list.length ? list.map(function (i) {
        var f = P.filter(function (p) { return hasIng(p, i); });
        return '<button type="button" class="ingcard press" data-ing="' + esc(i.key) + '"><span class="eyebrow">' + esc(i.sub) + '</span><h3>' + esc(i.name) + '</h3><p>' + esc(i.text) + '</p><span class="found">' + f.map(function (p) { return '<img src="' + esc(img(p)) + '" alt="' + esc(p.name) + '" width="30" height="30">'; }).join('') + '</span></button>';
      }).join('') : emptyBox(I.search, 'Not in our collection', 'We only list ingredients that are in our products.');
    }
    paint(''); $('#l-q').addEventListener('input', function () { paint(this.value); });
  });
};
function ingSheet(key) {
  var i = INGREDIENTS.filter(function (x) { return x.key === key; })[0]; if (!i) return;
  loadCatalog().then(function () {
    var f = P.filter(function (p) { return hasIng(p, i); });
    openSheet('<span class="eyebrow">' + esc(i.sub) + '</span><h2>' + esc(i.name) + '</h2><p style="color:var(--text)">' + esc(i.text) + '</p><div class="sec" style="margin-top:18px"><h2 style="font-size:1.3rem">Found in</h2></div><div class="grid">' + f.map(card).join('') + '</div>');
  });
}

/* ---------- BAG ---------- */
var quote = null;
function localTotals(lines) {
  var sub = lines.reduce(function (s, l) { return s + l.total; }, 0);
  var ship = sub >= SET.free_shipping_from || !sub ? 0 : SET.shipping_fee;
  return { items_subtotal: sub, discount: 0, shipping: ship, total: sub + ship };
}
function sumRows(t, coupon) {
  return '<div class="srow"><span>Items</span><span>' + inr(t.items_subtotal != null ? t.items_subtotal : t.subtotal) + '</span></div>' +
    (t.discount ? '<div class="srow disc"><span>Coupon ' + esc(coupon || '') + '</span><span>\u2212' + inr(t.discount) + '</span></div>' : '') +
    '<div class="srow"><span>Shipping</span><span>' + (t.shipping ? inr(t.shipping) : 'Free') + '</span></div>' +
    '<div class="srow tot"><span>Total</span><span>' + inr(t.total) + '</span></div>';
}
function fetchQuote(lines, code) {
  return api('POST', '/api/quote', { items: lines.map(function (l) { return { id: l.p.id, qty: l.qty }; }), coupon: code || undefined }).then(function (b) { return b.quote; });
}
RENDER.bag = function (el) {
  el.innerHTML = subhead('Bag', 'shop') + '<div id="b-body"><div class="sk" style="height:100px;margin-bottom:10px"></div><div class="sk" style="height:100px"></div></div>';
  loadCatalog().then(paintBag);
};
function paintBag() {
  var b = $('#b-body'); if (!b) return;
  var lines = cartLines(), pay = $('#paybar'); if (pay) pay.remove();
  if (!lines.length) { b.innerHTML = emptyBox(I.bag, 'Your bag is empty', 'Your ritual starts with one step.', '<button type="button" class="btn inline press" data-go="shop" style="margin:16px auto 0">Shop the collection</button>'); return; }
  var t = localTotals(lines), code = localStorage.getItem(COUPON) || '';
  var away = SET.free_shipping_from - t.items_subtotal;
  b.innerHTML = lines.map(function (l) {
    return '<div class="bline"><img src="' + esc(img(l.p)) + '" alt="" data-prod="' + esc(l.p.id) + '"><div><b>' + esc(l.p.name) + '</b><span class="small muted">' + esc(l.p.size || '') + ' \u00B7 ' + inr(l.p.price) + '</span>' +
      '<div class="bm"><div class="qty"><button type="button" data-q="' + esc(l.p.id) + '" data-d="-1" aria-label="Less">' + (l.qty === 1 ? I.trash.replace('<svg', '<svg width="16" height="16"') : '\u2212') + '</button><span>' + l.qty + '</span><button type="button" data-q="' + esc(l.p.id) + '" data-d="1" aria-label="More">+</button></div><b style="font-family:var(--sans);font-size:1rem">' + inr(l.total) + '</b></div>' + (canBargain(l.p) ? '<button type="button" class="v4-bl-offer press" data-offer="' + esc(l.p.id) + '">' + V4I.tag + ' Make an offer</button>' : '') + '</div></div>';
  }).join('') +
    '<div class="ship">' + (away > 0 ? 'Add ' + inr(away) + ' more for free shipping' : 'You\u2019ve unlocked free shipping') + '<div class="bar"><i style="width:' + Math.min(100, t.items_subtotal / SET.free_shipping_from * 100) + '%"></i></div></div>' +
    '<div class="field" style="display:flex;gap:8px;margin-bottom:10px"><input class="inp" id="b-code" placeholder="Coupon code" value="' + esc(code) + '" autocapitalize="characters" aria-label="Coupon code" style="flex:1"><button type="button" class="btn sm ghost press" id="b-apply">Apply</button></div><div id="b-cmsg"></div>' +
    '<div class="sumbox" id="b-sum">' + sumRows(t) + '</div>' +
    '<p class="small muted" style="margin-top:10px">Prices include GST and are confirmed by the store when you place the order.</p>';
  var bar = document.createElement('div'); bar.className = 'paybar'; bar.id = 'paybar';
  bar.innerHTML = '<div class="pt"><small>Total</small><b id="b-total">' + inr(t.total) + '</b></div><button type="button" class="btn press" data-go="checkout">Checkout \u00B7 COD</button>';
  $('#app').appendChild(bar);
  function q(c) {
    return fetchQuote(lines, c).then(function (qq) { quote = qq; if ($('#b-sum')) { $('#b-sum').innerHTML = sumRows(qq, qq.coupon); $('#b-total').textContent = inr(qq.total); } return qq; });
  }
  q(code).catch(function (e) { if (code) { localStorage.removeItem(COUPON); q('').catch(function () {}); } });
  $('#b-apply').addEventListener('click', function () {
    var c = $('#b-code').value.trim().toUpperCase(), m = $('#b-cmsg');
    if (!c) { localStorage.removeItem(COUPON); q(''); m.innerHTML = ''; return; }
    q(c).then(function (qq) { if (qq.discount) { localStorage.setItem(COUPON, c); buzz(15); m.innerHTML = '<div class="alert ok">Coupon applied: you save ' + inr(qq.discount) + '</div>'; } else m.innerHTML = '<div class="alert">' + esc(qq.coupon_error || 'This coupon does not apply to your bag.') + '</div>'; })
      .catch(function (e) { m.innerHTML = '<div class="alert">' + esc(e.message) + '</div>'; });
  });
}
function leaveBag() { var pay = $('#paybar'); if (pay && current !== 'bag') pay.remove(); }

/* ---------- CHECKOUT (Cash on Delivery, same order API as the website) ---------- */
var RULES = {
  name: function (v) { return v.length < 2 ? 'Please enter your full name.' : ''; },
  phone: function (v) { var d = v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''); return /^[6-9]\d{9}$/.test(d) ? '' : 'Enter a 10-digit Indian mobile number.'; },
  email: function (v) { return !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'This email does not look right (or leave it empty).'; },
  address: function (v) { return v.length < 10 ? 'House no., street and area (at least 10 characters).' : ''; },
  pincode: function (v) { return /^[1-9]\d{5}$/.test(v) ? '' : 'Pincode must be 6 digits.'; },
  city: function (v) { return v.length < 2 ? 'Please enter your city.' : ''; },
  state: function (v) { return STATES.indexOf(v) >= 0 ? '' : 'Please choose your state.'; }
};
function fld(name, label, attrs) { return '<div class="field" data-f="' + name + '"><label for="c-' + name + '">' + label + '</label><input class="inp" id="c-' + name + '" name="' + name + '" ' + (attrs || '') + '><div class="err"></div></div>'; }
RENDER.checkout = function (el) {
  var pay = $('#paybar'); if (pay) pay.remove();
  el.innerHTML = subhead('Checkout', 'bag') + '<div id="c-body"><div class="sk" style="height:300px"></div></div>';
  loadCatalog().then(function () {
    var lines = cartLines(); if (!lines.length) { go('bag', true); return; }
    var saved = get(ADDR, {}) || {};
    $('#c-body').innerHTML = '<div id="c-acct" class="small muted" style="margin-bottom:14px"></div><form id="c-form" novalidate>' +
      '<div class="sec" style="margin-top:6px"><h2 style="font-size:1.3rem">Delivery address</h2></div>' +
      fld('name', 'Full name', 'autocomplete="name" maxlength="80"') + fld('phone', 'Mobile number', 'type="tel" inputmode="numeric" autocomplete="tel" maxlength="14" placeholder="10-digit mobile"') +
      fld('email', 'Email (optional, for order updates)', 'type="email" autocomplete="email" maxlength="120"') + fld('address', 'House no., street, area', 'autocomplete="street-address" maxlength="300"') +
      '<div class="row2">' + fld('pincode', 'Pincode', 'inputmode="numeric" autocomplete="postal-code" maxlength="6"') + fld('city', 'City', 'autocomplete="address-level2" maxlength="60"') + '</div>' +
      '<div class="field" data-f="state"><label for="c-state">State</label><select class="inp" id="c-state" name="state"><option value="">Choose state</option>' + STATES.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select><div class="err"></div></div>' +
      '<div class="field"><label for="c-notes">Delivery note (optional)</label><input class="inp" id="c-notes" name="notes" maxlength="300" placeholder="Landmark, preferred time\u2026"></div>' +
      '<div class="sec"><h2 style="font-size:1.3rem">Payment</h2></div><div class="cod"><span class="rd"></span><div><b style="color:var(--ivory)">Cash on Delivery</b><div class="small muted">Pay in cash when your order arrives.</div></div></div>' +
      '<div class="sumbox" id="c-sum">' + sumRows(localTotals(lines)) + '</div><div id="c-alert"></div></form>';
    var f = $('#c-form');
    Object.keys(RULES).forEach(function (k) { if (saved[k] && f[k]) f[k].value = saved[k]; }); if (saved.notes) f.notes.value = saved.notes;
    me().then(function (u) {
      $('#c-acct').innerHTML = u ? 'Signed in as <b style="color:var(--text)">' + esc(u.email) + '</b>. This order will be saved to your account.' : 'Checking out as a guest. <a href="#me">Sign in</a> to save orders to your account.';
      if (u) { if (!f.name.value) f.name.value = u.name || ''; if (!f.email.value) f.email.value = u.email || ''; }
    });
    var code = localStorage.getItem(COUPON) || '';
    fetchQuote(lines, code).then(function (qq) { quote = qq; $('#c-sum').innerHTML = sumRows(qq, qq.coupon); $('#c-total').textContent = inr(qq.total); }).catch(function () {});
    var bar = document.createElement('div'); bar.className = 'paybar'; bar.id = 'paybar';
    bar.innerHTML = '<div class="pt"><small>To pay on delivery</small><b id="c-total">' + inr(localTotals(lines).total) + '</b></div><button type="button" class="btn press" id="c-place">Place order</button>';
    $('#app').appendChild(bar);
    function check(k) { var m = RULES[k](String(f[k].value || '').trim()), box = f.querySelector('[data-f="' + k + '"]'); box.classList.toggle('bad', !!m); box.querySelector('.err').textContent = m; return !m; }
    Object.keys(RULES).forEach(function (k) { f[k].addEventListener('blur', function () { if (f[k].value) check(k); }); });
    var busy = false;
    $('#c-place').addEventListener('click', function () {
      if (busy) return; var al = $('#c-alert'); al.innerHTML = '';
      var bad = Object.keys(RULES).filter(function (k) { return !check(k); });
      if (bad.length) { buzz([10, 40, 10]); f[bad[0]].focus(); f[bad[0]].scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      if (!navigator.onLine) { al.innerHTML = '<div class="alert">You are offline. Connect and tap Place order again; your bag is saved.</div>'; return; }
      var cust = {}; Object.keys(RULES).forEach(function (k) { cust[k] = String(f[k].value).trim(); });
      cust.phone = cust.phone.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''); cust.notes = f.notes.value.trim().slice(0, 300);
      put(ADDR, cust);
      busy = true; var btn = this; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Placing order\u2026';
      api('POST', '/api/orders', { items: cartLines().map(function (l) { return { id: l.p.id, qty: l.qty }; }), customer: cust, payment: 'cod', coupon: code || undefined }).then(function (b) {
        put(LAST, b.order); try { sessionStorage.setItem(LAST, JSON.stringify(b.order)); } catch (e) {}
        localStorage.removeItem(CART); localStorage.removeItem(COUPON); paintBadges(); ordersP = null; buzz([20, 60, 30]);
        var pb = $('#paybar'); if (pb) pb.remove();
        go('done', true);
      }).catch(function (err) {
        busy = false; btn.disabled = false; btn.textContent = 'Place order';
        if (err.fields) Object.keys(err.fields).forEach(function (k) { var box = f.querySelector('[data-f="' + k + '"]'); if (box) { box.classList.add('bad'); box.querySelector('.err').textContent = err.fields[k]; } });
        al.innerHTML = '<div class="alert">' + esc(err.message) + '</div>';
      });
    });
  });
};
RENDER.done = function (el) {
  var o = get(LAST, null);
  if (!o) { el.innerHTML = subhead('Order', 'shop') + emptyBox(I.box, 'No recent order', 'Your orders are under Me.'); return; }
  el.innerHTML = '<div class="success"><div class="tick">' + I.check + '</div><span class="eyebrow">Order placed</span><h1 class="title">Thank you' + (o.customer && o.customer.name ? ', ' + esc(firstName(o.customer.name)) : '') + '</h1>' +
    '<p class="muted">Order <b style="color:var(--ivory)">' + esc(o.id) + '</b> is saved. Please keep <b style="color:var(--ivory)">' + inr(o.total) + '</b> ready \u2014 you pay in cash when it arrives.</p></div>' +
    '<div class="sumbox" style="margin-top:18px">' + (o.items || []).map(function (i) { return '<div class="srow"><span>' + esc(i.name) + ' \u00D7 ' + i.qty + '</span><span>' + inr(i.total) + '</span></div>'; }).join('') + '<div class="srow tot"><span>Total (COD)</span><span>' + inr(o.total) + '</span></div></div>' +
    '<div style="display:flex;flex-direction:column;gap:10px;margin-top:18px">' + (o.invoice_url ? '<a class="btn ghost press" href="' + esc(o.invoice_url) + '" target="_blank" rel="noopener">' + I.doc + ' Invoice (PDF)</a>' : '') +
    '<button type="button" class="btn press" data-track="' + esc(o.id) + '">' + I.truck + ' Track this order</button><button type="button" class="btn ghost press" data-go="routine">Back to my ritual</button></div>';
};

/* ---------- ME ---------- */
var seenOrders = {};
function orderCard(o) {
  seenOrders[o.id] = o;
  var si = STATUS.indexOf(o.status), canc = o.status === 'cancelled';
  return '<div class="ocard"><div class="oh"><span class="oid">' + esc(o.id) + '</span><span class="status ' + esc(o.status) + '">' + esc(STATUS_LABEL[o.status] || o.status) + '</span></div>' +
    '<div class="small muted">' + fmtDate(o.created_at) + ' \u00B7 ' + inr(o.total) + ' \u00B7 Cash on Delivery</div>' +
    (canc ? '' : '<div class="steps">' + STATUS.map(function (s, i) { return '<i class="' + (i <= si ? 'on' : '') + '"></i>'; }).join('') + '</div><div class="steplabels">' + STATUS.map(function (s) { return '<span>' + STATUS_LABEL[s] + '</span>'; }).join('') + '</div>') +
    '<div class="oimgs">' + (o.items || []).map(function (it) { var p = byId(it.id); return p ? '<img src="' + esc(img(p)) + '" alt="' + esc(it.name) + '" width="46" height="46">' : ''; }).join('') + '</div>' +
    '<div class="oa"><button type="button" class="btn sm press" data-reorder="' + esc(o.id) + '">' + I.repeat + ' Reorder</button>' + (o.invoice_url ? '<a class="btn sm ghost press" href="' + esc(o.invoice_url) + '" target="_blank" rel="noopener">Invoice</a>' : '') + '</div></div>';
}
RENDER.me = function (el) {
  var pr = profile() || {};
  el.innerHTML = head('Me', '') + '<div id="m-head"><div class="sk" style="height:96px"></div></div><div id="m-orders"></div>' +
    '<div class="sec"><h2>Wishlist</h2></div><div class="hscroll" id="m-wish"></div>' +
    '<div class="sec"><h2>My skin</h2></div><div class="list">' +
    '<button type="button" class="li press" data-act="quiz"><span class="lic">' + I.drop + '</span><span class="lt"><b>Skin profile</b><span>' + (profilePills(pr).replace(/<[^>]+>/g, ' ').trim().replace(/\s{2,}/g, ' \u00B7 ') || 'Not set') + '</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</button>' +
    '<button type="button" class="li press" data-go="routine"><span class="lic">' + I.bell + '</span><span class="lt"><b>Ritual &amp; reminders</b><span>' + (rems().on ? 'On \u00B7 ' + rems().am + ' and ' + rems().pm : 'Off') + '</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</button>' +
    '<button type="button" class="li press" data-go="learn"><span class="lic">' + I.leaf + '</span><span class="lt"><b>Ingredient guide</b><span>What\u2019s in our products</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</button></div>' +
    '<div class="sec"><h2>Orders &amp; help</h2></div><div class="list">' +
    '<button type="button" class="li press" data-track=""><span class="lic">' + I.truck + '</span><span class="lt"><b>Track an order</b><span>With your order number and phone</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</button>' +
    '<button type="button" class="li press" data-act="address"><span class="lic">' + I.pin + '</span><span class="lt"><b>Saved address</b><span id="m-addr">On this phone</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</button>' +
    (feat('chat') ? '<button type="button" class="li press" data-act="chat"><span class="lic">' + V4I.chat + '</span><span class="lt"><b>Ask the assistant</b><span>Products, routine, orders \u2014 English, Hinglish, \u0939\u093F\u0902\u0926\u0940</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</button>' : '') +
    (feat('notifications') ? '<button type="button" class="li press" data-act="notes"><span class="lic">' + I.bell + '</span><span class="lt"><b>Notifications</b><span>Offers and order updates</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</button>' : '') +
    '<a class="li press" href="mailto:' + SUPPORT + '"><span class="lic">' + I.help + '</span><span class="lt"><b>Help</b><span>' + SUPPORT + '</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</a>' +
    '<a class="li press" href="/shipping"><span class="lic">' + I.box + '</span><span class="lt"><b>Shipping &amp; returns</b><span>Delivery and return policy</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</a>' +
    '<a class="li press" href="/privacy"><span class="lic">' + I.lock + '</span><span class="lt"><b>Privacy &amp; terms</b><span>Your diary stays on your phone</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</a>' +
    (feat('ar') ? '<button type="button" class="li press" data-act="ar"><span class="lic">' + V4I.cube + '</span><span class="lt"><b>AR &amp; 3D</b><span>In your room, glow selfie, scan your bottle</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</button>' : '') +
    (NATIVE && NATIVE_PLUG() && NATIVE_PLUG().setIcon ? '<button type="button" class="li press" data-act="icon"><span class="lic">' + I.sparkle + '</span><span class="lt"><b>App icon</b><span>Pick the home-screen icon you like</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</button>' : '') +
    '<a class="li press" href="/?view=site"><span class="lic">' + I.globe + '</span><span class="lt"><b>Open the website</b><span>avermontis.sites.tab.bot</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</a>' +
    '</div>' +
    '<div id="m-out"></div><p class="small muted" style="text-align:center;margin-top:22px">AVERMONTIS app ' + APP_VERSION + '</p>';
  var a = get(ADDR, null); if (a && a.city) $('#m-addr').textContent = a.name + ' \u00B7 ' + a.city + ' ' + (a.pincode || '');
  ptr(el, function () { return Promise.all([me(true), loadCatalog(true)]).then(function () { ordersP = null; rerender('me'); }); });
  Promise.all([loadCatalog(), me()]).then(function (r) {
    var u = r[1], h = $('#m-head'); if (!h) return;
    if (u) {
      h.innerHTML = '<div class="me-head"><span class="avatar">' + esc((u.name || u.email || '?').charAt(0).toUpperCase()) + '</span><div style="min-width:0"><b>' + esc(u.name || 'Your account') + '</b><span class="small muted" style="word-break:break-all">' + esc(u.email) + '</span></div></div>';
      $('#m-out').innerHTML = '<div class="list" style="margin-top:22px"><button type="button" class="li press" data-act="logout"><span class="lic">' + I.out + '</span><span class="lt"><b>Sign out</b></span></button></div>';
      $('#m-orders').innerHTML = '<div class="sec"><h2>My orders</h2></div><div id="m-olist"><div class="sk" style="height:150px"></div></div>';
      orders().then(function (os) { var b = $('#m-olist'); if (b) b.innerHTML = os.length ? os.map(orderCard).join('') : emptyBox(I.box, 'No orders yet', 'Orders you place while signed in show up here, with tracking and one-tap reorder.'); });
    } else {
      h.innerHTML = '<div class="me-head" style="flex-wrap:wrap"><span class="avatar">' + esc((pr.name || 'A').charAt(0).toUpperCase()) + '</span><div style="flex:1;min-width:0"><b>' + esc(pr.name || 'Welcome') + '</b><span class="small muted">Sign in to see your orders, reorder in one tap and keep your wishlist.</span></div><div style="display:flex;gap:10px;width:100%;margin-top:6px"><button type="button" class="btn sm press" style="flex:1" data-auth="login">Sign in</button><button type="button" class="btn sm ghost press" style="flex:1" data-auth="signup">Create account</button></div></div>';
      var lo = get(LAST, null);
      if (lo) $('#m-orders').innerHTML = '<div class="sec"><h2>Last order on this phone</h2></div>' + orderCard(lo);
    }
    loadWish().then(function (ids) {
      var list = ids.map(byId).filter(Boolean), b = $('#m-wish'); if (!b) return;
      b.innerHTML = list.length ? list.map(card).join('') : '<p class="small muted" style="padding:0 2px">Tap the heart on any product to save it here.</p>';
    });
  });
};
function authSheet(mode) {
  openSheet('<div class="tabs2"><button type="button" data-mode="login" class="' + (mode === 'login' ? 'on' : '') + '">Sign in</button><button type="button" data-mode="signup" class="' + (mode === 'signup' ? 'on' : '') + '">Create account</button></div>' +
    '<h2>' + (mode === 'login' ? 'Welcome back' : 'Create your account') + '</h2><p class="muted small">Same account as the AVERMONTIS website.</p>' +
    '<form id="a-form" novalidate>' + (mode === 'signup' ? '<div class="field" data-f="name"><label for="a-name">Name</label><input class="inp" id="a-name" name="name" autocomplete="name" maxlength="60"><div class="err"></div></div>' : '') +
    '<div class="field" data-f="email"><label for="a-email">' + 'Email' + '</label><input class="inp" id="a-email" name="email" type="' + (mode === 'login' ? 'text' : 'email') + '" inputmode="email" autocapitalize="none" spellcheck="false" autocomplete="' + (mode === 'login' ? 'username' : 'email') + '" maxlength="254"><div class="err"></div></div>' +
    '<div class="field" data-f="password"><label for="a-pw">Password</label><input class="inp" id="a-pw" name="password" type="password" autocomplete="' + (mode === 'login' ? 'current-password' : 'new-password') + '" maxlength="128"><div class="err"></div></div>' +
    (mode === 'signup' ? '<p class="small muted">At least 8 characters, with a letter and a number.</p>' : '<p class="small"><a href="/forgot">Forgot password?</a></p>') +
    '<div id="a-alert"></div><button class="btn press" type="submit" id="a-go">' + (mode === 'login' ? 'Sign in' : 'Create account') + '</button></form>');
  $$('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { buzz(5); authSheet(b.getAttribute('data-mode')); }); });
  $('#a-form').addEventListener('submit', function (e) {
    e.preventDefault(); var f = this, btn = $('#a-go'); $('#a-alert').innerHTML = ''; $$('.field', f).forEach(function (x) { x.classList.remove('bad'); });
    var body = { email: f.email.value.trim(), password: f.password.value }; if (f.name) body.name = f.name.value.trim();
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    api('POST', '/api/auth/' + mode, body).then(function (r) {
      buzz(20); meP = null; ordersP = null; wishSrv = null;
      var local = get(K.wish, []);
      return me(true).then(function (u) { return Promise.all(local.map(function (id) { return api('POST', '/api/account/wishlist', { product_id: id }).catch(function () {}); })).then(function () { put(K.wish, []); return u; }); });
    }).then(function (u) { closeSheet(); toast('Signed in' + (u && u.name ? ' \u00B7 ' + firstName(u.name) : '')); rerender('me'); })
      .catch(function (err) {
        btn.disabled = false; btn.textContent = mode === 'login' ? 'Sign in' : 'Create account';
        if (err.fields) Object.keys(err.fields).forEach(function (k) { var x = f.querySelector('[data-f="' + k + '"]'); if (x) { x.classList.add('bad'); x.querySelector('.err').textContent = err.fields[k]; } });
        $('#a-alert').innerHTML = '<div class="alert">' + esc(err.message) + '</div>';
      });
  });
}
/* v6: the store owner no longer signs in from the app; owner work happens in the separate Avermontis Admin app. */
function trackSheet(id) {
  var a = get(ADDR, {}) || {};
  openSheet('<span class="eyebrow">Order tracking</span><h2>Track an order</h2><form id="t-form" novalidate>' +
    '<div class="field"><label for="t-id">Order number</label><input class="inp" id="t-id" value="' + esc(id || '') + '" placeholder="AV-261026-ABC123" autocapitalize="characters"></div>' +
    '<div class="field"><label for="t-c">Phone or email used at checkout</label><input class="inp" id="t-c" value="' + esc(a.phone || '') + '"></div><div id="t-res"></div>' +
    '<button class="btn press" type="submit">Track</button></form>');
  $('#t-form').addEventListener('submit', function (e) {
    e.preventDefault(); var r = $('#t-res'); r.innerHTML = '<div class="sk" style="height:120px;margin-bottom:12px"></div>';
    api('POST', '/api/track', { order_id: $('#t-id').value.trim(), contact: $('#t-c').value.trim() }).then(function (b) { buzz(10); r.innerHTML = orderCard(b.order); })
      .catch(function (err) { r.innerHTML = '<div class="alert">' + esc(err.message) + '</div>'; });
  });
}
function addressSheet() {
  var a = get(ADDR, null);
  openSheet('<span class="eyebrow">On this phone</span><h2>Saved address</h2>' + (a ? '<div class="sumbox"><b style="color:var(--ivory)">' + esc(a.name) + '</b><p class="muted small" style="margin:6px 0 0">' + esc(a.address) + '<br>' + esc(a.city) + ', ' + esc(a.state) + ' ' + esc(a.pincode) + '<br>' + esc(a.phone) + '</p></div><p class="small muted">It fills in automatically at checkout. Change it there any time.</p>' : '<p class="muted">Your address is saved here after your first order, so checkout is faster next time.</p>'),
    a ? '<button type="button" class="btn ghost press" id="ad-del">Remove from this phone</button>' : '');
  if (a) $('#ad-del').addEventListener('click', function () { localStorage.removeItem(ADDR); closeSheet(); toast('Address removed'); rerender('me'); });
}
function reorder(id) {
  orders().then(function (os) {
    var o = os.filter(function (x) { return x.id === id; })[0] || seenOrders[id]; if (!o) return;
    var n = 0; (o.items || []).forEach(function (it) { var p = byId(it.id); if (p && p.in_stock !== false) { addToBag(it.id, it.qty, true); n++; } });
    if (n) { toast(n === 1 ? '1 product added to your bag' : n + ' products added to your bag'); go('bag'); } else toast('These products are not available right now.');
  });
}

/* ---------- ONBOARDING + SKIN PROFILE ---------- */
var SLIDES = [
  { img: '/img/campaign-tall.webp', eyebrow: 'Welcome to', h: 'Your ritual,<br><em>in your pocket.</em>', p: 'Skincare made simple: a cleanser, two serums, a moisturiser and a daily sunscreen.' },
  { img: '/img/ritual.webp', eyebrow: 'Personal', h: 'A routine built<br><em>for your skin.</em>', p: 'Tell us about your skin and we build your morning and evening ritual from our collection, step by step.' },
  { img: '/img/story.webp', eyebrow: 'Private', h: 'See your own<br><em>progress.</em>', p: 'Check off your ritual, keep a streak, and take diary photos that stay on your phone.' }
];
var QUIZ = [
  { k: 'name', t: 'text', q: 'What should we call you?', s: 'Just your first name. It stays on this phone.' },
  { k: 'skin', t: 'one', q: 'How does your skin usually feel?', s: 'By midday, most days.', o: [['normal', 'Balanced', 'Comfortable, not oily or tight'], ['dry', 'Dry', 'Feels tight or flaky'], ['oily', 'Oily', 'Shiny all over'], ['combination', 'Combination', 'Oily T-zone, drier cheeks'], ['sensitive', 'Sensitive', 'Reacts easily to new products']] },
  { k: 'concerns', t: 'many', q: 'What would you like your ritual to focus on?', s: 'Pick any that apply.', o: CONCERNS.map(function (c) { return [c.slug, c.name, c.line]; }) },
  { k: 'style', t: 'one', q: 'How much time do you have?', s: 'You can change this any time.', o: [['essential', 'Keep it quick', 'The essential steps, morning and night'], ['complete', 'The full ritual', 'Every step, morning and night']] },
  { k: 'remind', t: 'one', q: 'Want a nudge?', s: 'Morning 8:00 AM and evening 9:30 PM. Change the times in your routine.', o: [['yes', 'Yes, remind me', 'Reminders for both rituals'], ['no', 'Not now', 'I\u2019ll check in myself']] }
];
function onboarding() {
  var ob = document.createElement('div'); ob.className = 'ob'; ob.id = 'ob';
  ob.innerHTML = '<button type="button" class="skip" id="ob-skip">Skip</button><div class="slides" id="ob-slides">' + SLIDES.map(function (s, i) {
    return '<section class="slide"><img src="' + s.img + '" alt="" ' + (i ? 'loading="lazy"' : '') + '>' + (i === 0 ? '<span class="wordmark">Avermontis</span>' : '') + '<span class="eyebrow">' + s.eyebrow + (i === 0 ? ' AVERMONTIS' : '') + '</span><h1>' + s.h + '</h1><p>' + s.p + '</p></section>';
  }).join('') + '</div><div class="obfoot"><div class="dots" id="ob-dots">' + SLIDES.map(function (s, i) { return '<i class="' + (i ? '' : 'on') + '"></i>'; }).join('') + '</div><button type="button" class="btn press" id="ob-next">Continue</button></div>';
  document.body.appendChild(ob);
  var sl = $('#ob-slides'), idx = 0;
  sl.addEventListener('scroll', function () { var i = Math.round(sl.scrollLeft / sl.clientWidth); if (i !== idx) { idx = i; buzz(5); $$('#ob-dots i').forEach(function (d, k) { d.classList.toggle('on', k === i); }); $('#ob-next').textContent = i === SLIDES.length - 1 ? 'Build my ritual' : 'Continue'; } }, { passive: true });
  $('#ob-next').addEventListener('click', function () { if (idx < SLIDES.length - 1) sl.scrollTo({ left: (idx + 1) * sl.clientWidth, behavior: 'smooth' }); else startQuiz(); });
  $('#ob-skip').addEventListener('click', startQuiz);
}
function startQuiz(edit) {
  var ans = Object.assign({ concerns: [] }, profile() || {}), step = 0;
  var qz = document.createElement('div'); qz.className = 'quiz'; qz.id = 'quiz'; document.body.appendChild(qz);
  requestAnimationFrame(function () { requestAnimationFrame(function () { qz.classList.add('on'); }); });
  function paint() {
    var q = QUIZ[step], v = ans[q.k];
    qz.innerHTML = '<div class="qtop"><button type="button" class="icon press" id="q-back" aria-label="Back">' + I.backI + '</button><div class="bar"><i style="width:' + ((step + 1) / QUIZ.length * 100) + '%"></i></div><span class="small muted">' + (step + 1) + '/' + QUIZ.length + '</span></div>' +
      '<div class="qbody"><span class="eyebrow">Skin profile</span><h2>' + q.q + '</h2><p class="qs">' + q.s + '</p>' +
      (q.t === 'text' ? '<input class="inp" id="q-name" maxlength="30" autocomplete="given-name" placeholder="Your name" value="' + esc(v || '') + '">' :
        '<div class="opts">' + q.o.map(function (o, i) { var on = q.t === 'many' ? (v || []).indexOf(o[0]) >= 0 : v === o[0]; return '<button type="button" class="opt press' + (on ? ' on' : '') + '" data-v="' + o[0] + '"><span class="oi">' + (q.k === 'concerns' ? I.sparkle : q.k === 'remind' ? I.bell : q.k === 'style' ? (i ? I.moon : I.sun) : I.drop) + '</span><span><b>' + o[1] + '</b><span>' + o[2] + '</span></span><span class="ck">' + I.check + '</span></button>'; }).join('') + '</div>') +
      '</div><button type="button" class="btn press" id="q-next">' + (step === QUIZ.length - 1 ? 'Build my ritual' : q.t === 'text' && !v ? 'Skip' : 'Next') + '</button>';
    $('#q-back').addEventListener('click', function () { if (step) { step--; paint(); } else { qz.classList.remove('on'); setTimeout(function () { qz.remove(); }, 450); } });
    if (q.t === 'text') { var inp = $('#q-name'); inp.addEventListener('input', function () { ans.name = inp.value.trim(); $('#q-next').textContent = ans.name ? 'Next' : 'Skip'; }); setTimeout(function () { try { inp.focus(); } catch (e) {} }, 400); }
    $$('.opt', qz).forEach(function (b) { b.addEventListener('click', function () {
      var val = b.getAttribute('data-v'); buzz(8);
      if (q.t === 'many') { var l = ans[q.k] || []; var i = l.indexOf(val); if (i >= 0) l.splice(i, 1); else l.push(val); ans[q.k] = l; b.classList.toggle('on'); }
      else { ans[q.k] = val; $$('.opt', qz).forEach(function (x) { x.classList.toggle('on', x === b); }); setTimeout(next, 260); }
    }); });
    $('#q-next').addEventListener('click', next);
  }
  function next() {
    var q = QUIZ[step];
    if (q.t === 'one' && !ans[q.k]) { buzz([10, 30, 10]); toast('Choose one to continue'); return; }
    if (step < QUIZ.length - 1) { step++; paint(); return; }
    finish();
  }
  function finish() {
    var pr = { name: (ans.name || '').slice(0, 30), skin: ans.skin, concerns: ans.concerns || [], style: ans.style, created: (profile() || {}).created || new Date().toISOString(), updated: new Date().toISOString() };
    put(K.profile, pr); put(K.seen, 1);
    if (ans.remind === 'yes') { var r = rems(); r.on = true; put(K.rem, r); scheduleReminders(); askNotify(); }
    else if (ans.remind === 'no') { var r2 = rems(); r2.on = false; put(K.rem, r2); scheduleReminders(); }
    var b = document.createElement('div'); b.className = 'building'; b.id = 'building';
    loadCatalog().then(function () {
      var am = routineFor(pr, 'am'), pm = routineFor(pr, 'pm');
      b.innerHTML = '<div class="orb"></div><h2>Building your ritual</h2><p>From your skin profile and our collection.</p><div class="lines"><div style="animation-delay:.3s">Morning: ' + am.length + ' steps</div><div style="animation-delay:.7s">Evening: ' + pm.length + ' steps</div><div style="animation-delay:1.1s">' + (pr.concerns.length ? 'Picks for ' + pr.concerns.map(function (s) { return CONCERNS.filter(function (c) { return c.slug === s; })[0].name.toLowerCase(); }).join(', ') : 'Your daily essentials') + '</div></div>';
      document.body.appendChild(b); requestAnimationFrame(function () { b.classList.add('on'); });
      setTimeout(function () {
        var ob = $('#ob'); if (ob) { ob.classList.add('out'); setTimeout(function () { ob.remove(); }, 500); }
        qz.remove(); current = null; go('home', true); show('home'); buzz([15, 50, 25]);
        b.classList.remove('on'); setTimeout(function () { b.remove(); }, 450);
      }, edit === true ? 1200 : 2000);
    });
  }
  paint();
}

/* ---------- one tap handler for the whole app ---------- */
document.addEventListener('click', function (e) {
  var t = e.target, el;
  if ((el = t.closest('[data-wish]'))) { e.stopPropagation(); toggleWish(el.getAttribute('data-wish'), el); return; }
  if ((el = t.closest('[data-add]'))) { e.stopPropagation(); addToBag(el.getAttribute('data-add'), 1); return; }
  if ((el = t.closest('[data-addall]'))) { el.getAttribute('data-addall').split(',').forEach(function (id) { addToBag(id, 1, true); }); toast('Your ritual is in the bag'); go('bag'); return; }
  if ((el = t.closest('[data-step]')) && !t.closest('[data-prod]')) { var on = toggleStep(rWhen, el.getAttribute('data-step')); buzz(on ? [12, 30, 8] : 6); paintRoutine(); return; }
  if ((el = t.closest('[data-prod]'))) { closeSheetQuiet(); productSheet(el.getAttribute('data-prod')); return; }
  if ((el = t.closest('[data-ing]'))) { closeSheetQuiet(); ingSheet(el.getAttribute('data-ing')); return; }
  if ((el = t.closest('[data-entry]'))) { entrySheet(el.getAttribute('data-entry')); return; }
  if ((el = t.closest('[data-concern]'))) { concernSheet(el.getAttribute('data-concern')); return; }
  if ((el = t.closest('[data-cat]'))) { shopCat = el.getAttribute('data-cat'); buzz(5); $$('#s-cats .chip').forEach(function (c) { c.classList.toggle('on', c === el); }); paintShop(); return; }
  if ((el = t.closest('[data-when]'))) { rWhen = el.getAttribute('data-when'); buzz(6); var sg = $('#r-seg'); sg.setAttribute('data-v', rWhen); $$('button', sg).forEach(function (b) { b.classList.toggle('on', b === el); }); paintRoutine(); return; }
  if ((el = t.closest('[data-reorder]'))) { buzz(10); reorder(el.getAttribute('data-reorder')); return; }
  if ((el = t.closest('[data-track]'))) { trackSheet(el.getAttribute('data-track')); return; }
  if ((el = t.closest('[data-auth]'))) { authSheet(el.getAttribute('data-auth')); return; }
  if ((el = t.closest('[data-q]'))) { var c = readCart(), id = el.getAttribute('data-q'); c[id] = (parseInt(c[id], 10) || 0) + parseInt(el.getAttribute('data-d'), 10); if (c[id] <= 0) delete c[id]; buzz(6); writeCart(c); paintBag(); return; }
  if ((el = t.closest('[data-back]'))) { buzz(5); go(el.getAttribute('data-back')); return; }
  if ((el = t.closest('[data-go]'))) { buzz(5); closeSheetQuiet(); go(el.getAttribute('data-go')); return; }
  if ((el = t.closest('[data-act]'))) {
    var a = el.getAttribute('data-act'); buzz(6);
    if (a === 'bag') go('bag');
    else if (a === 'snap') $('#cam').click();
    else if (a === 'quiz') startQuiz(true);
    else if (a === 'address') addressSheet();
    else if (a === 'chat') chatOpen();
    else if (a === 'notes') notesSheet();
    else if (a === 'ar') loadCatalog().then(function () { arSheet(); });
    else if (a === 'icon') iconSheet();
    else if (a === 'logout') api('POST', '/api/auth/logout', {}).catch(function () {}).then(function () { if (NATIVE) { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} } meP = null; ordersP = null; wishSrv = null; toast('Signed out'); rerender('me'); });
  }
});
document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches && e.target.matches('.pcard')) productSheet(e.target.getAttribute('data-prod')); });
function closeSheetQuiet() { if (sheetOpen) { sheetOpen = false; $('#scrim').classList.remove('on'); $('#sheet').classList.remove('on'); if (history.state && history.state.sheet) history.replaceState(null, '', location.hash); } }


/* =====================================================================================================
   v4: live look from the owner's dashboard (colours, fonts, light/dark, home order, name, banners),
   assistant chat, notifications bell, AR (3D / in your room, glow selfie, bottle scan), Make an offer,
   app icon choice. Config comes from /api/config, is cached on the phone, and falls back to the built-in look offline.
   ===================================================================================================== */
var CFG_KEY = 'avm_app_cfg_v4', ICON_KEY = 'avm_app_icon_mine', SEEN_N = 'avm_app_seen_notes', CHAT_KEY = 'avm_app_chat_v1';
var CFG = get(CFG_KEY, null) || {}, UI = CFG.ui || {}, NOTES = [];
var NATIVE_PLUG = function () { return PLUG.AvmNative || null; };
var APP_VERSION = '6.0.0';
function hx(h) { h = String(h || ''); return /^#[0-9a-f]{6}$/i.test(h) ? h : null; }
function rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function mix(a, b, t) { var x = rgb(a), y = rgb(b); return '#' + x.map(function (v, i) { return ('0' + Math.round(v + (y[i] - v) * t).toString(16)).slice(-2); }).join(''); }
function rgbaOf(h, a) { var c = rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
var FONT_STACK = { cormorant: '"Cormorant","Cormorant Garamond",Georgia,serif', playfair: '"Playfair Display",Georgia,serif', georgia: 'Georgia,"Times New Roman",serif', system: 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif', poppins: '"Poppins",system-ui,-apple-system,Roboto,Arial,sans-serif' };
function themeVars(t) {
  if (!t) return '';
  var v = {}, pr = hx(t.primary), ac = hx(t.accent), bg = hx(t.background), tx = hx(t.text);
  var original = t.preset === 'obsidian' && t.app_mode !== 'light';
  if (!original && pr && ac && bg && tx) {
    if (t.app_mode === 'light') {
      v['--ob'] = bg; v['--ob2'] = mix(bg, pr, .035); v['--card'] = mix(bg, '#FFFFFF', .7); v['--card2'] = mix(bg, pr, .06);
      v['--line'] = rgbaOf(pr, .10); v['--line2'] = rgbaOf(pr, .2); v['--ivory'] = pr; v['--text'] = tx; v['--muted'] = mix(tx, bg, .38); v['--muted2'] = mix(tx, bg, .52);
      v['--gold'] = mix(ac, pr, .25); v['--gold2'] = ac; v['--goldd'] = mix(ac, pr, .45); v['--ok'] = '#2F6B45'; v['--err'] = '#B3261E';
    } else {
      var base = mix(pr, '#000000', .15);
      v['--ob'] = base; v['--ob2'] = mix(base, '#FFFFFF', .03); v['--card'] = mix(base, '#FFFFFF', .055); v['--card2'] = mix(base, '#FFFFFF', .09);
      v['--line'] = 'rgba(232,220,200,.10)'; v['--line2'] = 'rgba(232,220,200,.18)'; v['--gold'] = ac; v['--gold2'] = mix(ac, '#FFFFFF', .3); v['--goldd'] = mix(ac, '#000000', .25);
    }
  }
  if (t.heading_font && t.heading_font !== 'cormorant' && FONT_STACK[t.heading_font]) v['--serif'] = FONT_STACK[t.heading_font];
  if (t.body_font && t.body_font !== 'system' && FONT_STACK[t.body_font]) v['--sans'] = FONT_STACK[t.body_font];
  var keys = Object.keys(v); if (!keys.length) return '';
  return ':root{' + keys.map(function (k) { return k + ':' + v[k]; }).join(';') + '}' + (v['--ob'] ? APP_THEMED_CSS : '') + (t.app_mode === 'light' ? APP_LIGHT_CSS : '');
}
var APP_THEMED_CSS = '.today{background:radial-gradient(120% 90% at 100% 0%,color-mix(in srgb,var(--gold) 25%,transparent),transparent 55%),linear-gradient(160deg,var(--card2),var(--ob2))}.ring>div{background:var(--ob2)}' +
  '.sk{background:linear-gradient(90deg,var(--card) 0%,var(--card2) 40%,var(--card) 80%);background-size:300% 100%}.sheet,.sheet .sfoot{background:var(--ob2)}.tabbar{background:color-mix(in srgb,var(--ob) 88%,transparent)}body{background:var(--ob)}' +
  '.tile::after{background:linear-gradient(180deg,transparent 20%,color-mix(in srgb,var(--ob) 88%,transparent))}';
var APP_LIGHT_CSS = 'html.lightapp .icon{background:rgba(0,0,0,.04)}html.lightapp .tile::after{background:linear-gradient(180deg,transparent 15%,rgba(255,255,255,.92))}html.lightapp .tile img{opacity:.5}' +
  'html.lightapp .btn{color:#fff;background:linear-gradient(180deg,var(--gold2),var(--gold))}html.lightapp .sheet,html.lightapp .tabbar{background:var(--card)}html.lightapp .badge{color:#fff}';
function applyLook() {
  if (window.__avmPreview) return;      // the owner's design studio is showing a draft in this frame
  var t = UI.theme || null, server = typeof UI.app_css === 'string', css = server ? UI.app_css : themeVars(t), st = document.getElementById('avm-app-theme');
  if (!st) { st = document.createElement('style'); st.id = 'avm-app-theme'; document.head.appendChild(st); }
  st.textContent = css;
  // v5: the server sends the whole look (colours, dark/auto, fonts, cards, buttons, bottom bar, custom CSS) as one CSS string
  var light = !!(t && css && (t.app_mode === 'light' || (t.app_mode === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches)));
  if (server) { document.documentElement.classList.remove('lightapp'); document.documentElement.classList.toggle('themed', !!css); syncChrome(light); applyNav(); return; }
  document.documentElement.classList.toggle('lightapp', light); document.documentElement.classList.toggle('themed', !!css);
  syncChrome(light);
}
function syncChrome(light) {
  var ob = getComputedStyle(document.documentElement).getPropertyValue('--ob').trim() || '#0B0C0B';
  var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', ob);
  var cs = document.querySelector('meta[name=color-scheme]'); if (cs) cs.setAttribute('content', light ? 'light' : 'dark');
  if (NATIVE && PLUG.StatusBar) { try { PLUG.StatusBar.setStyle({ style: light ? 'LIGHT' : 'DARK' }); PLUG.StatusBar.setBackgroundColor({ color: ob }); } catch (e) {} }
  var name = storeName(); $$('.wordmark').forEach(function (w) { w.textContent = name; });
}
// v5: the owner picks the bottom bar items and their order (Home and Me always stay)
function applyNav() {
  var bar = $('#tabbar'); if (!bar) return;
  var want = (UI.style && Array.isArray(UI.style.bottom_nav) && UI.style.bottom_nav.length >= 3) ? UI.style.bottom_nav : null;
  $$('#tabbar button').forEach(function (b) { var id = b.getAttribute('data-go'), i = want ? want.indexOf(id) : 0; b.style.order = want && i >= 0 ? i + 1 : ''; b.hidden = !!(want && i < 0 && id !== 'home' && id !== 'me'); });
}
if (window.matchMedia) { try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { applyLook(); }); } catch (e) {} }
/* the owner's design studio shows this screen in a frame and sends draft CSS (nothing is saved here) */
if (/[?&]avm_preview=1/.test(location.search) && window.parent !== window) {
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return; var d = e.data || {};
    if (d.type !== 'avm-app-css') return;
    window.__avmPreview = true;
    var st = document.getElementById('avm-app-theme'); if (!st) { st = document.createElement('style'); st.id = 'avm-app-theme'; document.head.appendChild(st); }
    st.textContent = d.css || ''; document.documentElement.classList.remove('lightapp');
    if (d.style) { UI.style = d.style; applyNav(); }
  });
  setTimeout(function () { try { parent.postMessage({ type: 'avm-preview-ready' }, location.origin); } catch (e) {} }, 300);
}
function storeName() { return (UI.brand && UI.brand.store_name) || 'Avermontis'; }
function feat(k) { return !UI.features || UI.features[k] !== false; }
function loadConfig() {
  return api('GET', '/api/config').then(function (b) {
    var c = b.config || {}, changed = c.ui_version !== CFG.ui_version;
    CFG = c; UI = c.ui || {}; put(CFG_KEY, c);
    if (c.free_shipping_from != null) { SET.free_shipping_from = c.free_shipping_from; SET.shipping_fee = c.shipping_fee; }
    if (changed) { applyLook(); if (current === 'home') rerender('home'); if (current === 'me') rerender('me'); }
    syncIcon();
    return c;
  }, function () { return CFG; });
}
/* ---------- app icon (activity aliases in the Android app) ---------- */
var ICONS = { avr: 'AVR \u2014 green on white', avr_gold: 'AVR \u2014 gold on black', avr_green: 'AVR \u2014 white on green', classic: 'Classic gold A' };
function syncIcon() {
  var N = NATIVE_PLUG(); if (!N || !N.setIcon) return;
  var want = get(ICON_KEY, null) || (UI.brand && UI.brand.app_icon) || 'avr';
  if (!ICONS[want]) return;
  N.getIcon().then(function (r) { if (r && r.name !== want) return N.setIcon({ name: want }); }).catch(function () {});
}
function iconSheet() {
  var cur = get(ICON_KEY, null);
  openSheet('<span class="eyebrow">App icon</span><h2 style="margin:6px 0 4px">Choose your icon</h2><p class="small muted">The home-screen icon changes in a few seconds. Some phones move the icon back to the app drawer \u2014 just add it to your home screen again.</p><div class="v4-icons">' +
    Object.keys(ICONS).map(function (k) { return '<button type="button" class="v4-icon press' + ((cur || (UI.brand && UI.brand.app_icon) || 'avr') === k ? ' on' : '') + '" data-icon="' + k + '"><img src="/assets/icons4/' + k + '.png" alt=""><span>' + ICONS[k] + '</span></button>'; }).join('') + '</div>' +
    '<button type="button" class="btn ghost sm" data-icon="">Follow the store\u2019s choice</button>');
  $$('[data-icon]', $('#sheet-body')).forEach(function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-icon'); put(ICON_KEY, k || null); syncIcon(); closeSheet(); toast(k ? 'Icon changed to ' + ICONS[k] : 'Following the store\u2019s icon'); }); });
}
/* ---------- banners (owner's offers) ---------- */
function openLink(href) {
  href = String(href || ''); if (!href) return;
  var m = /^\/product\?id=([a-z0-9-]+)/i.exec(href); if (m) { loadCatalog().then(function () { productSheet(m[1]); }); return; }
  if (/^\/(shop|collections)(\/|$|\?)/.test(href)) { go('shop'); return; }
  if (/^\/ar(\?|$)/.test(href)) { arSheet(); return; }
  var url = /^\//.test(href) ? (NATIVE ? BASE + href : href) : href;
  if (NATIVE && PLUG.AppLauncher) PLUG.AppLauncher.openUrl({ url: url }).catch(function () { toast('Could not open that link.'); }); else window.open(url, '_blank', 'noopener');
}
function bannersHtml() {
  var list = (UI.banners || []).filter(function (b) { return b.title || b.image; }); if (!list.length) return '';
  return '<div class="hscroll v4-banners">' + list.map(function (b) {
    return '<button type="button" class="v4-banner press" data-link="' + esc(b.link || '') + '">' + (b.image ? '<img src="' + esc(img(b.image)) + '" alt="">' : '') + '<span class="v4-bt"><b>' + esc(b.title) + '</b>' + (b.text ? '<em>' + esc(b.text) + '</em>' : '') + (b.cta ? '<i>' + esc(b.cta) + ' \u2192</i>' : '') + '</span></button>'; }).join('') + '</div>';
}
/* ---------- notifications bell ---------- */
function bellBtn() { return feat('notifications') ? '<button type="button" class="icon press v4-bell" data-act="notes" aria-label="Notifications">' + I.bell + '<span class="badge" data-n="0"></span></button>' : ''; }
function chatBtn() { return feat('chat') ? '<button type="button" class="icon press" data-act="chat" aria-label="Ask the assistant">' + V4I.chat + '</button>' : ''; }
function loadNotes() {
  if (!feat('notifications')) return Promise.resolve([]);
  return api('GET', '/api/notifications').then(function (b) {
    NOTES = b.items || []; var seen = get(SEEN_N, null), first = seen === null; seen = seen || [];
    var fresh = NOTES.filter(function (n) { return seen.indexOf(n.id) < 0; });
    paintBell(fresh.length);
    if (first) put(SEEN_N, NOTES.map(function (n) { return n.id; }));
    else if (fresh.length && NATIVE && LN) {
      var n = fresh[0];
      try { LN.schedule({ notifications: [{ id: 900000 + (Date.now() % 90000), title: n.title, body: n.body || (fresh.length > 1 ? fresh.length + ' new updates' : ''), channelId: 'ritual', smallIcon: 'ic_stat_avermontis', extra: { go: 'home', notes: 1 } }] }).catch(function () {}); } catch (e) {}
    }
    return NOTES;
  }, function () { return NOTES; });
}
function paintBell(n) { $$('.v4-bell .badge').forEach(function (b) { b.textContent = n || ''; b.setAttribute('data-n', n || 0); }); }
function notesSheet() {
  var seen = get(SEEN_N, []) || [];
  openSheet('<span class="eyebrow">Updates</span><h2 style="margin:6px 0 12px">Notifications</h2>' + (NOTES.length ? '<div class="list">' + NOTES.map(function (n) {
    return '<button type="button" class="li press v4-note' + (seen.indexOf(n.id) < 0 ? ' new' : '') + '"' + (n.order_id ? ' data-track="' + esc(n.order_id) + '"' : n.link ? ' data-link="' + esc(n.link) + '"' : '') + '><span class="lic">' + (n.kind === 'order' ? I.truck : n.kind === 'tip' ? I.leaf : I.sparkle) + '</span><span class="lt"><b>' + esc(n.title) + '</b><span>' + esc(n.body || '') + (n.body ? ' \u00B7 ' : '') + fmtDate(n.at) + '</span></span></button>'; }).join('') + '</div>' : emptyBox(I.bell, 'Nothing yet', 'Offers from the store and updates on your orders show up here.')));
  put(SEEN_N, NOTES.map(function (n) { return n.id; }).concat(seen).slice(0, 200)); paintBell(0);
}
/* ---------- assistant chat ---------- */
var V4I = {
  chat: ic('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" stroke-width="2.4"/>'),
  send: ic('<path d="M4 12l16-8-6 16-2.5-6.5z"/>'),
  cube: ic('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
  face: ic('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1 1.2 2.1 1.8 3.5 1.8s2.5-.6 3.5-1.8M9 9.5h.01M15 9.5h.01" stroke-width="2"/>'),
  scan: ic('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="9" y="7" width="6" height="10" rx="1.5"/>'),
  tag: ic('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>'),
  wa: ic('<path d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-4A8 8 0 1 1 20 12z"/><path d="M9 9.5c.3 1.8 2.6 4.4 5 5l1-1.4-1.6-1-1 .6c-.8-.4-1.6-1.2-2-2l.6-1-1-1.6z"/>')
};
var chatSt = null;
function chatState() { if (!chatSt) { chatSt = get(CHAT_KEY, null); if (!chatSt || !(chatSt.t > Date.now() - 6 * 3600e3)) chatSt = { sid: null, lang: 'auto', msgs: [] }; } return chatSt; }
function chatSave() { var s = chatState(); s.t = Date.now(); s.msgs = s.msgs.slice(-40); put(CHAT_KEY, s); }
function chatOpen(text) {
  var C = UI.chat || {}, s = chatState(), ai = !!C.ai;
  var ov = document.getElementById('v4-chat');
  if (!ov) { ov = document.createElement('section'); ov.id = 'v4-chat'; ov.className = 'v4-chat'; ov.setAttribute('aria-label', 'Assistant'); document.getElementById('app').appendChild(ov); }
  ov.innerHTML = '<header><button type="button" class="back press" id="ch-x">' + I.backI + '</button><span class="v4-av">A</span><div><b>' + esc(C.name || 'AVERMONTIS Assistant') + '</b><span>' + (ai ? 'AI assistant \u00B7 answers from our catalogue' : 'Automatic assistant \u00B7 answers from our catalogue') + '</span></div>' +
    '<select id="ch-lang" aria-label="Language"><option value="auto">Auto</option><option value="en">English</option><option value="hinglish">Hinglish</option><option value="hi">\u0939\u093F\u0902\u0926\u0940</option></select></header>' +
    '<div class="v4-ch-body" id="ch-body" role="log" aria-live="polite"></div><div class="v4-ch-quick" id="ch-quick"></div>' +
    '<form id="ch-form" class="v4-ch-form"><input id="ch-in" class="inp" autocomplete="off" maxlength="600" placeholder="Ask about products, routine, orders\u2026" aria-label="Message"><button type="submit" class="icon press" aria-label="Send">' + V4I.send + '</button></form>' +
    '<p class="v4-ch-note">Not medical advice. Our team is on WhatsApp/email for anything else.</p>';
  ov.classList.add('on'); document.getElementById('app').classList.add('hide-tabs');
  if (!sheetOpen) history.pushState({ chat: 1 }, '', location.hash || '#home');
  var body = $('#ch-body'), quick = $('#ch-quick'), inp = $('#ch-in'), sel = $('#ch-lang'); sel.value = s.lang || 'auto';
  sel.addEventListener('change', function () { s.lang = sel.value; chatSave(); });
  function bubble(m) {
    var d = document.createElement('div'); d.className = 'v4-msg ' + (m.role === 'user' ? 'me' : 'bot');
    var h = '<p>' + esc(m.text).replace(/\n/g, '<br>') + '</p>';
    if (m.products && m.products.length) h += '<div class="v4-ch-cards">' + m.products.map(function (p) { return '<div class="v4-ch-card"><button type="button" data-prod="' + esc(p.id) + '"><img src="' + esc(img(p)) + '" alt=""><span><b>' + esc(p.name) + '</b><em>' + inr(p.price) + '</em></span></button>' + (p.in_stock === false ? '' : '<button type="button" class="btn sm" data-chadd="' + esc(p.id) + '">Add to bag</button>') + '</div>'; }).join('') + '</div>';
    var hs = [];
    if (m.handoff && m.handoff.whatsapp) hs.push('<a class="v4-chip" href="' + esc(m.handoff.whatsapp) + '">' + V4I.wa + ' WhatsApp us</a>');
    if (m.handoff && m.handoff.email) hs.push('<a class="v4-chip" href="mailto:' + esc(m.handoff.email) + '">Email ' + esc(m.handoff.email) + '</a>');
    if (m.map) hs.push('<a class="v4-chip" href="' + esc(m.map) + '">' + I.pin + ' Directions</a>');
    if (m.order) hs.push('<button type="button" class="v4-chip" data-track="' + esc(m.order) + '">' + I.truck + ' Track ' + esc(m.order) + '</button>');
    if (hs.length) h += '<div class="v4-ch-hand">' + hs.join('') + '</div>';
    d.innerHTML = h; body.appendChild(d); body.scrollTop = body.scrollHeight;
  }
  var QUICK = ['Suggest for oily skin', 'Morning routine', 'Track my order', 'Shipping & COD', 'Vitamin C serum price', 'Talk to a person'];
  function chips(l) { quick.innerHTML = (l || []).slice(0, 6).map(function (q) { return '<button type="button" class="v4-q press">' + esc(q) + '</button>'; }).join(''); }
  function render() { body.innerHTML = ''; if (!s.msgs.length) { bubble({ role: 'bot', text: C.greeting || 'Hi! I\u2019m ' + (C.name || 'the AVERMONTIS assistant') + '. Ask me about products, your routine, an order, shipping or returns \u2014 English, Hinglish ya Hindi.' }); chips(QUICK); } s.msgs.forEach(bubble); }
  function send(t) {
    t = String(t || '').trim(); if (!t) return; var um = { role: 'user', text: t }; s.msgs.push(um); bubble(um); chips([]); inp.value = ''; chatSave();
    var ty = document.createElement('div'); ty.className = 'v4-msg bot typing'; ty.innerHTML = '<p><i></i><i></i><i></i></p>'; body.appendChild(ty); body.scrollTop = body.scrollHeight;
    api('POST', '/api/chat', { message: t, session_id: s.sid, lang: s.lang === 'auto' ? undefined : s.lang, source: 'app' }).then(function (b) {
      ty.remove(); s.sid = b.session_id; var r = b.reply || {}; var om = /\b(AVM-?[A-Z0-9]{4,})\b/.exec(r.text || '');
      var bm = { role: 'bot', text: r.text, products: r.products, handoff: r.handoff, map: r.map, order: r.intent === 'order_status' && om ? om[1] : null }; s.msgs.push(bm); bubble(bm); chips(r.quick); chatSave();
    }).catch(function (err) { ty.remove(); bubble({ role: 'bot', text: err.message }); });
  }
  render();
  $('#ch-form').addEventListener('submit', function (e) { e.preventDefault(); send(inp.value); });
  quick.addEventListener('click', function (e) { var b = e.target.closest('.v4-q'); if (b) send(b.textContent); });
  body.addEventListener('click', function (e) { var a = e.target.closest('[data-chadd]'); if (a) { e.stopPropagation(); loadCatalog().then(function () { addToBag(a.getAttribute('data-chadd'), 1); }); } });
  $('#ch-x').addEventListener('click', function () { if (history.state && history.state.chat) history.back(); else chatClose(); });
  if (text) send(text);
}
function chatClose() { var ov = document.getElementById('v4-chat'); if (ov) ov.classList.remove('on'); document.getElementById('app').classList.toggle('hide-tabs', current === 'checkout' || current === 'bag'); }
window.addEventListener('popstate', function () { var ov = document.getElementById('v4-chat'); if (ov && ov.classList.contains('on') && !(history.state && history.state.chat)) chatClose(); });
/* ---------- AR ---------- */
var arP = null;
function loadAR() {
  if (window.AvmAR) return Promise.resolve(window.AvmAR);
  if (!arP) arP = new Promise(function (ok, no) {
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = NATIVE ? BASE + '/ar-files/ar.css?v=' + APP_VERSION : '/assets/ar/ar.css?v=' + APP_VERSION; document.head.appendChild(l);
    var sc = document.createElement('script'); sc.src = NATIVE ? BASE + '/ar-files/ar.js?v=' + APP_VERSION : '/assets/ar/ar.js?v=' + APP_VERSION; sc.onload = function () { if (!window.AvmAR) return no(new Error('AR could not start')); window.AvmAR.configure({ base: NATIVE ? BASE + '/ar-files/' : '/assets/ar/' }); ok(window.AvmAR); }; sc.onerror = function () { arP = null; no(new Error(navigator.onLine ? 'AR could not load. Please try again.' : 'AR needs the internet the first time.')); }; document.head.appendChild(sc);
  });
  return arP;
}
function arUrl(u) { u = String(u || ''); if (!NATIVE || !u) return u; if (u.indexOf('/assets/ar/') === 0) return BASE + '/ar-files/' + u.slice('/assets/ar/'.length); return BASE + u; }
function arProducts() { return P.map(function (p) { return { id: p.id, name: p.name, size: p.size, price: p.price, image: absUrl(img(p)), how_to_use: p.how_to_use }; }); }
function arSceneViewer(httpsUrl, intentUrl, title) {
  var N = NATIVE_PLUG();
  if (N && N.sceneViewer) { N.sceneViewer({ url: httpsUrl, title: title || '' }).catch(function (e) { toast((e && e.message) || 'View in your room needs the Google app on this phone.'); }); return; }
  window.open(intentUrl || httpsUrl, '_blank');
}
function saveSelfie(blob) {
  // the WebView cannot download files: the photo goes into the private skin diary instead
  var e = { id: 'e' + Date.now(), ts: Date.now(), date: dkey(), blob: blob, note: 'Glow selfie (fun filter)', tags: [], routine: dayDone(log()[dkey()], profile()) };
  return dbPut(e).then(function () { toast('Saved to your skin diary'); });
}
function arViewer(p) {
  loadAR().then(function (AR) {
    var ov = document.createElement('div'); ov.className = 'v4-arview' + (document.documentElement.classList.contains('lightapp') ? '' : ' avm-dark');
    ov.innerHTML = '<header><button type="button" class="back press" data-x>' + I.backI + 'Back</button><b>' + esc(p.name) + '</b></header><div class="v4-arstage"></div><p class="small muted">Drag to turn. \u201CView in your room\u201D opens Google\u2019s AR view to place it on your table at real size.</p>';
    document.getElementById('app').appendChild(ov);
    var v = AR.mountViewer($('.v4-arstage', ov), { id: p.id, name: p.name, glb: arUrl(p.ar.model), poster: arUrl(p.ar.poster || ''), arGlb: BASE ? BASE + p.ar.model : location.origin + p.ar.model, loading: 'eager', arLabel: 'View in your room',
      onSceneViewer: NATIVE ? function (u, intent) { arSceneViewer(u, intent, p.name); } : undefined });
    function close() { try { v.destroy(); } catch (e) {} ov.remove(); window.removeEventListener('popstate', onPop); }
    function onPop() { close(); }
    history.pushState({ arv: 1 }, '', location.hash || '#home'); window.addEventListener('popstate', onPop);
    $('[data-x]', ov).addEventListener('click', function () { history.back(); });
  }).catch(function (e) { toast(e.message); });
}
var arHandle = null;
function arOpen(kind) {
  loadAR().then(function (AR) {
    var dark = !document.documentElement.classList.contains('lightapp');
    document.body.classList.toggle('avm-dark', dark);
    if (kind === 'selfie') arHandle = AR.openSelfie(document.body, { caption: (UI.ar && UI.ar.caption) || 'My AVERMONTIS glow', onSave: NATIVE ? saveSelfie : undefined, onShare: NATIVE ? saveSelfie : undefined });
    else loadCatalog().then(function () { arHandle = AR.openScan(document.body, { products: arProducts(), onReorder: function (id) { addToBag(id, 1); go('bag'); } }); });
  }).catch(function (e) { toast(e.message); });
}
function arOf(p) { return p && p.ar && p.ar.on !== false && p.ar.model ? p.ar : null; }
function arSheet(pid) {
  if (!feat('ar')) return;
  var A = UI.ar || {}, list = P.filter(arOf);
  openSheet('<span class="eyebrow">AR &amp; 3D</span><h2 style="margin:6px 0 4px">Try ' + esc(storeName()) + ' around you</h2><p class="small muted" style="margin:0 0 14px">Real AR uses your camera; nothing is recorded or uploaded.</p><div class="list">' +
    (A.viewer !== false && list.length ? '<button type="button" class="li press" data-ar="viewer"><span class="lic">' + V4I.cube + '</span><span class="lt"><b>View in 3D &amp; in your room</b><span>Spin the bottle, then place it on your table (real AR)</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</button>' : '') +
    (A.selfie !== false ? '<button type="button" class="li press" data-ar="selfie"><span class="lic">' + V4I.face + '</span><span class="lt"><b>Glow selfie</b><span>A fun face-tracking frame \u2014 just for fun, it does not analyse your skin</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</button>' : '') +
    (A.scan !== false ? '<button type="button" class="li press" data-ar="scan"><span class="lic">' + V4I.scan + '</span><span class="lt"><b>Scan your bottle</b><span>Point at the label: how to use + one-tap reorder (real AR)</span></span>' + I.chev.replace('<svg', '<svg class="chev"') + '</button>' : '') + '</div>' +
    (list.length ? '<div id="ar-pick" class="hidden"><div class="sec" style="margin-top:18px"><h2>Pick a product</h2></div><div class="hscroll">' + list.map(function (p) { return '<button type="button" class="v4-arp press" data-arp="' + esc(p.id) + '"><img src="' + esc(img(p.ar.poster || p)) + '" alt=""><b>' + esc(p.name) + '</b></button>'; }).join('') + '</div></div>' : ''));
  var sb = $('#sheet-body');
  function viewer(id) { var p = byId(id); if (!p) return; closeSheetQuiet(); arViewer(p); }
  $$('[data-ar]', sb).forEach(function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-ar');
    if (k === 'viewer') { if (list.length === 1) viewer(list[0].id); else $('#ar-pick').classList.remove('hidden'); return; }
    closeSheetQuiet(); arOpen(k); }); });
  $$('[data-arp]', sb).forEach(function (b) { b.addEventListener('click', function () { viewer(b.getAttribute('data-arp')); }); });
  if (pid) viewer(pid);
}
function arHomeHtml() {
  if (!feat('ar')) return ''; var A = UI.ar || {};
  return '<div class="sec"><h2>Try it in AR</h2><button type="button" class="link" data-act="ar">All</button></div><div class="v4-artiles">' +
    (A.viewer !== false ? '<button type="button" class="v4-art press" data-act="ar">' + V4I.cube + '<b>In your room</b><span>3D + AR</span></button>' : '') +
    (A.selfie !== false ? '<button type="button" class="v4-art press" data-arq="selfie">' + V4I.face + '<b>Glow selfie</b><span>Just for fun</span></button>' : '') +
    (A.scan !== false ? '<button type="button" class="v4-art press" data-arq="scan">' + V4I.scan + '<b>Scan bottle</b><span>How to use</span></button>' : '') + '</div>';
}
/* ---------- Make an offer (bargaining) ---------- */
function canBargain(p) { return feat('bargain') && UI.bargain && UI.bargain.on && p && p.bargain_on !== false && p.in_stock !== false; }
function offerSheet(id) {
  var p = byId(id); if (!p) return;
  me().then(function (u) {
    if (!u) { toast('Sign in to make an offer \u2014 your deal is saved to your account.'); authSheet('login'); return; }
    var st = { id: null, done: false };
    openSheet('<span class="eyebrow">Make an offer</span><h2 style="margin:6px 0 2px">' + esc(p.name) + '</h2><p class="small muted" style="margin:0 0 10px">Listed at ' + inr(p.price) + '. Name your price \u2014 if we agree you get a one-time coupon for this product.</p><div class="v4-ch-body v4-offer" id="of-body"></div>',
      '<form id="of-form" class="v4-ch-form" style="width:100%"><input id="of-in" class="inp" inputmode="numeric" maxlength="60" placeholder="Your price, e.g. 499" aria-label="Your offer"><button type="submit" class="icon press" aria-label="Send">' + V4I.send + '</button></form>');
    var body = $('#of-body');
    function line(by, text) { var d = document.createElement('div'); d.className = 'v4-msg ' + (by === 'user' ? 'me' : 'bot'); d.innerHTML = '<p>' + esc(text) + '</p>'; body.appendChild(d); body.scrollTop = body.scrollHeight; }
    function dealBox(c) { var d = document.createElement('div'); d.className = 'v4-deal'; d.innerHTML = '<span class="eyebrow">Your deal</span><b>' + inr(c.price) + '</b><code>' + esc(c.code) + '</code><small>One-time coupon for your account and this product. Valid till ' + new Date(c.expires_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + '.</small><button type="button" class="btn sm" id="of-use">Add to bag with this deal</button>'; body.appendChild(d); body.scrollTop = body.scrollHeight;
      $('#of-use').addEventListener('click', function () { localStorage.setItem(COUPON, c.code); addToBag(p.id, 1, true); closeSheet(); go('bag'); toast('Deal applied in your bag'); }); }
    function call(payload) {
      return api('POST', '/api/bargain', payload).then(function (b) { st.id = b.bargain.id; if (b.message) line('bot', b.message); if (b.bargain.coupon && b.bargain.coupon.code) { dealBox({ code: b.bargain.coupon.code, price: b.bargain.coupon.price || b.bargain.agreed_price, expires_at: b.bargain.coupon.expires_at }); st.done = true; } else if (b.done) st.done = true;
        if (st.done) $('#of-form').classList.add('hidden');
        var oa = $('.v4-accept', body); if (oa) oa.remove();
        if (!st.done && b.bargain.status === 'open' && b.bargain.counter) { var ac = document.createElement('button'); ac.type = 'button'; ac.className = 'v4-q press v4-accept'; ac.style.alignSelf = 'flex-start'; ac.textContent = 'Accept ' + inr(b.bargain.counter); body.appendChild(ac); body.scrollTop = body.scrollHeight;
          ac.addEventListener('click', function () { ac.remove(); line('user', 'Deal at ' + inr(b.bargain.counter)); call({ bargain_id: st.id, product_id: p.id, offer: b.bargain.counter }); }); }
      }).catch(function (e) { line('bot', e.message); });
    }
    call({ product_id: p.id, lang: 'en' });
    $('#of-form').addEventListener('submit', function (e) { e.preventDefault(); var v = $('#of-in').value.trim(); if (!v || st.done) return; line('user', /^\d+$/.test(v) ? inr(+v) : v); $('#of-in').value = ''; call({ bargain_id: st.id, product_id: p.id, message: v }); });
  });
}
function productExtras(p) {
  var h = '';
  if (feat('ar') && (!UI.ar || UI.ar.viewer !== false) && arOf(p)) h += '<button type="button" class="btn ghost sm press" data-arv="' + esc(p.id) + '">' + V4I.cube + ' View in 3D / your room</button>';
  if (canBargain(p)) h += '<button type="button" class="btn ghost sm press" data-offer="' + esc(p.id) + '">' + V4I.tag + ' Make an offer</button>';
  return h ? '<div class="v4-pextra">' + h + '</div>' : '';
}
document.addEventListener('click', function (e) {
  var t = e.target, el;
  if (!t || !t.closest) return;
  if ((el = t.closest('[data-link]'))) { e.preventDefault(); closeSheetQuiet(); openLink(el.getAttribute('data-link')); return; }
  if ((el = t.closest('[data-arv]'))) { var pv = byId(el.getAttribute('data-arv')); if (pv) { closeSheetQuiet(); arViewer(pv); } return; }
  if ((el = t.closest('[data-offer]'))) { offerSheet(el.getAttribute('data-offer')); return; }
  if ((el = t.closest('[data-arq]'))) { arOpen(el.getAttribute('data-arq')); return; }
}, true);

/* ---------- native shell: back button, status bar, splash, outside links, notification taps ---------- */
function nativeBoot() {
  document.documentElement.classList.add('native');
  var App = PLUG.App, SB = PLUG.StatusBar, SS = PLUG.SplashScreen, AL = PLUG.AppLauncher;
  try { if (SB) { SB.setStyle({ style: 'DARK' }); SB.setBackgroundColor({ color: '#0B0C0B' }); } } catch (e) {}
  applyLook();
  setTimeout(function () { try { if (SS) SS.hide({ fadeOutDuration: 250 }); } catch (e) {} }, 350);
  // Android back: close an open sheet first, then go back through the app's screens, then leave the app from Home
  if (App) App.addListener('backButton', function (ev) {
    if (sheetOpen) { closeSheet(); return; }
    var cov = document.getElementById('v4-chat'); if (cov && cov.classList.contains('on')) { if (history.state && history.state.chat) history.back(); else chatClose(); return; }
    if (arHandle && arHandle.element && document.body.contains(arHandle.element)) { try { arHandle.close(); } catch (e) {} arHandle = null; return; }
    if (document.querySelector('.v4-arview')) { history.back(); return; }
    var qb = document.getElementById('quiz') && document.getElementById('q-back'); if (qb) { qb.click(); return; }   // skin-profile quiz: one question back
    if (current !== 'home') { if (ev && ev.canGoBack) history.back(); else go('home', true); return; }
    App.exitApp();
  });
  if (App) App.addListener('appStateChange', function (s) { if (s && s.isActive) { scheduleReminders(); loadConfig(); loadNotes(); if (current === 'home') paintHome(); if (current === 'routine') paintRoutine(); } });
  // policies, invoices, mail and the website open outside the app (browser / mail app); app screens (#...) stay inside
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a[href]') : null; if (!el) return;
    var href = el.getAttribute('href') || ''; if (!href || href.charAt(0) === '#') return;
    var url = /^\//.test(href) ? BASE + href : href;
    if (/^(https?:|mailto:|tel:)/i.test(url)) { e.preventDefault(); if (AL) AL.openUrl({ url: url }).catch(function () { toast('Could not open that link.'); }); else window.open(url, '_blank'); }
  }, true);
  if (LN) {
    try { LN.createChannel({ id: 'ritual', name: 'Ritual reminders', description: 'Morning and evening skincare ritual reminders', importance: 4, visibility: 1, lights: true, lightColor: '#C9A96E', vibration: true }).catch(function () {}); } catch (e) {}
    LN.addListener('localNotificationActionPerformed', function (a) { var x = a && a.notification && a.notification.extra || {}; go(x.go || 'routine'); if (x.notes) loadNotes().then(notesSheet); });
  }
}

/* ---------- boot ---------- */
function boot() {
  wireSheetDrag();
  $('#cam').addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (!f) return; shrink(f).then(newEntrySheet).catch(function (err) { toast(err.message); }); });
  $$('#tabbar button').forEach(function (b) { b.addEventListener('click', function () { if (current === b.getAttribute('data-go')) { var v = $('#v-' + current); v.scrollTo({ top: 0, behavior: 'smooth' }); } }); });
  var orig = show; show = function (n) { orig(n); leaveBag(); if (n === 'bag') { /* paybar added by paintBag */ } };
  applyLook(); loadCatalog(); me(); scheduleReminders(); loadConfig();
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { scheduleReminders(); loadConfig(); loadNotes(); if (current === 'home') paintHome(); if (current === 'routine') paintRoutine(); } });
  window.addEventListener('storage', function (e) { if (e.key === CART) paintBadges(); });
  var start = (location.hash || '#home').slice(1).split('/')[0];
  var deep = new URLSearchParams(location.search).get('product');
  if (!PREVIEW && (!get(K.seen, 0) || !profile())) { onboarding(); show('home'); }
  else { show(VIEWS.indexOf(start) >= 0 ? start : 'home'); }
  if (deep) loadCatalog().then(function () { productSheet(deep); });
  if (NATIVE) nativeBoot();
  else if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {}); });
}
window.AVERMONTIS_APP = { loadCatalog: loadCatalog, dayDone: dayDone, routineFor: routineFor, picksFor: picksFor, streak: streak, tipFor: tipFor, CONCERNS: CONCERNS, INGREDIENTS: INGREDIENTS };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
