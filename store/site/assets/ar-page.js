/* AVERMONTIS /ar page: 3D viewer + View in your room (model-viewer: WebXR / Scene Viewer / Quick Look), glow selfie (fun filter), bottle scan */
(function () {
'use strict';
var $ = function (s, r) { return (r || document).querySelector(s); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
var AR = window.AvmAR; if (!AR) { $('#ar-note').textContent = 'AR could not load. Please refresh the page.'; return; }
AR.configure({ base: '/assets/ar/' });
var CFG = {}; try { CFG = JSON.parse(($('#avm-cfg') || {}).textContent || '{}'); } catch (e) {}
var A = (CFG.ui && CFG.ui.ar) || {}, F = (CFG.ui && CFG.ui.features) || {};
if (F.ar === false) { $('.ar-page').innerHTML = '<h1>AR &amp; 3D</h1><p>AR is switched off right now. <a href="/shop">Browse the shop</a>.</p>'; return; }
var products = [], viewer = null;
function img(p) { var s = String(p.image || ''); return /^(https?:)?\//.test(s) ? s : '/' + s; }
function addToBag(id) {
  try { var c = JSON.parse(localStorage.getItem('avermontis_cart_v1') || '{}') || {}; c[id] = (parseInt(c[id], 10) || 0) + 1; localStorage.setItem('avermontis_cart_v1', JSON.stringify(c)); } catch (e) {}
  location.href = '/cart';
}
function show(id) {
  var p = products.filter(function (x) { return x.id === id; })[0]; if (!p) return;
  Array.prototype.forEach.call(document.querySelectorAll('#ar-pick button'), function (b) { var on = b.getAttribute('data-id') === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  if (viewer) { try { viewer.destroy(); } catch (e) {} viewer = null; }
  var st = $('#ar-stage'); st.innerHTML = '';
  viewer = AR.mountViewer(st, { id: p.id, name: p.name, glb: p.ar.model, poster: p.ar.poster, arGlb: location.origin + p.ar.model, link: location.origin + '/product?id=' + encodeURIComponent(p.id), loading: 'eager', arLabel: 'View in your room' });
  history.replaceState(null, '', '/ar?p=' + encodeURIComponent(p.id));
}
fetch('/api/catalog', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (b) {
  products = (b.products || []).filter(function (p) { return p.ar && p.ar.on !== false && p.ar.model; });
  if (A.viewer === false || !products.length) { $('#ar-viewer-card').hidden = true; return; }
  $('#ar-pick').innerHTML = products.map(function (p) { return '<button type="button" role="tab" data-id="' + esc(p.id) + '"><img src="' + esc(p.ar.poster || img(p)) + '" alt="" width="56" height="70"><span>' + esc(p.name) + '</span></button>'; }).join('');
  $('#ar-pick').addEventListener('click', function (e) { var b = e.target.closest('button[data-id]'); if (b) show(b.getAttribute('data-id')); });
  var want = new URLSearchParams(location.search).get('p');
  show(products.some(function (p) { return p.id === want; }) ? want : products[0].id);
}).catch(function () { $('#ar-stage').innerHTML = '<p class="muted small">Could not load the products. Check your connection and refresh.</p>'; });
var sel = $('#ar-selfie'), scan = $('#ar-scan');
if (A.selfie === false) sel.closest('.ar-card').hidden = true;
if (A.scan === false) scan.closest('.ar-card').hidden = true;
sel.addEventListener('click', function () { AR.openSelfie(document.body, { caption: A.caption || 'My AVERMONTIS glow' }); });
scan.addEventListener('click', function () {
  AR.openScan(document.body, { products: products.map(function (p) { return { id: p.id, name: p.name, size: p.size, price: p.price, image: img(p), how_to_use: p.how_to_use }; }), onReorder: addToBag });
});
})();
