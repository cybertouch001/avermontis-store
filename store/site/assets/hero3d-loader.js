/* Avermontis 3D hero loader: decides if this device should get the 3D bottle, then lazy-loads it.
   Falls back to the normal hero photo when WebGL is missing, the device looks slow, or data saver is on.
   Add ?3d=off to any URL to see the photo version, ?3d=force to skip the speed checks. */
(function () {
  var host = document.getElementById('hero3d');
  if (!host) return;
  var q = location.search, force = /[?&]3d=force\b/.test(q);
  function no(reason) { window.__av3d = { active: false, reason: reason }; host.classList.add('no-3d'); }
  if (/[?&]3d=off\b/.test(q)) return no('off');
  if (!force) {
    var c = navigator.connection || {};
    if (c.saveData || /(^|-)2g$/.test(c.effectiveType || '')) return no('save-data');
    if (navigator.deviceMemory && navigator.deviceMemory < 2) return no('low-memory');
  }
  try {
    var t = document.createElement('canvas');
    var opts = { failIfMajorPerformanceCaveat: !force };
    var gl = t.getContext('webgl2', opts) || t.getContext('webgl', opts);
    if (!gl) return no('no-webgl');
    var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  } catch (e) { return no('no-webgl'); }
  function go() {
    var s = document.createElement('script');
    s.type = 'module'; s.src = 'assets/hero3d.js';
    s.onerror = function () { no('load-failed'); };
    document.head.appendChild(s);
  }
  function idle() { ('requestIdleCallback' in window) ? requestIdleCallback(go, { timeout: 2500 }) : setTimeout(go, 300); }
  if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle);
})();
