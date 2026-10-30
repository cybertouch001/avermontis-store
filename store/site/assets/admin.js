/* Avermontis owner dashboard. Every number here comes from the server; the server checks the owner session on every call. */
(function(){
'use strict';
var $ = function(s, r){ return (r||document).querySelector(s); };
var $$ = function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function inr(n){ return '\u20B9' + Number(n || 0).toLocaleString('en-IN'); }
function ist(iso){ try { return new Date(iso).toLocaleString('en-IN', {timeZone:'Asia/Kolkata', day:'numeric', month:'short', hour:'numeric', minute:'2-digit'}) + ' IST'; } catch(e){ return iso; } }
var toastTimer;
function toast(msg){ var t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2600); }
function offline(){ var b = $('#offline'); if (b) b.classList.toggle('show', !navigator.onLine); }
window.addEventListener('online', offline); window.addEventListener('offline', offline);

function api(method, path, body){
  if (!navigator.onLine) return Promise.reject(Object.assign(new Error('You are offline. Connect to the internet and try again.'), {code:'offline'}));
  var ctrl = ('AbortController' in window) ? new AbortController() : null;
  var timer = setTimeout(function(){ if (ctrl) ctrl.abort(); }, 15000);
  var opt = {method: method, headers: {'Accept':'application/json'}, credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined};
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  return fetch(path, opt).then(function(r){
    clearTimeout(timer);
    var ct = r.headers.get('content-type') || '';
    if (ct.indexOf('application/json') < 0) throw Object.assign(new Error('The server did not answer properly. Try again in a minute.'), {status:r.status});
    return r.json().then(function(b){
      if (r.ok && b && b.ok) return b;
      var e = (b && b.error) || {};
      throw Object.assign(new Error(e.message || 'Something went wrong.'), {status:r.status, code:e.code, fields:e.fields});
    });
  }, function(err){ clearTimeout(timer); throw new Error(err && err.name === 'AbortError' ? 'The request took too long. Try again.' : 'Could not reach the server. Check your connection.'); });
}
function errorBox(err, retry){
  return '<div class="state error" role="alert"><p><strong>' + esc(err.message) + '</strong></p>' + (retry ? '<button class="btn ghost" type="button" data-retry>Retry</button>' : '') + '</div>';
}
function pwRules(v){ return v.length < 10 ? 'Use at least 10 characters.' : (v.length > 128 ? 'At most 128 characters.' : ((/[A-Za-z]/.test(v) && /[0-9]/.test(v)) ? '' : 'Use at least one letter and one number.')); }

function fieldHTML(id, label, type, auto){
  return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" name="' + id + '" type="' + type + '" autocomplete="' + auto + '" maxlength="128" required><div class="err" id="err-' + id + '" aria-live="polite"></div></div>';
}
function wireForm(form, rules, send, onOk){
  var busy = false, btn = $('button[type=submit]', form), label = btn.textContent;
  function check(k){ var f = form[k], m = rules[k](f.value); f.closest('.field').classList.toggle('invalid', !!m); $('#err-' + k).textContent = m; f.setAttribute('aria-invalid', m ? 'true' : 'false'); return !m; }
  Object.keys(rules).forEach(function(k){ form[k].addEventListener('input', function(){ if (form[k].closest('.field').classList.contains('invalid')) check(k); }); });
  var sp = $('[data-showpw]', form); if (sp) sp.addEventListener('change', function(){ Object.keys(rules).forEach(function(k){ form[k].type = sp.checked ? 'text' : 'password'; }); });
  form.addEventListener('submit', function(e){
    e.preventDefault(); if (busy) return;
    var al = $('.form-alert', form); al.className = 'form-alert hidden'; al.textContent = '';
    var bad = Object.keys(rules).filter(function(k){ return !check(k); });
    if (bad.length) { form[bad[0]].focus(); return; }
    busy = true; btn.disabled = true; btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Please wait…';
    send().then(onOk).catch(function(err){
      busy = false; btn.disabled = false; btn.textContent = label;
      if (err.fields) Object.keys(err.fields).forEach(function(k){ if (form[k]) { form[k].closest('.field').classList.add('invalid'); $('#err-' + k).textContent = err.fields[k]; } });
      al.className = 'form-alert alert error'; al.textContent = err.message;
    });
  });
}

/* ---------- /admin/setup (works exactly once) ---------- */
function setupPage(root){
  api('GET', '/api/admin/setup-status').then(function(s){
    if (!s.setup_open) {
      root.innerHTML = '<div class="auth-card"><span class="eyebrow">Owner setup</span><h1>Already set up</h1><p class="muted">The owner password has been created, so this page is closed for good.</p><a class="btn block" href="/admin">Go to the dashboard</a></div>';
      return;
    }
    root.innerHTML = '<form class="auth-card" id="setup-form" novalidate><span class="eyebrow">One-time owner setup</span><h1>Create your owner password</h1>' +
      '<p class="muted small">This password opens your dashboard (orders, customers, sign-in history). It is stored only as a secure hash — nobody else, including us, can read it. <strong>This page works once</strong>: after you save, it closes forever.</p>' +
      fieldHTML('password', 'Owner password', 'password', 'new-password') + '<p class="note" style="margin-top:-8px">At least 10 characters, with a letter and a number. Save it in your phone\u2019s password manager.</p>' +
      fieldHTML('confirm', 'Type it again', 'password', 'new-password') +
      '<label class="showpw small"><input type="checkbox" data-showpw> Show passwords</label>' +
      '<div class="form-alert hidden" role="alert"></div><button class="btn block" type="submit">Save password &amp; open dashboard</button></form>';
    var form = $('#setup-form');
    wireForm(form, {
      password: pwRules,
      confirm: function(v){ return v !== form.password.value ? 'The two passwords do not match.' : ''; }
    }, function(){ return api('POST', '/api/admin/setup', {password: form.password.value, confirm: form.confirm.value}); },
    function(){ location.href = '/admin'; });
  }, function(err){ root.innerHTML = errorBox(err, true); $('[data-retry]', root).addEventListener('click', function(){ setupPage(root); }); });
}

/* ---------- /admin ---------- */
var STATUSES = ['new','confirmed','shipped','delivered','cancelled'];
var state = {tab: 'orders', status: '', result: '', offset: 0};
function loginView(root, setupOpen){
  if (setupOpen) {
    root.innerHTML = '<div class="auth-card"><span class="eyebrow">Owner dashboard</span><h1>Set your password first</h1><p class="muted">No owner password exists yet. Create it once — after that, setup closes for good.</p><a class="btn block" href="/admin/setup">Open one-time setup</a></div>';
    return;
  }
  root.innerHTML = '<form class="auth-card" id="admin-login" novalidate><span class="eyebrow">Owner dashboard</span><h1>Owner sign in</h1>' +
    fieldHTML('password', 'Owner password', 'password', 'current-password') +
    '<label class="showpw small"><input type="checkbox" data-showpw> Show password</label>' +
    '<div class="form-alert hidden" role="alert"></div><button class="btn block" type="submit">Open dashboard</button>' +
    '<p class="note center" style="margin-top:12px">Wrong attempts are recorded in the sign-in history.</p></form>';
  var form = $('#admin-login');
  wireForm(form, {password: function(v){ return v ? '' : 'Enter the owner password.'; }},
    function(){ return api('POST', '/api/admin/login', {password: form.password.value}); },
    function(){ dashboard(root); });
}

/* ---------- dashboard shell ---------- */
var TABS = [['overview','Overview'],['orders','Orders'],['products','Products'],['customize','Customize'],['assistant','Assistant'],['bargains','Bargains'],['ar','AR'],['notify','Notify'],['coupons','Coupons'],['reviews','Reviews'],['customers','Customers'],['messages','Messages'],['subscribers','Subscribers'],['logins','Login history'],['backup','Backup'],['settings','Settings']];
var LABEL = {'new':'New', confirmed:'Confirmed', shipped:'Shipped', delivered:'Delivered', cancelled:'Cancelled'};
var EVENT = {signup: 'Sign-up', login: 'Sign-in', admin_login: 'Owner sign-in', admin_setup: 'Owner setup'};
var counts = {};
function dashboard(root){
  $('#admin-logout').classList.remove('hidden');
  root.innerHTML = '<div class="acct-head"><div><span class="eyebrow">Owner dashboard</span><h1 style="margin:0">Avermontis</h1></div><button class="btn ghost small-btn" id="refresh" type="button">\u21BB Refresh</button></div>' +
    '<div class="adm-tabs" role="tablist">' + TABS.map(function(t){ return '<button type="button" role="tab" data-tab="' + t[0] + '">' + t[1] + '<span class="n hidden" data-n="' + t[0] + '"></span></button>'; }).join('') + '</div>' +
    '<div id="panel" role="tabpanel" aria-live="polite"></div>';
  $$('.adm-tabs button', root).forEach(function(b){ b.addEventListener('click', function(){ go(b.getAttribute('data-tab')); }); });
  $('#refresh').addEventListener('click', function(){ go(state.tab); });
  var h = location.hash.slice(1); go(TABS.some(function(t){ return t[0] === h; }) ? h : 'overview');
}
function go(tab){
  state.tab = tab; state.offset = 0; history.replaceState(null, '', '#' + tab);
  $$('.adm-tabs button').forEach(function(b){ var on = b.getAttribute('data-tab') === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); if (on && b.scrollIntoView) b.scrollIntoView({block:'nearest', inline:'nearest'}); });
  var p = $('#panel'); p.innerHTML = '<p class="muted"><span class="spinner"></span> Loading\u2026</p>';
  loadCounts();
  ({overview: overviewTab, orders: ordersTab, products: productsTab, customize: customizeTab, assistant: assistantTab, bargains: bargainsTab, ar: arTab, notify: notifyTab, coupons: couponsTab, reviews: reviewsTab, customers: customersTab, messages: messagesTab, subscribers: subscribersTab, logins: loginsTab, backup: backupTab, settings: settingsTab})[tab](p);
}
function fail(p, retry){ return function(err){ p.innerHTML = errorBox(err, true); var b = $('[data-retry]', p); if (b) b.addEventListener('click', function(){ retry(p); }); }; }
function badge(tab, n){ var el = $('[data-n="' + tab + '"]'); if (el) { el.textContent = n; el.classList.toggle('hidden', !n); } }
function loadCounts(){ return api('GET', '/api/admin/stats').then(function(b){ counts = b.stats; badge('orders', counts.new_orders); badge('messages', counts.new_messages); badge('reviews', counts.pending_reviews); badge('products', counts.low_stock); return counts; }).catch(function(){ return counts; }); }
function mailto(m){ return 'mailto:' + encodeURIComponent(m.to || '') + '?subject=' + encodeURIComponent(m.subject || '') + '&body=' + encodeURIComponent(m.body || ''); }
function busy(btn, on, text){ if (on) { btn.dataset.l = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ' + (text || 'Saving\u2026'); } else { btn.disabled = false; btn.innerHTML = btn.dataset.l || btn.innerHTML; } }
function fld(id, label, val, type, extra){ return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" name="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" ' + (extra || '') + '><p class="err" id="err-' + id + '"></p></div>'; }
function area(id, label, val, rows, extra){ return '<div class="field"><label for="' + id + '">' + label + '</label><textarea id="' + id + '" name="' + id + '" rows="' + (rows || 3) + '" ' + (extra || '') + '>' + esc(val || '') + '</textarea><p class="err" id="err-' + id + '"></p></div>'; }
function showFieldErrors(form, err){ $$('.err', form).forEach(function(e){ e.textContent = ''; }); $$('.field', form).forEach(function(f){ f.classList.remove('invalid'); });
  if (err.fields) Object.keys(err.fields).forEach(function(k){ var e = $('#err-' + k, form) || $('#err-' + k); if (e) { e.textContent = err.fields[k]; var f = e.closest('.field'); if (f) f.classList.add('invalid'); } });
  var al = $('.form-alert', form); if (al) { al.className = 'form-alert alert error'; al.textContent = err.message; } }
function clearAlert(form){ var al = $('.form-alert', form); if (al) { al.className = 'form-alert hidden'; al.textContent = ''; } }

/* ---------- overview: counts + sales chart (last 30 days) ---------- */
function overviewTab(p){
  Promise.all([loadCounts(), api('GET', '/api/admin/sales?days=30')]).then(function(r){
    var s = r[0], days = r[1].days;
    var max = Math.max.apply(null, days.map(function(d){ return d.sales; }).concat([1]));
    var W = 600, H = 180, bw = W / days.length;
    var bars = days.map(function(d, i){ var h = Math.round((d.sales / max) * (H - 30)); return '<rect x="' + (i * bw + 2).toFixed(1) + '" y="' + (H - 18 - h) + '" width="' + (bw - 4).toFixed(1) + '" height="' + Math.max(h, d.sales ? 2 : 0) + '" rx="2" fill="#C6A16A"><title>' + d.date + ': ' + inr(d.sales) + ' (' + d.orders + ' orders)</title></rect>'; }).join('');
    var labels = [0, 10, 20, days.length - 1].map(function(i){ return '<text x="' + (i === 0 ? 0 : i === days.length - 1 ? i * bw + bw : i * bw + bw / 2).toFixed(1) + '" y="' + (H - 3) + '" fill="#a4ada7" font-size="10" text-anchor="' + (i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle') + '">' + days[i].date.slice(5) + '</text>'; }).join('');
    var total30 = days.reduce(function(a, d){ return a + d.sales; }, 0), orders30 = days.reduce(function(a, d){ return a + d.orders; }, 0);
    p.innerHTML = '<div class="stats">' +
      stat(s.orders_today, 'Orders today') + stat(inr(s.sales_today), 'Sales today') + stat(s.new_orders, 'New orders to confirm', s.new_orders) + stat(inr(s.total_sales), 'Total sales (all time)') +
      stat(s.users, 'Customers') + stat(s.subscribers, 'Newsletter subscribers') + stat(s.new_messages, 'Unread messages', s.new_messages) + stat(s.low_stock, 'Products low on stock (\u22645)', s.low_stock) + '</div>' +
      '<div class="chart"><div class="top" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px"><strong>Sales, last 30 days</strong><span class="muted small">' + inr(total30) + ' \u00B7 ' + orders30 + ' orders (cancelled not counted)</span></div><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Sales per day for the last 30 days">' + bars + labels + '</svg></div>' +
      '<a class="big-btn" href="/api/admin/backup.xlsx" download>\u2B07 Download full backup (Excel)<span>Orders, items, customers, login history, subscribers, messages, coupons, reviews \u2014 saves to your phone\u2019s Downloads folder</span></a>' +
      (s.failed_logins_24h ? '<p class="note">' + s.failed_logins_24h + ' failed sign-in attempt(s) in the last 24 hours \u2014 see Login history.</p>' : '');
    insightsBlock(p);
  }).catch(fail(p, overviewTab));
}
function stat(v, l, warn){ return '<div class="stat' + (warn ? ' warn' : '') + '"><b>' + esc(v) + '</b><span>' + esc(l) + '</span></div>'; }

/* ---------- orders ---------- */
function ordersTab(p, append){
  if (!append) state.offset = 0;
  var q = '/api/admin/orders?limit=30&offset=' + state.offset + (state.status ? '&status=' + state.status : '');
  api('GET', q).then(function(b){
    var head = '<div class="toolbar-a"><label class="sr" for="st-f">Filter</label><select id="st-f"><option value="">All orders</option>' + STATUSES.map(function(s){ return '<option value="' + s + '"' + (state.status === s ? ' selected' : '') + '>' + LABEL[s] + '</option>'; }).join('') + '</select>' +
      '<a class="btn ghost small-btn" href="/api/admin/export/orders.csv" download>Orders CSV</a></div><div id="olist"></div><div id="omore"></div>';
    if (!append) p.innerHTML = head;
    var list = $('#olist', p);
    if (!append && !b.orders.length) list.innerHTML = '<div class="state"><p><strong>No orders' + (state.status ? ' with this status' : ' yet') + '.</strong></p><p class="muted">New orders appear here the moment customers place them.</p></div>';
    list.insertAdjacentHTML('beforeend', b.orders.map(orderCardA).join(''));
    $('#omore', p).innerHTML = b.orders.length === 30 ? '<button class="btn ghost block" type="button" id="more-o">Load more</button>' : '';
    var mb = $('#more-o', p); if (mb) mb.addEventListener('click', function(){ state.offset += 30; mb.disabled = true; ordersTab(p, true); });
    $('#st-f', p).onchange = function(){ state.status = this.value; ordersTab(p); };
    wireOrders(list);
  }).catch(fail(p, ordersTab));
}
function orderCardA(o){
  var c = o.customer;
  return '<article class="acard" data-id="' + esc(o.id) + '"><div class="top"><div><strong>' + esc(o.id) + '</strong> <span class="muted small">' + esc(o.invoice_no || '') + '</span><br><span class="muted small">' + ist(o.created_at) + (o.account_email ? ' \u00B7 account ' + esc(o.account_email) : ' \u00B7 guest') + '</span></div><span class="status s-' + esc(o.status) + '">' + LABEL[o.status] + '</span></div>' +
    '<ul class="oc-items">' + o.items.map(function(i){ return '<li><span>' + esc(i.name) + (i.size ? ' (' + esc(i.size) + ')' : '') + ' \u00D7 ' + i.qty + '</span><span>' + inr(i.total) + '</span></li>'; }).join('') + '</ul>' +
    '<div class="oc-total">' + (o.discount ? 'Coupon ' + esc(o.coupon || '') + ' \u2212' + inr(o.discount) + ' \u00B7 ' : '') + 'Shipping ' + (o.shipping ? inr(o.shipping) : 'free') + ' \u00B7 <strong>Total ' + inr(o.total) + '</strong> (COD)</div>' +
    '<p class="small" style="margin:10px 0 0"><strong>' + esc(c.name) + '</strong> \u00B7 <a href="tel:+91' + esc(c.phone) + '">' + esc(c.phone) + '</a>' + (c.email ? ' \u00B7 ' + esc(c.email) : '') + '<br><span class="muted">' + esc(c.address) + ', ' + esc(c.city) + ', ' + esc(c.state) + ' ' + esc(c.pincode) + '</span>' + (c.notes ? '<br><em class="muted">Note: ' + esc(c.notes) + '</em>' : '') + '</p>' +
    '<div class="acts"><label class="sr" for="s-' + esc(o.id) + '">Status</label><select id="s-' + esc(o.id) + '" data-status>' + STATUSES.map(function(s){ return '<option value="' + s + '"' + (s === o.status ? ' selected' : '') + '>' + LABEL[s] + '</option>'; }).join('') + '</select>' +
    (o.status === 'new' ? '<button class="btn small-btn" type="button" data-confirm>\u2713 Confirm order</button>' : '') +
    (o.invoice_url ? '<a class="btn ghost small-btn" href="' + esc(o.invoice_url) + '" target="_blank" rel="noopener">Invoice</a>' : '') +
    (c.email ? '<a class="btn ghost small-btn" href="' + esc(mailto(o.mail)) + '">Email customer</a>' : '') +
    '<button class="btn danger small-btn" type="button" data-del>Delete</button></div><div class="mail-note"></div></article>';
}
function setStatus(card, status){
  var id = card.getAttribute('data-id'), sel = $('[data-status]', card); sel.disabled = true;
  return api('PATCH', '/api/admin/orders/' + encodeURIComponent(id), {status: status}).then(function(r){
    sel.value = status; var st = $('.status', card); st.className = 'status s-' + status; st.textContent = LABEL[status];
    var cb = $('[data-confirm]', card); if (cb && status !== 'new') cb.remove();
    var note = $('.mail-note', card);
    if (r.email && r.email.sent) { note.innerHTML = '<p class="ok-msg small">\u2713 Confirmation email sent to ' + esc(r.mail.to) + '.</p>'; toast('Confirmed \u2014 email sent to customer'); }
    else if (status === 'confirmed' && r.mail && r.mail.to) {
      note.innerHTML = '<div class="alert info small" style="margin-top:10px">Automatic email is not set up yet' + (r.email && r.email.detail ? ' (' + esc(r.email.detail) + ')' : '') + '. Tap to send the confirmation from your own email app \u2014 it is already written for you, with the invoice link.<br><a class="btn small-btn" style="margin-top:8px" href="' + esc(mailto(r.mail)) + '">\u2709 Send confirmation email</a></div>';
      toast('Order confirmed');
    } else if (status === 'confirmed') { note.innerHTML = '<p class="note">Confirmed. This customer gave no email \u2014 call them on the number above if needed.</p>'; toast('Order confirmed'); }
    else { note.innerHTML = r.mail && r.mail.to ? '<p class="small"><a href="' + esc(mailto(r.mail)) + '">\u2709 Tell the customer (email)</a></p>' : ''; toast('Status: ' + LABEL[status]); }
    loadCounts();
  }).catch(function(err){ toast(err.message); }).then(function(){ sel.disabled = false; });
}
function wireOrders(list){
  orderExtras(list);
  $$('.acard', list).forEach(function(card){
    if (card.dataset.wired) return; card.dataset.wired = '1';
    var id = card.getAttribute('data-id');
    $('[data-status]', card).addEventListener('change', function(){ setStatus(card, this.value); });
    var cb = $('[data-confirm]', card); if (cb) cb.addEventListener('click', function(){ busy(cb, true, 'Confirming\u2026'); setStatus(card, 'confirmed').then(function(){ if (cb.isConnected) busy(cb, false); }); });
    $('[data-del]', card).addEventListener('click', function(){
      if (!confirm('Delete order ' + id + ' for good? Use this only for test or duplicate orders. (To stop a real order, set it to Cancelled instead.)')) return;
      var b = this; b.disabled = true;
      api('DELETE', '/api/admin/orders/' + encodeURIComponent(id)).then(function(){ card.remove(); toast('Order deleted'); loadCounts(); }).catch(function(err){ b.disabled = false; toast(err.message); });
    });
  });
}

/* ---------- products (stock, price, photos) ---------- */
function productsTab(p){
  api('GET', '/api/admin/products').then(function(b){
    p.innerHTML = '<div class="toolbar-a"><button class="btn small-btn" type="button" id="add-p">+ Add product</button><span class="muted small">Prices include GST. Stock goes down with each order and back up if an order is cancelled.</span></div>' +
      b.products.map(function(x){ return '<article class="acard"><div class="top" style="flex-wrap:nowrap;align-items:center"><img src="' + esc(img(x.image)) + '" alt="" width="56" height="56" style="width:56px;height:56px;border-radius:10px;object-fit:cover;flex:none"><div style="flex:1;min-width:0"><strong>' + esc(x.name) + '</strong> <span class="muted small">' + esc(x.size || '') + '</span><br><span class="small">' + inr(x.price) + (x.mrp ? ' <s class="muted">' + inr(x.mrp) + '</s>' : '') + ' \u00B7 stock <strong' + (x.stock <= 5 ? ' style="color:var(--gold)"' : '') + '>' + x.stock + '</strong>' + (x.active ? '' : ' \u00B7 <span class="status s-cancelled">Hidden</span>') + '</span></div><button class="btn ghost small-btn" type="button" data-edit="' + esc(x.id) + '">Edit</button></div></article>'; }).join('');
    $('#add-p', p).addEventListener('click', function(){ productForm(null, p); });
    $$('[data-edit]', p).forEach(function(btn){ btn.addEventListener('click', function(){ productForm(b.products.filter(function(x){ return x.id === btn.getAttribute('data-edit'); })[0], p); }); });
  }).catch(fail(p, productsTab));
}
function img(s){ s = String(s || ''); return /^(https?:)?\//.test(s) ? s : '/' + s; }
function productForm(x, p){
  var isNew = !x; x = x || {active: true, stock: 100, images: [], ingredients: [], faqs: [], category: 'Serums'};
  var images = (x.images || []).slice();
  var m = document.createElement('div'); m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', isNew ? 'Add product' : 'Edit product');
  m.innerHTML = '<form class="panel pform" novalidate><div class="top" style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">' + (isNew ? 'Add product' : 'Edit ' + esc(x.name)) + '</h2><button class="btn ghost small-btn" type="button" data-x>Close</button></div>' +
    (isNew ? fld('id', 'Product ID (used in the link, e.g. rose-toner)', '', 'text', 'maxlength="60" autocapitalize="none"') : '') +
    fld('name', 'Name', x.name, 'text', 'maxlength="100"') +
    '<div class="row3">' + fld('size', 'Size', x.size, 'text', 'maxlength="30" placeholder="30 ml"') + fld('category', 'Category', x.category, 'text', 'maxlength="40" list="cats"') + fld('sort', 'Order in shop', x.sort || 0, 'number') + '</div><datalist id="cats"><option>Serums</option><option>Cleansers</option><option>Moisturizers</option><option>Sunscreens</option></datalist>' +
    '<div class="row3">' + fld('price', 'Price \u20B9 (incl. GST)', x.price, 'number', 'inputmode="numeric" min="1"') + fld('mrp', 'MRP \u20B9 (optional)', x.mrp, 'number', 'inputmode="numeric"') + fld('stock', 'Stock (units)', x.stock, 'number', 'inputmode="numeric" min="0"') + '</div>' +
    '<label class="showpw"><input type="checkbox" name="active"' + (x.active ? ' checked' : '') + '> Visible in the shop</label>' +
    '<div class="field"><span class="label">Photos (first one is the main photo)</span><div class="img-list" id="imgs"></div><input type="file" id="up" accept="image/jpeg,image/png,image/webp"><p class="note">JPG, PNG or WebP. Big photos are shrunk on your phone before upload.</p><p class="err" id="err-images"></p></div>' +
    fld('short', 'One-line summary', x.short, 'text', 'maxlength="200"') + area('description', 'Description', x.description, 4, 'maxlength="3000"') +
    area('ingredients', 'Key ingredients (one per line)', (x.ingredients || []).join('\n'), 4) + area('how_to_use', 'How to use', x.how_to_use, 3, 'maxlength="1500"') +
    area('faqs', 'Product FAQs (one per line: Question? | Answer)', (x.faqs || []).map(function(f){ return f.q + ' | ' + f.a; }).join('\n'), 3) +
    '<div class="form-alert hidden" role="alert"></div><button class="btn block" type="submit">' + (isNew ? 'Add product' : 'Save changes') + '</button></form>';
  document.body.appendChild(m); document.body.style.overflow = 'hidden';
  var form = $('form', m);
  function close(){ m.remove(); document.body.style.overflow = ''; }
  $('[data-x]', m).addEventListener('click', close);
  function drawImgs(){ $('#imgs', m).innerHTML = images.map(function(s, i){ return '<div class="im"><img src="' + esc(img(s)) + '" alt=""><button type="button" data-rm="' + i + '" aria-label="Remove photo">\u00D7</button></div>'; }).join('') || '<span class="muted small">No photos yet</span>';
    $$('[data-rm]', m).forEach(function(b){ b.addEventListener('click', function(){ images.splice(+b.getAttribute('data-rm'), 1); drawImgs(); }); }); }
  drawImgs();
  $('#up', m).addEventListener('change', function(){
    var f = this.files && this.files[0], inp = this; if (!f) return;
    var e = $('#err-images', m); e.textContent = 'Uploading\u2026';
    shrink(f).then(function(blob){
      return fetch('/api/admin/upload', {method: 'POST', body: blob, credentials: 'same-origin', headers: {'Content-Type': blob.type || 'application/octet-stream'}}).then(function(r){ return r.json().then(function(j){ if (!r.ok || !j.ok) throw new Error((j.error && j.error.message) || 'Upload failed'); return j; }); });
    }).then(function(j){ images.push(j.url); drawImgs(); e.textContent = ''; inp.value = ''; }).catch(function(err){ e.textContent = err.message; inp.value = ''; });
  });
  form.addEventListener('submit', function(ev){
    ev.preventDefault(); clearAlert(form);
    var g = function(n){ return form.elements[n] ? form.elements[n].value.trim() : ''; };
    var faqs = g('faqs').split('\n').map(function(l){ var i = l.indexOf('|'); return i > 0 ? {q: l.slice(0, i).trim(), a: l.slice(i + 1).trim()} : null; }).filter(Boolean);
    var body = {name: g('name'), size: g('size'), category: g('category'), sort: parseInt(g('sort') || '0', 10), price: parseInt(g('price'), 10), mrp: g('mrp') === '' ? '' : parseInt(g('mrp'), 10), stock: parseInt(g('stock'), 10),
      active: form.elements.active.checked, images: images, short: g('short'), description: g('description'), ingredients: g('ingredients').split('\n'), how_to_use: g('how_to_use'), faqs: faqs};
    if (isNew) body.id = g('id').toLowerCase();
    var btn = $('button[type=submit]', form); busy(btn, true);
    api(isNew ? 'POST' : 'PUT', isNew ? '/api/admin/products' : '/api/admin/products/' + encodeURIComponent(x.id), body).then(function(){ close(); toast(isNew ? 'Product added' : 'Saved'); productsTab(p); loadCounts(); })
      .catch(function(err){ busy(btn, false); showFieldErrors(form, err); });
  });
}
function shrink(file){
  return new Promise(function(res){
    if (file.size < 900000 || !window.createImageBitmap) return res(file);
    createImageBitmap(file).then(function(bm){
      var s = Math.min(1, 1400 / Math.max(bm.width, bm.height)), c = document.createElement('canvas');
      c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s); c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
      c.toBlob(function(b){ res(b || file); }, 'image/jpeg', 0.86);
    }).catch(function(){ res(file); });
  });
}

/* ---------- coupons ---------- */
function couponsTab(p){
  api('GET', '/api/admin/coupons').then(function(b){
    p.innerHTML = '<div class="toolbar-a"><button class="btn small-btn" type="button" id="add-c">+ Create coupon</button><p class="muted small" style="margin:0">All discounts are checked on the server; coupon use stops at the limit.</p></div>' +
      (b.coupons.length ? b.coupons.map(function(c){ return '<article class="acard"><div class="top"><div><strong>' + esc(c.code) + '</strong> <span class="status ' + (!c.active || c.expired ? 's-cancelled' : 's-delivered') + '">' + (c.expired ? 'Expired' : c.active ? 'Active' : 'Off') + '</span><p class="small muted">' + (c.kind === 'percent' ? c.value + '% off' : inr(c.value) + ' off') + ' \u00B7 Min ' + inr(c.min_order) + (c.max_discount ? ' \u00B7 Max ' + inr(c.max_discount) : '') + (c.expires_at ? ' \u00B7 Expires ' + ist(c.expires_at) : '') + '<br>Used ' + c.used_count + (c.usage_limit ? ' / ' + c.usage_limit : ' (unlimited)') + (c.note ? ' \u00B7 ' + esc(c.note) : '') + '</p></div><div class="acts"><button class="btn ghost small-btn" type="button" data-code="' + esc(c.code) + '" data-on="' + (c.active ? '1' : '0') + '">' + (c.active ? 'Switch off' : 'Switch on') + '</button><button class="btn danger small-btn" type="button" data-delc="' + esc(c.code) + '">Delete</button></div></div></article>'; }).join('') : '<div class="state"><p>No coupons yet.</p></div>');
    $('#add-c', p).addEventListener('click', function(){ couponForm(p); });
    $$('[data-code]', p).forEach(function(el){ el.addEventListener('click', function(){ var code = this.getAttribute('data-code'); this.disabled = true; api('PATCH', '/api/admin/coupons/' + encodeURIComponent(code), {active: this.getAttribute('data-on') !== '1'}).then(function(){ toast('Coupon updated'); couponsTab(p); }).catch(function(err){ toast(err.message); el.disabled = false; }); }); });
    $$('[data-delc]', p).forEach(function(el){ el.addEventListener('click', function(){ var code = this.getAttribute('data-delc'); if (!confirm('Delete coupon ' + code + '? Coupons on past orders cannot be deleted; switch those off instead.')) return; api('DELETE', '/api/admin/coupons/' + encodeURIComponent(code)).then(function(){ couponsTab(p); toast('Coupon deleted'); }).catch(function(err){ toast(err.message); }); }); });
  }).catch(fail(p, couponsTab));
}
function couponForm(p){
  var m = document.createElement('div'); m.className = 'modal'; m.setAttribute('role','dialog'); m.setAttribute('aria-label','Create coupon');
  m.innerHTML = '<form class="panel" novalidate><div class="top" style="display:flex;justify-content:space-between"><h2>Create coupon</h2><button type="button" class="btn ghost small-btn" data-x>Close</button></div>' +
    fld('code', 'Coupon code', '', 'text', 'maxlength="24" autocapitalize="characters" placeholder="WELCOME10"') +
    '<div class="row2"><div class="field"><label for="kind">Discount type</label><select name="kind" id="kind"><option value="percent">% off</option><option value="flat">\u20B9 off</option></select></div>' + fld('value', 'Discount', '', 'number', 'min="1" inputmode="numeric"') + '</div>' +
    '<div class="row2">' + fld('min_order', 'Minimum order \u20B9 (0 for none)', '0', 'number', 'min="0"') + fld('max_discount', 'Max discount \u20B9 (optional)', '', 'number', 'min="1"') + '</div>' +
    '<div class="row2">' + fld('expires', 'Expiry date (India time, optional)', '', 'date') + fld('usage_limit', 'Use limit (optional)', '', 'number', 'min="1"') + '</div>' +
    fld('note', 'Internal note (optional)', '', 'text', 'maxlength="100"') +
    '<div class="form-alert hidden" role="alert"></div><button class="btn block" type="submit">Create coupon</button></form>';
  document.body.appendChild(m); document.body.style.overflow = 'hidden';
  function close(){ m.remove(); document.body.style.overflow = ''; } $('[data-x]', m).addEventListener('click', close);
  var f = $('form', m);
  f.addEventListener('submit', function(e){ e.preventDefault(); clearAlert(f); var b = {}; ['code','kind','value','min_order','max_discount','expires','usage_limit','note'].forEach(function(k){ b[k] = f.elements[k].value.trim(); });
    var btn = $('button[type=submit]', f); busy(btn, true); api('POST', '/api/admin/coupons', b).then(function(){ close(); toast('Coupon created'); couponsTab(p); }).catch(function(err){ busy(btn, false); showFieldErrors(f, err); }); });
}

/* ---------- reviews moderation ---------- */
function reviewsTab(p){
  api('GET', '/api/admin/reviews').then(function(b){
    p.innerHTML = '<h2 class="h3">Product reviews <span class="muted small">(' + b.reviews.length + ')</span></h2><p class="muted small">Only approved reviews appear on product pages. No fake ratings or counts.</p>' +
      (b.reviews.length ? b.reviews.map(function(r){ return '<article class="acard"><div class="top"><div><strong>' + esc(r.product_name || r.product_id) + '</strong> <span class="status ' + (r.status === 'approved' ? 's-delivered' : r.status === 'rejected' ? 's-cancelled' : 's-new') + '">' + esc(r.status) + '</span><br><span class="muted small">' + esc(r.author) + ' \u00B7 ' + esc(r.email || '') + ' \u00B7 ' + ist(r.created_at) + (r.verified ? ' \u00B7 Verified buyer' : '') + '</span></div><strong>' + '★'.repeat(r.rating) + '</strong></div><p>' + (r.title ? '<strong>' + esc(r.title) + '</strong><br>' : '') + esc(r.body) + '</p><div class="acts"><button class="btn small-btn" type="button" data-rv="' + r.id + '" data-s="approved">Approve</button><button class="btn ghost small-btn" type="button" data-rv="' + r.id + '" data-s="rejected">Reject</button><button class="btn danger small-btn" type="button" data-rvd="' + r.id + '">Delete</button></div></article>'; }).join('') : '<div class="state"><p>No reviews yet.</p></div>');
    $$('[data-rv]', p).forEach(function(btn){ btn.addEventListener('click', function(){ btn.disabled = true; api('PATCH', '/api/admin/reviews/' + btn.getAttribute('data-rv'), {status: btn.getAttribute('data-s')}).then(function(){ reviewsTab(p); loadCounts(); toast('Review updated'); }).catch(function(err){ toast(err.message); btn.disabled = false; }); }); });
    $$('[data-rvd]', p).forEach(function(btn){ btn.addEventListener('click', function(){ if (!confirm('Delete this review for good?')) return; api('DELETE', '/api/admin/reviews/' + btn.getAttribute('data-rvd')).then(function(){ reviewsTab(p); }).catch(function(err){ toast(err.message); }); }); });
  }).catch(fail(p, reviewsTab));
}

/* ---------- customers, manual reset link, login history ---------- */
function customersTab(p, append){
  if (!append) state.offset = 0;
  api('GET', '/api/admin/customers?limit=50&offset=' + state.offset).then(function(b){
    if (!append) p.innerHTML = '<h2 class="h3">Customers</h2><div id="clist"></div><div id="cmore"></div>';
    var el = $('#clist', p);
    if (!append && !b.customers.length) el.innerHTML = '<div class="state">No customer accounts yet.</div>';
    el.insertAdjacentHTML('beforeend', b.customers.map(function(c){ return '<article class="acard"><div class="top"><div><strong>' + esc(c.name) + '</strong> <span class="muted small">#' + c.id + '</span><br><span class="muted small">' + esc(c.email) + ' \u00B7 joined ' + ist(c.created_at) + (c.last_login_at ? ' \u00B7 last sign-in ' + ist(c.last_login_at) : '') + '</span></div><span class="small">' + c.orders + ' orders \u00B7 ' + inr(c.spent) + '</span></div><div class="acts"><button class="btn ghost small-btn" type="button" data-reset="' + c.id + '" data-name="' + esc(c.name) + '" data-email="' + esc(c.email) + '">Create password reset link</button></div><div class="reset-result"></div></article>'; }).join(''));
    $('#cmore', p).innerHTML = b.customers.length === 50 ? '<button class="btn ghost block" type="button" id="more-c">Load more</button>' : '';
    var mb = $('#more-c', p); if (mb) mb.addEventListener('click', function(){ state.offset += 50; mb.disabled = true; customersTab(p, true); });
    $$('[data-reset]', el).forEach(function(btn){ if (btn.dataset.wired) return; btn.dataset.wired = '1'; btn.addEventListener('click', function(){
      if (!confirm('Generate a password reset link for ' + btn.getAttribute('data-email') + '? Only share it with that customer after verifying their identity.')) return;
      var box = $('.reset-result', btn.closest('.acard')); busy(btn, true); api('POST', '/api/admin/customers/' + btn.getAttribute('data-reset') + '/reset-link', {}).then(function(r){ box.innerHTML = '<div class="alert info" style="margin-top:10px"><p>Link is valid for 2 hours. Send it only to the customer after verifying who they are.</p><a class="btn sm" href="' + esc(mailto(r.mail)) + '">Email reset link to customer</a></div>'; }).catch(function(err){ box.innerHTML = '<p class="err">' + esc(err.message) + '</p>'; }).then(function(){ busy(btn, false); });
    }); });
  }).catch(fail(p, customersTab));
}
function loginsTab(p, append){
  if (!append) state.offset = 0;
  api('GET', '/api/admin/logins?limit=50&offset=' + state.offset).then(function(b){
    if (!append) p.innerHTML = '<div class="toolbar-a"><h2 class="h3" style="margin:0">Sign-in history</h2><a class="btn ghost small-btn" href="/api/admin/export/logins.csv" download>Download CSV</a></div><div id="llist"></div><div id="lmore"></div>';
    var el = $('#llist', p);
    if (!append && !b.logins.length) el.innerHTML = '<div class="state">No sign-ins yet.</div>';
    el.insertAdjacentHTML('beforeend', b.logins.map(function(l){ return '<article class="acard" style="display:flex;gap:12px;align-items:flex-start"><span class="dot ' + (l.success ? 'ok' : 'bad') + '"></span><div><strong>' + (EVENT[l.event] || esc(l.event)) + (l.success ? '' : ' failed') + '</strong> <span class="muted small">' + (l.reason ? '(' + esc(l.reason) + ')' : '') + '</span><br><span class="small">' + esc(l.email) + '</span><br><span class="muted small">' + esc(l.time_ist) + ' \u00B7 ' + esc(l.device || '') + ' \u00B7 IP ' + esc(l.ip || '') + '</span></div></article>'; }).join(''));
    $('#lmore', p).innerHTML = b.logins.length === 50 ? '<button class="btn ghost block" type="button" id="more-l">Load more</button>' : '';
    var mb = $('#more-l', p); if (mb) mb.addEventListener('click', function(){ state.offset += 50; mb.disabled = true; loginsTab(p, true); });
  }).catch(fail(p, loginsTab));
}

/* ---------- contact inbox + newsletter ---------- */
function messagesTab(p){
  api('GET', '/api/admin/messages').then(function(b){
    p.innerHTML = '<h2 class="h3">Messages from the Contact page</h2>' + (b.messages.length ? b.messages.map(function(m){ return '<article class="acard"' + (m.status === 'new' ? ' style="border-color:rgba(60,207,142,.45)"' : '') + '><div class="top"><div><strong>' + esc(m.name) + '</strong> ' + (m.status === 'new' ? '<span class="status s-new">New</span>' : '<span class="status">' + esc(m.status) + '</span>') + '<br><span class="muted small">' + esc(m.email) + (m.phone ? ' \u00B7 ' + esc(m.phone) : '') + ' \u00B7 ' + esc(m.time_ist) + '</span></div></div>' + (m.subject ? '<p><strong>' + esc(m.subject) + '</strong></p>' : '') + '<p style="white-space:pre-wrap">' + esc(m.body) + '</p>' +
      '<div class="acts"><a class="btn small-btn" href="' + esc(mailto({to: m.email, subject: 'Re: ' + (m.subject || 'your message to Avermontis'), body: 'Hi ' + m.name.split(' ')[0] + ',\n\n\n\n\u2014 Team Avermontis\n\n> ' + m.body.replace(/\n/g, '\n> ')})) + '" data-read="' + m.id + '">Reply by email</a>' + (m.status === 'new' ? '<button class="btn ghost small-btn" type="button" data-mark="' + m.id + '" data-s="read">Mark read</button>' : '') + '<button class="btn danger small-btn" type="button" data-delm="' + m.id + '">Delete</button></div></article>'; }).join('') : '<div class="state"><p>No messages yet.</p></div>');
    function mark(id, s){ return api('PATCH', '/api/admin/messages/' + id, {status: s}).then(function(){ loadCounts(); }); }
    $$('[data-read]', p).forEach(function(a){ a.addEventListener('click', function(){ mark(a.getAttribute('data-read'), 'read').catch(function(){}); }); });
    $$('[data-mark]', p).forEach(function(b){ b.addEventListener('click', function(){ mark(b.getAttribute('data-mark'), b.getAttribute('data-s')).then(function(){ messagesTab(p); }).catch(function(err){ toast(err.message); }); }); });
    $$('[data-delm]', p).forEach(function(b){ b.addEventListener('click', function(){ if (!confirm('Delete this message?')) return; api('DELETE', '/api/admin/messages/' + b.getAttribute('data-delm')).then(function(){ messagesTab(p); loadCounts(); }).catch(function(err){ toast(err.message); }); }); });
  }).catch(fail(p, messagesTab));
}
function subscribersTab(p){
  api('GET', '/api/admin/subscribers').then(function(b){
    p.innerHTML = '<div class="toolbar-a"><h2 class="h3" style="margin:0">Newsletter subscribers (' + b.subscribers.length + ')</h2><a class="btn ghost small-btn" href="/api/admin/export/subscribers.csv" download>Download CSV</a></div>' +
      (b.subscribers.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>Email</th><th>Joined</th><th>From</th><th></th></tr></thead><tbody>' + b.subscribers.map(function(s){ return '<tr><td>' + esc(s.email) + '</td><td>' + esc(s.time_ist) + '</td><td>' + esc(s.source || '') + '</td><td><button class="linkbtn" type="button" data-dels="' + s.id + '">Remove</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="state"><p>No subscribers yet. The sign-up box is in the footer of every page.</p></div>');
    $$('[data-dels]', p).forEach(function(b){ b.addEventListener('click', function(){ if (!confirm('Remove this subscriber?')) return; api('DELETE', '/api/admin/subscribers/' + b.getAttribute('data-dels')).then(function(){ subscribersTab(p); }).catch(function(err){ toast(err.message); }); }); });
  }).catch(fail(p, subscribersTab));
}

/* ---------- backup + restore ---------- */
function backupTab(p){
  p.innerHTML = '<h2 class="h3">Backup</h2><p class="muted">Your live database is online and permanent. These buttons also save a full copy to your phone \u2014 it lands in the <strong>Downloads</strong> folder.</p>' +
    '<a class="big-btn" href="/api/admin/backup.xlsx" download>\u2B07 Download full backup (Excel .xlsx)<span>One file, a sheet each for Orders, Order items, Customers, Login history, Subscribers, Messages, Coupons, Reviews, Products</span></a>' +
    '<a class="big-btn alt" href="/api/admin/backup.json" download>\u2B07 Download as JSON (for full restore)<span>Keep this file safe \u2014 it can put everything back if ever needed</span></a>' +
    '<div class="toolbar-a"><a class="btn ghost small-btn" href="/api/admin/export/orders.csv" download>Orders CSV</a><a class="btn ghost small-btn" href="/api/admin/export/logins.csv" download>Login history CSV</a><a class="btn ghost small-btn" href="/api/admin/export/subscribers.csv" download>Subscribers CSV</a></div>' +
    '<div class="panel" style="margin-top:22px"><h3>Restore from a JSON backup</h3><p class="muted small">Adds back anything that is missing (orders, customers, messages\u2026). Records that already exist are left exactly as they are \u2014 nothing is overwritten or deleted. Your owner password is never part of a backup.</p>' +
    '<div class="field"><label for="rfile">Backup file (.json)</label><input type="file" id="rfile" accept="application/json,.json"></div><div id="rinfo"></div></div>';
  $('#rfile', p).addEventListener('change', function(){
    var f = this.files && this.files[0], info = $('#rinfo', p); if (!f) return;
    if (f.size > 20 * 1024 * 1024) { info.innerHTML = '<p class="err">File is too large.</p>'; return; }
    var rd = new FileReader();
    rd.onload = function(){
      var data; try { data = JSON.parse(rd.result); } catch(e){ info.innerHTML = '<p class="err">This is not a valid JSON file.</p>'; return; }
      if (!data || data.format !== 'avermontis-backup') { info.innerHTML = '<p class="err">This is not an Avermontis backup file.</p>'; return; }
      info.innerHTML = '<p class="small">Backup from <strong>' + ist(data.created_at) + '</strong>: ' + Object.keys(data.counts || {}).map(function(k){ return esc(k) + ' ' + data.counts[k]; }).join(', ') + '</p>' +
        '<form id="rform" novalidate><div class="field"><label for="rconfirm">Type <strong>RESTORE</strong> to confirm</label><input id="rconfirm" name="confirm" autocomplete="off" autocapitalize="characters"><p class="err" id="err-confirm"></p></div><div class="form-alert hidden" role="alert"></div><button class="btn" type="submit">Restore missing records</button></form><div id="rres"></div>';
      var form = $('#rform', p);
      form.addEventListener('submit', function(e){ e.preventDefault(); clearAlert(form); var btn = $('button', form); busy(btn, true, 'Restoring\u2026');
        api('POST', '/api/admin/restore', {confirm: form.confirm.value.trim(), backup: data}).then(function(r){ busy(btn, false);
          $('#rres', p).innerHTML = '<div class="alert ok"><strong>Restore finished.</strong><br>' + Object.keys(r.report).map(function(k){ return esc(k) + ': ' + r.report[k].added + ' added, ' + r.report[k].already_there_or_skipped + ' already there'; }).join('<br>') + '</div>'; loadCounts();
        }).catch(function(err){ busy(btn, false); showFieldErrors(form, err); }); });
    };
    rd.readAsText(f);
  });
}

/* ---------- settings (invoice details, WhatsApp, announcement, email sending) ---------- */
function settingsTab(p){
  api('GET', '/api/admin/settings').then(function(b){
    var s = b.settings, em = b.email;
    p.innerHTML = '<form class="panel" id="sform" novalidate><h2 class="h3">Store &amp; invoice</h2>' +
      '<div class="row2">' + fld('gstin', 'GSTIN (shown on invoices)', s.gstin, 'text', 'maxlength="15" autocapitalize="characters" placeholder="(to be added)"') + '<div class="field"><label for="gst_rate">GST rate on products</label><select id="gst_rate" name="gst_rate">' + ['0','5','12','18','28'].map(function(r){ return '<option' + (String(s.gst_rate || '18') === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></div></div>' +
      fld('seller_address', 'Seller address on invoice', s.seller_address, 'text', 'maxlength="200"') +
      '<div class="row2">' + fld('support_email', 'Support email', s.support_email, 'email') + fld('whatsapp_number', 'Business WhatsApp number (empty = no chat button)', s.whatsapp_number, 'tel', 'placeholder="e.g. 919876543210"') + '</div>' +
      fld('announcement', 'Announcement bar text', s.announcement, 'text', 'maxlength="200"') +
      '<h2 class="h3" style="margin-top:18px">Automatic emails to customers</h2>' +
      '<p class="small ' + (em.configured ? 'ok-msg' : 'muted') + '">' + (em.configured ? '\u2713 Email sending is ON. Customers get an \u201Corder received\u201D email after checkout and a \u201Cconfirmed\u201D email when you confirm.' : 'Email sending is OFF. Until it is set up, the Confirm button opens a ready-written email in your own mail app. To turn it on: create a free Brevo account (brevo.com), verify your sender email there, create an API key (SMTP & API \u2192 API keys) and paste it below.') + '</p>' +
      '<div class="row3"><div class="field"><label for="email_provider">Email service</label><select id="email_provider" name="email_provider"><option value="">Off</option><option value="brevo"' + (s.email_provider === 'brevo' ? ' selected' : '') + '>Brevo</option><option value="resend"' + (s.email_provider === 'resend' ? ' selected' : '') + '>Resend</option></select><p class="err" id="err-email_provider"></p></div>' +
      fld('email_from', 'Verified sender email', s.email_from, 'email') + fld('email_from_name', 'Sender name', s.email_from_name || 'Avermontis', 'text', 'maxlength="60"') + '</div>' +
      fld('email_api_key', 'API key ' + (em.key_set ? '(saved: ' + esc(em.key_hint) + ' \u2014 leave empty to keep)' : ''), '', 'password', 'autocomplete="off" placeholder="' + (em.key_set ? 'Saved' : 'Paste the key here') + '"') +
      (em.key_set ? '<label class="showpw small"><input type="checkbox" name="remove_key"> Remove the saved key</label>' : '') +
      '<p class="note">The key is kept only on the server. It is never shown again, never sent to the browser and never included in backups.</p>' +
      '<div class="form-alert hidden" role="alert"></div><button class="btn" type="submit">Save settings</button></form>' +
      '<form class="panel" id="tform" style="margin-top:16px" novalidate><h3>Send a test email</h3><div class="row2">' + fld('to', 'Send to', s.support_email, 'email') + '<div class="field"><label>&nbsp;</label><button class="btn ghost" type="submit">Send test</button></div></div><div id="tres"></div></form>' +
      (b.email_log.length ? '<h3 style="margin-top:18px">Recent email activity</h3><div class="table-wrap"><table class="tbl"><thead><tr><th>Time</th><th>To</th><th>Type</th><th>Result</th></tr></thead><tbody>' + b.email_log.map(function(l){ return '<tr><td>' + esc(l.time_ist) + '</td><td>' + esc(l.to_email) + '</td><td>' + esc(l.kind) + '</td><td title="' + esc(l.detail || '') + '">' + esc(l.status) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
      '<p class="note" style="margin-top:14px">Photo storage for product uploads: ' + (b.media_storage ? 'connected' : 'not connected') + '.</p>';
    var f = $('#sform', p);
    f.addEventListener('submit', function(e){ e.preventDefault(); clearAlert(f);
      var body = {}; ['gstin','gst_rate','seller_address','support_email','whatsapp_number','announcement','email_provider','email_from','email_from_name'].forEach(function(k){ body[k] = f.elements[k].value.trim(); });
      var key = f.elements.email_api_key.value.trim(); if (key) body.email_api_key = key; if (f.elements.remove_key && f.elements.remove_key.checked) body.remove_email_api_key = true;
      var btn = $('button[type=submit]', f); busy(btn, true);
      api('PUT', '/api/admin/settings', body).then(function(){ toast('Settings saved'); settingsTab(p); }).catch(function(err){ busy(btn, false); showFieldErrors(f, err); });
    });
    var t = $('#tform', p);
    t.addEventListener('submit', function(e){ e.preventDefault(); var btn = $('button[type=submit]', t); busy(btn, true, 'Sending\u2026');
      api('POST', '/api/admin/email-test', {to: t.elements.to.value.trim()}).then(function(r){ var x = r.result; $('#tres', t).innerHTML = x.sent ? '<p class="ok-msg">\u2713 Sent. Check the inbox (and spam folder).</p>' : '<p class="err">Not sent: ' + esc(x.reason === 'not_configured' ? 'email sending is not set up yet (choose a service, sender and key above).' : (x.detail || x.reason)) + '</p>'; })
        .catch(function(err){ $('#tres', t).innerHTML = '<p class="err">' + esc(err.message) + '</p>'; }).then(function(){ busy(btn, false); }); });
  }).catch(fail(p, settingsTab));
}


/* =================================================================================================
   v4: Customize (colours, fonts, layout, logo, store info, location + map, delivery areas, app icon),
   Assistant (chat settings, own AI key, chat logs), Bargains, AR, Notifications, insights, order notes
   ================================================================================================= */
var UI4 = null;
function loadUi(){ return api('GET', '/api/admin/ui').then(function(b){ UI4 = b; return b; }); }
function putUi(section, body){ return api('PUT', '/api/admin/ui/' + section, body).then(function(b){ UI4 = b; return b; }); }
function upload(file, kind){
  var p = kind === 'model' ? Promise.resolve(file) : shrink(file);
  return p.then(function(blob){ return fetch('/api/admin/upload?kind=' + kind, {method: 'POST', body: blob, credentials: 'same-origin', headers: {'Content-Type': blob.type || 'application/octet-stream'}})
    .then(function(r){ return r.json().then(function(j){ if (!r.ok || !j.ok) throw new Error((j.error && j.error.message) || 'Upload failed'); return j.url; }); }); });
}
function sub(title, html, note){ return '<section class="v4-card"><h3>' + title + '</h3>' + (note ? '<p class="note">' + note + '</p>' : '') + html + '</section>'; }
function sel(id, label, val, opts){ return '<div class="field"><label for="' + id + '">' + label + '</label><select id="' + id + '" name="' + id + '">' + opts.map(function(o){ return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select><p class="err" id="err-' + id + '"></p></div>'; }
function chk(id, label, on){ return '<label class="v4-switch"><input type="checkbox" id="' + id + '" name="' + id + '"' + (on ? ' checked' : '') + '><span></span>' + label + '</label>'; }
function saveBtn(t){ return '<div class="form-alert hidden" role="alert"></div><button class="btn" type="submit">' + (t || 'Save') + '</button>'; }
function wireSave(form, fn){
  form.addEventListener('submit', function(e){ e.preventDefault(); clearAlert(form); var btn = $('button[type=submit]', form); busy(btn, true);
    Promise.resolve().then(fn).then(function(){ busy(btn, false); toast('Saved \u2014 live on the website and app'); }).catch(function(err){ busy(btn, false); showFieldErrors(form, err); }); });
}
var SEC_LABEL = {hero: 'Big top banner (hero)', banners: 'Offer banners', story: 'Our story', categories: 'Shop by category', collection: 'Products', concerns: 'Shop by concern', ingredients: 'Ingredients', routine: 'Morning & evening routine', closing: 'Closing line',
  today: 'Today\u2019s ritual card', picks: 'Product picks', ar: 'AR & 3D (try it)', order: 'Last order', explore: 'Explore tiles', ingredient: 'Ingredient of the day'};
var FONT_LABEL = {cormorant: 'Cormorant (original serif)', playfair: 'Playfair Display (serif)', georgia: 'Georgia (classic serif)', system: 'Clean sans (system)', poppins: 'Poppins (modern sans)'};
var ICON_LABEL = {avr: 'AVR \u2014 green on white (new)', avr_gold: 'AVR \u2014 gold on black', avr_green: 'AVR \u2014 white on green', classic: 'Classic gold A'};

/* ---------- Customize ---------- */
function customizeTab(p){
  loadUi().then(function(b){
    var u = b.ui, t = u.theme;
    p.innerHTML = '<div class="v4-head"><div><h2 style="margin:0">Customize</h2><p class="muted small" style="margin:4px 0 0">Changes go live on the website and in the app (next time it opens) \u2014 no new app download needed.</p></div></div>' +
      '<div class="v4-sub" role="tablist">' + [['look', 'Colours & fonts'], ['home', 'Home layout'], ['brand', 'Logo & name'], ['hero', 'Top banner & offers'], ['location', 'Location & hours'], ['delivery', 'Delivery areas'], ['contact', 'Contact & social'], ['icon', 'App icon']].map(function(x, i){ return '<button type="button" data-st="' + x[0] + '"' + (i ? '' : ' class="on"') + '>' + x[1] + '</button>'; }).join('') + '</div><div id="cz"></div>';
    var go4 = function(k){ $$('.v4-sub button', p).forEach(function(x){ x.classList.toggle('on', x.getAttribute('data-st') === k); }); ({look: czLook, home: czHome, brand: czBrand, hero: czHero, location: czLocation, delivery: czDelivery, contact: czContact, icon: czIcon})[k]($('#cz', p)); };
    $$('.v4-sub button', p).forEach(function(x){ x.addEventListener('click', function(){ go4(x.getAttribute('data-st')); }); });
    go4('look');
  }).catch(fail(p, customizeTab));
}
function previewFrame(path){ return '<div class="v4-preview"><div class="v4-pv-bar"><span>Live preview</span><span class="muted small">' + esc(path) + '</span></div><iframe id="pv" title="Live preview" src="' + path + (path.indexOf('?') < 0 ? '?' : '&') + 'avm_preview=1" loading="lazy"></iframe></div>'; }
function czLook(el){
  var t = UI4.ui.theme, presets = UI4.presets;
  el.innerHTML = '<div class="v4-split"><form class="panel" novalidate id="f-look">' +
    '<span class="label">Ready-made looks</span><div class="v4-presets">' + Object.keys(presets).map(function(k){ var x = presets[k]; return '<button type="button" class="v4-preset' + (t.preset === k ? ' on' : '') + '" data-preset="' + k + '"><span class="sw" style="background:' + x.primary + '"></span><span class="sw" style="background:' + x.accent + '"></span><span class="sw" style="background:' + x.background + ';border:1px solid #ddd"></span><b>' + esc(x.label) + '</b></button>'; }).join('') + '</div>' +
    '<div class="row2">' + ['primary|Brand colour (dark)', 'accent|Accent (buttons, gold)', 'background|Background', 'text|Text colour'].map(function(s){ var k = s.split('|'); return '<div class="field v4-color"><label for="c-' + k[0] + '">' + k[1] + '</label><div><input type="color" id="c-' + k[0] + '" value="' + esc(t[k[0]]) + '"><input type="text" id="t-' + k[0] + '" name="' + k[0] + '" value="' + esc(t[k[0]]) + '" maxlength="7"></div><p class="err" id="err-' + k[0] + '"></p></div>'; }).join('') + '</div>' +
    '<div class="row2">' + sel('site_mode', 'Website', t.site_mode, [['light', 'Light'], ['dark', 'Dark']]) + sel('app_mode', 'App', t.app_mode, [['dark', 'Dark (original)'], ['light', 'Light']]) + '</div>' +
    '<div class="row2">' + sel('heading_font', 'Heading font', t.heading_font, UI4.fonts.heading.map(function(f){ return [f, FONT_LABEL[f]]; })) + sel('body_font', 'Text font', t.body_font, UI4.fonts.body.map(function(f){ return [f, FONT_LABEL[f]]; })) + '</div>' +
    sel('radius', 'Corners', t.radius, [['sharp', 'Sharp (original)'], ['soft', 'Soft'], ['round', 'Round']]) +
    saveBtn('Save look') + ' <button type="button" class="btn ghost" id="reset-look">Back to original</button></form>' + previewFrame('/') + '</div>';
  var form = $('#f-look', el), preset = t.preset, timer;
  function draft(){ var g = function(n){ return form.elements[n].value; }; return {preset: preset, primary: g('primary'), accent: g('accent'), background: g('background'), text: g('text'), site_mode: g('site_mode'), app_mode: g('app_mode'), heading_font: g('heading_font'), body_font: g('body_font'), radius: g('radius')}; }
  function preview(){ clearTimeout(timer); timer = setTimeout(function(){ api('POST', '/api/admin/ui-preview', {theme: draft()}).then(function(r){ var f = $('#pv', el); if (f && f.contentWindow) f.contentWindow.postMessage({type: 'avm-css', css: r.css}, location.origin); showFieldErrors(form, {fields: r.fields || {}}); clearAlert(form); }).catch(function(){}); }, 250); }
  ['primary', 'accent', 'background', 'text'].forEach(function(k){
    var c = $('#c-' + k, el), tx = $('#t-' + k, el);
    c.addEventListener('input', function(){ tx.value = c.value.toUpperCase(); preset = 'custom'; markPreset(); preview(); });
    tx.addEventListener('input', function(){ if (/^#[0-9A-Fa-f]{6}$/.test(tx.value)) { c.value = tx.value; preset = 'custom'; markPreset(); preview(); } });
  });
  $$('select', form).forEach(function(s){ s.addEventListener('change', preview); });
  function markPreset(){ $$('.v4-preset', el).forEach(function(x){ x.classList.toggle('on', x.getAttribute('data-preset') === preset); }); }
  $$('.v4-preset', el).forEach(function(bn){ bn.addEventListener('click', function(){ preset = bn.getAttribute('data-preset'); var x = UI4.presets[preset];
    ['primary', 'accent', 'background', 'text'].forEach(function(k){ $('#c-' + k, el).value = x[k]; $('#t-' + k, el).value = x[k]; }); markPreset(); preview(); }); });
  window.addEventListener('message', function onReady(e){ if (e.origin === location.origin && e.data && e.data.type === 'avm-preview-ready' && $('#f-look')) preview(); });
  wireSave(form, function(){ return putUi('theme', draft()); });
  $('#reset-look', el).addEventListener('click', function(){ if (!confirm('Go back to the original obsidian & gold look?')) return; api('DELETE', '/api/admin/ui/theme').then(function(b){ UI4 = b; toast('Original look restored'); czLook(el); }).catch(function(err){ toast(err.message); }); });
}
function orderList(id, list){
  return '<ol class="v4-order" id="' + id + '">' + list.map(function(x, i){ return '<li data-id="' + x.id + '"><label class="v4-switch small"><input type="checkbox"' + (x.on ? ' checked' : '') + '><span></span>' + esc(SEC_LABEL[x.id] || x.id) + '</label><span class="v4-mv"><button type="button" data-up aria-label="Move up">\u2191</button><button type="button" data-down aria-label="Move down">\u2193</button></span></li>'; }).join('') + '</ol>';
}
function wireOrder(root, onChange){
  root.addEventListener('click', function(e){ var b = e.target.closest('button'); if (!b) return; var li = b.closest('li');
    if (b.hasAttribute('data-up') && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
    if (b.hasAttribute('data-down') && li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
    onChange && onChange(); });
  root.addEventListener('change', function(){ onChange && onChange(); });
}
function readOrder(root){ return $$('li', root).map(function(li){ return {id: li.getAttribute('data-id'), on: $('input', li).checked}; }); }
function czHome(el){
  var L = UI4.ui.layout, timer;
  el.innerHTML = '<div class="v4-split"><form class="panel" novalidate id="f-home">' + sub('Website home page', orderList('o-web', L.home_web), 'Switch sections on/off and move them up or down.') + sub('App home screen', orderList('o-app', L.home_app)) + saveBtn('Save layout') + '</form>' + previewFrame('/') + '</div>';
  var f = $('#f-home', el);
  var pv = function(){ clearTimeout(timer); timer = setTimeout(function(){ api('POST', '/api/admin/ui-preview', {layout: {home_web: readOrder($('#o-web', el))}}).then(function(r){ var fr = $('#pv', el); if (fr && fr.contentWindow) fr.contentWindow.postMessage({type: 'avm-css', css: r.css}, location.origin); }).catch(function(){}); }, 200); };
  wireOrder($('#o-web', el), pv); wireOrder($('#o-app', el));
  wireSave(f, function(){ return putUi('layout', {home_web: readOrder($('#o-web', el)), home_app: readOrder($('#o-app', el))}); });
}
function imgPick(id, label, val, note){ return '<div class="field"><span class="label">' + label + '</span><div class="v4-img"><span class="v4-img-pv" id="pv-' + id + '">' + (val ? '<img src="' + esc(val) + '" alt="">' : '<span class="muted small">None</span>') + '</span><input type="hidden" name="' + id + '" value="' + esc(val || '') + '"><input type="file" accept="image/jpeg,image/png,image/webp" data-for="' + id + '"><button type="button" class="btn ghost small-btn" data-clear="' + id + '">Remove</button></div>' + (note ? '<p class="note">' + note + '</p>' : '') + '<p class="err" id="err-' + id + '"></p></div>'; }
function wireImgs(el, kind){
  $$('input[type=file][data-for]', el).forEach(function(inp){ inp.addEventListener('change', function(){ var f = inp.files && inp.files[0], id = inp.getAttribute('data-for'); if (!f) return; var e = $('#err-' + id, el); e.textContent = 'Uploading\u2026';
    upload(f, kind || 'brand').then(function(url){ $('input[name="' + id + '"]', el).value = url; $('#pv-' + id, el).innerHTML = '<img src="' + esc(url) + '" alt="">'; e.textContent = ''; }).catch(function(err){ e.textContent = err.message; }).then(function(){ inp.value = ''; }); }); });
  $$('[data-clear]', el).forEach(function(b){ b.addEventListener('click', function(){ var id = b.getAttribute('data-clear'); $('input[name="' + id + '"]', el).value = ''; $('#pv-' + id, el).innerHTML = '<span class="muted small">None</span>'; }); });
}
function czBrand(el){
  var B = UI4.ui.brand;
  el.innerHTML = '<form class="panel" novalidate id="f-brand">' + fld('store_name', 'Store name', B.store_name, 'text', 'maxlength="40"') + fld('tagline', 'Tagline (optional)', B.tagline, 'text', 'maxlength="80"') +
    imgPick('logo_url', 'Logo for the website header (optional)', B.logo_url, 'A wide PNG with a transparent background looks best. Empty = the AVERMONTIS wordmark.') +
    imgPick('favicon_url', 'Website icon / install icon (square)', B.favicon_url, 'Square PNG, at least 512\u00D7512. Used for the browser tab and the installed web app. The Android app\u2019s launcher icon is chosen under \u201CApp icon\u201D.') + saveBtn() + '</form>';
  var f = $('#f-brand', el); wireImgs(el, 'brand');
  wireSave(f, function(){ var g = function(n){ return f.elements[n].value.trim(); }; return putUi('brand', {store_name: g('store_name'), tagline: g('tagline'), logo_url: g('logo_url'), favicon_url: g('favicon_url')}); });
}
function czHero(el){
  var H = UI4.ui.hero, BN = UI4.ui.banners.slice();
  el.innerHTML = '<form class="panel" novalidate id="f-hero">' + sub('Top banner on the home page', fld('eyebrow', 'Small line above the title', H.eyebrow, 'text', 'maxlength="60" placeholder="The Vitamin C Face Serum"') + fld('title', 'Title', H.title, 'text', 'maxlength="80" placeholder="Timeless care, in a few drops."') +
      fld('subtitle', 'Text', H.subtitle, 'text', 'maxlength="160"') + '<div class="row2">' + fld('cta_text', 'Button text', H.cta_text, 'text', 'maxlength="30" placeholder="Shop the serum"') + fld('cta_link', 'Button link', H.cta_link, 'text', 'placeholder="/product?id=vitamin-c-serum"') + '</div>' + imgPick('image', 'Photo (optional)', H.image), 'Leave a box empty to keep the current text.') + saveBtn('Save top banner') + '</form>' +
    '<form class="panel" novalidate id="f-bn" style="margin-top:16px"><h3 style="margin-top:0">Offer banners</h3><p class="note">Shown under the top banner on the home page and on the app home. Up to 6.</p><div id="bn-list"></div><button type="button" class="btn ghost small-btn" id="bn-add">+ Add banner</button><p class="err" id="err-banners"></p>' + saveBtn('Save banners') + '</form>';
  var f = $('#f-hero', el); wireImgs(f, 'brand');
  wireSave(f, function(){ var g = function(n){ return f.elements[n].value.trim(); }; return putUi('hero', {eyebrow: g('eyebrow'), title: g('title'), subtitle: g('subtitle'), cta_text: g('cta_text'), cta_link: g('cta_link'), image: g('image')}); });
  function draw(){ $('#bn-list', el).innerHTML = BN.map(function(x, i){ return '<div class="v4-bn" data-i="' + i + '"><div class="row2">' + fld('bt' + i, 'Title', x.title, 'text', 'maxlength="60"') + fld('bx' + i, 'Text', x.text, 'text', 'maxlength="140"') + '</div><div class="row2">' + fld('bc' + i, 'Button text', x.cta, 'text', 'maxlength="24" placeholder="Shop now"') + fld('bl' + i, 'Link', x.link, 'text', 'placeholder="/shop"') + '</div>' + imgPick('bi' + i, 'Image (optional)', x.image) + chk('bo' + i, 'Show', x.on !== false) + ' <button type="button" class="btn danger small-btn" data-rmbn="' + i + '">Remove</button><p class="err" id="err-banner_' + i + '"></p></div>'; }).join('') || '<p class="muted small">No banners yet.</p>';
    wireImgs($('#bn-list', el), 'brand'); $$('[data-rmbn]', el).forEach(function(b){ b.addEventListener('click', function(){ collect(); BN.splice(+b.getAttribute('data-rmbn'), 1); draw(); }); }); }
  function collect(){ var fb = $('#f-bn', el); BN = BN.map(function(x, i){ var g = function(n){ var e = fb.elements[n + i]; return e ? (e.type === 'checkbox' ? e.checked : e.value.trim()) : ''; }; return {title: g('bt'), text: g('bx'), cta: g('bc'), link: g('bl'), image: g('bi'), on: g('bo')}; }); }
  draw(); $('#bn-add', el).addEventListener('click', function(){ collect(); if (BN.length >= 6) return toast('Up to 6 banners'); BN.push({title: '', text: '', cta: 'Shop now', link: '/shop', image: '', on: true}); draw(); });
  wireSave($('#f-bn', el), function(){ collect(); return putUi('banners', {banners: BN}); });
}
var DAYN = {mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday'};
function czLocation(el){
  var L = UI4.ui.location;
  el.innerHTML = '<form class="panel" novalidate id="f-loc">' + chk('show', 'Show my store location on the website, app and in the assistant', L.show) +
    '<div class="row2">' + fld('name', 'Place name', L.name, 'text', 'maxlength="60" placeholder="AVERMONTIS Studio"') + fld('city', 'City', L.city, 'text', 'maxlength="60"') + '</div>' + area('address', 'Address', L.address, 2, 'maxlength="200"') +
    '<div class="row2">' + fld('pincode', 'Pincode', L.pincode, 'text', 'inputmode="numeric" maxlength="6"') + fld('note', 'Note (e.g. "Pickup by appointment")', L.note, 'text', 'maxlength="140"') + '</div>' +
    '<span class="label">Map pin \u2014 tap the map to place it, or drag the pin</span><div id="map4" class="v4-map"></div><div class="row3">' + fld('lat', 'Latitude', L.lat, 'text', 'inputmode="decimal"') + fld('lng', 'Longitude', L.lng, 'text', 'inputmode="decimal"') + '<div class="field"><span class="label">&nbsp;</span><button type="button" class="btn ghost small-btn" id="here">\u25CE Use my current location</button></div></div>' +
    '<span class="label">Store hours (IST)</span><div class="v4-hours">' + L.hours.map(function(h, i){ return '<div class="v4-hr"><b>' + DAYN[h.day] + '</b><input type="time" data-h="' + i + '" data-k="open" value="' + esc(h.open) + '"><span>to</span><input type="time" data-h="' + i + '" data-k="close" value="' + esc(h.close) + '"><label class="v4-switch small"><input type="checkbox" data-h="' + i + '" data-k="closed"' + (h.closed ? ' checked' : '') + '><span></span>Closed</label></div>'; }).join('') + '</div><p class="err" id="err-hours"></p>' + saveBtn() + '</form>';
  var f = $('#f-loc', el), map, marker;
  function setPin(lat, lng, pan){ f.elements.lat.value = lat.toFixed(6); f.elements.lng.value = lng.toFixed(6); if (!window.L || !map) return; if (!marker) { marker = window.L.marker([lat, lng], {draggable: true}).addTo(map); marker.on('dragend', function(){ var p = marker.getLatLng(); setPin(p.lat, p.lng); }); } else marker.setLatLng([lat, lng]); if (pan) map.setView([lat, lng], 16); }
  loadAsset('/assets/vendor/leaflet/leaflet.css'); loadAsset('/assets/vendor/leaflet/leaflet.js').then(function(){
    var Lf = window.L; Lf.Icon.Default.imagePath = '/assets/vendor/leaflet/images/';
    var has = L.lat != null && L.lng != null; map = Lf.map('map4').setView(has ? [L.lat, L.lng] : [25.3176, 82.9739], has ? 16 : 12);   // default view: Varanasi
    Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '&copy; OpenStreetMap'}).addTo(map);
    if (has) setPin(L.lat, L.lng); map.on('click', function(e){ setPin(e.latlng.lat, e.latlng.lng); });
  }).catch(function(){ $('#map4', el).innerHTML = '<p class="note">Map could not load \u2014 type the latitude and longitude instead.</p>'; });
  $('#here', el).addEventListener('click', function(){ if (!navigator.geolocation) return toast('Location is not available on this device'); navigator.geolocation.getCurrentPosition(function(pos){ setPin(pos.coords.latitude, pos.coords.longitude, true); }, function(){ toast('Could not read your location \u2014 allow location or tap the map'); }, {enableHighAccuracy: true, timeout: 10000}); });
  wireSave(f, function(){ var g = function(n){ return f.elements[n].value.trim(); };
    var hours = L.hours.map(function(h, i){ return {open: $('[data-h="' + i + '"][data-k=open]', f).value, close: $('[data-h="' + i + '"][data-k=close]', f).value, closed: $('[data-h="' + i + '"][data-k=closed]', f).checked}; });
    return putUi('location', {show: f.elements.show.checked, name: g('name'), address: g('address'), city: g('city'), pincode: g('pincode'), note: g('note'), lat: g('lat') === '' ? null : g('lat'), lng: g('lng') === '' ? null : g('lng'), hours: hours}); });
}
function loadAsset(src){ return new Promise(function(ok, no){ if (/\.css$/.test(src)) { if (!$('link[href="' + src + '"]')) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = src; document.head.appendChild(l); } return ok(); } if (window.L && /leaflet/.test(src)) return ok(); var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
function czDelivery(el){
  var D = UI4.ui.delivery;
  el.innerHTML = '<form class="panel" novalidate id="f-del">' + sel('mode', 'Where do you deliver?', D.mode, [['all', 'All of India (every pincode)'], ['list', 'Only the pincodes/areas below'], ['except', 'Everywhere except the pincodes/areas below']]) +
    area('areas', 'Pincodes / areas', D.areas, 4, 'placeholder="221001, 221002&#10;221*  (every pincode starting with 221)&#10;226001-226030  (a range)"') +
    fld('message', 'Message when a pincode is not served', D.message, 'text', 'maxlength="160" placeholder="Sorry, we don\u2019t deliver there yet \u2014 WhatsApp us for options."') +
    '<div class="field"><label for="tp">Test a pincode</label><div style="display:flex;gap:8px"><input id="tp" inputmode="numeric" maxlength="6"><button type="button" class="btn ghost small-btn" id="tpb">Check</button></div><p class="small" id="tpr"></p></div>' + saveBtn() + '<p class="note">Checkout blocks orders to pincodes you don\u2019t serve. Customers can check their pincode on every product page.</p></form>';
  var f = $('#f-del', el);
  $('#tpb', el).addEventListener('click', function(){ api('GET', '/api/delivery?pincode=' + encodeURIComponent($('#tp', el).value)).then(function(r){ $('#tpr', el).textContent = (r.serviceable ? '\u2713 ' : '\u2717 ') + r.message + ' (saved settings)'; }).catch(function(err){ $('#tpr', el).textContent = err.message; }); });
  wireSave(f, function(){ return putUi('delivery', {mode: f.elements.mode.value, areas: f.elements.areas.value, message: f.elements.message.value.trim()}); });
}
function czContact(el){
  var C = UI4.ui.contact;
  el.innerHTML = '<form class="panel" novalidate id="f-ct"><p class="note">Only what you type here is shown publicly. WhatsApp number and order emails are under Settings.</p>' + fld('phone', 'Store phone (optional)', C.phone, 'tel', 'placeholder="+91\u2026"') + fld('email', 'Store email for customers (optional)', C.email, 'email', 'placeholder="avermontis@mail.tab.bot"') +
    fld('instagram', 'Instagram page link', C.instagram, 'url', 'placeholder="https://instagram.com/\u2026"') + fld('facebook', 'Facebook page link', C.facebook, 'url') + fld('youtube', 'YouTube channel link', C.youtube, 'url') + saveBtn() + '</form>';
  var f = $('#f-ct', el);
  wireSave(f, function(){ var g = function(n){ return f.elements[n].value.trim(); }; return putUi('contact', {phone: g('phone'), email: g('email'), instagram: g('instagram'), facebook: g('facebook'), youtube: g('youtube')}); });
}
function czIcon(el){
  var B = UI4.ui.brand;
  el.innerHTML = '<form class="panel" novalidate id="f-icon"><p class="note">The Android app (version 4 or newer) switches its home-screen icon to the one you pick the next time it opens. Customers can also pick their own under Me \u2192 App icon. A completely new icon design needs a new app version.</p><div class="v4-icons">' +
    UI4.app_icons.map(function(k){ return '<label class="v4-icon"><input type="radio" name="app_icon" value="' + k + '"' + (B.app_icon === k ? ' checked' : '') + '><img src="/assets/icons4/' + k + '.png" alt="" width="72" height="72"><span>' + esc(ICON_LABEL[k] || k) + '</span></label>'; }).join('') + '</div>' + saveBtn('Save app icon') + '</form>';
  var f = $('#f-icon', el);
  wireSave(f, function(){ var v = ($('input[name=app_icon]:checked', f) || {}).value; return putUi('brand', {app_icon: v}); });
}

/* ---------- Assistant (chat) ---------- */
function assistantTab(p){
  Promise.all([loadUi(), api('GET', '/api/admin/chats?limit=30')]).then(function(r){
    var C = UI4.ui.chat, F = UI4.ui.features, k = UI4.chat_key, ch = r[1];
    p.innerHTML = '<div class="stats">' + stat(ch.stats.chats_7d, 'Chats, last 7 days') + stat(ch.stats.handoffs_7d, 'Sent to WhatsApp/email') + stat(k.set && C.provider ? 'AI (' + C.provider + ')' : 'Automatic', 'Answer engine') + '</div>' +
      (ch.stats.top_intents.length ? '<p class="small muted">Top questions: ' + ch.stats.top_intents.map(function(x){ return esc(x.intent) + ' (' + x.n + ')'; }).join(' \u00B7 ') + '</p>' : '') +
      '<form class="panel" novalidate id="f-chat">' + chk('on', 'Show the chat assistant on the website and app', F.chat !== false) + '<div class="row2">' + fld('name', 'Assistant name', C.name, 'text', 'maxlength="40"') + fld('greeting', 'First message (optional)', C.greeting, 'text', 'maxlength="200"') + '</div>' +
      '<h3>AI answers (optional)</h3><p class="note">Without a key the assistant uses automatic answers built from your products, prices and policies (always on, free). With your own AI key it writes friendlier answers from the same facts; any answer that shows a price that is not in your shop is thrown away. Your key stays on the server and is never shown again.</p>' +
      '<div class="row2">' + sel('provider', 'AI service', C.provider, [['', 'None \u2014 automatic answers'], ['gemini', 'Google Gemini'], ['openai', 'OpenAI'], ['groq', 'Groq']]) + fld('model', 'Model (optional)', C.model, 'text', 'placeholder="default"') + '</div>' +
      fld('api_key', 'API key' + (k.set ? ' (saved: ' + esc(k.hint) + ' \u2014 type a new one to replace)' : ''), '', 'password', 'autocomplete="off"') +
      (k.set ? '<label class="showpw"><input type="checkbox" name="remove_api_key"> Remove the saved key</label>' : '') + saveBtn() + ' <button type="button" class="btn ghost" id="test-ai">Test AI</button><p class="small" id="test-r"></p></form>' +
      '<h3 style="margin-top:24px">Recent chats</h3><div id="chats">' + (ch.chats.length ? ch.chats.map(function(s){ return '<details class="acard v4-chat"><summary><strong>' + esc(s.updated_ist) + '</strong> \u00B7 ' + esc(s.source || '') + ' \u00B7 ' + esc(s.lang || '') + ' \u00B7 ' + s.msgs + ' messages' + (s.account ? ' \u00B7 ' + esc(s.account) : '') + (s.handoff ? ' \u00B7 <span class="status s-new">Wants a person</span>' : '') + '</summary>' +
        s.messages.map(function(m){ return '<p class="v4-m ' + (m.role === 'bot' ? 'b' : 'u') + '"><span>' + (m.role === 'bot' ? 'Assistant' + (m.engine === 'llm' ? ' (AI)' : '') : 'Customer') + ' \u00B7 ' + esc(m.time_ist.slice(11)) + (m.intent && m.role === 'user' ? ' \u00B7 ' + esc(m.intent) : '') + '</span>' + esc(m.text).replace(/\n/g, '<br>') + '</p>'; }).join('') + '</details>'; }).join('') : '<p class="muted">No chats yet.</p>') + '</div>';
    var f = $('#f-chat', p);
    wireSave(f, function(){ var g = function(n){ return f.elements[n] ? f.elements[n].value.trim() : ''; };
      return putUi('features', {chat: f.elements.on.checked}).then(function(){ return putUi('chat', {name: g('name'), greeting: g('greeting'), provider: g('provider'), model: g('model'), api_key: g('api_key') || undefined, remove_api_key: f.elements.remove_api_key ? f.elements.remove_api_key.checked : false}); }).then(function(){ f.elements.api_key.value = ''; }); });
    $('#test-ai', p).addEventListener('click', function(){ var o = $('#test-r', p); o.textContent = 'Testing\u2026'; api('POST', '/api/admin/chat-test', {}).then(function(r){ o.textContent = r.works ? '\u2713 AI works. Sample: ' + r.sample : '\u2717 ' + r.error + ' \u2014 automatic answers are used meanwhile.'; }).catch(function(err){ o.textContent = err.message; }); });
  }).catch(fail(p, assistantTab));
}

/* ---------- Bargains ---------- */
function bargainsTab(p){
  Promise.all([loadUi(), api('GET', '/api/admin/bargains?limit=50')]).then(function(r){
    var B = UI4.ui.bargain, d = r[1], s = d.stats_30d;
    p.innerHTML = '<div class="stats">' + stat(s.total, 'Offers, 30 days') + stat(s.rate + '%', 'Accepted') + stat(s.avg_discount_pct + '%', 'Average discount given') + stat(s.coupons_used, 'Deal coupons used in orders') + '</div>' +
      '<form class="panel" novalidate id="f-bg"><h3 style="margin-top:0">Bargaining rules</h3><p class="note">Customers tap \u201CMake an offer\u201D on a product, chat with the bargaining assistant and get a one-time coupon locked to their account and that product. The lowest price is checked on the server and is never shown to customers.</p>' +
      chk('on', 'Bargaining on', B.on && UI4.ui.features.bargain !== false) + '<div class="row3">' + fld('max_discount_pct', 'Max discount % (default)', B.max_discount_pct, 'number') + fld('start_discount_pct', 'Opening discount %', B.start_discount_pct, 'number') + fld('max_rounds', 'Max rounds', B.max_rounds, 'number') + '</div>' +
      '<div class="row3">' + fld('deal_minutes', 'Coupon valid (minutes)', B.deal_minutes, 'number') + fld('per_customer_daily', 'Offers per customer per day', B.per_customer_daily, 'number') + fld('daily_cap', 'Deals per day (whole shop)', B.daily_cap, 'number') + '</div>' + saveBtn() + '</form>' +
      '<h3 style="margin-top:22px">Per product</h3><div class="v4-bgp">' + d.products.map(function(x){ return '<form class="acard" data-pid="' + esc(x.id) + '" novalidate><div class="top"><strong>' + esc(x.name) + '</strong><span class="small">Price ' + inr(x.price) + ' \u00B7 lowest now <b>' + inr(x.effective.floor) + '</b> \u00B7 opens at ' + inr(x.effective.open) + '</span></div><div class="row3">' +
        fld('floor_price', 'Lowest price \u20B9', x.rules.floor_price, 'number', 'placeholder="auto"') + fld('max_discount_pct', 'or max discount %', x.rules.max_discount_pct, 'number', 'placeholder="' + B.max_discount_pct + '"') + fld('max_rounds', 'Rounds', x.rules.max_rounds, 'number', 'placeholder="' + B.max_rounds + '"') + '</div>' + chk('on', 'Allow offers on this product', x.rules.on !== false) + ' <button class="btn small-btn" type="submit">Save</button><p class="err" id="err-x"></p></form>'; }).join('') + '</div>' +
      '<h3 style="margin-top:22px">Negotiations</h3>' + (d.bargains.length ? d.bargains.map(function(b){ return '<details class="acard v4-chat"><summary><strong>' + esc(b.created_ist) + '</strong> \u00B7 ' + esc(b.product) + ' \u00B7 ' + esc(b.email || '') + ' \u00B7 <span class="status ' + (b.status === 'agreed' ? 's-delivered' : 's-new') + '">' + esc(b.status) + '</span>' + (b.agreed_price ? ' ' + inr(b.list_price) + ' \u2192 <b>' + inr(b.agreed_price) + '</b>' : '') + (b.coupon ? ' \u00B7 ' + esc(b.coupon) + (b.coupon_used ? ' (used)' : '') : '') + '</summary>' +
        b.log.map(function(m){ return '<p class="v4-m ' + (m.by === 'bot' ? 'b' : 'u') + '"><span>' + (m.by === 'bot' ? 'Assistant' : 'Customer') + '</span>' + esc(m.text) + '</p>'; }).join('') + '</details>'; }).join('') : '<p class="muted">No offers yet.</p>');
    var f = $('#f-bg', p);
    wireSave(f, function(){ var n = function(k){ return parseInt(f.elements[k].value, 10); }; return putUi('features', {bargain: f.elements.on.checked}).then(function(){ return putUi('bargain', {on: f.elements.on.checked, max_discount_pct: n('max_discount_pct'), start_discount_pct: n('start_discount_pct'), max_rounds: n('max_rounds'), deal_minutes: n('deal_minutes'), per_customer_daily: n('per_customer_daily'), daily_cap: n('daily_cap')}); }); });
    $$('.v4-bgp form', p).forEach(function(pf){ pf.addEventListener('submit', function(e){ e.preventDefault(); var g = function(k){ return pf.elements[k].value.trim(); }; var btn = $('button[type=submit]', pf); busy(btn, true);
      api('PUT', '/api/admin/products/' + encodeURIComponent(pf.getAttribute('data-pid')) + '/bargain', {on: pf.elements.on.checked, floor_price: g('floor_price'), max_discount_pct: g('max_discount_pct'), max_rounds: g('max_rounds')}).then(function(){ toast('Saved'); bargainsTab(p); }).catch(function(err){ busy(btn, false); $('#err-x', pf).textContent = err.message; }); }); });
  }).catch(fail(p, bargainsTab));
}

/* ---------- AR ---------- */
function arTab(p){
  Promise.all([loadUi(), api('GET', '/api/admin/products')]).then(function(r){
    var A = UI4.ui.ar, F = UI4.ui.features;
    p.innerHTML = '<form class="panel" novalidate id="f-ar"><h3 style="margin-top:0">AR & 3D</h3><p class="note">Customers open these from a product page (\u201CView in 3D / your room\u201D) or the AR page at <a href="/ar" target="_blank">/ar</a> and in the app.</p>' +
      chk('on', 'AR features on', F.ar !== false) + chk('viewer', '3D viewer + \u201CView in your room\u201D', A.viewer) + chk('selfie', 'Glow selfie frame (fun filter with your branding)', A.selfie) + chk('scan', 'Scan the bottle \u2192 how-to-use + reorder', A.scan) +
      fld('caption', 'Selfie frame caption', A.caption, 'text', 'maxlength="40"') + saveBtn() + '</form>' +
      '<h3 style="margin-top:22px">3D models per product</h3><div>' + r[1].products.map(function(x){ var a = x.ar || {}; return '<div class="acard" data-pid="' + esc(x.id) + '"><div class="top"><strong>' + esc(x.name) + '</strong><span class="small">' + (a.model ? (a.model.indexOf('/media/') === 0 ? 'Your uploaded model' : 'Built-in AVERMONTIS model') : 'No 3D model yet') + '</span></div>' +
        chk('on-' + x.id, 'Show 3D/AR for this product', a.on) + ' <label class="btn ghost small-btn">Upload .glb<input type="file" accept=".glb,model/gltf-binary" hidden data-glb></label>' + (a.model ? ' <a class="btn ghost small-btn" target="_blank" href="/ar?p=' + encodeURIComponent(x.id) + '">Preview</a>' : '') + '<p class="err small"></p></div>'; }).join('') + '</div>';
    var f = $('#f-ar', p);
    wireSave(f, function(){ return putUi('features', {ar: f.elements.on.checked}).then(function(){ return putUi('ar', {viewer: f.elements.viewer.checked, selfie: f.elements.selfie.checked, scan: f.elements.scan.checked, caption: f.elements.caption.value.trim()}); }); });
    $$('.acard[data-pid]', p).forEach(function(card){ var id = card.getAttribute('data-pid'), e = $('.err', card);
      var save = function(extra){ return api('PUT', '/api/admin/products/' + encodeURIComponent(id) + '/ar', Object.assign({on: $('input[type=checkbox]', card).checked}, extra || {})).then(function(){ toast('Saved'); }).catch(function(err){ e.textContent = err.message; }); };
      $('input[type=checkbox]', card).addEventListener('change', function(){ save(); });
      $('[data-glb]', card).addEventListener('change', function(){ var file = this.files && this.files[0]; if (!file) return; e.textContent = 'Uploading\u2026'; upload(file, 'model').then(function(url){ e.textContent = ''; return save({model_url: url}); }).then(function(){ arTab(p); }).catch(function(err){ e.textContent = err.message; }); });
    });
  }).catch(fail(p, arTab));
}

/* ---------- Notifications ---------- */
function notifyTab(p){
  Promise.all([loadUi(), api('GET', '/api/admin/notifications')]).then(function(r){
    var list = r[1].notifications;
    p.innerHTML = '<form class="panel" novalidate id="f-nt"><h3 style="margin-top:0">Send a notification</h3><p class="note">Shows in the app\u2019s bell (and as a phone notification when the customer opens the app). Customers also get automatic updates when you change an order\u2019s status. The top-of-site announcement line is under Settings.</p>' +
      '<div class="row2">' + sel('kind', 'Type', 'offer', [['offer', 'Offer'], ['news', 'News'], ['tip', 'Skincare tip']]) + fld('days', 'Show for (days, 0 = no end)', 7, 'number') + '</div>' + fld('title', 'Title', '', 'text', 'maxlength="80" placeholder="Weekend offer: 10% off serums"') + area('body', 'Text', '', 2, 'maxlength="240"') + fld('link', 'Link (optional)', '', 'text', 'placeholder="/shop/serums"') + saveBtn('Publish') + '</form>' +
      chk('nt-on', 'Notifications on', UI4.ui.features.notifications !== false) +
      '<h3 style="margin-top:20px">Published</h3>' + (list.length ? list.map(function(n){ return '<div class="acard"><div class="top"><div><strong>' + esc(n.title) + '</strong> <span class="muted small">' + esc(n.kind) + ' \u00B7 ' + esc(n.created_ist) + (n.expires_ist ? ' \u00B7 until ' + esc(n.expires_ist) : '') + '</span><br><span class="small">' + esc(n.body || '') + '</span></div><span><button type="button" class="btn ghost small-btn" data-tg="' + n.id + '" data-on="' + (n.active ? 1 : 0) + '">' + (n.active ? 'Hide' : 'Show') + '</button> <button type="button" class="btn danger small-btn" data-dl="' + n.id + '">Delete</button></span></div></div>'; }).join('') : '<p class="muted">Nothing published yet.</p>');
    var f = $('#f-nt', p);
    wireSave(f, function(){ var g = function(n){ return f.elements[n].value.trim(); }; return api('POST', '/api/admin/notifications', {kind: g('kind'), title: g('title'), body: g('body'), link: g('link'), days: parseInt(g('days') || '0', 10)}).then(function(){ notifyTab(p); }); });
    $('#nt-on', p).addEventListener('change', function(){ putUi('features', {notifications: this.checked}).then(function(){ toast('Saved'); }); });
    $$('[data-tg]', p).forEach(function(b){ b.addEventListener('click', function(){ api('PATCH', '/api/admin/notifications/' + b.getAttribute('data-tg'), {active: b.getAttribute('data-on') !== '1'}).then(function(){ notifyTab(p); }); }); });
    $$('[data-dl]', p).forEach(function(b){ b.addEventListener('click', function(){ if (confirm('Delete this notification?')) api('PATCH', '/api/admin/notifications/' + b.getAttribute('data-dl'), {delete: true}).then(function(){ notifyTab(p); }); }); });
  }).catch(fail(p, notifyTab));
}

/* ---------- Overview: extra insights ---------- */
function insightsBlock(p){
  api('GET', '/api/admin/insights?days=30').then(function(d){
    var max = Math.max.apply(null, d.top_products.map(function(x){ return x.revenue; }).concat([1]));
    var st = d.status_counts, tot = Object.keys(st).reduce(function(a, k){ return a + st[k]; }, 0) || 1;
    var cols = {'new': '#C6A16A', confirmed: '#8a6d3b', shipped: '#4a6fa5', delivered: '#2f5e3f', cancelled: '#9e2f25'};
    var el = document.createElement('div'); el.className = 'v4-ins';
    el.innerHTML = '<h3>Last 30 days</h3><div class="stats">' + stat(inr(d.revenue), 'Revenue (not cancelled)') + stat(d.orders, 'Orders') + stat(inr(d.aov), 'Average order') + stat(inr(d.discounts), 'Discounts given') + stat(d.repeat_customers, 'Repeat customers (all time)') + stat(d.chats.sessions, 'Assistant chats') + stat(d.bargain.total ? d.bargain.rate + '%' : '\u2014', 'Offers accepted') + stat(d.wishlist_items, 'Wishlist saves') + '</div>' +
      '<div class="v4-2col"><div class="chart"><strong>Top products by sales</strong>' + (d.top_products.length ? d.top_products.map(function(x){ return '<div class="v4-bar"><span>' + esc(x.name) + ' <em>' + x.qty + ' sold</em></span><i style="width:' + Math.max(4, Math.round(100 * x.revenue / max)) + '%"></i><b>' + inr(x.revenue) + '</b></div>'; }).join('') : '<p class="muted small">No sales yet.</p>') + '</div>' +
      '<div class="chart"><strong>Orders by status</strong><div class="v4-stack">' + Object.keys(cols).map(function(k){ return st[k] ? '<i style="width:' + (100 * st[k] / tot) + '%;background:' + cols[k] + '" title="' + k + ': ' + st[k] + '"></i>' : ''; }).join('') + '</div><ul class="v4-legend">' + Object.keys(cols).map(function(k){ return '<li><i style="background:' + cols[k] + '"></i>' + (LABEL[k] || k) + ' <b>' + (st[k] || 0) + '</b></li>'; }).join('') + '</ul></div></div>' +
      '<div class="v4-quick"><a class="btn ghost small-btn" href="#customize" data-goto="customize">\uD83C\uDFA8 Customize look</a><a class="btn ghost small-btn" href="#notify" data-goto="notify">\uD83D\uDD14 Send offer</a><a class="btn ghost small-btn" href="#assistant" data-goto="assistant">\uD83D\uDCAC Chats</a><a class="btn ghost small-btn" href="#bargains" data-goto="bargains">\uD83E\uDD1D Bargains</a><a class="btn ghost small-btn" href="/" target="_blank">\u2197 View store</a></div>';
    p.appendChild(el);
    $$('[data-goto]', el).forEach(function(a){ a.addEventListener('click', function(e){ e.preventDefault(); go(a.getAttribute('data-goto')); }); });
  }).catch(function(){});
}

/* ---------- Orders: notes, refund note, timeline ---------- */
function orderExtras(list){
  $$('.acard[data-id]', list).forEach(function(card){
    if (card.dataset.v4) return; card.dataset.v4 = '1';
    var id = card.getAttribute('data-id'), acts = $('.acts', card); if (!acts) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost small-btn'; b.textContent = 'Notes & timeline'; acts.insertBefore(b, $('[data-del]', acts));
    var box = document.createElement('div'); box.className = 'v4-onote'; box.hidden = true; card.appendChild(box);
    b.addEventListener('click', function(){
      if (!box.hidden) { box.hidden = true; return; } box.hidden = false; box.innerHTML = '<p class="muted small"><span class="spinner"></span> Loading\u2026</p>';
      api('GET', '/api/admin/orders/' + encodeURIComponent(id) + '/events').then(function(r){
        box.innerHTML = '<ol class="v4-tl">' + r.events.map(function(e){ return '<li><b>' + esc(LABEL[e.status] || e.status) + '</b> <span class="muted small">' + esc(e.time_ist) + '</span>' + (e.note ? '<br><span class="small">' + esc(e.note) + '</span>' : '') + '</li>'; }).join('') + '</ol>' +
          '<form novalidate>' + area('admin_note', 'Private note (only you see this)', r.admin_note, 2, 'maxlength="500"') + area('refund_note', 'Refund note (e.g. \u20B9549 refunded by UPI on 30 Oct)', r.refund_note, 2, 'maxlength="500"') +
          '<label class="showpw"><input type="checkbox" name="log_event"> Add the refund note to the customer\u2019s order timeline</label><button class="btn small-btn" type="submit">Save notes</button></form>';
        var f = $('form', box);
        f.addEventListener('submit', function(e){ e.preventDefault(); var btn = $('button', f); busy(btn, true);
          api('PUT', '/api/admin/orders/' + encodeURIComponent(id) + '/note', {admin_note: f.elements.admin_note.value, refund_note: f.elements.refund_note.value, log_event: f.elements.log_event.checked}).then(function(){ toast('Notes saved'); busy(btn, false); box.hidden = true; }).catch(function(err){ busy(btn, false); toast(err.message); }); });
      }).catch(function(err){ box.innerHTML = errorBox(err); });
    });
  });
}

function boot(){
  offline();
  var root = $('#admin-root'), setup = $('#setup-root');
  if (setup) return setupPage(setup);
  if (!root) return;
  api('GET', '/api/admin/me').then(function(){ dashboard(root); }, function(err){
    if (err.status !== 403) { root.innerHTML = errorBox(err, true); $('[data-retry]', root).addEventListener('click', boot); return; }
    $('#admin-logout').classList.add('hidden');
    api('GET', '/api/admin/setup-status').then(function(s){ loginView(root, s.setup_open); }, function(e){ root.innerHTML = errorBox(e, true); $('[data-retry]', root).addEventListener('click', boot); });
  });
}
document.addEventListener('DOMContentLoaded', function(){
  var lo = $('#admin-logout');
  if (lo) lo.addEventListener('click', function(){ lo.disabled = true; api('POST', '/api/admin/logout', {}).then(function(){ location.href = '/admin'; }, function(err){ lo.disabled = false; toast(err.message); }); });
  boot();
});
})();
