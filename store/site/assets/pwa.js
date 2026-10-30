/* Avermontis app layer: service worker, install button/banner, app tab bar. */
(function () {
  'use strict';
  var d = document, html = d.documentElement;
  var isApp = html.classList.contains('is-app');
  var isIOS = html.classList.contains('is-ios');
  var deferred = null;
  var DISMISS = 'avm_install_dismissed';

  /* 1. service worker */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
    });
  }

  /* 2. tab bar: mark the current tab */
  var path = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  var tabFor = path === '/' ? 'home'
    : /^\/(shop|product|collections)/.test(path) ? 'shop'
    : /^\/(concerns|ingredients|guide)/.test(path) ? 'concerns'
    : /^\/(cart|checkout|order-success)/.test(path) ? 'bag'
    : /^\/(account|login|signup|forgot|reset|track)/.test(path) ? 'account' : '';
  Array.prototype.forEach.call(d.querySelectorAll('.tabbar a[data-tab]'), function (a) {
    if (a.getAttribute('data-tab') === tabFor) a.setAttribute('aria-current', 'page');
  });
  if (isApp) {
    // inside the installed app, the tab bar on website pages leads back to the app screens
    var APP_TABS = { home: '/app#home', shop: '/app#shop', bag: '/app#bag', account: '/app#me' };
    Array.prototype.forEach.call(d.querySelectorAll('.tabbar a[data-tab]'), function (a) { var to = APP_TABS[a.getAttribute('data-tab')]; if (to) a.setAttribute('href', to); });
    // status bar colour follows the page: dark over the home hero, ivory elsewhere
    var meta = d.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', d.body.classList.contains('home') ? '#0B0C0B' : '#F5F0E7');
  }

  /* 3. install */
  function dismissed() { try { var t = +localStorage.getItem(DISMISS); return t && (Date.now() - t) < 14 * 864e5; } catch (e) { return false; } }
  function canShowBanner() {
    if (isApp || dismissed()) return false;
    if (/^\/(admin|checkout|order-success|invoice)/.test(path)) return false;
    if (d.querySelector('.cookie')) return false;
    return !!deferred || isIOS;
  }
  var banner = d.getElementById('install-banner');
  function setBannerText() {
    if (!banner) return;
    var hint = banner.querySelector('[data-install-hint]');
    var btn = banner.querySelector('[data-install]');
    if (isIOS && !deferred) {
      if (hint) hint.innerHTML = 'Tap <span class="ios-share" aria-label="Share"></span> <b>Share</b>, then <b>Add to Home Screen</b>.';
      if (btn) btn.classList.add('hidden');
    }
  }
  var shown = false;
  function showBanner() {
    if (shown || !banner || !canShowBanner()) return;
    shown = true;
    setBannerText();
    banner.hidden = false;
    requestAnimationFrame(function () { banner.classList.add('show'); });
  }
  function hideBanner(remember) {
    if (!banner) return;
    banner.classList.remove('show');
    setTimeout(function () { banner.hidden = true; }, 300);
    if (remember) { try { localStorage.setItem(DISMISS, String(Date.now())); } catch (e) {} }
  }
  function toast(msg) {
    var t = d.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 5200);
  }
  function install() {
    if (deferred) {
      var p = deferred; deferred = null;
      p.prompt();
      p.userChoice.then(function (c) { hideBanner(c && c.outcome !== 'accepted'); }).catch(function () {});
      return;
    }
    if (isApp) { toast('You are already using the Avermontis app.'); return; }
    if (isIOS) { setBannerText(); if (banner) { banner.hidden = false; requestAnimationFrame(function () { banner.classList.add('show'); }); } return; }
    toast('Open your browser menu (⋮) and tap "Install app" or "Add to Home screen".');
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    Array.prototype.forEach.call(d.querySelectorAll('[data-install-wrap]'), function (el) { el.classList.remove('hidden'); });
    setTimeout(showBanner, 3500);
  });
  window.addEventListener('appinstalled', function () {
    deferred = null; hideBanner(true);
    Array.prototype.forEach.call(d.querySelectorAll('[data-install-wrap]'), function (el) { el.classList.add('hidden'); });
    toast('Avermontis app installed. Open it from your home screen.');
  });
  d.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-install],[data-install-close]') : null;
    if (!t) return;
    e.preventDefault();
    if (t.hasAttribute('data-install-close')) hideBanner(true); else install();
  });
  if (!isApp) {
    // the install entries in the menu/footer show wherever installing is possible
    if (isIOS) Array.prototype.forEach.call(d.querySelectorAll('[data-install-wrap]'), function (el) { el.classList.remove('hidden'); });
    if (isIOS) setTimeout(showBanner, 4000);
    // a dismissed cookie notice makes room for the banner
    if (window.MutationObserver) {
      var hadCookie = false;
      var mo = new MutationObserver(function () {
        if (d.querySelector('.cookie')) { hadCookie = true; return; }
        if (hadCookie) { mo.disconnect(); setTimeout(showBanner, 800); }
      });
      mo.observe(d.body, { childList: true });
      setTimeout(function () { if (!hadCookie) mo.disconnect(); }, 60000);
    }
  }
})();
