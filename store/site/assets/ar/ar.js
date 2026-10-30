/*! AVERMONTIS AR module v1.0.0 — 3D viewer, glow selfie (filter — for fun), packaging scan.
 * Global: window.AvmAR. Heavy vendor files load only when a feature opens.
 * Vendor: @google/model-viewer 4.4.0 (Apache-2.0), @mediapipe/tasks-vision 1.2.0 (Apache-2.0), mind-ar 1.2.5 (MIT).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AvmAR = api;
})(typeof window !== 'undefined' ? window : this, function (win) {
  'use strict';
  var doc = win.document;
  var VERSION = '1.0.0';
  var cfg = { base: './', fontFamily: '"Cormorant Garamond", Cormorant, "Cormorant Garamond Fallback", Georgia, serif' };
  var cache = {};
  var debug = { selfie: null, scan: null };

  /* ---------- helpers ---------- */
  function baseOf(o) { var b = (o && o.base) || cfg.base || './'; return b.charAt(b.length - 1) === '/' ? b : b + '/'; }
  function path(p, o) { return baseOf(o) + p; }
  function abs(u) { try { return new URL(u, doc.baseURI).href; } catch (e) { return u; } }
  function el(tag, cls, html) { var e = doc.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function txt(tag, cls, t) { var e = el(tag, cls); e.textContent = t; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function once(key, fn) { if (!cache[key]) { cache[key] = fn().catch(function (e) { delete cache[key]; throw e; }); } return cache[key]; }
  function loadModule(url) { return import(/* webpackIgnore: true */ abs(url)); }
  function loadScriptModule(url) {
    return new Promise(function (res, rej) {
      var s = doc.createElement('script'); s.type = 'module'; s.src = abs(url);
      s.onload = function () { res(); }; s.onerror = function () { rej(new Error('Could not load ' + url)); };
      doc.head.appendChild(s);
    });
  }
  function today() {
    var d = new Date(); var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getDate() + ' ' + m[d.getMonth()] + ' ' + d.getFullYear();
  }
  function stopStream(s) { if (s) s.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); }
  function cameraError(e) {
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Camera permission is off. Allow camera access for this app/site in your settings, then tap Try again.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device.';
    if (n === 'NotReadableError') return 'The camera is busy in another app. Close it and tap Try again.';
    if (!win.isSecureContext) return 'The camera only works on a secure (https) page.';
    return 'Could not start the camera.';
  }
  function getCamera(facing, w, h) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      var err = new Error('getUserMedia unavailable'); err.name = win.isSecureContext ? 'NotFoundError' : 'SecurityError'; return Promise.reject(err);
    }
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: w }, height: { ideal: h } } });
  }
  function waitVideo(video) {
    return new Promise(function (res) {
      if (video.readyState >= 2 && video.videoWidth) return res();
      video.addEventListener('loadeddata', function f() { video.removeEventListener('loadeddata', f); res(); });
    });
  }
  function splitSteps(text) {
    if (!text) return [];
    if (Array.isArray(text)) return text.slice(0, 4);
    var parts = String(text).replace(/[ \t]+/g, ' ').replace(/([.!?\u0964])\s+/g, '$1\n').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length < 2) parts = String(text).split(/;\s+|,\s+then\s+/i).map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length > 4) parts = parts.slice(0, 3).concat([parts.slice(3).join(' ')]);
    return parts.map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); });
  }

  /* ---------- 1. 3D viewer ---------- */
  function loadModelViewer(o) {
    return once('mv', function () {
      if (win.customElements && win.customElements.get('model-viewer')) return Promise.resolve();
      return loadScriptModule(path('vendor/model-viewer.min.js', o)).then(function () { return win.customElements.whenDefined('model-viewer'); });
    });
  }
  function sceneViewerUrl(absGlbUrl, title, opts) {
    opts = opts || {};
    var q = 'file=' + encodeURIComponent(absGlbUrl) + '&mode=' + (opts.mode || 'ar_preferred');
    if (title) q += '&title=' + encodeURIComponent(title);
    if (opts.link) q += '&link=' + encodeURIComponent(opts.link);
    if (opts.resizable === false) q += '&resizable=false';
    return 'https://arvr.google.com/scene-viewer/1.0?' + q;
  }
  function sceneViewerIntent(absGlbUrl, title, opts) {
    opts = opts || {};
    var https = sceneViewerUrl(absGlbUrl, title, opts);
    var fallback = opts.fallbackUrl || https;
    return 'intent://' + https.replace(/^https:\/\//, '') +
      '#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;' +
      'S.browser_fallback_url=' + encodeURIComponent(fallback) + ';end;';
  }
  function mountViewer(container, o) {
    o = o || {};
    if (!container) throw new Error('AvmAR.mountViewer: container missing');
    var id = o.id || 'product';
    var glb = o.glb || path('models/' + id + '.glb', o);
    var poster = o.poster || path('posters/' + id + '.png', o);
    var name = o.name || 'AVERMONTIS';
    var wrap = el('div', 'avm-viewer');
    var mv = doc.createElement('model-viewer');
    var attrs = {
      src: glb, poster: poster, alt: '3D model of ' + name + ' by AVERMONTIS', 'camera-controls': '', 'auto-rotate': '',
      'auto-rotate-delay': '0', 'rotation-per-second': '24deg', 'shadow-intensity': '1', 'shadow-softness': '0.9', exposure: '1.05',
      'tone-mapping': 'neutral', 'environment-image': 'neutral', 'interaction-prompt': 'none', 'touch-action': 'pan-y',
      'camera-orbit': o.cameraOrbit || '0deg 78deg auto', 'min-camera-orbit': 'auto 10deg auto', 'max-camera-orbit': 'auto 100deg auto', loading: o.loading || 'lazy', reveal: 'auto'
    };
    Object.keys(attrs).forEach(function (k) { mv.setAttribute(k, attrs[k]); });
    var btnLabel = o.arLabel || 'View in your room';
    var icon = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4L12 2.8Zm0 0v9.2m0 0 8-4.6M12 12l-8-4.6"/></svg>';
    var arBtn = el('button', 'avm-btn avm-ar-btn', icon + '<span>' + esc(btnLabel) + '</span>');
    arBtn.type = 'button';
    var arGlb = o.arGlb ? abs(o.arGlb) : abs(glb);
    var note = el('p', 'avm-viewer-note');
    if (typeof o.onSceneViewer === 'function') {
      // Native app path: Android System WebView has no WebXR; hand Scene Viewer an absolute public https URL.
      if (/^https?:\/\/(localhost|127\.|10\.|192\.168\.)/.test(arGlb)) console.warn('[AvmAR] Scene Viewer needs a public https glb URL; pass opts.arGlb (got ' + arGlb + ')');
      mv.removeAttribute('ar');
      arBtn.addEventListener('click', function () { o.onSceneViewer(sceneViewerUrl(arGlb, name, { link: o.link }), sceneViewerIntent(arGlb, name, { link: o.link, fallbackUrl: o.fallbackUrl })); });
      wrap.appendChild(mv); wrap.appendChild(arBtn);
    } else {
      mv.setAttribute('ar', ''); mv.setAttribute('ar-modes', o.arModes || 'webxr scene-viewer quick-look');
      mv.setAttribute('ar-scale', 'fixed'); mv.setAttribute('ar-placement', 'floor');
      if (o.iosSrc) mv.setAttribute('ios-src', o.iosSrc);
      arBtn.setAttribute('slot', 'ar-button');
      mv.appendChild(arBtn);
      wrap.appendChild(mv);
      mv.addEventListener('load', function () {
        if (!mv.canActivateAR) { note.textContent = 'Drag to rotate'; }
      });
      mv.addEventListener('ar-status', function (ev) {
        if (ev.detail && ev.detail.status === 'failed') note.textContent = 'AR could not start on this device. You can still rotate the 3D model.';
      });
    }
    var badge = txt('span', 'avm-viewer-badge', '3D');
    wrap.appendChild(badge); wrap.appendChild(note);
    container.appendChild(wrap);
    var ready = loadModelViewer(o).catch(function (e) { note.textContent = '3D viewer could not load. Showing the photo instead.'; wrap.classList.add('avm-viewer--failed'); var img = doc.createElement('img'); img.src = poster; img.alt = name; img.className = 'avm-viewer-fallback'; wrap.insertBefore(img, mv); mv.remove(); throw e; });
    return { element: mv, wrapper: wrap, ready: ready, destroy: function () { wrap.remove(); } };
  }

  /* ---------- 2. Glow selfie (filter — for fun) ---------- */
  function loadFaceDetector(o) {
    return once('face', function () {
      return loadModule(path('vendor/mediapipe/vision_bundle.mjs', o)).then(function (mp) {
        var wasmBase = abs(path('vendor/mediapipe/wasm', o));
        var fileset = { wasmLoaderPath: wasmBase + '/vision_wasm_internal.js', wasmBinaryPath: wasmBase + '/vision_wasm_internal.wasm' };
        return mp.FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: abs(path('vendor/mediapipe/blaze_face_short_range.tflite', o)), delegate: 'CPU' },
          runningMode: 'VIDEO', minDetectionConfidence: 0.5
        });
      });
    });
  }
  function star(ctx, x, y, r, a) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.beginPath();
    for (var i = 0; i < 8; i++) { var rr = i % 2 ? r * 0.28 : r; var t = i * Math.PI / 4; ctx.lineTo(Math.cos(t) * rr, Math.sin(t) * rr); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function openSelfie(container, o) {
    o = o || {};
    var font = o.fontFamily || cfg.fontFamily;
    var root = el('div', 'avm-sheet avm-selfie');
    root.innerHTML =
      '<div class="avm-topbar"><span class="avm-title">Glow selfie</span><span class="avm-pill avm-pill--fun">filter — for fun</span><button type="button" class="avm-icon-btn avm-close" aria-label="Close">&times;</button></div>' +
      '<div class="avm-stage"><video class="avm-video" playsinline muted autoplay></video><canvas class="avm-canvas" aria-label="Camera preview with AVERMONTIS frame"></canvas>' +
      '<img class="avm-preview" alt="Your AVERMONTIS selfie" hidden><div class="avm-status" role="status">Starting camera…</div>' +
      '<div class="avm-msg" hidden><p class="avm-msg-text"></p><button type="button" class="avm-btn avm-retry">Try again</button></div></div>' +
      '<div class="avm-controls avm-controls--live"><button type="button" class="avm-shutter" aria-label="Take photo" disabled><span></span></button></div>' +
      '<div class="avm-controls avm-controls--review" hidden><button type="button" class="avm-btn avm-btn--ghost avm-retake">Retake</button>' +
      '<button type="button" class="avm-btn avm-btn--ghost avm-download">Download</button><button type="button" class="avm-btn avm-share">Share</button></div>' +
      '<p class="avm-fineprint">Just a fun camera filter with a branded frame. It does not analyse or change your skin.</p>';
    container.appendChild(root);
    var q = function (s) { return root.querySelector(s); };
    var video = q('.avm-video'), canvas = q('.avm-canvas'), ctx = canvas.getContext('2d');
    var status = q('.avm-status'), preview = q('.avm-preview'), shutter = q('.avm-shutter');
    var stream = null, raf = 0, detector = null, tracking = 'loading', closed = false, lastBlob = null, lastUrl = null;
    var face = null, faceSeen = 0, particles = [], tPrev = 0;
    var state = { faces: 0, box: null, tracking: 'loading', frames: 0 };
    debug.selfie = state;

    var map = { s: 1, dx: 0, dy: 0 };
    function sizeCanvas() {
      // Output matches the on-screen stage (portrait on phones, like a story), video drawn "cover".
      var st = q('.avm-stage'), sw = st.clientWidth || 360, sh = st.clientHeight || 640;
      var ratio = Math.max(0.5625, Math.min(1.7778, sw / sh)), long = 1080;
      var W = ratio <= 1 ? Math.round(long * ratio) : long, H = ratio <= 1 ? long : Math.round(long / ratio);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      var vw = video.videoWidth || W, vh = video.videoHeight || H, s = Math.max(W / vw, H / vh);
      map = { s: s, dx: (W - vw * s) / 2, dy: (H - vh * s) / 2 };
    }
    win.addEventListener('resize', sizeCanvas);
    function setStatus(t) { status.textContent = t || ''; status.hidden = !t; }
    function showMsg(t) { q('.avm-msg-text').textContent = t; q('.avm-msg').hidden = false; setStatus(''); }
    function start() {
      q('.avm-msg').hidden = true; setStatus('Starting camera…');
      getCamera('user', 1280, 720).then(function (s) {
        if (closed) return stopStream(s);
        stream = s; video.srcObject = s; video.muted = true;
        var p = video.play(); if (p && p.catch) p.catch(function () {});
        return waitVideo(video).then(function () {
          sizeCanvas();
          shutter.disabled = false; setStatus(tracking === 'ready' ? '' : (tracking === 'failed' ? 'tracking unavailable' : 'Loading face tracking…'));
          loop();
        });
      }).catch(function (e) { showMsg(cameraError(e)); });
    }
    loadFaceDetector(o).then(function (d) { detector = d; tracking = 'ready'; state.tracking = 'ready'; if (stream) setStatus(''); })
      .catch(function (e) { console.warn('[AvmAR] face tracking unavailable', e); tracking = 'failed'; state.tracking = 'failed'; if (!closed) setStatus('tracking unavailable'); });

    function detect(now) {
      if (!detector || video.readyState < 2) return;
      try {
        var r = detector.detectForVideo(video, now);
        var d = r && r.detections && r.detections[0];
        state.faces = r && r.detections ? r.detections.length : 0;
        if (d && d.boundingBox) {
          var b = d.boundingBox, s = map.s;
          // video px -> canvas px (cover), mirrored for the selfie view
          var nb = { x: canvas.width - (map.dx + (b.originX + b.width) * s), y: map.dy + b.originY * s, w: b.width * s, h: b.height * s };
          if (!face) face = nb; else { var k = 0.35; face = { x: face.x + (nb.x - face.x) * k, y: face.y + (nb.y - face.y) * k, w: face.w + (nb.w - face.w) * k, h: face.h + (nb.h - face.h) * k }; }
          faceSeen = now; state.box = { x: Math.round(face.x), y: Math.round(face.y), w: Math.round(face.w), h: Math.round(face.h), cw: canvas.width, ch: canvas.height };
        }
      } catch (e) { console.warn('[AvmAR] detect failed', e); tracking = 'failed'; state.tracking = 'failed'; detector = null; setStatus('tracking unavailable'); }
    }
    function anchor(now) {
      var W = canvas.width, H = canvas.height;
      if (face && now - faceSeen < 900) return { x: face.x + face.w / 2, y: face.y + face.h * 0.48, w: face.w, h: face.h, live: true };
      return { x: W / 2, y: H * 0.45, w: W * 0.32, h: W * 0.38, live: false };
    }
    function drawScene(now, forCapture) {
      var W = canvas.width, H = canvas.height, a = anchor(now);
      ctx.save();
      ctx.setTransform(-1, 0, 0, 1, W, 0); // mirror
      var hasFilter = 'filter' in ctx;
      if (hasFilter) ctx.filter = 'brightness(1.07) contrast(0.95) saturate(1.1)';
      var vw = video.videoWidth * map.s, vh = video.videoHeight * map.s;
      ctx.drawImage(video, map.dx, map.dy, vw, vh);
      if (hasFilter) { ctx.filter = 'blur(' + Math.round(W / 90) + 'px)'; ctx.globalAlpha = 0.28; ctx.globalCompositeOperation = 'screen'; ctx.drawImage(video, map.dx, map.dy, vw, vh); ctx.filter = 'none'; }
      ctx.restore();
      ctx.save();
      // warm beauty light centred on the face
      var g = ctx.createRadialGradient(a.x, a.y, a.w * 0.1, a.x, a.y, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(255,214,160,0.30)'); g.addColorStop(0.45, 'rgba(255,190,120,0.12)'); g.addColorStop(1, 'rgba(20,12,4,0.45)');
      ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(255,200,140,0.06)'; ctx.fillRect(0, 0, W, H);
      // halo above the head
      var hy = a.y - a.h * 0.98, hw = a.w * 0.62, hh = a.w * 0.12, pulse = 0.75 + 0.25 * Math.sin(now / 380);
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = 'rgba(232,196,128,0.9)'; ctx.shadowBlur = a.w * 0.12;
      ctx.strokeStyle = 'rgba(232,198,134,' + (0.85 * pulse).toFixed(3) + ')'; ctx.lineWidth = Math.max(2, a.w * 0.025);
      ctx.beginPath(); ctx.ellipse(a.x, hy, hw / 2, hh / 2, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      // sparkles orbiting the face
      var dt = Math.min(64, now - (tPrev || now)); tPrev = now;
      var want = forCapture ? 0 : 2;
      for (var i = 0; i < want; i++) if (particles.length < 70) {
        var ang = Math.random() * Math.PI * 2, rx = a.w * (0.62 + Math.random() * 0.25), ry = a.h * (0.75 + Math.random() * 0.25);
        particles.push({ x: a.x + Math.cos(ang) * rx, y: a.y + Math.sin(ang) * ry, vx: (Math.random() - 0.5) * 0.02, vy: -0.02 - Math.random() * 0.04, life: 0, max: 900 + Math.random() * 1300, r: a.w * (0.025 + Math.random() * 0.04), rot: Math.random() * 3 });
      }
      ctx.fillStyle = '#F3D9A4';
      particles = particles.filter(function (p) {
        p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += 0.002 * dt;
        var k = p.life / p.max; if (k >= 1) return false;
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.95; ctx.shadowColor = 'rgba(198,161,106,0.9)'; ctx.shadowBlur = p.r * 2;
        star(ctx, p.x, p.y, p.r, p.rot); return true;
      });
      ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.globalCompositeOperation = 'source-over';
      // brand frame
      var m = Math.round(Math.min(W, H) * 0.035), gold = '#C6A16A';
      ctx.strokeStyle = gold; ctx.lineWidth = Math.max(2, m * 0.12); ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
      ctx.lineWidth = Math.max(1, m * 0.05); ctx.strokeRect(m * 1.45, m * 1.45, W - 2.9 * m, H - 2.9 * m);
      var S = Math.min(W, H), bandH = Math.round(S * 0.24);
      var bg = ctx.createLinearGradient(0, H - bandH - m, 0, H - m); bg.addColorStop(0, 'rgba(11,12,11,0)'); bg.addColorStop(0.45, 'rgba(11,12,11,0.62)'); bg.addColorStop(1, 'rgba(11,12,11,0.9)');
      ctx.fillStyle = bg; ctx.fillRect(m * 1.45, H - bandH - m * 1.45, W - 2.9 * m, bandH);
      ctx.fillStyle = gold; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      var fs = Math.round(S * 0.085);
      ctx.font = '600 ' + fs + 'px ' + font;
      if ('letterSpacing' in ctx) ctx.letterSpacing = Math.round(fs * 0.22) + 'px';
      ctx.fillText('AVERMONTIS', W / 2, H - m * 1.45 - bandH * 0.42);
      if ('letterSpacing' in ctx) ctx.letterSpacing = Math.round(fs * 0.06) + 'px';
      ctx.font = '500 ' + Math.round(fs * 0.36) + 'px ' + font; ctx.fillStyle = '#F5F0E7';
      ctx.fillText((o.caption || 'Glow moment') + '  ·  ' + today(), W / 2, H - m * 1.45 - bandH * 0.14);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.font = '500 ' + Math.round(fs * 0.3) + 'px ' + font; ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(245,240,231,0.8)';
      ctx.fillText('filter · for fun', W - m * 2, m * 2 + fs * 0.3);
      ctx.restore();
    }
    function loop(now) {
      if (closed) return;
      now = now || performance.now();
      detect(now); drawScene(now, false); state.frames++;
      raf = requestAnimationFrame(loop);
    }
    function capture() {
      shutter.disabled = true;
      canvas.toBlob(function (blob) {
        lastBlob = blob; if (lastUrl) URL.revokeObjectURL(lastUrl); lastUrl = URL.createObjectURL(blob);
        preview.src = lastUrl; preview.hidden = false; canvas.hidden = true;
        q('.avm-controls--live').hidden = true; q('.avm-controls--review').hidden = false;
        var canShareFile = false;
        try { canShareFile = !!(navigator.canShare && navigator.canShare({ files: [new File([blob], 'x.png', { type: 'image/png' })] })); } catch (e) {}
        q('.avm-share').hidden = !(canShareFile || typeof o.onShare === 'function');
        if (typeof o.onCapture === 'function') o.onCapture(blob);
      }, 'image/png');
    }
    function fileName() { return 'avermontis-glow-' + new Date().toISOString().slice(0, 10) + '.png'; }
    shutter.addEventListener('click', capture);
    q('.avm-retake').addEventListener('click', function () { preview.hidden = true; canvas.hidden = false; q('.avm-controls--live').hidden = false; q('.avm-controls--review').hidden = true; shutter.disabled = false; });
    q('.avm-download').addEventListener('click', function () {
      if (!lastBlob) return;
      if (typeof o.onSave === 'function') return o.onSave(lastBlob, fileName());
      var a = doc.createElement('a'); a.href = lastUrl; a.download = fileName(); doc.body.appendChild(a); a.click(); a.remove();
    });
    q('.avm-share').addEventListener('click', function () {
      if (!lastBlob) return;
      if (typeof o.onShare === 'function') return o.onShare(lastBlob, fileName());
      var f = new File([lastBlob], fileName(), { type: 'image/png' });
      navigator.share({ files: [f], title: 'AVERMONTIS', text: o.shareText || 'My AVERMONTIS glow moment ✨' }).catch(function () {});
    });
    q('.avm-retry').addEventListener('click', start);
    function close() {
      if (closed) return; closed = true; cancelAnimationFrame(raf); win.removeEventListener('resize', sizeCanvas); stopStream(stream); stream = null;
      if (video) video.srcObject = null; if (lastUrl) URL.revokeObjectURL(lastUrl); root.remove();
      if (typeof o.onClose === 'function') o.onClose();
    }
    q('.avm-close').addEventListener('click', close);
    start();
    return { close: close, capture: capture, element: root, state: state };
  }

  /* ---------- 3. Packaging / label scan ---------- */
  function loadMind(o) {
    return once('mind', function () { return loadModule(path('vendor/mindar/mindar-controller.js', o)).then(function (m) { return { Controller: m.C }; }); });
  }
  function project(P, M, x, y) {
    // column-major 4x4: clip = P * M * [x,y,0,1]
    var cx = M[0] * x + M[4] * y + M[12], cy = M[1] * x + M[5] * y + M[13], cz = M[2] * x + M[6] * y + M[14], cw = M[3] * x + M[7] * y + M[15];
    var X = P[0] * cx + P[4] * cy + P[8] * cz + P[12] * cw, Y = P[1] * cx + P[5] * cy + P[9] * cz + P[13] * cw, Wc = P[3] * cx + P[7] * cy + P[11] * cz + P[15] * cw;
    return [X / Wc, Y / Wc];
  }
  function openScan(container, o) {
    o = o || {};
    var products = o.products || [];
    var byId = {}; products.forEach(function (p) { byId[p.id] = p; });
    var root = el('div', 'avm-sheet avm-scan');
    root.innerHTML =
      '<div class="avm-topbar"><span class="avm-title">Scan your product</span><button type="button" class="avm-icon-btn avm-close" aria-label="Close">&times;</button></div>' +
      '<div class="avm-stage"><video class="avm-video avm-video--rear" playsinline muted autoplay></video>' +
      '<svg class="avm-scan-quad" aria-hidden="true"><polygon points=""/></svg><div class="avm-scan-reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
      '<div class="avm-scan-card" hidden></div><div class="avm-status" role="status">Starting camera…</div>' +
      '<p class="avm-hint">Point at the AVERMONTIS bottle or its photo</p>' +
      '<div class="avm-msg" hidden><p class="avm-msg-text"></p><button type="button" class="avm-btn avm-retry">Try again</button></div></div>' +
      '<div class="avm-manual"><button type="button" class="avm-manual-toggle" aria-expanded="false">Not scanning? pick your product</button><div class="avm-manual-list" hidden></div></div>';
    container.appendChild(root);
    var q = function (s) { return root.querySelector(s); };
    var video = q('.avm-video'), stage = q('.avm-stage'), card = q('.avm-scan-card'), status = q('.avm-status');
    var quad = q('.avm-scan-quad'), poly = quad.querySelector('polygon'), reticle = q('.avm-scan-reticle');
    var stream = null, controller = null, closed = false, dims = [], targetIds = o.targetIds || null, current = null, lostTimer = 0;
    var state = { found: null, foundCount: 0, card: null, status: 'starting' };
    debug.scan = state;
    function setStatus(t) { status.textContent = t || ''; status.hidden = !t; }
    function cardHtml(p, docked) {
      var steps = splitSteps(p.how_to_use || p.howToUse);
      return '<div class="avm-card-head"><span class="avm-card-kicker">' + (docked ? 'Last scanned' : 'Recognised') + '</span><strong class="avm-card-name">' + esc(p.name) + '</strong>' +
        (p.size ? '<span class="avm-card-size">' + esc(p.size) + '</span>' : '') + '</div>' +
        (steps.length ? '<p class="avm-card-sub">How to use</p><ol class="avm-steps">' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' : '') +
        '<div class="avm-card-actions"><button type="button" class="avm-btn avm-reorder" data-id="' + esc(p.id) + '">Reorder' + (p.price ? ' · ₹' + esc(p.price) : '') + '</button>' +
        (docked ? '<button type="button" class="avm-btn avm-btn--ghost avm-card-x">Scan again</button>' : '') + '</div>';
    }
    function showCard(id, docked) {
      var p = byId[id] || { id: id, name: id };
      if (current !== id + (docked ? ':d' : '')) { card.innerHTML = cardHtml(p, docked); current = id + (docked ? ':d' : ''); }
      card.hidden = false; card.classList.toggle('avm-scan-card--docked', !!docked); state.card = id;
      if (docked) { card.style.transform = ''; card.style.left = ''; card.style.top = ''; }
    }
    card.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('avm-reorder') && typeof o.onReorder === 'function') o.onReorder(b.getAttribute('data-id'));
      if (b.classList.contains('avm-card-x')) { card.hidden = true; current = null; state.card = null; state.manual = false; }
    });
    // manual fallback list
    var list = q('.avm-manual-list'), toggle = q('.avm-manual-toggle');
    list.innerHTML = products.map(function (p) {
      return '<button type="button" class="avm-manual-item" data-id="' + esc(p.id) + '">' + (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">' : '') + '<span>' + esc(p.name) + '</span></button>';
    }).join('');
    toggle.addEventListener('click', function () { var open = list.hidden; list.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); });
    list.addEventListener('click', function (e) { var b = e.target.closest('.avm-manual-item'); if (!b) return; q('.avm-msg').hidden = true; state.manual = true; showCard(b.getAttribute('data-id'), true); card.querySelector('.avm-card-kicker').textContent = 'Your product'; list.hidden = true; toggle.setAttribute('aria-expanded', 'false'); });

    function layout(worldMatrix, idx) {
      var P = controller.getProjectionMatrix(), dm = dims[idx], w = dm[0], h = dm[1];
      var vw = video.videoWidth, vh = video.videoHeight, cw = stage.clientWidth, ch = stage.clientHeight;
      var s = Math.max(cw / vw, ch / vh), ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
      var pts = [[0, 0], [w, 0], [w, h], [0, h], [w / 2, h / 2]].map(function (c) {
        var n = project(P, worldMatrix, c[0], c[1]);
        return [ox + (n[0] + 1) / 2 * vw * s, oy + (1 - n[1]) / 2 * vh * s];
      });
      poly.setAttribute('points', pts.slice(0, 4).map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '));
      quad.classList.add('is-on'); reticle.classList.add('is-off');
      var c = pts[4], minY = Math.min(pts[0][1], pts[1][1], pts[2][1], pts[3][1]), maxY = Math.max(pts[0][1], pts[1][1], pts[2][1], pts[3][1]);
      var cwid = card.offsetWidth || 280, chei = card.offsetHeight || 220;
      var left = Math.max(8, Math.min(cw - cwid - 8, c[0] - cwid / 2));
      var topMin = 64; // keep clear of the top bar
      var top = maxY + 10 + chei < ch - 44 ? maxY + 10 : minY - chei - 10;
      if (top < topMin) top = Math.max(topMin, ch - chei - 44); // no room around the product: sit at the bottom, product stays visible
      card.style.left = left + 'px'; card.style.top = top + 'px';
      state.anchor = { x: Math.round(c[0]), y: Math.round(c[1]), quad: pts.slice(0, 4).map(function (p) { return [Math.round(p[0]), Math.round(p[1])]; }) };
    }
    function layoutQuadOnly(m, idx) { var l = card.style.left, t = card.style.top; layout(m, idx); if (state.manual) { card.style.left = l; card.style.top = t; } }
    function onUpdate(d) {
      if (d && d.type === 'processDone') state.processed = (state.processed || 0) + 1;
      if (closed || d.type !== 'updateMatrix') return;
      var id = targetIds ? targetIds[d.targetIndex] : (products[d.targetIndex] || {}).id;
      if (d.worldMatrix) {
        clearTimeout(lostTimer); state.found = id; state.foundCount++; setStatus('');
        if (!state.manual) { showCard(id, false); layout(d.worldMatrix, d.targetIndex); } else { layoutQuadOnly(d.worldMatrix, d.targetIndex); }
      } else {
        quad.classList.remove('is-on'); reticle.classList.remove('is-off');
        clearTimeout(lostTimer);
        lostTimer = setTimeout(function () { if (!closed && state.card && !state.manual) { showCard(state.found, true); } setStatus('Scanning…'); }, 700);
      }
    }
    function start() {
      q('.avm-msg').hidden = true; setStatus('Starting camera…');
      var targetsUrl = o.targets || path('targets.mind', o), mapUrl = o.targetMap || path('targets.json', o);
      var mapP = targetIds ? Promise.resolve() : fetch(mapUrl).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.targets) targetIds = j.targets.map(function (t) { return t.id; }); }).catch(function () {});
      getCamera('environment', 1280, 720).then(function (s) {
        if (closed) return stopStream(s);
        stream = s; video.srcObject = s; var pl = video.play(); if (pl && pl.catch) pl.catch(function () {});
        return waitVideo(video).then(function () {
          setStatus('Loading scanner…'); state.status = 'loading';
          return Promise.all([loadMind(o), mapP]);
        }).then(function (r) {
          if (closed) return;
          var M = r[0];
          // MindAR reads video.width/height (attributes) when copying frames; CSS still sizes the element.
          video.setAttribute('width', video.videoWidth); video.setAttribute('height', video.videoHeight);
          controller = new M.Controller({ inputWidth: video.videoWidth, inputHeight: video.videoHeight, maxTrack: 1, filterMinCF: 0.0001, filterBeta: 0.001, warmupTolerance: 3, missTolerance: 6, onUpdate: onUpdate });
          return controller.addImageTargets(abs(targetsUrl)).then(function (res) {
            dims = res.dimensions; if (closed) return;
            controller.dummyRun(video); controller.processVideo(video);
            state.status = 'scanning'; setStatus('Scanning…');
          });
        }).catch(function (e) {
          console.warn('[AvmAR] scanner unavailable', e); state.status = 'failed';
          setStatus('Scanner unavailable on this device — pick your product below.');
          list.hidden = false; toggle.setAttribute('aria-expanded', 'true');
        });
      }).catch(function (e) { state.status = 'nocamera'; q('.avm-msg-text').textContent = cameraError(e) + ' You can still pick your product below.'; q('.avm-msg').hidden = false; setStatus(''); list.hidden = false; toggle.setAttribute('aria-expanded', 'true'); });
    }
    q('.avm-retry').addEventListener('click', start);
    function close() {
      if (closed) return; closed = true; clearTimeout(lostTimer);
      try { if (controller) { controller.stopProcessVideo(); controller.dispose(); } } catch (e) {}
      stopStream(stream); stream = null; video.srcObject = null; root.remove();
      if (typeof o.onClose === 'function') o.onClose();
    }
    q('.avm-close').addEventListener('click', close);
    start();
    return { close: close, element: root, state: state };
  }

  return {
    version: VERSION,
    configure: function (o) { Object.keys(o || {}).forEach(function (k) { cfg[k] = o[k]; }); return cfg; },
    mountViewer: mountViewer,
    sceneViewerUrl: sceneViewerUrl,
    sceneViewerIntent: sceneViewerIntent,
    openSelfie: openSelfie,
    openScan: openScan,
    splitSteps: splitSteps,
    preload: function (what, o) { return what === 'viewer' ? loadModelViewer(o) : what === 'selfie' ? loadFaceDetector(o) : what === 'scan' ? loadMind(o) : Promise.resolve(); },
    _debug: debug
  };
});
