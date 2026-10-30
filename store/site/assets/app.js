/* Avermontis store script (no framework). Products come from the store database (/api/catalog);
   products.js is only the offline fallback. Prices and totals shown here are previews — the server re-checks everything. */
(function(){
'use strict';
var FALLBACK = (window.AVERMONTIS_PRODUCTS || []);
var SET = window.AVERMONTIS_SETTINGS || {free_shipping_from:499, shipping_fee:49, max_qty_per_item:10, order_email:'avermontis@mail.tab.bot'};
var P = [];
var KEY = 'avermontis_cart_v1', ORDER_KEY = 'avermontis_last_order', COUPON_KEY = 'avermontis_coupon';
var SUPPORT = 'avermontis@mail.tab.bot';
var $ = function(s, r){ return (r||document).querySelector(s); };
var $$ = function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function inr(n){ return '\u20B9' + Number(n || 0).toLocaleString('en-IN'); }
function img(src){ src = String(src || 'img/hero.webp'); return /^(https?:)?\//.test(src) ? src : '/' + src; }
function byId(id){ for (var i=0;i<P.length;i++){ if (P[i].id === id) return P[i]; } return null; }
function maxQ(){ return SET.max_qty_per_item || 10; }
function qs(k){ return new URLSearchParams(location.search).get(k); }
function off(p){ return p.mrp && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0; }

/* ---------- API (same JSON error format everywhere) ---------- */
function api(method, path, body){
  var opt = {method: method, headers: {}, credentials: 'same-origin'};
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  var ctrl = window.AbortController ? new AbortController() : null; if (ctrl) { opt.signal = ctrl.signal; setTimeout(function(){ ctrl.abort(); }, 20000); }
  return fetch(path, opt).then(function(r){
    return r.json().catch(function(){ return {ok:false, error:{code:'bad_response', message:'Unexpected answer from the server. Please try again.'}}; }).then(function(b){
      if (!r.ok || !b || b.ok === false) { var e = new Error((b && b.error && b.error.message) || 'Something went wrong. Please try again.'); e.status = r.status; e.code = b && b.error && b.error.code; e.fields = b && b.error && b.error.fields; throw e; }
      return b;
    });
  }, function(){ var e = new Error(navigator.onLine ? 'Could not reach the store. Please check your connection and try again.' : 'You are offline. Connect to the internet and try again.'); e.code = 'network'; throw e; });
}
var catalogPromise = null;
function loadCatalog(){
  if (!catalogPromise) catalogPromise = api('GET', '/api/catalog').then(function(b){
    P = b.products; if (b.settings) { SET.free_shipping_from = b.settings.free_shipping_from; SET.shipping_fee = b.settings.shipping_fee; SET.max_qty_per_item = b.settings.max_qty_per_item; }
    return P;
  }).catch(function(){
    P = FALLBACK.filter(function(p){ return p.active !== false; }).map(function(p){ return Object.assign({in_stock:true, images:[p.image], rating:{count:0, avg:null}}, p); });
    return P;
  });
  return catalogPromise;
}
var mePromise = null;
function me(){ if (!mePromise) mePromise = api('GET','/api/auth/me').then(function(b){ return b.user; }, function(){ return null; }); return mePromise; }
var wishPromise = null;
function wishlist(){ if (!wishPromise) wishPromise = me().then(function(u){ return u ? api('GET','/api/account/wishlist').then(function(b){ return b.items; }, function(){ return []; }) : []; }); return wishPromise; }
function fmtIST(iso){ try { return new Date(iso).toLocaleString('en-IN', {timeZone:'Asia/Kolkata', day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit'}) + ' IST'; } catch(e){ return iso; } }
function fmtDate(iso){ try { return new Date(iso).toLocaleDateString('en-IN', {timeZone:'Asia/Kolkata', day:'numeric', month:'short', year:'numeric'}); } catch(e){ return iso; } }

/* ---------- cart (stores only product id + quantity; prices always come from the store) ---------- */
function readCart(){ try { var c = JSON.parse(localStorage.getItem(KEY) || '{}'); return (c && typeof c === 'object' && !Array.isArray(c)) ? c : {}; } catch(e){ return {}; } }
function cleanCart(c){
  var out = {};
  Object.keys(c).forEach(function(id){ var q = parseInt(c[id], 10); var p = byId(id); if ((p || !P.length) && q > 0) out[id] = Math.min(q, maxQ()); });
  return out;
}
function saveCart(c){ try { localStorage.setItem(KEY, JSON.stringify(cleanCart(c))); } catch(e){ toast('Could not save your cart on this device (storage is blocked).'); } updateCount(); }
function cartLines(){
  var c = cleanCart(readCart());
  return Object.keys(c).map(function(id){ var p = byId(id); return p ? {p:p, qty:c[id], total:p.price*c[id]} : null; }).filter(Boolean);
}
function totals(lines, discount){
  var sub = lines.reduce(function(s,l){ return s + l.total; }, 0);
  var count = lines.reduce(function(s,l){ return s + l.qty; }, 0);
  var d = discount || 0, net = sub - d;
  var ship = (sub === 0 || net >= SET.free_shipping_from) ? 0 : SET.shipping_fee;
  return {subtotal:sub, discount:d, shipping:ship, total:net+ship, count:count};
}
function addToCart(id, qty){
  var p = byId(id); if (!p) { toast('Sorry, this product is not available right now.'); return false; }
  if (!p.in_stock) { toast(p.name + ' is out of stock.'); return false; }
  var c = readCart(); var cur = parseInt(c[id],10) || 0;
  var lim = Math.min(maxQ(), p.stock != null ? p.stock : maxQ());
  var next = Math.min(cur + (qty||1), lim);
  c[id] = next; saveCart(c);
  toast(cur + (qty||1) > lim ? 'Max ' + lim + ' for this product. Cart updated.' : p.name + ' added to your bag');
  bumpCart();
  return true;
}
function updateCount(){
  var n = 0, c = readCart(); Object.keys(c).forEach(function(k){ n += parseInt(c[k],10) || 0; });
  if (P.length) n = totals(cartLines()).count;
  $$('.cart-count').forEach(function(el){ el.textContent = n; el.classList.toggle('zero', !n); });
}
function bumpCart(){ $$('.cart-link').forEach(function(a){ a.classList.remove('bump'); void a.offsetWidth; a.classList.add('bump'); }); }
window.addEventListener('storage', function(e){ if (e.key === KEY) { updateCount(); if ($('#cart-root')) renderCart(); } });

/* ---------- UI helpers ---------- */
var toastTimer;
function toast(msg){ var t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2600); }
function offline(){
  var b = $('#offline'); if (!b) return;
  function u(){ b.classList.toggle('show', !navigator.onLine); }
  u(); window.addEventListener('online', u); window.addEventListener('offline', u);
}
function stars(avg, size){
  var out = '<span class="stars" aria-label="' + (avg ? avg + ' out of 5 stars' : 'No ratings yet') + '"' + (size ? ' style="font-size:' + size + '"' : '') + '>';
  for (var i = 1; i <= 5; i++) out += '<span class="' + (avg && avg >= i - 0.25 ? 'on' : '') + '">\u2605</span>';
  return out + '</span>';
}
function stateBox(title, text, btn){ return '<div class="state"><h2>' + title + '</h2>' + (text ? '<p class="muted">' + text + '</p>' : '') + (btn || '') + '</div>'; }
function errorBox(el, msg, retry){
  el.innerHTML = stateBox('Something went wrong', esc(msg || 'Could not load this. Please check your connection.'), '<button class="btn" type="button" data-retry>Try again</button>');
  var b = $('[data-retry]', el); if (b) b.addEventListener('click', retry || function(){ location.reload(); });
}
var HEART = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.1 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.6 0 5.7 3.6 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="currentColor"/></svg>';
function card(p){
  var o = off(p);
  var badge = !p.in_stock ? '<span class="badge sold">Out of stock</span>' : (p.stock != null && p.stock <= 5 ? '<span class="badge low">Only ' + p.stock + ' left</span>' : '');
  // a Bestseller/New label shows only when the product data itself carries one (none do today)
  if (!badge && /^(Bestseller|New)$/.test(p.label || '')) badge = '<span class="badge tag">' + esc(p.label) + '</span>';
  var r = p.rating && p.rating.count ? '<div class="rating">' + stars(p.rating.avg) + '<span class="muted small">(' + p.rating.count + ')</span></div>' : '';
  return '<article class="card"><a class="thumb" href="/product?id=' + encodeURIComponent(p.id) + '">' + badge + '<img src="' + esc(img(p.image)) + '" alt="' + esc(p.name) + ' ' + esc(p.size || '') + '" loading="lazy" width="600" height="600"></a>' +
    '<button class="wish" type="button" data-wish="' + esc(p.id) + '" aria-label="Save ' + esc(p.name) + ' to wishlist" aria-pressed="false">' + HEART + '</button>' +
    '<div class="body"><span class="cat">' + esc(p.category) + '</span><h3><a href="/product?id=' + encodeURIComponent(p.id) + '">' + esc(p.name) + '</a></h3>' + r +
    (p.short ? '<p class="short">' + esc(p.short) + '</p>' : '') + '<p class="price">' + inr(p.price) + (p.size ? '<span class="size">' + esc(p.size) + '</span>' : '') + '</p>' +
    '<div class="card-actions">' + (p.in_stock ? '<button class="btn sm" type="button" data-add="' + esc(p.id) + '">Add to Bag</button>' : '<button class="btn sm" type="button" disabled>Out of stock</button>') + '<a class="btn sm ghost" href="/product?id=' + encodeURIComponent(p.id) + '" aria-label="View ' + esc(p.name) + '">View</a></div></div></article>';
}
function skeletons(n){ var s = ''; for (var i=0;i<n;i++) s += '<div class="skeleton card-sk"></div>'; return s; }
document.addEventListener('click', function(e){
  var a = e.target.closest && e.target.closest('[data-add]');
  if (a) { e.preventDefault(); addToCart(a.getAttribute('data-add'), 1); return; }
  var w = e.target.closest && e.target.closest('[data-wish]');
  if (w) { e.preventDefault(); toggleWish(w); }
});
function paintWish(){
  wishlist().then(function(ids){ $$('[data-wish]').forEach(function(b){ var on = ids.indexOf(b.getAttribute('data-wish')) >= 0; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); });
}
function toggleWish(btn){
  var id = btn.getAttribute('data-wish');
  me().then(function(u){
    if (!u) { toast('Sign in to save products to your wishlist'); setTimeout(function(){ location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); }, 900); return; }
    var on = btn.classList.contains('on'); btn.disabled = true;
    (on ? api('DELETE', '/api/account/wishlist/' + encodeURIComponent(id)) : api('POST', '/api/account/wishlist', {product_id: id})).then(function(){
      wishPromise = null; $$('[data-wish="' + id + '"]').forEach(function(b){ b.classList.toggle('on', !on); b.setAttribute('aria-pressed', !on); });
      toast(on ? 'Removed from wishlist' : 'Saved to your wishlist');
      if ($('#wish-root') && on) renderAccountWishlist();
    }).catch(function(err){ toast(err.message); }).then(function(){ btn.disabled = false; });
  });
}

/* ---------- header, search, account link, announcement, cookie notice, WhatsApp (only when the owner sets a number) ---------- */
function header(){
  var mb = $('.menu-btn'), drawer = $('#drawer');
  function setOpen(o){ document.body.classList.toggle('drawer-open', o); if (mb) mb.setAttribute('aria-expanded', o); if (o) { var f = $('a', drawer); if (f) f.focus(); } }
  if (mb && drawer) { mb.addEventListener('click', function(){ setOpen(!document.body.classList.contains('drawer-open')); }); $$('[data-close-drawer]').forEach(function(b){ b.addEventListener('click', function(){ setOpen(false); }); }); }
  var sb = $('.search-btn'), so = $('#search-overlay');
  if (sb && so) {
    sb.addEventListener('click', function(){ so.classList.add('open'); var i = $('input', so); setTimeout(function(){ i.focus(); }, 50); });
    $$('[data-close-search]').forEach(function(b){ b.addEventListener('click', function(){ so.classList.remove('open'); }); });
  }
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') { setOpen(false); if (so) so.classList.remove('open'); } });
  var hdr = $('.site-header'); if (hdr) { var onS = function(){ hdr.classList.toggle('scrolled', window.scrollY > 8); }; onS(); window.addEventListener('scroll', onS, {passive:true}); }
  me().then(function(u){
    $$('.acct-link').forEach(function(a){ if (u) { a.href = '/account'; a.setAttribute('aria-label', 'My account'); var l = $('.acct-label', a); if (l) l.textContent = u.name.split(' ')[0]; } });
    $$('[data-signed-in]').forEach(function(el){ el.classList.toggle('hidden', !u); });
    $$('[data-signed-out]').forEach(function(el){ el.classList.toggle('hidden', !!u); });
  });
  var path = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  $$('.menu a, .drawer-nav a').forEach(function(a){ var h = a.getAttribute('href'); if (h === path || (path === '/' && h === '/')) a.setAttribute('aria-current', 'page'); });
}
function config(){
  api('GET', '/api/config').then(function(b){
    var c = b.config; SUPPORT = c.support_email || SUPPORT;
    var ab = $('#announce-text'); if (ab && c.announcement && !(c.ui && c.ui.style && c.ui.style.announce_text)) ab.textContent = c.announcement;
    if (c.whatsapp_number && /^\d{10,13}$/.test(c.whatsapp_number)) {
      var a = document.createElement('a'); a.className = 'wa-float'; a.href = 'https://wa.me/' + c.whatsapp_number + '?text=' + encodeURIComponent('Hi Avermontis, I have a question'); a.target = '_blank'; a.rel = 'noopener';
      a.setAttribute('aria-label', 'Chat with us on WhatsApp'); a.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.3z"/></svg>';
      document.body.appendChild(a);
    }
  }).catch(function(){});
}
function cookieNotice(){
  var k = 'avermontis_cookie_ok'; try { if (localStorage.getItem(k)) return; } catch(e){ return; }
  try { if (window.top !== window.self) return; } catch(e){ return; }   // not inside the owner dashboard's live preview
  var d = document.createElement('div'); d.className = 'cookie'; d.setAttribute('role', 'region'); d.setAttribute('aria-label', 'Cookie notice');
  d.innerHTML = '<p>We use only essential cookies and your browser storage to keep you signed in and remember your cart. No ads or tracking. <a href="/privacy">Privacy policy</a></p><button class="btn sm" type="button">OK</button>';
  document.body.appendChild(d);
  $('button', d).addEventListener('click', function(){ try { localStorage.setItem(k, '1'); } catch(e){} d.remove(); });
}

/* ---------- generic form wiring: inline errors, busy button, server field errors ---------- */
function setErr(form, name, msg){
  var f = form.elements[name]; if (!f) return; var w = f.closest('.field'); var er = $('#' + form.id + '-err-' + name) || (w && $('.err', w));
  if (w) w.classList.toggle('invalid', !!msg); if (er) er.textContent = msg || ''; f.setAttribute('aria-invalid', msg ? 'true' : 'false');
}
function wireForm(form, rules, send, onOk){
  var btn = $('button[type=submit]', form), label = btn.innerHTML, busy = false;
  var al = $('.form-alert', form);
  function check(k){ var f = form.elements[k]; var m = rules[k](f.type === 'checkbox' ? f.checked : f.value.trim()); setErr(form, k, m); return !m; }
  Object.keys(rules).forEach(function(k){ var f = form.elements[k]; if (!f) return;
    f.addEventListener('blur', function(){ if (f.value) check(k); });
    f.addEventListener('input', function(){ var w = f.closest('.field'); if (w && w.classList.contains('invalid')) check(k); }); });
  var sp = $('[data-showpw]', form); if (sp) sp.addEventListener('change', function(){ $$('input[data-pw]', form).forEach(function(i){ i.type = sp.checked ? 'text' : 'password'; }); });
  form.addEventListener('submit', function(e){
    e.preventDefault(); if (busy) return;
    if (al) { al.className = 'form-alert hidden'; al.textContent = ''; }
    var bad = Object.keys(rules).filter(function(k){ return !check(k); });
    if (bad.length) { form.elements[bad[0]].focus(); return; }
    if (!navigator.onLine) { if (al) { al.className = 'form-alert alert error'; al.textContent = 'You are offline. Connect to the internet and try again.'; } return; }
    busy = true; btn.disabled = true; btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Please wait\u2026';
    send().then(function(r){ busy = false; btn.disabled = false; btn.innerHTML = label; onOk(r); }).catch(function(err){
      busy = false; btn.disabled = false; btn.innerHTML = label;
      if (err.fields) Object.keys(err.fields).forEach(function(k){ setErr(form, k, err.fields[k]); });
      if (al) { al.className = 'form-alert alert error'; al.textContent = err.message; }
    });
  });
}
var R = {
  email: function(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'Enter a valid email address.'; },
  name: function(v){ return v.length < 2 ? 'Please enter your name.' : (v.length > 60 ? 'Name is too long.' : ''); },
  password: function(v){ return v.length < 8 ? 'At least 8 characters.' : (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v) ? 'Use at least one letter and one number.' : ''); },
  required: function(v){ return v ? '' : 'This field is required.'; }
};
function newsletterForms(){
  $$('form[data-newsletter]').forEach(function(form){
    wireForm(form, {email: R.email}, function(){ return api('POST', '/api/newsletter', {email: form.elements.email.value.trim(), source: form.getAttribute('data-newsletter')}); },
      function(r){ form.innerHTML = '<p class="ok-msg">\u2713 ' + esc(r.message) + '</p>'; });
  });
}

/* ---------- home + shop ---------- */
function renderFeatured(){
  var el = $('#featured'); if (!el) return;
  loadCatalog().then(function(){
    var list = P.slice(0, 4);
    el.innerHTML = list.length ? list.map(card).join('') : stateBox('Products coming soon', 'Please check back shortly.');
    paintWish();
  });
}
function renderShop(){
  var root = $('#shop-grid'); if (!root) return;
  var q = $('#q'), sort = $('#sort'), chips = $('#chips'), count = $('#count');
  var state = {cat: qs('cat') || 'All', q: qs('q') || '', sort: qs('sort') || 'featured'};
  if (q) q.value = state.q; if (sort) sort.value = state.sort;
  root.innerHTML = skeletons(6);
  loadCatalog().then(function(){
    if (!P.length) { root.innerHTML = stateBox('No products yet', 'Please check back soon.'); return; }
    var cats = ['All'].concat(P.map(function(p){ return p.category; }).filter(function(c, i, a){ return a.indexOf(c) === i; }));
    function draw(){
      chips.innerHTML = cats.map(function(c){ return '<button type="button" class="chip' + (c === state.cat ? ' on' : '') + '" data-cat="' + esc(c) + '" aria-pressed="' + (c === state.cat) + '">' + esc(c) + '</button>'; }).join('');
      var term = state.q.toLowerCase();
      var list = P.filter(function(p){
        if (state.cat !== 'All' && p.category !== state.cat) return false;
        if (!term) return true;
        return (p.name + ' ' + (p.ingredients || []).join(' ') + ' ' + p.category + ' ' + (p.short || '')).toLowerCase().indexOf(term) >= 0;
      });
      if (state.sort === 'price-asc') list.sort(function(a,b){ return a.price - b.price; });
      if (state.sort === 'price-desc') list.sort(function(a,b){ return b.price - a.price; });
      if (state.sort === 'name') list.sort(function(a,b){ return a.name.localeCompare(b.name); });
      count.textContent = list.length + ' product' + (list.length === 1 ? '' : 's');
      root.innerHTML = list.length ? list.map(card).join('') : stateBox('No products match', 'Try a different word or clear the filters.', '<button class="btn ghost" type="button" id="clear-f">Clear filters</button>');
      var cf = $('#clear-f'); if (cf) cf.addEventListener('click', function(){ state = {cat:'All', q:'', sort:'featured'}; q.value = ''; sort.value = 'featured'; draw(); });
      paintWish();
      var u = new URL(location.href); ['cat','q','sort'].forEach(function(k){ var v = state[k]; if (v && v !== 'All' && v !== 'featured') u.searchParams.set(k, v); else u.searchParams.delete(k); }); history.replaceState(null, '', u);
    }
    chips.addEventListener('click', function(e){ var b = e.target.closest('[data-cat]'); if (b) { state.cat = b.getAttribute('data-cat'); draw(); } });
    var t; q.addEventListener('input', function(){ clearTimeout(t); t = setTimeout(function(){ state.q = q.value.trim(); draw(); }, 150); });
    sort.addEventListener('change', function(){ state.sort = sort.value; draw(); });
    $('#shop-form').addEventListener('submit', function(e){ e.preventDefault(); state.q = q.value.trim(); draw(); });
    draw();
  });
}

/* ---------- product page ---------- */
var GENERAL_FAQ = [
  {q:'Is Cash on Delivery available?', a:'Yes. Pay in cash when your order arrives. Shipping is free on orders above \u20B9499.'},
  {q:'How long does delivery take?', a:'Orders are usually delivered in 4\u20138 working days across India. You can follow your order on the Track order page.'},
  {q:'Can I return it?', a:'Unopened products can be returned within 7 days of delivery. Damaged or wrong items are replaced or refunded \u2014 see our Returns policy.'},
  {q:'Should I patch test?', a:'Yes. Apply a little on your inner arm and wait 24 hours before first use, especially if your skin is sensitive. Stop use if irritation occurs.'}
];
function acc(title, body, open){ return '<details class="acc"' + (open ? ' open' : '') + '><summary>' + title + '<span class="pm" aria-hidden="true"></span></summary><div class="acc-body">' + body + '</div></details>'; }
function renderProduct(){
  var root = $('#product-root'); if (!root) return;
  var id = qs('id');
  loadCatalog().then(function(){
    var p = byId(id);
    if (!p) { root.innerHTML = stateBox('Product not found', 'This product may have been removed or the link is wrong.', '<a class="btn" href="/shop">Browse all products</a>'); return; }
    var o = off(p), imgs = (p.images && p.images.length ? p.images : [p.image]);
    var faqs = (p.faqs || []).concat(GENERAL_FAQ);
    var lim = Math.min(maxQ(), p.stock != null ? p.stock : maxQ());
    root.innerHTML = '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/shop">Shop</a> / <a href="' + esc(catHref(p.category)) + '">' + esc(p.category) + '</a></nav>' +
      '<div class="pd"><div class="gallery"><div class="g-main"><img id="g-main" src="' + esc(img(imgs[0])) + '" alt="' + esc(p.name) + '" width="800" height="800"></div>' +
      (imgs.length > 1 ? '<div class="g-thumbs">' + imgs.map(function(s, i){ return '<button type="button" class="g-th' + (i ? '' : ' on') + '" data-src="' + esc(img(s)) + '" aria-label="Photo ' + (i+1) + '"><img src="' + esc(img(s)) + '" alt="" loading="lazy"></button>'; }).join('') + '</div>' : '') + '</div>' +
      '<div class="pd-info"><span class="cat">' + esc(p.category) + '</span><h1>' + esc(p.name) + '</h1>' +
      '<a class="rating-link" href="#reviews" id="pd-rating">' + (p.rating && p.rating.count ? stars(p.rating.avg) + ' <span>' + p.rating.avg + ' \u00B7 ' + p.rating.count + ' review' + (p.rating.count > 1 ? 's' : '') + '</span>' : stars(0) + ' <span>No reviews yet</span>') + '</a>' +
      '<p class="lead">' + esc(p.short || '') + '</p>' +
      '<div class="pd-price"><span class="now">' + inr(p.price) + '</span>' + '' + '</div><p class="note">Inclusive of all taxes (GST)</p>' +
      (p.size ? '<div class="sizes"><span class="label">Size</span><span class="chip on" aria-pressed="true">' + esc(p.size) + '</span></div>' : '') +
      '<p class="stock ' + (p.in_stock ? (p.stock != null && p.stock <= 5 ? 'low' : 'in') : 'out') + '">' + (p.in_stock ? (p.stock != null && p.stock <= 5 ? 'Only ' + p.stock + ' left \u2014 order soon' : '\u25CF In stock') : 'Out of stock') + '</p>' +
      (p.in_stock ? '<div class="buyrow"><div class="qty"><button type="button" data-q="-1" aria-label="Decrease quantity">\u2212</button><input id="qty" type="number" inputmode="numeric" min="1" max="' + lim + '" value="1" aria-label="Quantity"><button type="button" data-q="1" aria-label="Increase quantity">+</button></div><button class="btn grow" type="button" id="add-btn">Add to Bag</button></div>' +
        '<button class="btn ghost block" type="button" id="buy-now">Buy now \u2014 Cash on Delivery</button><div class="pd-sticky" id="pd-sticky"><div class="ps-info"><strong>' + esc(p.name) + '</strong><span>' + inr(p.price) + (p.size ? ' \u00B7 ' + esc(p.size) : '') + '</span></div><button class="btn" type="button" id="sticky-add">Add to Bag</button></div>' : '<button class="btn block" type="button" disabled>Out of stock</button>') +
      '<button class="linkbtn wish-inline" type="button" data-wish="' + esc(p.id) + '" aria-pressed="false">' + HEART + ' <span>Save to wishlist</span></button>' +
      '<ul class="perks"><li>Free shipping above ' + inr(SET.free_shipping_from) + '</li><li>Cash on Delivery available</li><li>Easy 7-day returns on unopened items</li><li>Secure checkout</li></ul>' +
      '<div class="accs">' + acc('Shipping, returns & payment', '<p>Free shipping on orders above ' + inr(SET.free_shipping_from) + '; a flat ' + inr(SET.shipping_fee) + ' below that. Pay by Cash on Delivery when your order arrives. Unopened items can be returned within 7 days.</p><p><a href="/shipping">Shipping policy</a> \u00B7 <a href="/returns">Returns &amp; refunds</a></p>') + '</div>' +
      '</div></div>' + pdStory(p, faqs) +
      '<section class="block" id="reviews"><div class="sec-head"><div><span class="eyebrow">Reviews</span><h2>What customers say</h2></div></div><div id="reviews-root"><p class="muted"><span class="spinner"></span> Loading reviews\u2026</p></div></section>' +
      '<section class="block"><div class="sec-head"><div><span class="eyebrow">You may also like</span><h2>Complete your routine</h2></div></div><div class="grid" id="related"></div></section>';
    $$('.g-th', root).forEach(function(b){ b.addEventListener('click', function(){ $('#g-main').src = b.getAttribute('data-src'); $$('.g-th', root).forEach(function(x){ x.classList.toggle('on', x === b); }); }); });
    var q = $('#qty');
    function clampQ(){ var v = parseInt(q.value,10); if (!(v>=1)) v=1; if (v>lim) v=lim; q.value=v; return v; }
    if (q) {
      $$('[data-q]', root).forEach(function(b){ b.addEventListener('click', function(){ q.value = (parseInt(q.value,10)||1) + parseInt(b.getAttribute('data-q'),10); clampQ(); }); });
      q.addEventListener('change', clampQ);
      $('#add-btn').addEventListener('click', function(){ addToCart(p.id, clampQ()); });
      $('#buy-now').addEventListener('click', function(){ if (addToCart(p.id, clampQ())) location.href = '/checkout'; });
      var sa = $('#sticky-add'), sb = $('#pd-sticky'), ab = $('#add-btn');
      if (sa) sa.addEventListener('click', function(){ addToCart(p.id, clampQ()); });
      var ba = $('#band-add'); if (ba) ba.addEventListener('click', function(){ addToCart(p.id, clampQ()); });
      if (sb && ab && window.IntersectionObserver) { new IntersectionObserver(function(es){ sb.classList.toggle('show', !es[0].isIntersecting && es[0].boundingClientRect.top < 0); }).observe(ab); }
    }
    var rel = P.filter(function(x){ return x.id !== p.id; }).sort(function(a, b){ return (b.category === p.category) - (a.category === p.category); }).slice(0, 4);
    $('#related').innerHTML = rel.map(card).join('');
    paintWish();
    renderReviews(p);
  });
}
function renderReviews(p){
  var root = $('#reviews-root');
  api('GET', '/api/products/' + encodeURIComponent(p.id) + '/reviews').then(function(b){
    var list = b.reviews.length ? '<div class="rev-summary">' + stars(b.avg, '1.3rem') + ' <strong>' + b.avg + ' out of 5</strong> <span class="muted">\u00B7 ' + b.count + ' review' + (b.count > 1 ? 's' : '') + '</span></div>' +
      b.reviews.map(function(r){ return '<article class="review">' + stars(r.rating) + (r.title ? ' <strong>' + esc(r.title) + '</strong>' : '') + '<p>' + esc(r.body) + '</p><p class="muted small">' + esc(r.author) + (r.verified ? ' \u00B7 <span class="verified">Verified buyer</span>' : '') + ' \u00B7 ' + fmtDate(r.created_at) + '</p></article>'; }).join('')
      : '<div class="empty-rev"><p><strong>No reviews yet.</strong> Be the first to share how it works for you.</p></div>';
    var form;
    if (!b.signed_in) form = '<p class="muted"><a href="/login?next=' + encodeURIComponent('/product?id=' + p.id + '#reviews') + '">Sign in</a> to write a review.</p>';
    else if (b.mine) form = '<p class="muted">Thanks \u2014 you reviewed this product' + (b.mine.status === 'pending' ? '. It will show here after a quick check.' : '.') + '</p>';
    else form = '<form class="rev-form" id="rev-form" novalidate><h3>Write a review</h3><div class="field"><span class="label">Your rating</span><div class="star-input" role="radiogroup" aria-label="Rating">' +
      [1,2,3,4,5].map(function(n){ return '<label><input type="radio" name="rating" value="' + n + '"><span aria-hidden="true">\u2605</span><span class="sr">' + n + ' star' + (n>1?'s':'') + '</span></label>'; }).join('') + '</div><p class="err" id="rev-form-err-rating"></p></div>' +
      '<div class="field"><label for="rv-title">Title (optional)</label><input id="rv-title" name="title" maxlength="80"></div>' +
      '<div class="field"><label for="rv-body">Your review</label><textarea id="rv-body" name="body" rows="4" maxlength="1000" required></textarea><p class="err" id="rev-form-err-body"></p></div>' +
      '<div class="form-alert hidden" role="alert"></div><button class="btn" type="submit">Submit review</button><p class="note">Reviews are checked before they appear. Please keep it honest and about the product.</p></form>';
    root.innerHTML = '<div class="rev-wrap"><div>' + list + '</div><div>' + form + '</div></div>';
    var f = $('#rev-form');
    if (f) {
      $$('.star-input input', f).forEach(function(i){ i.addEventListener('change', function(){ $$('.star-input label', f).forEach(function(l, k){ l.classList.toggle('on', k < parseInt(i.value, 10)); }); }); });
      wireForm(f, {rating: function(){ return $('input[name=rating]:checked', f) ? '' : 'Choose a star rating.'; }, body: function(v){ return v.length < 10 ? 'Please write at least 10 characters.' : ''; }},
        function(){ return api('POST', '/api/products/' + encodeURIComponent(p.id) + '/reviews', {rating: parseInt($('input[name=rating]:checked', f).value, 10), title: f.elements.title.value.trim(), body: f.elements.body.value.trim()}); },
        function(r){ f.outerHTML = '<p class="ok-msg">\u2713 ' + esc(r.message) + '</p>'; });
    }
  }).catch(function(err){ root.innerHTML = '<p class="muted">' + esc(err.message) + '</p>'; });
}

/* ---------- cart ---------- */
function getCoupon(){ try { return localStorage.getItem(COUPON_KEY) || ''; } catch(e){ return ''; } }
function setCoupon(c){ try { if (c) localStorage.setItem(COUPON_KEY, c); else localStorage.removeItem(COUPON_KEY); } catch(e){} }
function quote(lines, code){ return api('POST', '/api/quote', {items: lines.map(function(l){ return {id:l.p.id, qty:l.qty}; }), coupon: code || undefined}).then(function(b){ return b.quote; }); }
function summaryRows(t, q){
  var d = q ? q.discount : 0, ship = q ? q.shipping : t.shipping, total = q ? q.total : t.total;
  var need = SET.free_shipping_from - ((q ? q.subtotal : t.subtotal - d));
  return '<div class="summary-row"><span>Subtotal</span><span>' + inr(q ? q.items_subtotal : t.subtotal) + '</span></div>' +
    (d ? '<div class="summary-row disc"><span>Coupon ' + esc(q.coupon) + '</span><span>\u2212' + inr(d) + '</span></div>' : '') +
    '<div class="summary-row"><span>Shipping</span><span>' + (ship ? inr(ship) : 'Free') + '</span></div>' +
    (ship && need > 0 ? '<p class="note ship-note">Add ' + inr(need) + ' more for free shipping</p>' : '') +
    '<div class="summary-row total"><span>Total</span><span>' + inr(total) + '</span></div><p class="note">Inclusive of GST \u00B7 Pay cash on delivery</p>';
}
function couponBox(){ return '<form class="coupon" id="coupon-form" novalidate><label for="coupon-in" class="small">Have a coupon?</label><div class="coupon-row"><input id="coupon-in" name="coupon" autocomplete="off" autocapitalize="characters" placeholder="Enter code" maxlength="24"><button class="btn ghost sm" type="submit">Apply</button></div><p class="err" id="coupon-err" role="alert"></p><p class="ok-msg small hidden" id="coupon-ok"></p></form>'; }
function wireCoupon(lines, onQuote){
  var f = $('#coupon-form'); if (!f) return;
  var inp = $('#coupon-in'), er = $('#coupon-err'), ok = $('#coupon-ok'), btn = $('button', f);
  function apply(code, quiet){
    er.textContent = ''; ok.classList.add('hidden'); btn.disabled = true;
    return quote(lines, code).then(function(q){
      onQuote(q);
      if (code) { setCoupon(q.coupon); ok.textContent = '\u2713 ' + q.coupon + ' applied \u2014 you save ' + inr(q.discount); ok.classList.remove('hidden'); btn.textContent = 'Remove'; f.dataset.applied = '1'; inp.value = q.coupon; inp.readOnly = true; }
      else { setCoupon(''); btn.textContent = 'Apply'; f.dataset.applied = ''; inp.readOnly = false; inp.value = ''; }
    }).catch(function(err){ if (code) setCoupon(''); if (!quiet) er.textContent = err.message; return quote(lines, '').then(onQuote).catch(function(){}); }).then(function(){ btn.disabled = false; });
  }
  f.addEventListener('submit', function(e){ e.preventDefault(); if (f.dataset.applied) return apply(''); var c = inp.value.trim().toUpperCase(); if (!c) { er.textContent = 'Enter a coupon code.'; return; } apply(c); });
  var saved = getCoupon(); if (saved) { inp.value = saved; return apply(saved, true); }
  return apply('', true);
}
function renderCart(){
  var root = $('#cart-root'); if (!root) return;
  loadCatalog().then(function(){
    var lines = cartLines();
    if (!lines.length) { root.innerHTML = stateBox('Your cart is empty', 'Find something you\u2019ll love in our short, simple range.', '<a class="btn" href="/shop">Shop products</a>'); return; }
    root.innerHTML = '<div class="cart-layout"><div class="cart-lines">' + lines.map(function(l){
      var lim = Math.min(maxQ(), l.p.stock != null ? l.p.stock : maxQ());
      return '<div class="line" data-id="' + esc(l.p.id) + '"><a class="lthumb" href="/product?id=' + encodeURIComponent(l.p.id) + '"><img src="' + esc(img(l.p.image)) + '" alt="" width="96" height="96"></a><div class="linfo"><a href="/product?id=' + encodeURIComponent(l.p.id) + '"><strong>' + esc(l.p.name) + '</strong></a><span class="muted small">' + esc(l.p.size || '') + ' \u00B7 ' + inr(l.p.price) + '</span>' +
        (!l.p.in_stock ? '<span class="err">Out of stock \u2014 please remove</span>' : '') +
        '<div class="lrow"><div class="qty sm"><button type="button" data-step="-1" aria-label="Decrease">\u2212</button><input type="number" min="1" max="' + lim + '" value="' + l.qty + '" aria-label="Quantity of ' + esc(l.p.name) + '"><button type="button" data-step="1" aria-label="Increase">+</button></div><button class="linkbtn" type="button" data-remove>Remove</button></div></div><div class="ltotal">' + inr(l.total) + '</div></div>';
    }).join('') + '</div><aside class="summary"><h2>Order summary</h2>' + couponBox() + '<div id="sum-rows">' + summaryRows(totals(lines)) + '</div><a class="btn block" href="/checkout" id="go-checkout">Checkout securely</a><p class="note center">\uD83D\uDD12 Secure checkout \u00B7 COD available</p></aside></div>';
    $$('.line', root).forEach(function(row){
      var id = row.getAttribute('data-id'), input = $('input', row);
      function set(v){ var c = readCart(); var lim = parseInt(input.max, 10) || maxQ(); v = Math.max(1, Math.min(lim, v || 1)); c[id] = v; saveCart(c); renderCart(); }
      $$('[data-step]', row).forEach(function(b){ b.addEventListener('click', function(){ set((parseInt(input.value,10)||1) + parseInt(b.getAttribute('data-step'),10)); }); });
      input.addEventListener('change', function(){ set(parseInt(input.value, 10)); });
      $('[data-remove]', row).addEventListener('click', function(){ var c = readCart(); delete c[id]; saveCart(c); renderCart(); toast('Removed from cart'); });
    });
    wireCoupon(lines, function(q){ $('#sum-rows').innerHTML = summaryRows(totals(lines), q); });
  });
}

/* ---------- checkout (server re-prices everything; this page only previews) ---------- */
var STATES = ['Andaman and Nicobar Islands','Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jammu and Kashmir','Jharkhand','Karnataka','Kerala','Ladakh','Lakshadweep','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal'];
var RULES = {
  name: function(v){ return v.length < 2 ? 'Please enter your full name.' : (v.length > 80 ? 'Name is too long.' : ''); },
  phone: function(v){ var d = v.replace(/[\s-]/g,'').replace(/^(\+91|91|0)(?=\d{10}$)/,''); return /^[6-9]\d{9}$/.test(d) ? '' : 'Enter a 10-digit Indian mobile number (starts with 6, 7, 8 or 9).'; },
  email: function(v){ return !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'This email does not look right (or leave it empty).'; },
  address: function(v){ return v.length < 10 ? 'Please enter house no., street and area (at least 10 characters).' : (v.length > 300 ? 'Address is too long.' : ''); },
  pincode: function(v){ return /^[1-9]\d{5}$/.test(v) ? '' : 'Pincode must be 6 digits and cannot start with 0.'; },
  city: function(v){ return v.length < 2 ? 'Please enter your city.' : ''; },
  state: function(v){ return STATES.indexOf(v) >= 0 ? '' : 'Please choose your state.'; }
};
function renderCheckout(){
  var form = $('#checkout-form'); if (!form) return;
  loadCatalog().then(function(){
    var lines = cartLines();
    if (!lines.length) { $('#checkout-root').innerHTML = stateBox('Your cart is empty', 'There is nothing to check out yet.', '<a class="btn" href="/shop">Shop products</a>'); return; }
    var box = $('#checkout-summary'), current = null;
    box.innerHTML = '<div class="mini-lines">' + lines.map(function(l){ return '<div class="mini"><img src="' + esc(img(l.p.image)) + '" alt="" width="52" height="52"><span>' + esc(l.p.name) + ' <span class="muted">\u00D7 ' + l.qty + '</span></span><span>' + inr(l.total) + '</span></div>'; }).join('') + '</div>' + couponBox() + '<div id="sum-rows">' + summaryRows(totals(lines)) + '</div>';
    wireCoupon(lines, function(q){ current = q; $('#sum-rows').innerHTML = summaryRows(totals(lines), q); $('#place-total').textContent = inr(q.total); });
    var note = $('#acct-note');
    me().then(function(u){
      note.classList.remove('hidden');
      if (u) { note.innerHTML = 'Signed in as <strong>' + esc(u.email) + '</strong>. This order will be saved to <a href="/account">My account</a>.'; if (!form.name.value) form.name.value = u.name; if (!form.email.value) form.email.value = u.email; }
      else note.innerHTML = 'Checking out as a guest. <a href="/login?next=/checkout">Sign in</a> or <a href="/signup?next=/checkout">create an account</a> to save your orders and wishlist.';
    });
    form.state.innerHTML = '<option value="">Choose state</option>' + STATES.map(function(s){ return '<option>' + s + '</option>'; }).join('');
    try { var saved = JSON.parse(localStorage.getItem('avermontis_address') || 'null'); if (saved) Object.keys(RULES).forEach(function(k){ if (saved[k] && form[k]) form[k].value = saved[k]; }); } catch(e){}
    function check(name){ var msg = RULES[name](form[name].value.trim()); setErr(form, name, msg); return !msg; }
    Object.keys(RULES).forEach(function(k){
      form[k].addEventListener('blur', function(){ if (form[k].value) check(k); });
      form[k].addEventListener('input', function(){ if (form[k].closest('.field').classList.contains('invalid')) check(k); });
    });
    var busy = false;
    form.addEventListener('submit', function(e){
      e.preventDefault(); if (busy) return;
      var alertBox = $('#form-alert'); alertBox.className = 'hidden'; alertBox.textContent = '';
      var bad = Object.keys(RULES).filter(function(k){ return !check(k); });
      if (bad.length) { form[bad[0]].focus(); alertBox.className = 'alert error'; alertBox.textContent = 'Please fix the ' + bad.length + ' highlighted field' + (bad.length>1?'s':'') + '.'; return; }
      if (!navigator.onLine) { alertBox.className = 'alert error'; alertBox.textContent = 'You are offline. Connect to the internet and tap Place order again \u2014 your cart is saved.'; return; }
      var fresh = cartLines(); if (!fresh.length) { location.href = '/cart'; return; }
      var cust = {}; Object.keys(RULES).forEach(function(k){ cust[k] = form[k].value.trim(); });
      cust.phone = cust.phone.replace(/[\s-]/g,'').replace(/^(\+91|91|0)(?=\d{10}$)/,'');
      cust.notes = (form.notes.value || '').trim().slice(0, 300);
      try { localStorage.setItem('avermontis_address', JSON.stringify(cust)); } catch(err){}
      busy = true; var btn = $('#place'), label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Placing order\u2026';
      api('POST', '/api/orders', {items: fresh.map(function(l){ return {id:l.p.id, qty:l.qty}; }), customer: cust, payment: 'cod', coupon: current && current.coupon ? current.coupon : undefined}).then(function(b){
        try { sessionStorage.setItem(ORDER_KEY, JSON.stringify(b.order)); localStorage.setItem(ORDER_KEY, JSON.stringify(b.order)); } catch(err){}
        localStorage.removeItem(KEY); setCoupon(''); updateCount();
        location.href = '/order-success';
      }).catch(function(err){
        busy = false; btn.disabled = false; btn.innerHTML = label;
        if (err.fields) Object.keys(err.fields).forEach(function(k){ if (form[k]) setErr(form, k, err.fields[k]); });
        alertBox.className = 'alert error'; alertBox.textContent = err.message;
      });
    });
  });
}
function renderSuccess(){
  var root = $('#success-root'); if (!root) return;
  var o; try { o = JSON.parse(sessionStorage.getItem(ORDER_KEY) || localStorage.getItem(ORDER_KEY) || 'null'); } catch(e){ o = null; }
  if (!o) { root.innerHTML = stateBox('No recent order found', 'If you just placed an order, check My account or track it with your order number.', '<a class="btn" href="/track">Track an order</a> <a class="btn ghost" href="/shop">Continue shopping</a>'); return; }
  var body = 'Order ' + o.id + '\n' + o.items.map(function(i){ return i.name + ' x' + i.qty + ' = ' + inr(i.total); }).join('\n') + '\nTotal: ' + inr(o.total) + ' (Cash on Delivery)\n\n' + o.customer.name + ', ' + o.customer.phone + '\n' + o.customer.address + ', ' + o.customer.city + ', ' + o.customer.state + ' ' + o.customer.pincode;
  root.innerHTML = '<div class="success-card"><div class="tick" aria-hidden="true">\u2713</div><span class="eyebrow">Order placed</span><h1>Thank you, ' + esc(o.customer.name.split(' ')[0]) + '!</h1>' +
    '<p class="lead">Your order <strong>' + esc(o.id) + '</strong> is saved. Please keep ' + inr(o.total) + ' ready \u2014 you pay in cash when it arrives.</p>' +
    (o.customer.email ? '<p class="muted small">Order details are linked to ' + esc(o.customer.email) + '.</p>' : '') +
    '<div class="succ-actions">' + (o.invoice_url ? '<a class="btn" href="' + esc(o.invoice_url) + '" target="_blank" rel="noopener">Download invoice (PDF)</a>' : '') + '<a class="btn ghost" href="/track?order=' + encodeURIComponent(o.id) + '">Track this order</a></div>' +
    '<div class="summary flat">' + o.items.map(function(i){ return '<div class="summary-row"><span>' + esc(i.name) + ' \u00D7 ' + i.qty + '</span><span>' + inr(i.total) + '</span></div>'; }).join('') +
    (o.discount ? '<div class="summary-row disc"><span>Coupon ' + esc(o.coupon) + '</span><span>\u2212' + inr(o.discount) + '</span></div>' : '') +
    '<div class="summary-row"><span>Shipping</span><span>' + (o.shipping ? inr(o.shipping) : 'Free') + '</span></div><div class="summary-row total"><span>Total</span><span>' + inr(o.total) + '</span></div></div>' +
    '<p class="small muted">Invoice no. ' + esc(o.invoice_no || '') + ' \u00B7 Questions? <a href="mailto:' + SUPPORT + '?subject=' + encodeURIComponent('Order ' + o.id) + '&body=' + encodeURIComponent(body) + '">Email us about this order</a></p>' +
    '<a class="linkbtn" href="/shop">Continue shopping \u2192</a></div>';
}

/* ---------- auth pages ---------- */
function nextUrl(){ var n = qs('next') || '/account'; return /^\/[a-zA-Z0-9\-_/.?=&#%]*$/.test(n) && n.indexOf('//') !== 0 ? n : '/account'; }
function renderLogin(){
  var f = $('#login-form'); if (!f) return;
  me().then(function(u){ if (u) location.replace(nextUrl()); });
  var s = $('#to-signup'); if (s && qs('next')) s.href = '/signup?next=' + encodeURIComponent(qs('next'));
  // v6: the owner does NOT sign in here any more (laptop: /admin, phone: the Avermontis Admin app). Anything typed that is
  // not an e-mail address is checked by the server like any other wrong login, so "admin" gets the same generic message.
  wireForm(f, {email: function(v){ v = String(v).trim(); return !v ? 'Enter your email address.' : (v.indexOf('@') >= 0 ? R.email(v) : ''); }, password: function(v){ return v ? '' : 'Enter your password.'; }}, function(){ return api('POST', '/api/auth/login', {email: f.email.value.trim(), password: f.password.value}); }, function(){
    location.href = nextUrl(); });
}
function renderSignup(){
  var f = $('#signup-form'); if (!f) return;
  me().then(function(u){ if (u) location.replace(nextUrl()); });
  wireForm(f, {name: R.name, email: R.email, password: R.password}, function(){ return api('POST', '/api/auth/signup', {name: f.elements.name.value.trim(), email: f.email.value.trim(), password: f.password.value}); }, function(){ location.href = nextUrl(); });
}
function renderForgot(){
  var f = $('#forgot-form'); if (!f) return;
  wireForm(f, {email: R.email}, function(){ return api('POST', '/api/auth/forgot', {email: f.email.value.trim()}); }, function(r){ f.innerHTML = '<div class="alert ok">' + esc(r.message) + '</div><a class="btn block" href="/login">Back to sign in</a>'; });
}
function renderReset(){
  var f = $('#reset-form'); if (!f) return;
  var token = qs('token') || '';
  if (!token) { f.innerHTML = '<div class="alert error">This reset link is incomplete. Please ask for a new one.</div><a class="btn block" href="/forgot">Get a new link</a>'; return; }
  history.replaceState(null, '', '/reset');   // keep the token out of the address bar after reading it
  wireForm(f, {password: R.password, confirm: function(v){ return v !== f.password.value ? 'The two passwords do not match.' : ''; }}, function(){ return api('POST', '/api/auth/reset', {token: token, password: f.password.value}); },
    function(){ f.innerHTML = '<div class="alert ok">Your password is changed and you are signed in.</div><a class="btn block" href="/account">Go to My account</a>'; });
}

/* ---------- my account: own orders (with invoices), wishlist, sign-in history ---------- */
var STATUS_STEPS = ['new', 'confirmed', 'shipped', 'delivered'];
var STATUS_LABEL = {'new':'Order placed', confirmed:'Confirmed', shipped:'Shipped', delivered:'Delivered', cancelled:'Cancelled'};
function timeline(status, events){
  if (status === 'cancelled') return '<ol class="tl"><li class="done">Order placed</li><li class="cancel">Cancelled</li></ol>';
  var at = STATUS_STEPS.indexOf(status), times = {};
  (events || []).forEach(function(e){ times[e.status] = e.at; });
  return '<ol class="tl">' + STATUS_STEPS.map(function(s, i){ return '<li class="' + (i <= at ? 'done' : '') + (i === at ? ' cur' : '') + '"><span>' + STATUS_LABEL[s] + '</span>' + (times[s] ? '<small>' + fmtIST(times[s]) + '</small>' : '') + '</li>'; }).join('') + '</ol>';
}
function orderCard(o){
  return '<article class="order-card"><div class="oc-top"><div><strong>' + esc(o.id) + '</strong><span class="muted small"> \u00B7 ' + fmtIST(o.created_at) + '</span></div><span class="status s-' + esc(o.status) + '">' + esc(STATUS_LABEL[o.status] || o.status) + '</span></div>' +
    timeline(o.status) +
    '<ul class="oc-items">' + o.items.map(function(i){ return '<li><span>' + esc(i.name) + ' \u00D7 ' + i.qty + '</span><span>' + inr(i.total) + '</span></li>'; }).join('') + '</ul>' +
    '<div class="oc-total">' + (o.discount ? '<span class="muted small">Coupon ' + esc(o.coupon || '') + ' \u2212' + inr(o.discount) + ' \u00B7 </span>' : '') + '<span>Total <strong>' + inr(o.total) + '</strong> \u00B7 Cash on Delivery</span></div>' +
    '<div class="oc-actions">' + (o.invoice_url ? '<a class="btn sm ghost" href="' + esc(o.invoice_url) + '" target="_blank" rel="noopener">Invoice (PDF)</a>' : '') + '<a class="btn sm ghost" href="/track?order=' + encodeURIComponent(o.id) + '">Track</a></div></article>';
}
function renderAccountWishlist(){
  var el = $('#wish-root'); if (!el) return;
  wishPromise = null;
  Promise.all([loadCatalog(), wishlist()]).then(function(r){
    var list = r[1].map(byId).filter(Boolean);
    el.innerHTML = list.length ? '<div class="grid">' + list.map(card).join('') + '</div>' : stateBox('Your wishlist is empty', 'Tap the heart on any product to save it here.', '<a class="btn ghost" href="/shop">Browse products</a>');
    paintWish();
  });
}
function renderAccount(){
  var root = $('#account-root'); if (!root) return;
  me().then(function(u){
    if (!u) { location.replace('/login?next=/account'); return; }
    $('#acct-name').textContent = u.name.split(' ')[0];
    $('#acct-email').textContent = u.email;
    var tabs = $$('[data-tab]'), panes = $$('[data-pane]');
    function show(t){ tabs.forEach(function(b){ var on = b.getAttribute('data-tab') === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }); panes.forEach(function(p){ p.classList.toggle('hidden', p.getAttribute('data-pane') !== t); }); if (t === 'wishlist') renderAccountWishlist(); }
    tabs.forEach(function(b){ b.addEventListener('click', function(){ show(b.getAttribute('data-tab')); history.replaceState(null, '', '#' + b.getAttribute('data-tab')); }); });
    show(['orders','wishlist','security'].indexOf(location.hash.slice(1)) >= 0 ? location.hash.slice(1) : 'orders');
    var ol = $('#orders-list');
    function loadOrders(){ ol.innerHTML = '<p class="muted"><span class="spinner"></span> Loading your orders\u2026</p>';
      api('GET', '/api/account/orders').then(function(b){ ol.innerHTML = b.orders.length ? b.orders.map(orderCard).join('') : stateBox('No orders yet', 'When you order while signed in, it shows up here with its invoice.', '<a class="btn" href="/shop">Start shopping</a>'); }).catch(function(err){ errorBox(ol, err.message, loadOrders); }); }
    loadOrders();
    var ll = $('#logins-list');
    api('GET', '/api/account/logins').then(function(b){
      ll.innerHTML = b.logins.length ? '<ul class="login-list">' + b.logins.map(function(l){ return '<li><span class="dot ' + (l.success ? 'ok' : 'bad') + '"></span><div><strong>' + (l.success ? (l.event === 'signup' ? 'Account created' : 'Signed in') : 'Failed sign-in') + '</strong><span class="muted small">' + fmtIST(l.created_at) + ' \u00B7 ' + esc(l.device || '') + ' \u00B7 IP ' + esc(l.ip || '') + '</span></div></li>'; }).join('') + '</ul>' : '<p class="muted">No sign-ins yet.</p>';
    }).catch(function(err){ ll.innerHTML = '<p class="muted">' + esc(err.message) + '</p>'; });
    $('#logout-btn').addEventListener('click', function(){ var b = this; b.disabled = true; api('POST', '/api/auth/logout', {}).then(function(){ location.href = '/'; }).catch(function(err){ b.disabled = false; toast(err.message); }); });
  });
}

/* ---------- order tracking ---------- */
function renderTrack(){
  var f = $('#track-form'); if (!f) return;
  var out = $('#track-result');
  if (qs('order')) f.order_id.value = qs('order');
  wireForm(f, {order_id: function(v){ return /^AV-[0-9A-Z-]{6,20}$/i.test(v) ? '' : 'Enter the order number, e.g. AV-261026-ABC123.'; }, contact: function(v){ return v.length >= 5 ? '' : 'Enter the phone number or email used at checkout.'; }},
    function(){ return api('POST', '/api/track', {order_id: f.order_id.value.trim().toUpperCase(), contact: f.contact.value.trim()}); },
    function(b){ var o = b.order;
      out.innerHTML = '<article class="order-card big"><div class="oc-top"><div><strong>' + esc(o.id) + '</strong><span class="muted small"> \u00B7 placed ' + fmtIST(o.created_at) + '</span></div><span class="status s-' + esc(o.status) + '">' + esc(STATUS_LABEL[o.status] || o.status) + '</span></div>' +
        timeline(o.status, o.events) +
        '<ul class="oc-items">' + o.items.map(function(i){ return '<li><span>' + esc(i.name) + ' \u00D7 ' + i.qty + '</span><span>' + inr(i.total) + '</span></li>'; }).join('') + '</ul>' +
        '<div class="oc-total"><span>Total <strong>' + inr(o.total) + '</strong> \u00B7 Cash on Delivery \u00B7 to ' + esc(o.ship_to) + '</span></div>' +
        '<div class="oc-actions">' + (o.invoice_url ? '<a class="btn sm" href="' + esc(o.invoice_url) + '" target="_blank" rel="noopener">Download invoice (PDF)</a>' : '') + '</div></article>';
      out.scrollIntoView({behavior:'smooth', block:'start'});
    });
}

/* ---------- contact form (saved to the owner's inbox in /admin) ---------- */
function renderContact(){
  var f = $('#contact-form'); if (!f) return;
  me().then(function(u){ if (u) { if (!f.elements.name.value) f.elements.name.value = u.name; if (!f.email.value) f.email.value = u.email; } });
  wireForm(f, {name: R.name, email: R.email, message: function(v){ return v.length < 10 ? 'Please write at least 10 characters.' : ''; }},
    function(){ return api('POST', '/api/contact', {name: f.elements.name.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), subject: f.subject.value.trim(), message: f.message.value.trim()}); },
    function(r){ f.innerHTML = '<div class="alert ok">' + esc(r.message) + '</div>'; });
}

/* ---------- boot ---------- */

/* ================= v3: categories, collections, shop by concern, skin finder, ingredients, routine =================
   Everything below picks products from the live catalog (P). Nothing is invented: a step whose product is missing is
   simply left out, and an empty category or collection shows "coming soon". */
var CATS = [
  {slug:'serums', name:'Serums', key:'serum', intro:'Water-light formulas that do the focused work in your routine.'},
  {slug:'moisturisers', name:'Moisturisers', key:'moisturizer', intro:'Light textures that keep skin comfortable and sit well under sunscreen.'},
  {slug:'cleansers', name:'Cleansers', key:'cleanser', intro:'The first step, morning and night.'},
  {slug:'sunscreens', name:'Sunscreens', key:'sunscreen', intro:'The last step of every morning.'},
  {slug:'eye-care', name:'Eye care', key:'eye', intro:'A dedicated eye formula is not part of the collection yet.'}
];
function catKey(c){ return String(c || '').toLowerCase().replace(/moisturiser/g, 'moisturizer').replace(/face ?wash/g, 'cleanser').replace(/[^a-z]/g, ''); }
function catOf(p){ var k = catKey(p.category); for (var i=0;i<CATS.length;i++){ if (k.indexOf(CATS[i].key) === 0) return CATS[i]; } return null; }
function catHref(name){ var c = catOf({category:name}); return c ? '/shop/' + c.slug : '/shop?cat=' + encodeURIComponent(name); }
var COLLECTIONS = [
  {slug:'morning-ritual', name:'The Morning Ritual', ids:['hydrating-face-wash','vitamin-c-serum','daily-moisturizer','sunscreen-spf50'], intro:'Cleanse, treat, moisturise, protect: the four morning steps, in the order you use them.'},
  {slug:'evening-ritual', name:'The Evening Ritual', ids:['hydrating-face-wash','niacinamide-serum','daily-moisturizer'], intro:'Cleanse, treat, moisturise. Sunscreen stays in the morning.'},
  {slug:'serum-edit', name:'The Serum Edit', ids:['vitamin-c-serum','niacinamide-serum'], intro:'Both serums, each with its own place: Vitamin C in the morning, Niacinamide morning or night.'}
];
var CONCERNS = [
  {slug:'dullness', name:'Dullness', line:'For skin that looks tired or flat.', ids:['vitamin-c-serum','hydrating-face-wash','sunscreen-spf50'],
    why:'Our Vitamin C serum is made for a fresh, bright-looking complexion. A gentle cleanse first and sunscreen last keep the routine simple.'},
  {slug:'dark-spots', name:'Dark spots', line:'For a routine built around brightness and daily sun protection.', ids:['vitamin-c-serum','sunscreen-spf50','niacinamide-serum'],
    why:'People with spots often start with a vitamin C serum and daily sunscreen. We make no promise to fade marks; for persistent spots, see a dermatologist.'},
  {slug:'uneven-tone', name:'Uneven tone', line:'For a smooth, even-looking routine.', ids:['niacinamide-serum','sunscreen-spf50','daily-moisturizer'],
    why:'Our Niacinamide serum is made for a smooth, even-looking routine and layers easily under moisturiser. Sunscreen finishes the morning.'},
  {slug:'dehydration', name:'Dehydration', line:'For skin that feels tight or thirsty.', ids:['hydrating-face-wash','daily-moisturizer','vitamin-c-serum'],
    why:'A cleanser that leaves skin feeling soft, not tight, and a moisturiser with hyaluronic acid and ceramides. The Vitamin C serum contains hyaluronic acid too.'}
];
var INGREDIENTS = [
  {key:'vitamin c', name:'Vitamin C', sub:'as ascorbyl glucoside', text:'A water-soluble form of vitamin C chosen for an everyday serum. It belongs in the morning, under sunscreen.'},
  {key:'niacinamide', name:'Niacinamide', sub:'vitamin B3', text:'Water-light and easy to layer, so it suits morning or evening routines and sits well under moisturiser.'},
  {key:'hyaluronic', name:'Hyaluronic acid', sub:'humectant', text:'Attracts and holds water, which is why it is used for a comfortable, hydrated feel.'},
  {key:'ceramide', name:'Ceramides', sub:'skin lipids', text:'Lipids that are naturally part of the skin\u2019s outer layer; moisturisers use them to help skin feel comfortable.'},
  {key:'zinc oxide', name:'Zinc oxide & titanium dioxide', sub:'mineral UV filters', also:'titanium dioxide', text:'Mineral filters that sit on the skin and reflect and scatter UV light.'},
  {key:'squalane', name:'Squalane', sub:'emollient', text:'A light, non-greasy emollient that softens the skin\u2019s surface.'},
  {key:'panthenol', name:'Panthenol', sub:'pro-vitamin B5', text:'A humectant used for a soft, comfortable feel.'},
  {key:'zinc pca', name:'Zinc PCA', sub:'zinc salt', text:'Often paired with niacinamide in water-light serums.'},
  {key:'glycerin', name:'Glycerin', sub:'humectant', text:'A classic humectant that draws water into the skin\u2019s surface layers.'},
  {key:'aloe', name:'Aloe vera', sub:'plant gel', text:'Used for a fresh, light feel.'},
  {key:'vitamin e', name:'Vitamin E', sub:'antioxidant vitamin', text:'Often used alongside vitamin C and in sunscreens.'},
  {key:'shea', name:'Shea butter', sub:'plant butter', text:'Softens and cushions the skin.'},
  {key:'cucumber', name:'Cucumber extract', sub:'plant extract', text:'Used for a fresh feel in cleansers.'},
  {key:'coconut', name:'Coconut-derived cleansers', sub:'mild surfactants', text:'Gentle cleansing agents that lift away oil and the day.'}
];
var ROUTINE = {
  am: [{step:'Cleanse', id:'hydrating-face-wash'}, {step:'Treat', id:'vitamin-c-serum'}, {step:'Moisturise', id:'daily-moisturizer'}, {step:'Protect', id:'sunscreen-spf50'}],
  pm: [{step:'Cleanse', id:'hydrating-face-wash'}, {step:'Treat', id:'niacinamide-serum'}, {step:'Moisturise', id:'daily-moisturizer'}]
};
function pick(ids){ return ids.map(byId).filter(Boolean); }
function hasIng(p, ing){ var l = (p.ingredients || []).join(' | ').toLowerCase(); return l.indexOf(ing.key) >= 0 || (ing.also && l.indexOf(ing.also) >= 0); }
function ingFor(p){ return INGREDIENTS.filter(function(i){ return hasIng(p, i); }); }
function soon(title, text){ return '<div class="soon"><span class="eyebrow">Coming soon</span><h2>' + title + '</h2><p class="muted">' + text + '</p><a class="btn ghost" href="/shop">Shop the collection</a></div>'; }
function mini(p){ return '<a class="mini" href="/product?id=' + encodeURIComponent(p.id) + '"><img src="' + esc(img(p.image)) + '" alt="" loading="lazy" width="120" height="120"><span><strong>' + esc(p.name) + '</strong><small>' + (p.size ? esc(p.size) + ' \u00B7 ' : '') + inr(p.price) + '</small></span></a>'; }

function renderCategory(){
  var el = $('#cat-grid'); if (!el) return;
  var slug = el.getAttribute('data-cat'), cat = CATS.filter(function(c){ return c.slug === slug; })[0];
  el.innerHTML = skeletons(3);
  loadCatalog().then(function(){
    var list = P.filter(function(p){ var c = catOf(p); return c && c.slug === slug; });
    el.innerHTML = list.length ? list.map(card).join('') : soon(esc(cat ? cat.name : 'This category') + ' is on its way', 'There are no products in this category yet. When we add one, it will appear here first.');
    var n = $('#cat-count'); if (n) n.textContent = list.length ? list.length + (list.length === 1 ? ' product' : ' products') : '';
    paintWish();
  });
}
function renderCollection(){
  var el = $('#col-grid'); if (!el) return;
  var col = COLLECTIONS.filter(function(c){ return c.slug === el.getAttribute('data-collection'); })[0];
  el.innerHTML = skeletons(3);
  loadCatalog().then(function(){
    var list = col ? pick(col.ids) : [];
    el.innerHTML = list.length ? list.map(card).join('') : soon('This collection is on its way', 'Its products are not in the store yet.');
    var buy = $('#col-buy');
    var inStock = list.filter(function(p){ return p.in_stock; });
    if (buy && inStock.length > 1) {
      var sum = inStock.reduce(function(s, p){ return s + p.price; }, 0);
      buy.innerHTML = '<p><strong>' + inStock.length + ' products \u00B7 ' + inr(sum) + '</strong><span class="muted small"> at today\u2019s prices, inclusive of GST</span></p><button class="btn" type="button" id="col-add">Add all to Bag</button>';
      $('#col-add').addEventListener('click', function(){ inStock.forEach(function(p){ addToCart(p.id, 1); }); });
    }
    paintWish();
  });
}
function renderCollections(){
  var el = $('#collections-root'); if (!el) return;
  loadCatalog().then(function(){
    el.innerHTML = COLLECTIONS.map(function(c){
      var list = pick(c.ids);
      return '<a class="col-card" href="/collections/' + c.slug + '"><span class="col-imgs">' + list.slice(0, 4).map(function(p){ return '<img src="' + esc(img(p.image)) + '" alt="" loading="lazy" width="300" height="300">'; }).join('') + '</span>' +
        '<span class="col-body"><span class="eyebrow">' + list.length + (list.length === 1 ? ' product' : ' products') + '</span><h2>' + esc(c.name) + '</h2><p class="muted">' + esc(c.intro) + '</p><span class="linkbtn">Explore</span></span></a>';
    }).join('');
  });
}
function renderConcerns(){
  var els = $$('[data-concern]'); if (!els.length) return;
  loadCatalog().then(function(){
    els.forEach(function(el){
      var c = CONCERNS.filter(function(x){ return x.slug === el.getAttribute('data-concern'); })[0];
      var list = c ? pick(c.ids) : [];
      el.innerHTML = list.length ? list.map(card).join('') : soon('Products coming soon', '');
    });
    paintWish();
  });
}
function renderIngredients(){
  var el = $('#ing-root'); if (!el) return;
  var only = el.getAttribute('data-only');
  loadCatalog().then(function(){
    var list = INGREDIENTS.filter(function(i){ return P.some(function(p){ return hasIng(p, i); }); });
    if (only) list = list.slice(0, parseInt(only, 10));
    el.innerHTML = list.map(function(i){
      var found = P.filter(function(p){ return hasIng(p, i); });
      return '<article class="ing-card" id="ing-' + i.key.replace(/[^a-z]/g, '-') + '"><span class="eyebrow">' + esc(i.sub) + '</span><h3>' + esc(i.name) + '</h3><p>' + esc(i.text) + '</p>' +
        '<p class="found"><span>Found in</span> ' + found.map(function(p){ return '<a href="/product?id=' + encodeURIComponent(p.id) + '">' + esc(p.name) + '</a>'; }).join(', ') + '</p></article>';
    }).join('');
  });
}
function renderRoutine(){
  var els = $$('[data-routine]'); if (!els.length) return;
  loadCatalog().then(function(){
    els.forEach(function(el){
      var steps = (ROUTINE[el.getAttribute('data-routine')] || []).filter(function(s){ return byId(s.id); });
      el.innerHTML = steps.map(function(s, i){ var p = byId(s.id);
        return '<li><span class="r-num">' + (i + 1) + '</span><span class="r-step">' + s.step + '</span>' + mini(p) + '</li>'; }).join('');
    });
  });
}
/* product page: the story below the buy box (ingredients, formulation, how to use, FAQs, shopping controls) */
function routinePlace(p){
  var out = [];
  ['am', 'pm'].forEach(function(t){ var steps = ROUTINE[t].filter(function(s){ return byId(s.id) || s.id === p.id; });
    steps.forEach(function(s, i){ if (s.id === p.id) out.push((t === 'am' ? 'Morning' : 'Evening') + ': step ' + (i + 1) + ' of ' + steps.length + ' (' + s.step.toLowerCase() + ')'); }); });
  return out;
}
function pdStory(p, faqs){
  var ings = ingFor(p), place = routinePlace(p);
  var steps = String(p.how_to_use || 'Use as directed on the pack. Patch test before first use.').replace(/\.\s+/g, '.\n').split('\n').filter(Boolean);
  return '<div class="pd-story">' +
    '<section class="pd-sec" id="ingredients"><div class="pd-sec-head"><span class="eyebrow">Key ingredients</span><h2>What\u2019s inside</h2></div><div class="pd-sec-body">' +
      (p.ingredients && p.ingredients.length ? '<ul class="ing-list">' + p.ingredients.map(function(n){ var d = INGREDIENTS.filter(function(i){ return n.toLowerCase().indexOf(i.key) >= 0 || (i.also && n.toLowerCase().indexOf(i.also) >= 0); })[0];
        return '<li><strong>' + esc(n) + '</strong>' + (d ? '<span>' + esc(d.text) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="note">Key ingredients only. The complete ingredient list is printed on the pack. <a href="/ingredients">About our ingredients</a></p></div></section>' +
    '<section class="pd-sec" id="formulation"><div class="pd-sec-head"><span class="eyebrow">Our formulation</span><h2>How it works</h2></div><div class="pd-sec-body">' +
      '<p class="lead">' + esc(p.description || p.short || '') + '</p>' +
      (place.length ? '<dl class="facts"><dt>In your routine</dt><dd>' + place.map(esc).join('<br>') + '</dd>' + (p.size ? '<dt>Size</dt><dd>' + esc(p.size) + '</dd>' : '') + (ings.length ? '<dt>Key ingredients</dt><dd>' + ings.slice(0, 3).map(function(i){ return esc(i.name); }).join(', ') + '</dd>' : '') + '</dl>' : '') +
    '</div></section>' +
    '<section class="pd-sec" id="how-to-use"><div class="pd-sec-head"><span class="eyebrow">Ritual</span><h2>How to use</h2></div><div class="pd-sec-body"><ol class="use-steps">' + steps.map(function(s){ return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div></section>' +
    '<section class="pd-sec" id="faqs"><div class="pd-sec-head"><span class="eyebrow">Questions</span><h2>FAQs</h2></div><div class="pd-sec-body accs">' + faqs.map(function(f){ return acc(esc(f.q), '<p>' + esc(f.a) + '</p>'); }).join('') + '</div></section>' +
    '<section class="buy-band" aria-label="Buy ' + esc(p.name) + '"><img src="' + esc(img(p.image)) + '" alt="" width="96" height="96" loading="lazy"><div><strong>' + esc(p.name) + '</strong><span>' + (p.size ? esc(p.size) + ' \u00B7 ' : '') + inr(p.price) + '</span></div>' +
      (p.in_stock ? '<button class="btn" type="button" id="band-add">Add to Bag</button>' : '<button class="btn" type="button" disabled>Out of stock</button>') + '</section>' +
  '</div>';
}
/* skin finder: 4 questions -> a routine from real products, using only their own directions */
var QUIZ = [
  {k:'concern', q:'What would you most like your routine to focus on?', o:CONCERNS.map(function(c){ return [c.slug, c.name]; })},
  {k:'skin', q:'By midday, how does your skin usually feel?', o:[['dry','Tight or dry'],['oily','Shiny all over'],['combo','Shiny in the T-zone, dry elsewhere'],['normal','Comfortable']]},
  {k:'time', q:'When will you use it?', o:[['am','Mornings'],['pm','Evenings'],['both','Morning and evening']]},
  {k:'steps', q:'How many steps feel right?', o:[['few','Keep it to two or three'],['full','The full routine']]}
];
function finderPlan(a){
  var serums = {'dullness':['vitamin-c-serum'], 'dark-spots':['vitamin-c-serum'], 'uneven-tone':['niacinamide-serum'], 'dehydration':[]}[a.concern] || [];
  var plan = {am: [], pm: []}, why = [];
  var c = CONCERNS.filter(function(x){ return x.slug === a.concern; })[0]; if (c) why.push(c.why);
  function add(t, id){ if (byId(id) && plan[t].indexOf(id) < 0) plan[t].push(id); }
  var full = a.steps === 'full', moist = full || a.skin === 'dry' || a.concern === 'dehydration';
  ['am', 'pm'].forEach(function(t){
    if (a.time !== 'both' && a.time !== t) return;
    if (full || a.concern === 'dehydration') add(t, 'hydrating-face-wash');
    var s = serums.slice();
    if (t === 'pm') s = s.filter(function(id){ return id !== 'vitamin-c-serum'; });   // Vitamin C is a morning step in its own directions
    if (t === 'pm' && !s.length && a.concern !== 'dehydration') s = ['niacinamide-serum'];
    if (a.skin === 'oily' && full && s.indexOf('niacinamide-serum') < 0) s.push('niacinamide-serum');
    s.forEach(function(id){ add(t, id); });
    if (moist) add(t, 'daily-moisturizer');
    if (t === 'am') add(t, 'sunscreen-spf50');
  });
  if (a.time === 'pm') why.push('Sunscreen belongs in the morning, so it is not in an evening-only routine; Vitamin C is a morning step in its own directions.');
  if (a.skin === 'dry' && a.concern !== 'dehydration') why.push('You said your skin feels tight, so moisturiser is in.');
  if (a.skin === 'oily') why.push('The moisturiser is a light gel-cream; the Niacinamide serum is water-light.');
  return {plan: plan, why: why};
}
function renderFinder(){
  var root = $('#finder-root'); if (!root) return;
  var a = {}, i = 0;
  function draw(){
    if (i >= QUIZ.length) return result();
    var q = QUIZ[i];
    root.innerHTML = '<div class="quiz"><p class="q-prog">Question ' + (i + 1) + ' of ' + QUIZ.length + '</p><div class="q-bar"><span style="width:' + Math.round(i / QUIZ.length * 100) + '%"></span></div>' +
      '<fieldset><legend><h3>' + esc(q.q) + '</h3></legend><div class="q-opts">' + q.o.map(function(o){ return '<button type="button" class="q-opt' + (a[q.k] === o[0] ? ' on' : '') + '" data-v="' + o[0] + '">' + esc(o[1]) + '</button>'; }).join('') + '</div></fieldset>' +
      (i ? '<button type="button" class="linkbtn" id="q-back">Back</button>' : '') + '</div>';
    $$('.q-opt', root).forEach(function(b){ b.addEventListener('click', function(){ a[q.k] = b.getAttribute('data-v'); i++; draw(); var h = $('.quiz h3, .finder-result h3', root); if (h) { h.setAttribute('tabindex', '-1'); h.focus({preventScroll:true}); } }); });
    var bk = $('#q-back'); if (bk) bk.addEventListener('click', function(){ i--; draw(); });
  }
  function result(){
    loadCatalog().then(function(){
      var r = finderPlan(a), ids = [];
      var col = function(t, label){ var l = r.plan[t]; if (!l.length) return ''; l.forEach(function(id){ if (ids.indexOf(id) < 0) ids.push(id); });
        return '<div class="fr-col"><span class="eyebrow">' + label + '</span><ol class="routine">' + l.map(function(id, n){ return '<li><span class="r-num">' + (n + 1) + '</span>' + mini(byId(id)) + '</li>'; }).join('') + '</ol></div>'; };
      var cols = col('am', 'Morning') + col('pm', 'Evening');
      var list = pick(ids).filter(function(p){ return p.in_stock; });
      root.innerHTML = '<div class="finder-result"><span class="eyebrow">Your Avermontis routine</span><h3>' + esc((CONCERNS.filter(function(c){ return c.slug === a.concern; })[0] || {}).name || 'Your') + ' \u2014 ' + ids.length + (ids.length === 1 ? ' product' : ' products') + '</h3>' +
        (cols ? '<div class="fr-cols">' + cols + '</div>' : '<p class="muted">We could not build a routine from the current collection.</p>') +
        r.why.map(function(w){ return '<p class="small">' + esc(w) + '</p>'; }).join('') +
        '<p class="note">Built only from our product directions. It is a starting point, not a diagnosis. Patch test before first use.</p>' +
        '<div class="fr-acts">' + (list.length ? '<button class="btn" type="button" id="fr-add">Add ' + (list.length > 1 ? 'all ' + list.length + ' ' : '') + 'to Bag</button>' : '') + '<button class="btn ghost" type="button" id="fr-again">Start again</button></div></div>';
      var ad = $('#fr-add'); if (ad) ad.addEventListener('click', function(){ list.forEach(function(p){ addToCart(p.id, 1); }); });
      $('#fr-again').addEventListener('click', function(){ a = {}; i = 0; draw(); });
    });
  }
  draw();
}
function markNav(){
  var path = location.pathname.replace(/\/$/, '') || '/';
  $$('.menu a, .drawer-nav a').forEach(function(a){ var h = a.getAttribute('href'); if (h === path || (h !== '/' && h.indexOf('#') < 0 && path.indexOf(h + '/') === 0)) a.setAttribute('aria-current', 'page'); });
}

function boot(){
  header(); offline(); updateCount(); config(); cookieNotice(); newsletterForms();
  loadCatalog().then(updateCount);
  renderFeatured(); renderShop(); renderProduct(); renderCart(); renderCheckout(); renderSuccess();
  renderCategory(); renderCollection(); renderCollections(); renderConcerns(); renderIngredients(); renderRoutine(); renderFinder(); markNav();
  renderLogin(); renderSignup(); renderForgot(); renderReset(); renderAccount(); renderTrack(); renderContact();
  var y = $('#year'); if (y) y.textContent = new Date().getFullYear();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

/* ---------- 3D tilt on product cards (hover on desktop, press on touch) ---------- */
(function(){
  if (!window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var cur = null, raf = 0, px = 0, py = 0;
  function apply(){
    raf = 0; if (!cur) return;
    var r = cur.getBoundingClientRect(); if (!r.width) return;
    var x = Math.max(0, Math.min(1, (px - r.left) / r.width)) - .5, y = Math.max(0, Math.min(1, (py - r.top) / r.height)) - .5;
    var s = cur.style;
    s.setProperty('--rx', (-y * 7).toFixed(2) + 'deg'); s.setProperty('--ry', (x * 9).toFixed(2) + 'deg');
    s.setProperty('--gx', ((x + .5) * 100).toFixed(1) + '%'); s.setProperty('--gy', ((y + .5) * 100).toFixed(1) + '%');
    cur.classList.add('tilt-on');
  }
  function reset(c){ if (!c) return; c.classList.remove('tilt-on'); ['--rx','--ry','--gx','--gy'].forEach(function(k){ c.style.removeProperty(k); }); }
  function track(e){
    var c = e.target && e.target.closest ? e.target.closest('.card') : null;
    if (c !== cur) { reset(cur); cur = c; }
    if (!c) return;
    px = e.clientX; py = e.clientY;
    if (!raf) raf = requestAnimationFrame(apply);
  }
  document.addEventListener('pointermove', function(e){ if (e.pointerType === 'mouse' || e.pointerType === 'pen') track(e); }, { passive: true });
  document.addEventListener('pointerdown', function(e){ if (e.pointerType === 'touch') track(e); }, { passive: true });
  function release(e){ if (e.pointerType === 'touch') { var c = cur; cur = null; setTimeout(function(){ reset(c); }, 180); } }
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', function(){ var c = cur; cur = null; reset(c); }, { passive: true });
  document.addEventListener('mouseleave', function(){ reset(cur); cur = null; });
})();
