
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, LatheGeometry, CylinderGeometry, Vector2,
  MeshPhysicalMaterial, MeshStandardMaterial, MeshBasicMaterial, CanvasTexture, SRGBColorSpace,
  AmbientLight, DirectionalLight, PointLight, PMREMGenerator, PlaneGeometry, AdditiveBlending,
  ACESFilmicToneMapping, TorusGeometry
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const host = document.getElementById('hero3d');
const FORCE = /[?&]3d=force\b/.test(location.search);
const W = window;

function fallback(reason) {
  try { W.__av3d = { active: false, reason }; host.classList.remove('is-3d'); host.classList.add('no-3d');
    const c = host.querySelector('canvas'); if (c) c.remove(); } catch (e) {}
}

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

// Full-wrap label: the real Vitamin C label art on the front quarter, plain matching green elsewhere.
function makeLabelTexture(img) {
  const H = 512, front = Math.round(img.width * H / img.height), Wc = front * 4;
  const c = document.createElement('canvas'); c.width = 2048; c.height = H;
  const sx = c.width / Wc; // squeeze the wrap into a power-of-two width
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#17331f'); grad.addColorStop(.5, '#1d3f27'); grad.addColorStop(1, '#142c1b');
  g.fillStyle = grad; g.fillRect(0, 0, c.width, H);
  g.strokeStyle = '#c9a24a'; g.lineWidth = 3;
  for (const y of [H * 0.046, H * 0.967]) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
  // back panel brand line, drawn at both wrap edges so it meets across the seam
  g.fillStyle = '#d8c48a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 46px Cormorant, Georgia, serif';
  const back = (x) => {
    g.save(); g.translate(x, H * 0.44); g.scale(sx * 1.6, 1);
    g.fillText('A V E R M O N T I S', 0, 0); g.restore();
    g.save(); g.translate(x, H * 0.56); g.scale(sx * 1.6, 1); g.font = '400 26px system-ui, sans-serif'; g.fillStyle = '#b9c9bd';
    g.fillText('VITAMIN C FACE SERUM · 30 ml', 0, 0); g.restore();
  };
  back(0); back(c.width);
  const fw = front * sx, fx = c.width / 2 - fw / 2;
  g.drawImage(img, fx, 0, fw, H);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function glowTexture(color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, color); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}

