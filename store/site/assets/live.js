/* AVERMONTIS v4 live layer for the website: the store assistant (chat bubble), delivery check, share,
   store location map + hours, footer contacts, and the dashboard's live preview. Settings come from the owner's dashboard. */
(function () {
'use strict';
var $ = function (s, r) { return (r || document).querySelector(s); };
var CFG = {}; try { CFG = JSON.parse(($('#avm-cfg') || {}).textContent || '{}'); } catch (e) { CFG = {}; }
var UI = CFG.ui || {}, F = UI.features || {};
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function inr(n) { return '\u20B9' + Number(n || 0).toLocaleString('en-IN'); }
function api(method, path, body) {
  var o = { method: method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
  return fetch(path, o).then(function (r) { return r.json().then(function (b) { if (r.ok && b.ok) return b; var e = new Error((b.error && b.error.message) || 'Something went wrong.'); e.code = b.error && b.error.code; e.status = r.status; throw e; }); });
}
var I = {
  chat: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="9" cy="9.6" r="1" fill="currentColor"/><circle cx="12" cy="9.6" r="1" fill="currentColor"/><circle cx="15" cy="9.6" r="1" fill="currentColor"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  wa: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.6 8.4c.3-.6.6-.6.9-.6h.6c.2 0 .4 0 .6.5l.8 1.8c.1.2.1.4 0 .6l-.5.7c-.1.2-.1.4 0 .5.6 1.1 1.5 2 2.6 2.6.2.1.4.1.5 0l.7-.8c.2-.2.4-.2.6-.1l1.8.8c.3.1.4.3.4.5 0 .5-.2 1.3-.9 1.7-.6.3-1.6.5-3.2-.2-2-.9-3.4-2.5-4.2-3.8-.7-1.2-.7-2.2-.3-2.9z" fill="currentColor"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="6" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17.5" cy="6" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17.5" cy="18" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.2 10.9l7.1-3.7M8.2 13.1l7.1 3.7" stroke="currentColor" stroke-width="1.6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="11" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
};
function loadCss(href) { if ($('link[href="' + href + '"]')) return; var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
function loadJs(src) { return new Promise(function (ok, no) { if ($('script[src="' + src + '"]')) { ok(); return; } var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
var DAYS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
function t12(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); if (!m) return s; var h = +m[1], ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + (m[2] === '00' ? '' : ':' + m[2]) + ap; }
function hoursHtml(hours) {
  // group equal consecutive days: "Mon–Sat 10am–6pm · Sun closed"
  var out = [], i = 0;
  while (i < 7) { var h = hours[i], j = i; while (j + 1 < 7 && hours[j + 1].closed === h.closed && hours[j + 1].open === h.open && hours[j + 1].close === h.close) j++;
    var d = DAYS[h.day].slice(0, 3) + (j > i ? '\u2013' + DAYS[hours[j].day].slice(0, 3) : '');
    out.push('<span>' + d + ' ' + (h.closed ? 'closed' : t12(h.open) + '\u2013' + t12(h.close)) + '</span>'); i = j + 1; }
  return out.join(' \u00B7 ');
}

/* ---------- live preview inside the dashboard ---------- */
if (/[?&]avm_preview=1/.test(location.search) && window.parent !== window) {
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return; var d = e.data || {};
    if (d.type === 'avm-css') { var st = $('#avm-theme'); if (!st) { st = document.createElement('style'); st.id = 'avm-theme'; document.head.appendChild(st); } st.textContent = d.css || '';  var an = $('#announce-text'); if (an) { if (!an.dataset.orig) an.dataset.orig = an.textContent; an.textContent = d.announce || an.dataset.orig; } }
  });
  try { parent.postMessage({ type: 'avm-preview-ready' }, location.origin); } catch (e) {}
  document.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a'); if (a && a.href && a.href.indexOf(location.origin) === 0 && a.href.indexOf('avm_preview') < 0) { e.preventDefault(); location.href = a.href + (a.href.indexOf('?') < 0 ? '?' : '&') + 'avm_preview=1'; } }, true);
}

/* ---------- footer: real contact details only when the owner entered them ---------- */
(function footer() {
  var fb = $('.fbrand'); if (!fb) return;
  var c = UI.contact || {}, loc = UI.location;
  var soc = $('.socials', fb);
  if (soc && (c.instagram || c.facebook || c.youtube)) {
    var html = '';
    [['instagram', 'Instagram', 0], ['facebook', 'Facebook', 1], ['youtube', 'YouTube', 2]].forEach(function (x) { var sp = soc.children[x[2]]; if (c[x[0]] && sp) html += '<a href="' + esc(c[x[0]]) + '" target="_blank" rel="noopener" title="' + x[1] + '" aria-label="' + x[1] + '">' + sp.innerHTML + '</a>'; });
    soc.innerHTML = html; soc.setAttribute('aria-label', 'Social media');
  }
  var lines = [];
  if (loc && loc.address) lines.push(esc([loc.name, loc.address, loc.city, loc.pincode].filter(Boolean).join(', ')));
  if (c.phone) lines.push('<a href="tel:' + esc(c.phone) + '">' + esc(c.phone) + '</a>');
  if (lines.length) { var p = document.createElement('p'); p.className = 'small muted avm-foot-loc'; p.innerHTML = lines.join('<br>'); fb.appendChild(p); }
})();

/* ---------- contact page: the store location, hours and a map ---------- */
(function contact() {
  if (CFG.page !== '/contact') return;
  var loc = UI.location, list = $('.contact-list'); if (!list) return;
  var c = UI.contact || {};
  if (c.phone) { var li0 = document.createElement('li'); li0.innerHTML = '<strong>Phone</strong><br><a href="tel:' + esc(c.phone) + '">' + esc(c.phone) + '</a>'; list.insertBefore(li0, list.children[1] || null); }
  if (!loc) return;
  var hoursLi = Array.prototype.slice.call(list.children).filter(function (li) { return /Hours/.test(li.textContent); })[0];
  if (hoursLi && loc.hours) hoursLi.innerHTML = '<strong>Hours</strong> <span class="avm-open ' + (loc.open_now ? 'on' : 'off') + '">' + (loc.open_now ? 'Open now' : 'Closed now') + '</span><br>' + hoursHtml(loc.hours) + ' (IST)';
  var li = document.createElement('li');
  var dir = loc.lat != null && loc.lng != null ? 'https://www.google.com/maps/dir/?api=1&destination=' + loc.lat + ',' + loc.lng : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([loc.address, loc.city, loc.pincode].join(' '));
  li.innerHTML = '<strong>' + esc(loc.name || 'Visit us') + '</strong><br>' + esc([loc.address, loc.city, loc.pincode].filter(Boolean).join(', ')) + (loc.note ? '<br><span class="muted small">' + esc(loc.note) + '</span>' : '') +
    '<br><a href="' + dir + '" target="_blank" rel="noopener">' + I.pin + ' Get directions</a>' + (loc.lat != null ? '<div class="avm-map" id="avm-map" role="img" aria-label="Map showing our location"></div>' : '');
  list.appendChild(li);
  if (loc.lat != null && loc.lng != null) {
    loadCss('/assets/vendor/leaflet/leaflet.css');
    loadJs('/assets/vendor/leaflet/leaflet.js').then(function () {
      var L = window.L; var m = L.map('avm-map', { scrollWheelZoom: false, attributionControl: true }).setView([loc.lat, loc.lng], 15);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
      L.Icon.Default.imagePath = '/assets/vendor/leaflet/images/';
      L.marker([loc.lat, loc.lng]).addTo(m).bindPopup(esc(loc.name || 'AVERMONTIS'));
    }).catch(function () {});
  }
})();

/* ---------- product page: delivery check + share ---------- */
function onProduct(cb) {
  var root = $('#product-root'); if (!root) return;
  var done = false; function tryIt() { var info = $('.pd-info', root); if (info && !done) { done = true; cb(info); } }
  tryIt(); if (!done) new MutationObserver(function (m, obs) { tryIt(); if (done) obs.disconnect(); }).observe(root, { childList: true, subtree: true });
}
function pinBox(id) {
  return '<form class="avm-pin" id="' + id + '" novalidate><label for="' + id + '-in">' + I.pin + ' Check delivery</label><div class="avm-pin-row"><input id="' + id + '-in" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="Enter pincode" autocomplete="postal-code"><button type="submit" class="btn ghost sm">Check</button></div><p class="avm-pin-msg" role="status"></p></form>';
}
function wirePin(form) {
  var inp = $('input', form), msg = $('.avm-pin-msg', form);
  try { var last = localStorage.getItem('avm_pin'); if (last) inp.value = last; } catch (e) {}
  form.addEventListener('submit', function (e) {
    e.preventDefault(); var v = inp.value.replace(/\D/g, '');
    if (!/^[1-9]\d{5}$/.test(v)) { msg.className = 'avm-pin-msg bad'; msg.textContent = 'Enter a valid 6-digit pincode.'; return; }
    msg.className = 'avm-pin-msg'; msg.textContent = 'Checking\u2026';
    api('GET', '/api/delivery?pincode=' + v).then(function (b) { try { localStorage.setItem('avm_pin', v); } catch (e2) {} msg.className = 'avm-pin-msg ' + (b.serviceable ? 'ok' : 'bad'); msg.textContent = b.message; })
      .catch(function (err) { msg.className = 'avm-pin-msg bad'; msg.textContent = err.message; });
  });
}
onProduct(function (info) {
  if ($('#pd-sticky')) document.body.classList.add('has-pd-sticky');
  var id = new URLSearchParams(location.search).get('id') || '';
  var wrap = document.createElement('div'); wrap.className = 'avm-pd-extra';
  var name = ($('h1', info) || {}).textContent || 'AVERMONTIS';
  wrap.innerHTML = pinBox('avm-pin-pd') + '<div class="avm-pd-actions" id="avm-pd-actions">' +
    '<button type="button" class="avm-chip" id="avm-share">' + I.share + ' Share</button>' +
    '<a class="avm-chip" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(name + ' \u2014 ' + location.origin + '/product?id=' + id) + '">' + I.wa + ' WhatsApp</a></div>';
  var buy = $('#buy-now', info) || $('.pd-price', info);
  if (buy && buy.parentNode) buy.parentNode.insertBefore(wrap, buy.nextSibling); else info.appendChild(wrap);
  wirePin($('#avm-pin-pd'));
  $('#avm-share').addEventListener('click', function () {
    var url = location.origin + '/product?id=' + encodeURIComponent(id);
    if (navigator.share) navigator.share({ title: name, text: name + ' \u2014 AVERMONTIS', url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { var b = $('#avm-share'); b.textContent = 'Link copied'; });
  });
  document.dispatchEvent(new CustomEvent('avm:product', { detail: { id: id, info: info, actions: $('#avm-pd-actions') } }));
});
if (CFG.page === '/cart') {
  var tryCart = function () { var s = $('.summary, .cart-summary, #cart-summary, aside'); if (s && !$('#avm-pin-cart')) { var d = document.createElement('div'); d.innerHTML = pinBox('avm-pin-cart'); s.appendChild(d.firstChild); wirePin($('#avm-pin-cart')); return true; } };
  if (!tryCart()) { var mo = new MutationObserver(function () { if (tryCart()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); setTimeout(function () { mo.disconnect(); }, 15000); }
}

/* ---------- the store assistant ---------- */
if (F.chat !== false && !/[?&]avm_preview=1/.test(location.search)) (function chat() {
  var C = UI.chat || {}, KEY = 'avm_chat_v1';
  var st = { sid: null, lang: 'auto', msgs: [] };
  try { var sv = JSON.parse(localStorage.getItem(KEY) || 'null'); if (sv && sv.t > Date.now() - 6 * 3600e3) st = sv; } catch (e) {}
  function save() { st.t = Date.now(); st.msgs = st.msgs.slice(-40); try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  var GREET = { en: 'Hi! I\u2019m ' + (C.name || 'the AVERMONTIS assistant') + '. Ask me about products, your routine, an order, shipping or returns.', hinglish: 'Namaste! Main ' + (C.name || 'AVERMONTIS assistant') + ' hoon. Products, routine, order, shipping ya returns \u2014 kuch bhi poochiye.' };
  var QUICK = ['Suggest for oily skin', 'Morning routine', 'Track my order', 'Shipping & COD', 'Vitamin C serum price', 'Talk to a person'];
  var fab = document.createElement('button'); fab.type = 'button'; fab.className = 'avm-chat-fab'; fab.setAttribute('aria-label', 'Chat with ' + (C.name || 'our assistant'));
  fab.innerHTML = I.chat + '<span class="avm-fab-label">Ask us</span>';
  var box = document.createElement('section'); box.className = 'avm-chat'; box.setAttribute('aria-label', C.name || 'Store assistant'); box.hidden = true;
  box.innerHTML = '<header class="avm-ch-head"><span class="avm-ch-av" aria-hidden="true">A</span><div class="avm-ch-t"><b>' + esc(C.name || 'AVERMONTIS Assistant') + '</b><span>' + (C.ai ? 'AI assistant \u00B7 answers from our catalogue' : 'Automatic assistant \u00B7 answers from our catalogue') + '</span></div>' +
    '<select class="avm-ch-lang" aria-label="Language"><option value="auto">Auto</option><option value="en">English</option><option value="hinglish">Hinglish</option><option value="hi">\u0939\u093F\u0902\u0926\u0940</option></select>' +
    '<button type="button" class="avm-ch-x" aria-label="Close chat">' + I.x + '</button></header>' +
    '<div class="avm-ch-body" role="log" aria-live="polite"></div><div class="avm-ch-quick"></div>' +
    '<form class="avm-ch-form"><label class="sr" for="avm-ch-in">Message</label><input id="avm-ch-in" autocomplete="off" maxlength="600" placeholder="Type your question\u2026"><button type="submit" aria-label="Send">' + I.send + '</button></form>' +
    '<p class="avm-ch-note">Not medical advice. For orders and returns our team can also help on WhatsApp or email.</p>';
  document.body.appendChild(fab); document.body.appendChild(box); document.body.classList.add('has-avm-chat');
  // keep the bubble above the cookie notice while it is showing (it sits in the same corner on phones)
  var liftFab = function () { var c = document.querySelector('body > .cookie'); var r = c && c.getBoundingClientRect(); fab.style.bottom = r && r.height ? Math.max(18, Math.round(window.innerHeight - r.top + 12)) + 'px' : ''; };
  new MutationObserver(liftFab).observe(document.body, { childList: true }); window.addEventListener('resize', liftFab); liftFab(); setTimeout(liftFab, 800);
  var body = $('.avm-ch-body', box), quick = $('.avm-ch-quick', box), form = $('.avm-ch-form', box), inp = $('#avm-ch-in', box), langSel = $('.avm-ch-lang', box);
  langSel.value = st.lang || 'auto';
  langSel.addEventListener('change', function () { st.lang = langSel.value; save(); });
  function bubble(m) {
    var d = document.createElement('div'); d.className = 'avm-msg ' + (m.role === 'user' ? 'me' : 'bot');
    var h = '<p>' + esc(m.text).replace(/\n/g, '<br>') + '</p>';
    if (m.products && m.products.length) h += '<div class="avm-ch-cards">' + m.products.map(function (p) {
      return '<div class="avm-ch-card"><a href="/product?id=' + encodeURIComponent(p.id) + '"><img src="/' + esc(String(p.image || '').replace(/^\//, '')) + '" alt="" loading="lazy"><span><b>' + esc(p.name) + '</b><em>' + inr(p.price) + (p.size ? ' \u00B7 ' + esc(p.size) : '') + '</em></span></a>' +
        (p.in_stock === false ? '' : '<button type="button" class="avm-ch-add" data-add="' + esc(p.id) + '">Add to bag</button>') + '</div>'; }).join('') + '</div>';
    if (m.handoff && (m.handoff.whatsapp || m.handoff.email)) h += '<div class="avm-ch-hand">' + (m.handoff.whatsapp ? '<a class="avm-chip" href="' + esc(m.handoff.whatsapp) + '" target="_blank" rel="noopener">' + I.wa + ' WhatsApp us</a>' : '') + (m.handoff.email ? '<a class="avm-chip" href="mailto:' + esc(m.handoff.email) + '">Email ' + esc(m.handoff.email) + '</a>' : '') + '</div>';
    if (m.map) h += '<div class="avm-ch-hand"><a class="avm-chip" href="' + esc(m.map) + '" target="_blank" rel="noopener">' + I.pin + ' Directions</a></div>';
    d.innerHTML = h; body.appendChild(d); body.scrollTop = body.scrollHeight;
  }
  function chips(list) { quick.innerHTML = (list || []).slice(0, 6).map(function (q) { return '<button type="button" class="avm-q">' + esc(q) + '</button>'; }).join(''); }
  function render() { body.innerHTML = ''; if (!st.msgs.length) { bubble({ role: 'bot', text: C.greeting || GREET[st.lang === 'en' ? 'en' : (st.lang === 'auto' ? 'en' : 'hinglish')] }); chips(QUICK); } st.msgs.forEach(bubble); }
  function send(text) {
    text = String(text || '').trim(); if (!text) return;
    var um = { role: 'user', text: text }; st.msgs.push(um); bubble(um); chips([]); inp.value = ''; save();
    var typing = document.createElement('div'); typing.className = 'avm-msg bot typing'; typing.innerHTML = '<p><i></i><i></i><i></i></p>'; body.appendChild(typing); body.scrollTop = body.scrollHeight;
    api('POST', '/api/chat', { message: text, session_id: st.sid, lang: st.lang === 'auto' ? undefined : st.lang, source: 'web' }).then(function (b) {
      typing.remove(); st.sid = b.session_id; var r = b.reply; var bm = { role: 'bot', text: r.text, products: r.products, handoff: r.handoff, map: r.map };
      st.msgs.push(bm); bubble(bm); chips(r.quick); save();
    }).catch(function (err) { typing.remove(); bubble({ role: 'bot', text: err.message + (CFG.whatsapp ? '' : '') }); });
  }
  function open(on) { box.hidden = !on; fab.classList.toggle('on', on); document.body.classList.toggle('avm-chat-open', on); if (on) { render(); setTimeout(function () { inp.focus(); }, 60); } }
  fab.addEventListener('click', function () { open(box.hidden); });
  $('.avm-ch-x', box).addEventListener('click', function () { open(false); });
  form.addEventListener('submit', function (e) { e.preventDefault(); send(inp.value); });
  quick.addEventListener('click', function (e) { var b = e.target.closest('.avm-q'); if (b) send(b.textContent); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !box.hidden) open(false); });
  window.AvmChat = { open: function (text) { open(true); if (text) send(text); } };
})();
})();

/* v4: "Make an offer" + "View in 3D / your room" on the product page */
(function () {
'use strict';
var $ = function (s, r) { return (r || document).querySelector(s); };
var CFG = {}; try { CFG = JSON.parse(($('#avm-cfg') || {}).textContent || '{}'); } catch (e) {}
var UI = CFG.ui || {}, F = UI.features || {};
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function inr(n) { return '\u20B9' + Number(n || 0).toLocaleString('en-IN'); }
function api(method, path, body) {
  var o = { method: method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
  return fetch(path, o).then(function (r) { return r.json().then(function (b) { if (r.ok && b.ok) return b; var e = new Error((b.error && b.error.message) || 'Something went wrong.'); e.code = b.error && b.error.code; e.status = r.status; throw e; }); });
}
var TAG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/></svg>';
var CUBE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>';
document.addEventListener('avm:product', function (ev) {
  var d = ev.detail || {}, acts = d.actions; if (!acts || !d.id) return;
  api('GET', '/api/catalog').then(function (b) {
    var p = (b.products || []).filter(function (x) { return x.id === d.id; })[0]; if (!p) return;
    if (F.ar !== false && (!UI.ar || UI.ar.viewer !== false) && p.ar && p.ar.on !== false && p.ar.model) {
      var a = document.createElement('a'); a.className = 'avm-chip'; a.href = '/ar?p=' + encodeURIComponent(p.id); a.innerHTML = CUBE + ' View in 3D / your room'; acts.insertBefore(a, acts.firstChild);
    }
    if (F.bargain !== false && UI.bargain && UI.bargain.on && p.bargain_on !== false && p.in_stock !== false) {
      var o = document.createElement('button'); o.type = 'button'; o.className = 'avm-chip gold'; o.innerHTML = TAG + ' Make an offer'; acts.insertBefore(o, acts.firstChild);
      o.addEventListener('click', function () { offer(p); });
    }
  }).catch(function () {});
});
/* v4: "Make an offer" on each bag line of the cart page too */
if (/^\/cart\/?$/.test(location.pathname) && F.bargain !== false && UI.bargain && UI.bargain.on) {
  var catP = null;
  var addCartOffers = function () {
    var rows = document.querySelectorAll('.cart-lines .line[data-id]'); if (!rows.length) return;
    (catP = catP || api('GET', '/api/catalog').then(function (b) { return b.products || []; })).then(function (list) {
      Array.prototype.forEach.call(document.querySelectorAll('.cart-lines .line[data-id]'), function (row) {
        if (row.querySelector('.avm-line-offer')) return;
        var p = list.filter(function (x) { return x.id === row.getAttribute('data-id'); })[0];
        if (!p || p.bargain_on === false || p.in_stock === false) return;
        var o = document.createElement('button'); o.type = 'button'; o.className = 'avm-chip gold avm-line-offer'; o.innerHTML = TAG + ' Make an offer';
        o.addEventListener('click', function () { offer(p); });
        var at = row.querySelector('.lrow') || row.querySelector('.linfo') || row; at.appendChild(o);
      });
    }).catch(function () {});
  };
  new MutationObserver(addCartOffers).observe(document.body, { childList: true, subtree: true });
  addCartOffers();
}
function offer(p) {
  var m = document.createElement('div'); m.className = 'avm-offer-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Make an offer');
  m.innerHTML = '<div class="avm-offer"><header><div><span class="avm-eyebrow">Make an offer</span><b>' + esc(p.name) + '</b><small>Listed at ' + inr(p.price) + ' \u00B7 a deal becomes a one-time coupon for your account</small></div><button type="button" class="avm-ch-x" aria-label="Close">\u00D7</button></header><div class="avm-of-body" role="log" aria-live="polite"></div>' +
    '<form class="avm-ch-form"><label class="sr" for="avm-of-in">Your offer</label><input id="avm-of-in" inputmode="numeric" maxlength="60" placeholder="Your price, e.g. 499" autocomplete="off"><button type="submit" aria-label="Send">\u2192</button></form></div>';
  document.body.appendChild(m);
  var body = $('.avm-of-body', m), form = $('form', m), st = { id: null, done: false };
  function close() { m.remove(); }
  $('.avm-ch-x', m).addEventListener('click', close); m.addEventListener('click', function (e) { if (e.target === m) close(); });
  function line(by, t) { var x = document.createElement('div'); x.className = 'avm-msg ' + (by === 'user' ? 'me' : 'bot'); x.innerHTML = '<p>' + esc(t) + '</p>'; body.appendChild(x); body.scrollTop = body.scrollHeight; }
  function deal(c) {
    var x = document.createElement('div'); x.className = 'avm-deal';
    x.innerHTML = '<span class="avm-eyebrow">Your deal</span><b>' + inr(c.price) + '</b><code>' + esc(c.code) + '</code><small>Valid till ' + new Date(c.expires_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + ', once, for this product on your account.</small><button type="button" class="btn">Add to bag with this deal</button>';
    body.appendChild(x); body.scrollTop = body.scrollHeight;
    $('button', x).addEventListener('click', function () {
      try { var cart = JSON.parse(localStorage.getItem('avermontis_cart_v1') || '{}') || {}; cart[p.id] = Math.max(1, parseInt(cart[p.id], 10) || 0); localStorage.setItem('avermontis_cart_v1', JSON.stringify(cart)); localStorage.setItem('avermontis_coupon', c.code); } catch (e) {}
      location.href = '/cart';
    });
  }
  function call(payload) {
    return api('POST', '/api/bargain', payload).then(function (b) {
      st.id = b.bargain.id; if (b.message) line('bot', b.message);
      if (b.bargain.coupon && b.bargain.coupon.code) { deal({ code: b.bargain.coupon.code, price: b.bargain.coupon.price || b.bargain.agreed_price, expires_at: b.bargain.coupon.expires_at }); st.done = true; }
      else if (b.done) st.done = true;
      if (st.done) form.hidden = true;
      var oldAcc = $('.avm-accept', m); if (oldAcc) oldAcc.remove();
      if (!st.done && b.bargain.status === 'open' && b.bargain.counter) { var ac = document.createElement('button'); ac.type = 'button'; ac.className = 'avm-chip gold avm-accept'; ac.textContent = 'Accept ' + inr(b.bargain.counter); ac.style.alignSelf = 'flex-start'; body.appendChild(ac); body.scrollTop = body.scrollHeight;
        ac.addEventListener('click', function () { ac.remove(); line('user', 'Deal at ' + inr(b.bargain.counter)); call({ bargain_id: st.id, product_id: p.id, offer: b.bargain.counter }); }); }
    }).catch(function (e) {
      if (e.status === 401) { body.innerHTML = '<div class="avm-msg bot"><p>' + esc(e.message) + '</p></div><p style="text-align:center"><a class="btn" href="/login?next=' + encodeURIComponent(location.pathname + location.search) + '">Sign in</a> <a class="btn ghost" href="/signup?next=' + encodeURIComponent(location.pathname + location.search) + '">Create account</a></p>'; form.hidden = true; return; }
      line('bot', e.message);
    });
  }
  call({ product_id: p.id, lang: 'en' });
  form.addEventListener('submit', function (e) { e.preventDefault(); var inp = $('#avm-of-in', m), v = inp.value.trim(); if (!v || st.done) return; line('user', /^\d+$/.test(v) ? inr(+v) : v); inp.value = ''; call({ bargain_id: st.id, product_id: p.id, message: v }); });
  setTimeout(function () { var i = $('#avm-of-in', m); if (i) i.focus(); }, 50);
}
})();
