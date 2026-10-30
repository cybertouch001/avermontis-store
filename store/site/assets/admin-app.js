/* =====================================================================================================
   AVERMONTIS ADMIN (v6) - the owner's own app. Runs at /admin/app on the store site: inside the
   "Avermontis Admin" Android app (Capacitor shell, package bot.tab.sites.avermontis.admin) or in any browser.
   Home (today, open orders, 7/30-day sales chart, low stock), Orders (search, filters, one-tap status, call /
   WhatsApp, invoice, CSV), Stock (quick +/- and price), More (every v5 admin area + app settings: dark mode,
   app lock, new-order alerts). Owner session = the same HttpOnly cookie, idle sign-out and lockout as /admin.
   ===================================================================================================== */
(function(){
'use strict';
var VERSION = '6.0.0';
var $ = function(s, r){ return (r || document).querySelector(s); };
var $$ = function(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function inr(n){ return '\u20B9' + Number(n || 0).toLocaleString('en-IN'); }
function when(iso){ try { var d = new Date(iso), now = new Date(); var sameDay = d.toDateString() === now.toDateString();
  return d.toLocaleString('en-IN', sameDay ? {timeZone:'Asia/Kolkata', hour:'numeric', minute:'2-digit'} : {timeZone:'Asia/Kolkata', day:'numeric', month:'short', hour:'numeric', minute:'2-digit'}); } catch(e){ return ''; } }
var store = { get: function(k, d){ try { var v = localStorage.getItem('avmA.' + k); return v === null ? d : JSON.parse(v); } catch(e){ return d; } }, set: function(k, v){ try { localStorage.setItem('avmA.' + k, JSON.stringify(v)); } catch(e){} } };
var C = window.Capacitor, P = (C && C.Plugins) || {};
var NATIVE = !!P.AvmAdmin;
var N = P.AvmAdmin;
function toast(m){ var t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function(){ t.classList.remove('show'); }, 2600); }
function buzz(ms){ try { if (N && N.vibrate) N.vibrate({ms: ms || 20}); else if (navigator.vibrate) navigator.vibrate(ms || 20); } catch(e){} }

function api(method, path, body){
  if (!navigator.onLine) return Promise.reject(Object.assign(new Error('You are offline. Connect to the internet and try again.'), {code: 'offline'}));
  var ctrl = ('AbortController' in window) ? new AbortController() : null;
  var timer = setTimeout(function(){ if (ctrl) ctrl.abort(); }, 20000);
  var opt = {method: method, headers: {'Accept': 'application/json'}, credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined};
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  return fetch(path, opt).then(function(r){
    clearTimeout(timer);
    var ct = r.headers.get('content-type') || '';
    if (ct.indexOf('application/json') < 0) throw Object.assign(new Error('The server did not answer properly. Try again in a minute.'), {status: r.status});
    return r.json().then(function(b){
      if (r.ok && b && b.ok) return b;
      var e = (b && b.error) || {};
      var err = Object.assign(new Error(e.message || 'Something went wrong.'), {status: r.status, code: e.code, fields: e.fields});
      if (r.status === 403 && /^\/api\/admin\//.test(path) && !/\/(login|setup-status)$/.test(path) && signedIn) { signedIn = false; setTimeout(function(){ loginView('Signed out (no activity for a while). Please sign in again.'); }, 0); }
      throw err;
    });
  }, function(err){ clearTimeout(timer); throw new Error(err && err.name === 'AbortError' ? 'The request took too long. Try again.' : 'Could not reach the server. Check your connection.'); });
}

var ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/></svg>',
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6" stroke-linecap="round"/></svg>',
  stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7.5 12 3l9 4.5-9 4.5z"/><path d="M3 7.5V16.5L12 21l9-4.5V7.5M12 12v9"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5" stroke-linecap="round"/></svg>'
};
var LABEL = {'new': 'New', confirmed: 'Confirmed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled'};
var signedIn = false, tab = 'home', summaryDays = store.get('days', 7);

/* ---------------- theme ---------------- */
function applyTheme(){ var t = store.get('theme', 'auto'); var dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  try { if (P.StatusBar) { P.StatusBar.setBackgroundColor({color: dark ? '#050706' : '#0E1311'}); P.StatusBar.setStyle({style: 'DARK'}); } } catch(e){} }
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch(e){}

/* ---------------- app lock (phone fingerprint / screen lock, or an app PIN) ---------------- */
function sha(s){ return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function(b){ return Array.prototype.map.call(new Uint8Array(b), function(x){ return ('0' + x.toString(16)).slice(-2); }).join(''); }); }
var unlocked = false, hiddenAt = 0;
function lockMode(){ return store.get('lock', 'off'); }      // off | device | pin
function showLock(){
  return new Promise(function(done){
    var mode = lockMode(); if (mode === 'off') { unlocked = true; return done(); }
    var L = $('#lock'); L.classList.remove('hidden');
    if (mode === 'device' && N && N.unlock) {
      L.innerHTML = '<div class="mark">A</div><h1 style="margin-top:14px">Avermontis Admin</h1><p class="muted">Locked</p><button class="btn" id="unlock-go" type="button">Unlock</button>';
      var go = function(){ N.unlock({title: 'Unlock Avermontis Admin', subtitle: 'Use your fingerprint, face or screen lock'}).then(function(r){ if (r && r.ok) { unlocked = true; L.classList.add('hidden'); L.innerHTML = ''; done(); } }, function(){}); };
      $('#unlock-go').addEventListener('click', go); go(); return;
    }
    L.innerHTML = '<div class="mark">A</div><h1 style="margin-top:14px">Enter app PIN</h1><form id="lock-f" class="pinrow"><input class="inp" id="lock-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" aria-label="App PIN"></form><p class="small muted" id="lock-msg">Forgot it? Sign in again with your owner password.</p><button class="btn ghost sm" id="lock-reset" type="button">Forgot PIN</button>';
    var inp = $('#lock-pin'); inp.focus();
    $('#lock-f').addEventListener('submit', function(e){ e.preventDefault(); check(); });
    inp.addEventListener('input', function(){ if (inp.value.length >= 4) check(true); });
    function check(soft){ sha('avmA:' + inp.value).then(function(h){ if (h === store.get('pinHash', '')) { unlocked = true; L.classList.add('hidden'); L.innerHTML = ''; done(); } else if (!soft || inp.value.length >= 6) { $('#lock-msg').textContent = 'Wrong PIN.'; inp.value = ''; buzz(60); } }); }
    $('#lock-reset').addEventListener('click', function(){ store.set('lock', 'off'); store.set('pinHash', ''); api('POST', '/api/admin/logout', {}).catch(function(){}).then(function(){ L.classList.add('hidden'); L.innerHTML = ''; unlocked = true; signedIn = false; loginView('App lock removed. Sign in with your owner password.'); done(); }); });
  });
}
document.addEventListener('visibilitychange', function(){
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (lockMode() !== 'off' && hiddenAt && Date.now() - hiddenAt > 60000) { unlocked = false; showLock(); }
  if (signedIn) { pulse(); if (tab === 'home') renderTab(); }
});

/* ---------------- login ---------------- */
function loginView(msg, step){
  signedIn = false; stopPulse();
  var app = $('#app');
  if (step && step.challenge) {
    app.innerHTML = '<form class="auth" id="pin-f" novalidate><div class="mark">A</div><h1>Owner PIN</h1><p class="sub">Second step: your 4\u20136 digit owner PIN.</p><div id="al"></div>' +
      '<div class="field"><label for="pin">Owner PIN</label><input class="inp" id="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>' +
      '<button class="btn block" id="go" type="submit">Continue</button><p class="note"><a href="#" id="back">Back</a></p></form>';
    $('#pin').focus();
    $('#back').addEventListener('click', function(e){ e.preventDefault(); loginView(); });
    $('#pin-f').addEventListener('submit', function(e){ e.preventDefault(); var v = $('#pin').value.trim(), b = $('#go');
      if (!/^\d{4,6}$/.test(v)) { $('#al').innerHTML = '<div class="alert">Enter 4 to 6 digits.</div>'; return; }
      b.disabled = true; b.innerHTML = '<span class="spin"></span>';
      api('POST', '/api/auth/admin-pin', {challenge: step.challenge, pin: v, app: 'admin'}).then(function(){ afterLogin(); }, function(err){ b.disabled = false; b.textContent = 'Continue'; $('#al').innerHTML = '<div class="alert">' + esc(err.message) + '</div>'; if (/sign in again/i.test(err.message)) setTimeout(function(){ loginView(); }, 1500); });
    });
    return;
  }
  app.innerHTML = '<form class="auth" id="login-f" novalidate autocomplete="on"><div class="mark">A</div><h1>Avermontis Admin</h1><p class="sub">Owner sign in</p><div id="al">' + (msg ? '<div class="alert">' + esc(msg) + '</div>' : '') + '</div>' +
    '<div class="field"><label for="u">Username</label><input class="inp" id="u" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="60"></div>' +
    '<div class="field"><label for="p">Password</label><div class="pw"><input class="inp" id="p" name="password" type="password" autocomplete="current-password" maxlength="128"><button type="button" id="eye">Show</button></div></div>' +
    '<button class="btn block" id="go" type="submit">Sign in</button>' +
    '<p class="note">5 wrong tries lock sign-in on this network for 15 minutes.</p></form>';
  $('#u').value = store.get('lastUser', ''); ($('#u').value ? $('#p') : $('#u')).focus();
  $('#eye').addEventListener('click', function(){ var p = $('#p'); p.type = p.type === 'password' ? 'text' : 'password'; this.textContent = p.type === 'password' ? 'Show' : 'Hide'; });
  $('#login-f').addEventListener('submit', function(e){ e.preventDefault(); var u = $('#u').value.trim(), p = $('#p').value, b = $('#go');
    if (!u || !p) { $('#al').innerHTML = '<div class="alert">Enter your username and password.</div>'; return; }
    b.disabled = true; b.innerHTML = '<span class="spin"></span>';
    api('POST', '/api/admin/login', {username: u, password: p, app: 'admin'}).then(function(r){
      store.set('lastUser', u);
      if (r.step === 'pin') return loginView(null, r);
      afterLogin();
    }, function(err){ b.disabled = false; b.textContent = 'Sign in'; $('#p').value = '';
      $('#al').innerHTML = '<div class="alert">' + esc(err.status === 409 ? 'The owner password has not been created yet. Open /admin/setup on the store website once.' : err.message) + '</div>'; buzz(60); });
  });
}
function afterLogin(){ signedIn = true; buzz(15); shell(); }

/* ---------------- shell ---------------- */
function shell(){
  var app = $('#app');
  app.innerHTML = '<header class="top"><span class="logo">AVER<b>MONTIS</b></span><span class="badge">ADMIN</span><span class="sp"></span>' +
    '<button class="ib" id="theme" type="button" aria-label="Light or dark">' + ICON.moon + '</button><button class="ib" id="refresh" type="button" aria-label="Refresh">' + ICON.refresh + '</button></header>' +
    '<main id="main"></main>' +
    '<nav class="nav" role="tablist">' + [['home', 'Home'], ['orders', 'Orders'], ['stock', 'Stock'], ['more', 'More']].map(function(t){ return '<button type="button" data-tab="' + t[0] + '">' + ICON[t[0]] + '<span>' + t[1] + '</span>' + (t[0] === 'orders' ? '<span class="dot hidden" id="dot"></span>' : '') + '</button>'; }).join('') + '</nav>';
  $$('.nav button').forEach(function(b){ b.addEventListener('click', function(){ go(b.getAttribute('data-tab')); }); });
  $('#refresh').addEventListener('click', function(){ renderTab(); pulse(); });
  $('#theme').addEventListener('click', function(){ var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; store.set('theme', t); applyTheme(); toast(t === 'dark' ? 'Dark mode' : 'Light mode'); });
  var h = (location.hash || '').slice(1); go(['home', 'orders', 'stock', 'more'].indexOf(h) >= 0 ? h : 'home');
  startPulse();
}
function go(t, opts){ tab = t; ordersState = Object.assign(ordersState, opts || {}); try { history.replaceState(null, '', '#' + t); } catch(e){}
  $$('.nav button').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-tab') === t); }); window.scrollTo(0, 0); renderTab(); }
function renderTab(){ var m = $('#main'); if (!m) return; ({home: homeTab, orders: ordersTab, stock: stockTab, more: moreTab})[tab](m); }
function loading(m){ m.innerHTML = '<div class="empty"><span class="spin"></span></div>'; }
function failBox(m, err, retry){ m.innerHTML = '<div class="card"><p>' + esc(err.message) + '</p><button class="btn ghost" type="button" id="retry">Try again</button></div>'; $('#retry', m).addEventListener('click', retry); }

/* ---------------- Home ---------------- */
function chart(series){
  var w = 320, h = 150, pad = 18, n = series.length, max = Math.max.apply(null, series.map(function(d){ return d.sales; }).concat([1]));
  var bw = (w - 8) / n, out = '';
  series.forEach(function(d, i){ var bh = Math.round((h - pad - 14) * d.sales / max); var x = 4 + i * bw + bw * 0.15, y = h - pad - bh;
    out += '<rect class="bar' + (i === n - 1 ? ' today' : '') + '" x="' + x.toFixed(1) + '" y="' + y + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + Math.max(bh, d.sales ? 2 : 0) + '" rx="2"><title>' + esc(d.date) + ': ' + inr(d.sales) + ', ' + d.orders + ' orders</title></rect>'; });
  var lbl = function(i){ var d = series[i].date.slice(5).split('-'); return d[1] + '/' + d[0]; };
  out += '<text class="ax" x="4" y="' + (h - 4) + '">' + lbl(0) + '</text><text class="ax" x="' + (w - 4) + '" y="' + (h - 4) + '" text-anchor="end">today</text>';
  out += '<text class="ax" x="4" y="10">' + inr(max) + '</text>';
  return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="Daily sales">' + out + '</svg>';
}
function homeTab(m){
  loading(m);
  api('GET', '/api/admin/app/summary?days=' + summaryDays).then(function(b){
    var s = b.summary; lastSummary = s;
    var hr = +new Date().toLocaleString('en-US', {timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false}) % 24; var hi = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    m.innerHTML = '<h1>' + hi + '</h1><p class="sub">Updated ' + when(new Date().toISOString()) + ' \u00B7 numbers from your live store</p>' +
      '<div class="grid">' +
        '<button class="kpi big" type="button" data-go="orders"><span>Today\u2019s sales</span><b>' + inr(s.today.revenue) + '</b><span>' + s.today.orders + ' order' + (s.today.orders === 1 ? '' : 's') + ' today (cancelled not counted)</span></button>' +
        '<button class="kpi' + (s.open.new ? ' hot' : '') + '" type="button" data-go="orders" data-st="new"><b>' + s.open.new + '</b><span>New \u2014 to confirm</span></button>' +
        '<button class="kpi" type="button" data-go="orders" data-st="confirmed"><b>' + s.open.confirmed + '</b><span>Packed \u2014 to ship</span></button>' +
        '<button class="kpi" type="button" data-go="orders" data-st="shipped"><b>' + s.open.shipped + '</b><span>On the way</span></button>' +
        '<button class="kpi' + (s.low_stock.length ? ' hot' : '') + '" type="button" data-go="stock"><b>' + s.low_stock.length + '</b><span>Low stock (\u2264' + s.low_stock_at + ')</span></button>' +
      '</div>' +
      '<div class="card"><div class="row"><div class="grow"><b>Sales</b><div class="small muted">' + inr(s.period.revenue) + ' \u00B7 ' + s.period.orders + ' orders in ' + s.period.days + ' days</div></div>' +
        '<div class="seg" id="days"><button type="button" data-d="7" class="' + (summaryDays === 7 ? 'on' : '') + '">7 days</button><button type="button" data-d="30" class="' + (summaryDays === 30 ? 'on' : '') + '">30 days</button></div></div>' + chart(s.series) + '</div>' +
      (s.low_stock.length ? '<h2>Low stock</h2><div class="card list">' + s.low_stock.slice(0, 6).map(function(p){ return '<div class="it"><div class="grow">' + esc(p.name) + '</div><span class="pill ' + (p.stock ? 'new' : 'cancelled') + '">' + (p.stock ? p.stock + ' left' : 'Sold out') + '</span></div>'; }).join('') + '<div class="it"><button class="btn ghost sm" type="button" data-go="stock">Update stock</button></div></div>' : '') +
      ((s.new_messages || s.pending_reviews) ? '<h2>Waiting for you</h2><div class="card list">' + (s.new_messages ? '<a class="it" href="/admin?app=1#messages" style="color:inherit;text-decoration:none"><div class="grow">Customer messages</div><span class="pill new">' + s.new_messages + ' new</span></a>' : '') + (s.pending_reviews ? '<a class="it" href="/admin?app=1#reviews" style="color:inherit;text-decoration:none"><div class="grow">Reviews to approve</div><span class="pill new">' + s.pending_reviews + '</span></a>' : '') + '</div>' : '') +
      '<h2>Recent orders</h2><div id="recent"><div class="empty"><span class="spin"></span></div></div>' +
      '<h2>Quick links</h2><div class="more">' + [['design', 'Design studio', 'Colours, fonts, themes'], ['customize', 'Store info & banners', 'Logo, hero, contact'], ['products', 'Edit products', 'Photos, text, prices']].map(function(x){ return '<a href="/admin?app=1#' + x[0] + '"><b>' + x[1] + '</b><span>' + x[2] + '</span></a>'; }).join('') + '</div>';
    $$('[data-go]', m).forEach(function(b){ b.addEventListener('click', function(){ go(b.getAttribute('data-go'), b.getAttribute('data-go') === 'orders' ? {status: b.getAttribute('data-st') || '', q: ''} : null); }); });
    $$('#days button', m).forEach(function(b){ b.addEventListener('click', function(){ summaryDays = +b.getAttribute('data-d'); store.set('days', summaryDays); homeTab(m); }); });
    api('GET', '/api/admin/orders?limit=5').then(function(r){ var el = $('#recent', m); if (!el) return; el.innerHTML = r.orders.length ? r.orders.map(orderCard).join('') : '<div class="card empty">No orders yet.</div>'; wireOrders(el); }, function(){ var el = $('#recent', m); if (el) el.innerHTML = ''; });
  }, function(err){ failBox(m, err, function(){ homeTab(m); }); });
}
var lastSummary = null;

/* ---------------- Orders ---------------- */
var ordersState = {status: '', q: '', offset: 0};
function digits(p){ return String(p || '').replace(/\D/g, ''); }
function waNumber(p){ var d = digits(p); if (d.length === 10) d = '91' + d; else if (d.length === 11 && d[0] === '0') d = '91' + d.slice(1); return d; }
function orderCard(o){
  var c = o.customer || {}, ph = digits(c.phone);
  var next = {'new': ['confirmed', 'Confirm & packed'], confirmed: ['shipped', 'Mark shipped'], shipped: ['delivered', 'Mark delivered']}[o.status];
  var wa = 'https://wa.me/' + waNumber(c.phone) + '?text=' + encodeURIComponent('Hello ' + (c.name || '') + ', this is Avermontis about your order ' + o.id + '.');
  return '<div class="order" data-id="' + esc(o.id) + '"><div class="hd"><div class="grow"><div class="id">' + esc(o.id) + '</div><div class="who">' + esc(c.name || '') + ' \u00B7 ' + esc(c.city || '') + ' \u00B7 ' + when(o.created_at) + '</div></div>' +
    '<div><div class="amt">' + inr(o.total) + '</div><span class="pill ' + esc(o.status) + '">' + esc(LABEL[o.status] || o.status) + '</span></div></div>' +
    '<div class="bd hidden">' +
      '<ul class="items">' + (o.items || []).map(function(i){ return '<li><span>' + esc(i.name) + (i.size ? ' <span class="muted">' + esc(i.size) + '</span>' : '') + ' \u00D7 ' + i.qty + '</span><span>' + inr(i.total) + '</span></li>'; }).join('') +
        (o.discount ? '<li><span class="muted">Discount' + (o.coupon ? ' (' + esc(o.coupon) + ')' : '') + '</span><span>\u2212' + inr(o.discount) + '</span></li>' : '') +
        '<li><span class="muted">Shipping</span><span>' + (o.shipping ? inr(o.shipping) : 'Free') + '</span></li><li><b>Total (' + esc(o.payment || 'COD') + ')</b><b>' + inr(o.total) + '</b></li></ul>' +
      '<p><b>' + esc(c.name || '') + '</b><br>' + esc(c.address || '') + '<br>' + esc([c.city, c.state, c.pincode].filter(Boolean).join(', ')) + '<br><span class="muted">' + esc(c.phone || '') + (c.email ? ' \u00B7 ' + esc(c.email) : '') + '</span></p>' +
      (c.notes ? '<p class="small"><b>Note:</b> ' + esc(c.notes) + '</p>' : '') +
      '<div class="acts">' +
        (next ? '<button class="btn sm" type="button" data-st="' + next[0] + '">' + next[1] + '</button>' : '') +
        (ph ? '<a class="btn ghost sm" href="tel:+' + waNumber(c.phone) + '">Call</a><a class="btn ghost sm" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') +
        (o.invoice_url ? '<a class="btn ghost sm" href="' + esc(o.invoice_url) + '">Invoice</a><button class="btn ghost sm" type="button" data-share="' + esc(o.invoice_url) + '">Share invoice</button>' : '') +
        '<button class="btn ghost sm" type="button" data-copy="1">Copy address</button>' +
        ((o.status === 'new' || o.status === 'confirmed') ? '<button class="btn bad sm" type="button" data-st="cancelled">Cancel order</button>' : '') +
      '</div></div></div>';
}
function wireOrders(root){
  $$('.order', root).forEach(function(card){
    if (card._w) return; card._w = true;
    $('.hd', card).addEventListener('click', function(){ $('.bd', card).classList.toggle('hidden'); });
    $$('[data-st]', card).forEach(function(b){ b.addEventListener('click', function(){
      var st = b.getAttribute('data-st'), id = card.getAttribute('data-id');
      if (st === 'cancelled' && !confirm('Cancel order ' + id + '? The stock goes back on the shelf.')) return;
      b.disabled = true;
      api('PATCH', '/api/admin/orders/' + encodeURIComponent(id), {status: st, note: st === 'confirmed' ? 'Packed (Admin app)' : 'Admin app'}).then(function(){
        buzz(20); toast(id + ' \u2192 ' + LABEL[st]);
        return api('GET', '/api/admin/orders?q=' + encodeURIComponent(id) + '&limit=1');
      }).then(function(r){ var o = r.orders.filter(function(x){ return x.id === id; })[0]; if (!o) return; var tmp = document.createElement('div'); tmp.innerHTML = orderCard(o); var nc = tmp.firstChild; card.parentNode.replaceChild(nc, card); $('.bd', nc).classList.remove('hidden'); wireOrders(nc.parentNode); pulse(); })
        .catch(function(err){ b.disabled = false; toast(err.message); });
    }); });
    var sh = $('[data-share]', card);
    if (sh) sh.addEventListener('click', function(){ var url = sh.getAttribute('data-share'), id = card.getAttribute('data-id'); share('Invoice ' + id, 'Avermontis invoice for order ' + id + ': ' + url, url); });
    var cp = $('[data-copy]', card);
    if (cp) cp.addEventListener('click', function(){ var p = $('.bd p', card); copy(p ? p.innerText : ''); });
  });
}
function share(title, text, url){
  if (N && N.share) return N.share({title: title, text: text}).catch(function(e){ toast(e.message || 'Could not share'); });
  if (navigator.share) return navigator.share({title: title, text: text, url: url}).catch(function(){});
  copy(url);
}
function copy(t){ (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t) : Promise.reject()).then(function(){ toast('Copied'); }, function(){ var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied'); } catch(e){} ta.remove(); }); }
var searchTimer;
function ordersTab(m){
  m.innerHTML = '<div class="row" style="margin-bottom:6px"><h1 class="grow">Orders</h1><a class="btn ghost sm" id="csv" href="/api/admin/export/orders.csv" download>CSV</a></div>' +
    '<label class="search">' + ICON.search + '<input id="q" type="search" placeholder="Order no., name, phone, city, pincode" value="' + esc(ordersState.q) + '" enterkeyhint="search"></label>' +
    '<div class="chips" id="chips">' + [['', 'All'], ['new', 'New'], ['confirmed', 'Packed'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']].map(function(x){ return '<button class="chip' + (ordersState.status === x[0] ? ' on' : '') + '" type="button" data-s="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
    '<div id="olist"></div><div id="omore"></div>';
  $$('#chips .chip', m).forEach(function(b){ b.addEventListener('click', function(){ ordersState.status = b.getAttribute('data-s'); $$('#chips .chip', m).forEach(function(x){ x.classList.toggle('on', x === b); }); loadOrders(m, false); }); });
  $('#q', m).addEventListener('input', function(){ var v = this.value; clearTimeout(searchTimer); searchTimer = setTimeout(function(){ ordersState.q = v.trim(); loadOrders(m, false); }, 350); });
  $('#csv', m).addEventListener('click', function(){ toast('Downloading all orders (CSV)\u2026'); });
  loadOrders(m, false);
}
function loadOrders(m, append){
  var list = $('#olist', m), more = $('#omore', m);
  if (!append) { ordersState.offset = 0; list.innerHTML = '<div class="empty"><span class="spin"></span></div>'; }
  var qs = '?limit=30&offset=' + ordersState.offset + (ordersState.status ? '&status=' + ordersState.status : '') + (ordersState.q ? '&q=' + encodeURIComponent(ordersState.q) : '');
  api('GET', '/api/admin/orders' + qs).then(function(r){
    if (!append) list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', r.orders.map(orderCard).join(''));
    if (!list.children.length) list.innerHTML = '<div class="card empty">' + (ordersState.q ? 'No order matches \u201C' + esc(ordersState.q) + '\u201D.' : 'No orders here yet.') + '</div>';
    wireOrders(list);
    more.innerHTML = r.orders.length === 30 ? '<button class="btn ghost block" type="button" id="lm">Load more</button>' : '';
    var lm = $('#lm', more); if (lm) lm.addEventListener('click', function(){ ordersState.offset += 30; lm.disabled = true; loadOrders(m, true); });
  }, function(err){ failBox(list, err, function(){ loadOrders(m, false); }); });
}

/* ---------------- Stock ---------------- */
var stockFilter = '';
function stockTab(m){
  loading(m);
  api('GET', '/api/admin/products').then(function(r){
    var prods = r.products.slice().sort(function(a, b){ return (a.active === b.active ? 0 : a.active ? -1 : 1) || a.stock - b.stock || a.name.localeCompare(b.name); });
    m.innerHTML = '<div class="row"><h1 class="grow">Stock &amp; prices</h1><a class="btn ghost sm" href="/admin?app=1#products">Full editor</a></div><p class="sub">Tap \u2212/+ to change stock. Tap the price to change it. Low stock = 5 or less.</p>' +
      '<label class="search">' + ICON.search + '<input id="sf" type="search" placeholder="Find a product" value="' + esc(stockFilter) + '"></label>' +
      '<div class="card list stock" id="sl">' + prods.map(function(p){
        return '<div class="it' + (p.stock === 0 ? ' zero' : p.stock <= 5 ? ' low' : '') + '" data-id="' + esc(p.id) + '" data-name="' + esc(p.name.toLowerCase()) + '"><div class="grow"><div>' + esc(p.name) + (p.size ? ' <span class="muted small">' + esc(p.size) + '</span>' : '') + '</div>' +
          '<button class="btn ghost sm" type="button" data-price="' + p.price + '" style="margin-top:4px;padding:4px 9px">' + inr(p.price) + '</button>' + (p.active ? '' : ' <span class="pill">Hidden</span>') + '</div>' +
          '<div class="q"><button class="btn ghost sm" type="button" data-d="-1" aria-label="One less">\u2212</button><b class="n">' + p.stock + '</b><button class="btn ghost sm" type="button" data-d="1" aria-label="One more">+</button><button class="btn ghost sm" type="button" data-set="1" aria-label="Set stock">Set</button></div></div>';
      }).join('') + '</div>';
    var sf = $('#sf', m); function filt(){ var v = sf.value.trim().toLowerCase(); stockFilter = v; $$('#sl .it', m).forEach(function(it){ it.classList.toggle('hidden', v && it.getAttribute('data-name').indexOf(v) < 0); }); }
    sf.addEventListener('input', filt); filt();
    $$('#sl .it', m).forEach(function(it){
      var id = it.getAttribute('data-id'), n = $('b.n', it);
      function save(body){ $$('button', it).forEach(function(b){ b.disabled = true; });
        return api('PATCH', '/api/admin/products/' + encodeURIComponent(id) + '/quick', body).then(function(r){ n.textContent = r.product.stock; $('[data-price]', it).textContent = inr(r.product.price); $('[data-price]', it).setAttribute('data-price', r.product.price);
          it.classList.toggle('zero', r.product.stock === 0); it.classList.toggle('low', r.product.stock > 0 && r.product.stock <= 5); buzz(10); }, function(err){ toast(err.message); })
          .then(function(){ $$('button', it).forEach(function(b){ b.disabled = false; }); }); }
      $$('[data-d]', it).forEach(function(b){ b.addEventListener('click', function(){ var v = Math.max(0, (+n.textContent) + (+b.getAttribute('data-d'))); save({stock: v}); }); });
      $('[data-set]', it).addEventListener('click', function(){ var v = prompt('Stock for this product:', n.textContent); if (v === null) return; v = parseInt(v, 10); if (!(v >= 0)) return toast('Enter a whole number, 0 or more.'); save({stock: v}); });
      $('[data-price]', it).addEventListener('click', function(){ var cur = this.getAttribute('data-price'); var v = prompt('New price in \u20B9 (whole rupees):', cur); if (v === null) return; v = parseInt(String(v).replace(/[^0-9]/g, ''), 10); if (!(v >= 1)) return toast('Enter a price of at least \u20B91.'); if (String(v) === cur) return; save({price: v}).then(function(){ toast('Price saved \u2014 live in the store now'); }); });
    });
  }, function(err){ failBox(m, err, function(){ stockTab(m); }); });
}

/* ---------------- More ---------------- */
var AREAS = [['design', 'Design studio', 'Themes, colours, fonts, layout'], ['customize', 'Store info & banners', 'Name, logo, hero, offers, contact'], ['products', 'Products', 'Add, photos, text, prices'], ['customers', 'Customers', 'Accounts and orders'],
  ['coupons', 'Coupons', 'Discount codes'], ['reviews', 'Reviews', 'Approve or hide'], ['messages', 'Messages', 'Contact-form inbox'], ['assistant', 'Chatbot', 'Answers, chats, test'], ['bargains', 'Bargaining', 'Price talks + floor'],
  ['notify', 'Notifications', 'Order e-mails, alerts'], ['ar', 'AR & 3D', 'Try-on settings'], ['overview', 'Insights', 'Full dashboard'], ['subscribers', 'Subscribers', 'Newsletter list'], ['logins', 'Login history', 'All sign-ins'],
  ['security', 'Security', 'Password, PIN, devices'], ['audit', 'Audit log', 'Every change you made'], ['backup', 'Backup', 'Download / restore'], ['settings', 'Settings', 'Shop settings, e-mail']];
function sw(id, on){ return '<label class="sw"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '><i></i></label>'; }
function moreTab(m){
  var lm = lockMode(), th = store.get('theme', 'auto');
  m.innerHTML = '<h1>More</h1><p class="sub">Everything from the full owner dashboard opens inside this app.</p>' +
    '<div class="more">' + AREAS.map(function(a){ return '<a href="/admin?app=1#' + a[0] + '"><b>' + a[1] + '</b><span>' + a[2] + '</span></a>'; }).join('') + '</div>' +
    '<h2>App settings</h2><div class="card">' +
      '<div class="set"><div class="grow">Look<span>Light, dark or follow the phone</span></div><div class="seg" id="th">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function(x){ return '<button type="button" data-t="' + x[0] + '" class="' + (th === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="set"><div class="grow">App lock<span>' + (NATIVE ? 'Fingerprint / face / screen lock when the app opens' : 'Ask for an app PIN when this page opens') + '</span></div>' + sw('lk', lm !== 'off') + '</div>' +
      '<div class="set"><div class="grow">New-order alert<span>Checks every minute while the app is open' + (NATIVE ? ' or in the background' : '') + '</span></div>' + sw('alert', store.get('alert', true)) + '</div>' +
      (NATIVE ? '<div class="set"><div class="grow">Alert when the app is closed<span>Checks about every 15 minutes (Android decides the exact time). Reads only the number of new orders.</span></div>' + sw('bg', store.get('bg', false)) + '</div>' : '') +
    '</div>' +
    '<h2>Account</h2><div class="card">' +
      '<div class="set"><div class="grow">Signed in as admin<span>Auto sign-out after no activity (set in Security)</span></div><button class="btn ghost sm" id="out" type="button">Sign out</button></div>' +
      '<div class="set"><div class="grow">Lost a phone?<span>Sign out every device in Security</span></div><a class="btn ghost sm" href="/admin?app=1#security">Security</a></div>' +
      '<div class="set"><div class="grow">Store website<span>Opens in your browser</span></div><a class="btn ghost sm" href="https://avermontis.sites.tab.bot/?view=site" target="_blank" rel="noopener">Open</a></div>' +
    '</div><p class="note">Avermontis Admin ' + (NATIVE ? 'app 1.0' : 'web') + ' \u00B7 store ' + VERSION + '</p>';
  $$('#th button', m).forEach(function(b){ b.addEventListener('click', function(){ store.set('theme', b.getAttribute('data-t')); applyTheme(); $$('#th button', m).forEach(function(x){ x.classList.toggle('on', x === b); }); }); });
  $('#lk', m).addEventListener('change', function(){ var cb = this;
    if (!cb.checked) { store.set('lock', 'off'); store.set('pinHash', ''); toast('App lock off'); return; }
    if (NATIVE && N.lockAvailable) { N.lockAvailable().then(function(r){ if (r && r.available) { N.unlock({title: 'Turn on app lock', subtitle: 'Confirm it is you'}).then(function(x){ if (x && x.ok) { store.set('lock', 'device'); toast('App lock on'); } else cb.checked = false; }, function(){ cb.checked = false; }); } else setPin(cb); }, function(){ setPin(cb); }); }
    else setPin(cb);
  });
  $('#alert', m).addEventListener('change', function(){ store.set('alert', this.checked); if (this.checked) { askNotify(); startPulse(); } else stopPulse(); });
  var bg = $('#bg', m);
  if (bg) bg.addEventListener('change', function(){ var cb = this; cb.disabled = true;
    if (cb.checked) { askNotify(); api('POST', '/api/admin/app/alert-key', {}).then(function(r){ return N.startWatch({key: r.key, url: location.origin + '/api/admin/app/peek', since: store.get('seenAt', '') || ''}); }).then(function(){ store.set('bg', true); toast('Background alerts on'); }, function(err){ cb.checked = false; toast(err.message || 'Could not turn it on'); }).then(function(){ cb.disabled = false; }); }
    else { Promise.resolve(N.stopWatch()).then(function(){ return api('DELETE', '/api/admin/app/alert-key'); }).catch(function(){}).then(function(){ store.set('bg', false); cb.disabled = false; toast('Background alerts off'); }); }
  });
  $('#out', m).addEventListener('click', function(){ api('POST', '/api/admin/logout', {}).catch(function(){}).then(function(){ loginView('Signed out.'); }); });
}
function setPin(cb){
  var a = prompt('Choose a 4-6 digit app PIN (only for this phone):'); if (a === null || !/^\d{4,6}$/.test(a)) { cb.checked = false; if (a !== null) toast('PIN must be 4 to 6 digits.'); return; }
  var b = prompt('Type the same PIN again:'); if (b !== a) { cb.checked = false; toast('The PINs did not match.'); return; }
  sha('avmA:' + a).then(function(h){ store.set('pinHash', h); store.set('lock', 'pin'); toast('App PIN on'); });
}

/* ---------------- new-order alerts (while open) ---------------- */
var pulseTimer = null;
function askNotify(){ try { if (N && N.requestNotify) N.requestNotify(); else if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch(e){} }
function notify(title, body){
  try { if (N && N.notify) return N.notify({title: title, body: body}); } catch(e){}
  try { if (window.Notification && Notification.permission === 'granted' && document.hidden) new Notification(title, {body: body, icon: '/icons/icon-192.png'}); } catch(e){}
}
function pulse(){
  if (!signedIn) return;
  api('GET', '/api/admin/app/pulse').then(function(r){
    var d = $('#dot'); if (d) { d.textContent = r.new_orders; d.classList.toggle('hidden', !r.new_orders); }
    var seen = store.get('seenAt', '');
    if (r.latest_at && seen && r.latest_at > seen && store.get('alert', true)) {
      buzz(200); notify('New order on Avermontis', r.new_orders + ' new order' + (r.new_orders === 1 ? '' : 's') + ' waiting. Tap to open.');
      toast('New order! ' + (r.latest_id || ''));
      if (tab === 'home' || tab === 'orders') renderTab();
    }
    if (r.latest_at && (!seen || r.latest_at > seen)) { store.set('seenAt', r.latest_at); try { if (N && N.setSeen) N.setSeen({since: r.latest_at}); } catch(e){} }
  }, function(){});
}
function startPulse(){ stopPulse(); if (!store.get('alert', true)) { pulse(); return; } pulse(); pulseTimer = setInterval(pulse, 60000); }
function stopPulse(){ if (pulseTimer) clearInterval(pulseTimer); pulseTimer = null; }

/* ---------------- start ---------------- */
function start(){
  applyTheme();
  try { if (P.App && P.App.addListener) P.App.addListener('backButton', function(){ if (signedIn && tab !== 'home') go('home'); else if (P.App.minimizeApp) P.App.minimizeApp(); }); } catch(e){}
  try { if (P.SplashScreen) P.SplashScreen.hide(); } catch(e){}
  showLock().then(function(){
    api('GET', '/api/admin/me').then(function(){ signedIn = true; shell(); }, function(err){
      if (err.status === 403) loginView(); else { $('#app').innerHTML = '<div class="auth"><div class="mark">A</div><h1>Can\u2019t reach the store</h1><p class="sub">' + esc(err.message) + '</p><button class="btn block" id="again" type="button">Try again</button></div>'; $('#again').addEventListener('click', start); }
    });
  });
}
window.addEventListener('online', function(){ if (!signedIn) start(); });
start();
})();