async function main() {
  if (!host) return;
  const labelImg = await loadImage(host.getAttribute('data-label') || 'assets/3d/label-vitc.webp');
  try { await document.fonts.load('600 46px Cormorant'); } catch (e) {}

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Avermontis Vitamin C Face Serum, 3D view. Drag to rotate.');
  canvas.setAttribute('role', 'img');
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: (W.devicePixelRatio || 1) < 2, alpha: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: !FORCE });
  } catch (e) { return fallback('webgl-context'); }
  const small = Math.min(W.innerWidth, W.innerHeight) < 600;
  renderer.setPixelRatio(Math.min(W.devicePixelRatio || 1, small ? 1.75 : 2));
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const pm = new PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  pm.dispose();

  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0.9, 8.1); camera.lookAt(0, 0.48, 0);

  // ---------- bottle ----------
  const bottle = new Group(); scene.add(bottle);
  const R = 0.62;                      // body radius
  const prof = [];
  prof.push(new Vector2(0.0001, -1.0)); prof.push(new Vector2(R - 0.08, -1.0));
  prof.push(new Vector2(R - 0.02, -0.985)); prof.push(new Vector2(R, -0.94));
  prof.push(new Vector2(R, 0.55));
  for (let i = 1; i <= 10; i++) { const a = i / 10 * Math.PI / 2; prof.push(new Vector2(0.24 + (R - 0.24) * Math.cos(a), 0.55 + 0.30 * Math.sin(a))); }
  prof.push(new Vector2(0.22, 0.88)); prof.push(new Vector2(0.22, 1.02)); prof.push(new Vector2(0.0001, 1.02));
  const glass = new MeshPhysicalMaterial({ color: 0x8a4512, roughness: 0.05, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.04,
    transparent: true, opacity: 0.94, emissive: 0x2a1203, emissiveIntensity: 0.35, envMapIntensity: 2.2, specularIntensity: 1, ior: 1.5 });
  bottle.add(new Mesh(new LatheGeometry(prof, 72), glass));

  // label: the whole wrap, slightly proud of the glass
  const labelTex = makeLabelTexture(labelImg);
  const front = labelImg.width / labelImg.height; // front panel width/height
  const LH = (Math.PI / 2) * (R + 0.006) / front; // front quarter arc / height = label aspect
  const labelMat = new MeshStandardMaterial({ map: labelTex, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.6 });
  const label = new Mesh(new CylinderGeometry(R + 0.006, R + 0.006, LH, 96, 1, true, -Math.PI, Math.PI * 2), labelMat);
  label.position.y = -0.2; bottle.add(label);

  // collar (ribbed black cap) + rubber bulb
  const black = new MeshStandardMaterial({ color: 0x0b0d0c, roughness: 0.35, metalness: 0.2, envMapIntensity: 0.9 });
  const collar = new Mesh(new CylinderGeometry(0.33, 0.33, 0.5, 48), black); collar.position.y = 1.2; bottle.add(collar);
  for (let i = 0; i < 4; i++) { const r = new Mesh(new TorusGeometry(0.335, 0.012, 6, 48), black); r.rotation.x = Math.PI / 2; r.position.y = 1.02 + i * 0.12; bottle.add(r); }
  const ring = new Mesh(new TorusGeometry(0.30, 0.025, 8, 48), new MeshStandardMaterial({ color: 0x2fbf7f, roughness: 0.3, metalness: 0.6, emissive: 0x0e5a37, emissiveIntensity: 0.6 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 1.47; bottle.add(ring);
  const bp = [];
  bp.push(new Vector2(0.0001, 0)); bp.push(new Vector2(0.24, 0)); bp.push(new Vector2(0.21, 0.06)); bp.push(new Vector2(0.17, 0.12));
  bp.push(new Vector2(0.16, 0.3));
  for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI / 2; bp.push(new Vector2(0.17 * Math.cos(a) + 0.0001, 0.42 + 0.17 * Math.sin(a))); }
  const bulb = new Mesh(new LatheGeometry(bp, 40), new MeshStandardMaterial({ color: 0x050605, roughness: 0.62, metalness: 0, envMapIntensity: 0.5 }));
  bulb.position.y = 1.45; bottle.add(bulb);
  bottle.position.y = -0.05;

  // ground glow + back halo
  const glow = new Mesh(new PlaneGeometry(3.4, 3.4), new MeshBasicMaterial({ map: glowTexture('rgba(47,191,127,0.55)'), transparent: true, depthWrite: false, blending: AdditiveBlending }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = -1.06; scene.add(glow);
  const halo = new Mesh(new PlaneGeometry(5.2, 5.2), new MeshBasicMaterial({ map: glowTexture('rgba(31,138,91,0.35)'), transparent: true, depthWrite: false, blending: AdditiveBlending }));
  halo.position.set(0, 0.25, -2.2); scene.add(halo);

  // ---------- lights: black stage, green rims, soft white key ----------
  scene.add(new AmbientLight(0xffffff, 0.12));
  const key = new DirectionalLight(0xfff4e6, 1.6); key.position.set(2.5, 3, 4); scene.add(key);
  const rimL = new PointLight(0x2fbf7f, 26, 12, 1.6); rimL.position.set(-2.6, 1.0, -1.6); scene.add(rimL);
  const rimR = new PointLight(0x1f8a5b, 22, 12, 1.6); rimR.position.set(2.8, -0.2, -1.4); scene.add(rimR);
  const under = new PointLight(0x2fbf7f, 6, 6, 2); under.position.set(0, -1.6, 1.4); scene.add(under);

  // ---------- size ----------
  function resize() {
    const w = host.clientWidth, h = host.clientHeight || w;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = w / h < 0.9 ? 36 : 30; camera.updateProjectionMatrix();
  }
  resize();
  if ('ResizeObserver' in W) new ResizeObserver(resize).observe(host); else W.addEventListener('resize', resize);

  // ---------- drag / touch rotate (vertical swipes still scroll the page) ----------
  const reduce = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const RQ = (location.search.match(/[?&]rot=(-?[0-9.]+)/) || [])[1];
  let rotY = RQ ? parseFloat(RQ) : -0.35, rotX = 0.06, velY = 0, dragging = false, lastX = 0, lastY = 0, lastT = 0, idleFor = 10;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; lastT = performance.now(); velY = 0; host.classList.add('dragged'); try { canvas.setPointerCapture(e.pointerId); } catch (_) {} });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY, now = performance.now(), dt = Math.max(1, now - lastT);
    rotY += dx * 0.012; rotX = Math.max(-0.35, Math.min(0.45, rotX + dy * 0.006));
    velY = dx * 0.012 / dt * 16; lastX = e.clientX; lastY = e.clientY; lastT = now; idleFor = 0;
  });
  const end = () => { dragging = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('lostpointercapture', end);

  // ---------- loop: only while on screen; bail to the image if the device can't keep up ----------
  let visible = true, running = false, prev = performance.now(), frames = 0, shown = false; const ft = [];
  if ('IntersectionObserver' in W) new IntersectionObserver((en) => { visible = en[0].isIntersecting; if (visible) start(); }, { rootMargin: '100px' }).observe(host);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  function start() { if (!running && W.__av3d && W.__av3d.active !== false) { running = true; prev = performance.now(); requestAnimationFrame(tick); } }
  function tick(now) {
    if (!visible || document.hidden) { running = false; return; }
    const dt = Math.min(0.05, (now - prev) / 1000); const raw = now - prev; prev = now;
    frames++;
    if (frames > 30 && frames <= 150) ft.push(raw);
    if (frames === 150) { ft.sort((a, b) => a - b); W.__av3d.medianMs = Math.round(ft[60]);
      if (ft[60] > 100 && !FORCE) { running = false; renderer.dispose(); return fallback('slow-device'); } }
    idleFor += dt;
    if (!dragging) {
      velY *= Math.pow(0.04, dt);
      rotY += velY;
      if (idleFor > 1.2 && !reduce && !RQ) rotY += dt * 0.45;           // slow auto-rotate
      rotX += (0.06 - rotX) * Math.min(1, dt * (idleFor > 1.2 ? 1.5 : 0));
    }
    bottle.rotation.y = rotY; bottle.rotation.x = rotX;
    bottle.position.y = -0.05 + (reduce ? 0 : Math.sin(now / 1400) * 0.04);
    renderer.render(scene, camera);
    if (!shown) { shown = true; host.classList.add('is-3d'); }
    W.__av3d.frames = frames; W.__av3d.rotY = rotY;
    requestAnimationFrame(tick);
  }
  host.appendChild(canvas);
  W.__av3d = { active: true, frames: 0, forced: FORCE };
  start();
}

main().catch((e) => fallback('error: ' + (e && e.message || e)));
