/* Runs in <head> before the page paints: marks app mode (installed / launched from the home screen). */
(function () {
  // the installed app (home-screen icon or Android app v1) now opens the app UI at /app; the website itself is unchanged
  if (location.pathname === '/' && /[?&]source=pwa\b/.test(location.search) && !/[?&]view=site\b/.test(location.search)) { location.replace('/app' + location.search + location.hash); return; }
  var d = document.documentElement, s;
  try { s = window.sessionStorage; } catch (e) { s = null; }
  var standalone = (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: minimal-ui)').matches)) || window.navigator.standalone === true;
  var fromIcon = /[?&]source=pwa\b/.test(location.search);
  if (fromIcon && s) { try { s.setItem('avm_app', '1'); } catch (e) {} }
  var app = standalone || fromIcon || (s && s.getItem('avm_app') === '1');
  if (app) {
    d.classList.add('is-app');
    if (s && !s.getItem('avm_launched')) { d.classList.add('app-launch'); try { s.setItem('avm_launched', '1'); } catch (e) {} }
  }
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) d.classList.add('is-ios');
})();
