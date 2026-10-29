/* Plan2Brick project page — UI wiring and three.js scene viewer. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DATA = window.P2B;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const REDUCED = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

const state = {
  plan: 0,
  cand: 0,
  walls: 'ghost',
  view: 'home',
  autoRotate: !REDUCED,
};

let viewer = null;
let partsPromise = null;
let loadToken = 0;
const partLib = new Map();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const fmt = (n) => Number(n).toLocaleString('en-US');
const gateOk = (g) => {
  const s = String(g).toLowerCase();
  return s === 'green' || s === 'pass' || s === 'true' || s === 'ok';
};
const gateLabel = (g) => (gateOk(g) ? 'PASS' : String(g).toUpperCase());

const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.6l3.3-3.3 1.4 1.4L12 17.8l-4.7-6.1 1.4-1.4L12 13.6V3zM5 19h14v2H5z"/></svg>';

/* ------------------------------------------------------------------ */
/* Page structure                                                      */
/* ------------------------------------------------------------------ */

function shortPlanTitle(plan) {
  const tail = plan.title.split('·').slice(1).join('·').trim();
  return tail || plan.subtitle.split(' · ')[0] || plan.id;
}

function renderPlanTabs() {
  $('#planTabs').innerHTML = DATA.plans.map((p, i) => `
    <button class="plan-tab" role="tab" data-plan="${i}" aria-selected="${i === state.plan}">
      <b>${esc(p.id)}</b><span>${esc(shortPlanTitle(p))}</span>
    </button>`).join('');
}

function syncPlanTabs() {
  $$('#planTabs [data-plan]').forEach((b) => {
    b.setAttribute('aria-selected', String(Number(b.dataset.plan) === state.plan));
  });
}

function renderInputCard() {
  const plan = DATA.plans[state.plan];
  const candidate = plan.candidates[0];
  const bbox = candidate.stats.bbox || ['—', '—'];
  $('#inputPlan').src = plan.input;
  $('#inputPlan').alt = `${plan.title} input floor plan`;
  $('#planBadge').textContent = plan.id;
  $('#inputBrief').textContent = `“${plan.brief}”`;
  $('#inputMeta').innerHTML = [
    ['Source', plan.source],
    ['Footprint', `${bbox[0]} × ${bbox[1]} m`],
    ['Plan image', `${plan.inputW} × ${plan.inputH} px`],
    ['Input', 'Image + 1-sentence brief'],
  ].map(([k, v]) => `
    <div><dt>${esc(k)}</dt><dd title="${esc(v)}">${esc(v)}</dd></div>`).join('');
  $('#legendCount').textContent = `${candidate.rooms.length} rooms`;
  $('#roomLegend').innerHTML = candidate.rooms.map((r) => `
    <div class="legend-item"><i style="background:${esc(r.col)}"></i>
      <span title="${esc(r.c || r.n)}">${esc(r.n)}</span></div>`).join('');
  $('#planFrame').onclick = () => openLightbox(plan.input, `${plan.id} · input floor plan`);
}

function renderCandidateTabs() {
  const plan = DATA.plans[state.plan];
  $('#candTabs').innerHTML = plan.candidates.map((c, i) => `
    <button class="cand-tab" role="tab" data-cand="${i}" aria-selected="${i === state.cand}">
      ${esc(c.label)}<small>${fmt(c.stats.parts)} p</small>
    </button>`).join('');
}

function syncCandidateTabs() {
  $$('#candTabs [data-cand]').forEach((b) => {
    b.setAttribute('aria-selected', String(Number(b.dataset.cand) === state.cand));
  });
}

function renderCandidateChrome() {
  const plan = DATA.plans[state.plan];
  const c = plan.candidates[state.cand];
  const s = c.stats;

  $('#stats').innerHTML = `
    <div class="stat"><b>${esc(s.coverage)}</b><span>Coverage</span></div>
    <div class="stat"><b>${fmt(s.parts)}</b><span>Parts</span></div>
    <div class="stat"><b>${esc(s.overlaps)}</b><span>Overlaps</span></div>
    <div class="stat"><b>${esc(s.rooms)}</b><span>Rooms</span></div>
    <div class="stat pass" title="LDraw validation + independent overlap recomputation"><b>${esc(gateLabel(s.gate))}</b><span>Gate</span></div>`;

  const dl = c.downloads;
  const downloads = [
    ['Scene .mpd', dl.mpd, true],
    ['+Walls .mpd', dl.walls_mpd, true],
    ['BOM .csv', dl.bom, true],
    ['Evaluate', dl.evaluate, false],
    ['Validate', dl.validate, false],
  ];
  $('#downloads').innerHTML = downloads.map(([label, href, dlAttr]) => `
    <a href="${esc(href)}" ${dlAttr ? 'download' : 'target="_blank" rel="noopener"'} title="Download ${esc(label)}">
      ${DOWNLOAD_ICON}${esc(label)}</a>`).join('');

  const views = [['home', '3/4 view'], ['top', 'Top view'], ['front', 'Front view']];
  $('#renderStrip').innerHTML = views.map(([key, label]) => `
    <figure class="render-card" data-src="${esc(c.renders[key])}"
      data-cap="${esc(`${plan.id} · candidate ${c.label} · ${label} (room overlay)`)}">
      <img src="${esc(c.renders[key])}" alt="${esc(`${plan.id} candidate ${c.label} ${label} 3D view`)}" loading="lazy">
      <figcaption><b>${esc(label)}</b><span>${esc(c.label)} · ${fmt(s.parts)} parts</span></figcaption>
    </figure>`).join('');
}

function buildResults() {
  const rows = [];
  DATA.plans.forEach((plan, pi) => {
    plan.candidates.forEach((c, ci) => {
      rows.push(`
        <tr>
          <td class="plan-cell">${esc(plan.id)}</td>
          <td class="brief-cell" title="${esc(plan.brief)}">${esc(plan.brief)}</td>
          <td>${esc(c.label)}</td>
          <td class="num-cell">${esc(c.stats.rooms)}</td>
          <td class="num-cell">${esc(c.stats.coverage)}</td>
          <td class="num-cell">${fmt(c.stats.parts)}</td>
          <td class="num-cell">${esc(c.stats.overlaps)}</td>
          <td><span class="gate">${esc(gateLabel(c.stats.gate))}</span></td>
          <td><button class="mini-open" type="button" data-plan="${pi}" data-cand="${ci}"
            aria-label="Open ${esc(plan.id)} candidate ${esc(c.label)} in the 3D viewer">Open →</button></td>
        </tr>`);
    });
  });
  $('#resultsBody').innerHTML = rows.join('');
}

function buildLibrary() {
  $('#libraryGrid').innerHTML = DATA.library.map((item) => `
    <figure class="lib-card">
      <img src="${esc(item.file)}" alt="${esc(item.label)} library object" loading="lazy">
      <figcaption>${esc(item.label)}</figcaption>
    </figure>`).join('');
}

function selectPlan(planIndex, candIndex = 0, { hash = true } = {}) {
  if (!DATA.plans[planIndex]) return;
  const same = planIndex === state.plan && candIndex === state.cand;
  state.plan = planIndex;
  state.cand = Math.min(candIndex, DATA.plans[planIndex].candidates.length - 1);
  syncPlanTabs();
  renderInputCard();
  renderCandidateTabs();
  renderCandidateChrome();
  if (hash) writeHash();
  if (!same || !viewer || !viewer.current) loadCandidate();
}

function selectCandidate(index, { hash = true } = {}) {
  const plan = DATA.plans[state.plan];
  if (!plan.candidates[index] || index === state.cand) return;
  state.cand = index;
  syncCandidateTabs();
  renderCandidateChrome();
  if (hash) writeHash();
  loadCandidate();
}

function writeHash() {
  const plan = DATA.plans[state.plan];
  const cand = plan.candidates[state.cand];
  const next = `#${plan.id}-${cand.label}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

function readHash() {
  const m = /^#([A-Za-z0-9_]+)-([A-Z])$/.exec(location.hash);
  if (!m) return null;
  const pi = DATA.plans.findIndex((p) => p.id === m[1]);
  if (pi < 0) return null;
  const ci = DATA.plans[pi].candidates.findIndex((c) => c.label === m[2]);
  if (ci < 0) return null;
  return { plan: pi, cand: ci };
}

/* ------------------------------------------------------------------ */
/* Lightbox / copy / reveal                                            */
/* ------------------------------------------------------------------ */

let lastFocus = null;

function openLightbox(src, caption) {
  const box = $('#lightbox');
  lastFocus = document.activeElement;
  $('#lbImg').src = src;
  $('#lbImg').alt = caption;
  $('#lbCap').textContent = caption;
  box.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#lbClose').focus();
}

function closeLightbox() {
  const box = $('#lightbox');
  if (box.hidden) return;
  box.hidden = true;
  $('#lbImg').removeAttribute('src');
  document.body.style.overflow = '';
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

function setupLightbox() {
  $('#lbClose').addEventListener('click', closeLightbox);
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target === $('#lightbox')) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });
}

function setupCopy() {
  const btn = $('#copyBib');
  btn.addEventListener('click', async () => {
    const text = $('#bibtex').textContent;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    btn.textContent = ok ? 'Copied ✓' : 'Press Ctrl+C';
    btn.classList.toggle('done', ok);
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('done');
    }, 1800);
  });
}

function setupReveal() {
  const nodes = $$('.reveal');
  if (!('IntersectionObserver' in window) || REDUCED) {
    nodes.forEach((n) => n.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
  nodes.forEach((n) => io.observe(n));
}

/* ------------------------------------------------------------------ */
/* three.js viewer — setup                                             */
/* ------------------------------------------------------------------ */

function initViewer() {
  const canvas = $('#canvas');
  const stage = $('#stage');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch (err) {
    showViewerError(err);
    return null;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // The lights and the scene are static: render the shadow map once per scene
  // (and when wall mode changes) rather than on every orbit frame.
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 60000);
  camera.position.set(1400, 1600, -1500);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.screenSpacePanning = true;
  controls.rotateSpeed = 0.72;
  controls.zoomSpeed = 0.9;
  controls.autoRotateSpeed = 0.5;
  controls.minPolarAngle = 0.02;
  controls.maxPolarAngle = Math.PI * 0.495;

  const hemi = new THREE.HemisphereLight(0xffffff, 0xd4d9e1, 1.18);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0xffffff, 0.18));

  const key = new THREE.DirectionalLight(0xfff8ef, 2.15);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.00045;
  key.shadow.normalBias = 0.35;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(0xdce8ff, 0.55);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShadowMaterial({ color: 0x2d3138, opacity: 0.17 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.1;
  ground.receiveShadow = true;
  scene.add(ground);

  const v = {
    renderer, scene, camera, controls, key, fill, ground,
    current: null,
    tween: null,
    ready: false,
    tmp: new THREE.Vector3(),
  };

  function resize() {
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
  else window.addEventListener('resize', resize);

  function updateTween(now) {
    const tw = v.tween;
    if (!tw) return;
    let k = (now - tw.start) / tw.dur;
    k = Math.max(0, Math.min(1, k));
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
    controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
    camera.lookAt(controls.target);
    if (k === 1) {
      v.tween = null;
      controls.enabled = true;
      controls.update();
    }
  }

  renderer.setAnimationLoop((now) => {
    if (v.tween) {
      updateTween(now);
    } else {
      controls.autoRotate = state.autoRotate && state.view !== 'top' && !REDUCED;
      controls.update();
    }
    renderer.render(scene, camera);
    updateRoomLabels();
  });

  // Auto-rotate yields to the first user interaction.
  controls.addEventListener('start', () => {
    if (!state.autoRotate) return;
    state.autoRotate = false;
    updateAutoRotateUI();
  });

  $('#viewPresets').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    const name = btn.dataset.view;
    if (!['home', 'top', 'front'].includes(name)) return;
    state.view = name;
    state.autoRotate = false;
    updateAutoRotateUI();
    syncViewButtons();
    applyView(name);
  });

  $('#wallToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-walls]');
    if (!btn) return;
    const mode = btn.dataset.walls;
    if (!['off', 'ghost', 'solid'].includes(mode)) return;
    state.walls = mode;
    syncWallButtons();
    applyWallMode();
  });

  $('#autoRotate').addEventListener('click', () => {
    state.autoRotate = !state.autoRotate;
    if (state.autoRotate && state.view === 'top') {
      state.view = 'home';
      syncViewButtons();
      applyView('home');
    }
    updateAutoRotateUI();
  });

  $('#fullscreen').addEventListener('click', () => {
    const card = $('#viewerCard');
    if (!document.fullscreenEnabled || !card.requestFullscreen) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else card.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    setTimeout(() => {
      resize();
      if (v.current) applyView(state.view, { instant: true });
    }, 120);
  });
  if (!document.fullscreenEnabled) $('#fullscreen').hidden = true;

  const hint = $('#stageHint');
  const hideHint = () => hint.classList.add('hide');
  canvas.addEventListener('pointerdown', hideHint, { once: true });
  canvas.addEventListener('wheel', hideHint, { once: true, passive: true });
  setTimeout(hideHint, 9000);

  syncViewButtons();
  syncWallButtons();
  updateAutoRotateUI();
  window.__P2BViewer = v;
  return v;
}

function syncViewButtons() {
  $$('#viewPresets button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
}

function syncWallButtons() {
  $$('#wallToggle button').forEach((b) => b.classList.toggle('on', b.dataset.walls === state.walls));
}

function updateAutoRotateUI() {
  const btn = $('#autoRotate');
  btn.setAttribute('aria-pressed', String(state.autoRotate));
  btn.title = state.autoRotate ? 'Pause auto-rotate' : 'Resume auto-rotate';
}

function showLoader(text, progress) {
  const loader = $('#loader');
  loader.classList.remove('hide');
  $('#loaderText').textContent = text;
  const bar = $('#loaderBar');
  if (bar) bar.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  const spinner = loader.querySelector('.spinner');
  const prog = loader.querySelector('.progress');
  if (spinner) spinner.style.display = '';
  if (prog) prog.style.display = '';
}

function hideLoader() {
  $('#loader').classList.add('hide');
}

function showViewerError(err) {
  console.error(err);
  const loader = $('#loader');
  loader.classList.remove('hide');
  $('#loaderText').textContent = 'The interactive 3D view could not load on this device. The LeoCAD QC renders below show the same nine scenes.';
  const spinner = loader.querySelector('.spinner');
  const prog = loader.querySelector('.progress');
  if (spinner) spinner.style.display = 'none';
  if (prog) prog.style.display = 'none';
  $('#stageHint').style.display = 'none';
}

/* ------------------------------------------------------------------ */
/* three.js viewer — part library                                      */
/* ------------------------------------------------------------------ */

function extractPrimitives(gltf) {
  const out = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const geo = obj.geometry.clone();
    geo.applyMatrix4(obj.matrixWorld);
    Object.keys(geo.attributes).forEach((name) => {
      if (name !== 'position') geo.deleteAttribute(name);
    });
    if (!geo.getAttribute('position')) return;
    geo.clearGroups();
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const materialName = mats.map((m) => (m && m.name) || '').join(',');
    const m = /color_(\d+)/.exec(materialName);
    out.push({ geometry: geo, colorCode: m ? Number(m[1]) : 16 });
  });
  return out;
}

async function loadPartLibrary() {
  const loader = new GLTFLoader();
  const parts = DATA.parts;
  const queue = parts.slice();
  const failed = [];
  let done = 0;

  const worker = async () => {
    while (queue.length) {
      const name = queue.shift();
      try {
        const gltf = await loader.loadAsync(`assets/parts/${name}.glb`);
        partLib.set(name, extractPrimitives(gltf));
      } catch (err) {
        console.error('Part load failed', name, err);
        failed.push(name);
      }
      done += 1;
      showLoader(`Loading part models · ${done}/${parts.length}`, (done / parts.length) * 0.96);
    }
  };

  await Promise.all(Array.from({ length: 8 }, worker));
  if (failed.length) throw new Error(`Missing part models: ${failed.slice(0, 6).join(', ')}${failed.length > 6 ? '…' : ''}`);
  showLoader('Building scene…', 1);
}

/* ------------------------------------------------------------------ */
/* three.js viewer — scene build                                       */
/* ------------------------------------------------------------------ */

const partMaterials = new Map();

function getPartMaterial(code) {
  const key = String(code);
  if (partMaterials.has(key)) return partMaterials.get(key);
  const p = DATA.palette[key] || { hex: '#a7adb5', alpha: 255 };
  const alpha = (p.alpha == null ? 255 : p.alpha) / 255;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(p.hex),
    roughness: 0.58,
    metalness: 0.015,
    flatShading: true,
    side: THREE.DoubleSide,
    transparent: alpha < 0.995,
    opacity: alpha,
    depthWrite: alpha >= 0.995,
  });
  partMaterials.set(key, mat);
  return mat;
}

function mergeIntervals(list, tol = 2) {
  const sorted = list.slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  sorted.forEach(([a, b]) => {
    if (out.length && a <= out[out.length - 1][1] + tol) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    } else {
      out.push([a, b]);
    }
  });
  return out;
}

function wallSegments(rooms) {
  const horiz = new Map();
  const vert = new Map();
  const add = (map, at, a, b) => {
    const key = Math.round(at * 10) / 10;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push([a, b]);
  };
  rooms.forEach((room) => {
    const [x0, z0, x1, z1] = room.r;
    add(horiz, z0, x0, x1);
    add(horiz, z1, x0, x1);
    add(vert, x0, z0, z1);
    add(vert, x1, z0, z1);
  });
  const segments = [];
  Array.from(horiz.entries()).sort((a, b) => a[0] - b[0]).forEach(([at, intervals]) => {
    mergeIntervals(intervals).forEach(([a, b]) => {
      if (b - a > 1) segments.push({ axis: 'h', at, a, b });
    });
  });
  Array.from(vert.entries()).sort((a, b) => a[0] - b[0]).forEach(([at, intervals]) => {
    mergeIntervals(intervals).forEach(([a, b]) => {
      if (b - a > 1) segments.push({ axis: 'v', at, a, b });
    });
  });
  return segments;
}

function roomBounds(rooms) {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  rooms.forEach((room) => {
    const r = room.r;
    x0 = Math.min(x0, r[0]); z0 = Math.min(z0, r[1]);
    x1 = Math.max(x1, r[2]); z1 = Math.max(z1, r[3]);
  });
  if (!Number.isFinite(x0)) {
    x0 = -200; z0 = -200; x1 = 200; z1 = 200;
  }
  return {
    x0, z0, x1, z1,
    cx: (x0 + x1) / 2,
    cz: (z0 + z1) / 2,
    w: Math.max(x1 - x0, 120),
    d: Math.max(z1 - z0, 120),
  };
}

function buildScene(cand) {
  const v = viewer;
  if (!v) return;
  clearScene();

  const bounds = roomBounds(cand.rooms);
  const root = new THREE.Group();
  root.rotation.x = Math.PI;
  v.scene.add(root);

  const cur = {
    root,
    labels: [],
    wallMeshes: [],
    wallEdges: [],
    wallMat: null,
    wallEdgeMat: null,
    wallGroup: null,
    partMeshes: [],
    fitPoints: [],
    disposables: [],
    center: new THREE.Vector3(bounds.cx, 70, -bounds.cz),
  };

  // Room floors + thin outlines.
  cand.rooms.forEach((room) => {
    const [x0, z0, x1, z1] = room.r;
    const w = x1 - x0;
    const d = z1 - z0;
    if (w <= 1 || d <= 1) return;
    const geo = new THREE.PlaneGeometry(w, d);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(room.col || '#eceff3'),
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, 0.6, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    root.add(mesh);
    cur.disposables.push(geo, mat);

    const pts = [
      new THREE.Vector3(x0, 0.4, z0),
      new THREE.Vector3(x1, 0.4, z0),
      new THREE.Vector3(x1, 0.4, z1),
      new THREE.Vector3(x0, 0.4, z1),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xb7b0a4, transparent: true, opacity: 0.55 });
    const line = new THREE.LineLoop(lineGeo, lineMat);
    root.add(line);
    cur.disposables.push(lineGeo, lineMat);
  });

  // Low walls, merged per plan coordinate so shared room edges are one wall.
  // Ghost mode is deliberately faint: it marks the layout without hiding furniture.
  const wallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#8d98a6'),
    roughness: 0.82,
    metalness: 0,
    transparent: true,
    opacity: 0.085,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0x6f7c8c, transparent: true, opacity: 0.34,
  });
  cur.wallMat = wallMat;
  cur.wallEdgeMat = edgeMat;
  cur.disposables.push(wallMat, edgeMat);
  const wallGroup = new THREE.Group();
  cur.wallGroup = wallGroup;
  root.add(wallGroup);
  const WALL_H = 140;
  const WALL_T = 8;
  wallSegments(cand.rooms).forEach((seg) => {
    const len = seg.b - seg.a;
    const geo = seg.axis === 'h'
      ? new THREE.BoxGeometry(len, WALL_H, WALL_T)
      : new THREE.BoxGeometry(WALL_T, WALL_H, len);
    const mesh = new THREE.Mesh(geo, wallMat);
    if (seg.axis === 'h') mesh.position.set((seg.a + seg.b) / 2, -WALL_H / 2, seg.at);
    else mesh.position.set(seg.at, -WALL_H / 2, (seg.a + seg.b) / 2);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    wallGroup.add(mesh);
    cur.wallMeshes.push(mesh);
    cur.disposables.push(geo);

    // Wall-top outlines make the plan readable even with the translucent faces.
    const edgeGeo = new THREE.EdgesGeometry(geo);
    const edge = new THREE.LineSegments(edgeGeo, edgeMat);
    edge.position.copy(mesh.position);
    wallGroup.add(edge);
    cur.wallEdges.push(edge);
    cur.disposables.push(edgeGeo);
  });

  // Instance the parts: one draw call per (part, primitive, resolved colour).
  const groups = new Map();
  cand.placements.forEach((pl) => {
    const [partIndex, color, x, y, z, ...m] = pl;
    const partName = DATA.parts[partIndex];
    const prims = partLib.get(partName);
    if (!prims) return;
    const matrix = new THREE.Matrix4().set(
      m[0], m[1], m[2], x,
      m[3], m[4], m[5], y,
      m[6], m[7], m[8], z,
      0, 0, 0, 1,
    );
    prims.forEach((prim, pi) => {
      const resolved = prim.colorCode === 16 ? color : prim.colorCode;
      const key = `${partIndex}|${resolved}|${pi}`;
      let group = groups.get(key);
      if (!group) {
        group = { geometry: prim.geometry, color: resolved, matrices: [] };
        groups.set(key, group);
      }
      group.matrices.push(matrix);
    });
  });

  groups.forEach((group) => {
    const mesh = new THREE.InstancedMesh(
      group.geometry,
      getPartMaterial(group.color),
      group.matrices.length,
    );
    group.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    cur.partMeshes.push(mesh);
  });

  root.updateMatrixWorld(true);

  // Frame the actual room corners, not the bounding box: L-shaped plans leave
  // whole bbox corners empty and would otherwise look zoomed out.
  cand.rooms.forEach((room) => {
    const [x0, z0, x1, z1] = room.r;
    if (x1 - x0 < 1 || z1 - z0 < 1) return;
    [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].forEach(([x, z]) => {
      [0, -WALL_H].forEach((y) => {
        cur.fitPoints.push(new THREE.Vector3(x, y, z).applyMatrix4(root.matrixWorld));
      });
    });
  });

  // Room labels are HTML projected from the room-centre world positions.
  const labelLayer = $('#roomLabels');
  cand.rooms.forEach((room) => {
    const [x0, z0, x1, z1] = room.r;
    if (x1 - x0 < 1 || z1 - z0 < 1) return;
    const el = document.createElement('div');
    el.className = 'room-label';
    el.title = room.c ? `${room.n} · ${room.c}` : room.n;
    el.innerHTML = `<i></i>${esc(room.n)}`;
    labelLayer.appendChild(el);
    const world = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2).applyMatrix4(root.matrixWorld);
    cur.labels.push({ el, world });
  });

  // Lighting, shadow frustum and ground follow the current footprint.
  const span = Math.max(bounds.w, bounds.d, 240);
  v.key.position.set(bounds.cx + span * 0.55, span * 0.95 + 260, -bounds.cz - span * 0.5);
  v.key.target.position.set(bounds.cx, 0, -bounds.cz);
  v.key.target.updateMatrixWorld();
  const shadowR = span * 0.86;
  const sc = v.key.shadow.camera;
  sc.left = -shadowR; sc.right = shadowR; sc.top = shadowR; sc.bottom = -shadowR;
  sc.near = 1; sc.far = span * 5;
  sc.updateProjectionMatrix();
  v.fill.position.set(bounds.cx - span * 0.5, span * 0.5 + 180, -bounds.cz + span * 0.6);
  v.ground.scale.set(span * 2.6, span * 2.6, 1);
  v.ground.position.set(bounds.cx, -1.1, -bounds.cz);

  v.current = cur;
  v.ready = true;
  applyWallMode();
  applyView(state.view, { instant: true });
  v.renderer.shadowMap.needsUpdate = true;
}

function clearScene() {
  const v = viewer;
  if (!v || !v.current) return;
  const cur = v.current;
  cur.partMeshes.forEach((mesh) => mesh.dispose());
  cur.disposables.forEach((d) => { if (d && d.dispose) d.dispose(); });
  cur.labels.forEach((label) => label.el.remove());
  v.scene.remove(cur.root);
  v.current = null;
}

function applyWallMode() {
  const v = viewer;
  if (!v || !v.current) return;
  const cur = v.current;
  const solid = state.walls === 'solid';
  cur.wallGroup.visible = state.walls !== 'off';
  const mat = cur.wallMat;
  mat.transparent = !solid;
  mat.opacity = solid ? 1 : 0.085;
  mat.depthWrite = solid;
  mat.roughness = solid ? 0.94 : 0.82;
  mat.color.set(solid ? '#eee8de' : '#8d98a6');
  mat.needsUpdate = true;
  const edge = cur.wallEdgeMat;
  edge.opacity = solid ? 0.22 : 0.34;
  edge.color.set(solid ? '#b9ae9d' : '#6f7c8c');
  edge.needsUpdate = true;
  cur.wallMeshes.forEach((mesh) => {
    mesh.castShadow = solid;
    mesh.receiveShadow = solid;
  });
  if (v.renderer) v.renderer.shadowMap.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* three.js viewer — camera, labels                                    */
/* ------------------------------------------------------------------ */

function fitDistance(center, points, dir, up, fovDeg, aspect, margin) {
  const forward = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const trueUp = new THREE.Vector3().crossVectors(right, forward).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  const tanH = tanV * Math.max(aspect, 0.2);
  const rel = new THREE.Vector3();
  let dist = 0;
  points.forEach((p) => {
    rel.copy(p).sub(center);
    const depth = rel.dot(dir);
    const x = Math.abs(rel.dot(right));
    const y = Math.abs(rel.dot(trueUp));
    // Perspective-fit each corner exactly: margin pads the projected extent,
    // while depth is added once for that same corner.
    dist = Math.max(dist, margin * x / tanH + depth, margin * y / tanV + depth);
  });
  return Math.max(dist, 200);
}

function viewSpec(name) {
  const v = viewer;
  if (!v || !v.current) return null;
  const cur = v.current;
  let dir;
  let up;
  if (name === 'top') {
    dir = new THREE.Vector3(0, 1, 0);
    up = new THREE.Vector3(0, 0, 1);
  } else if (name === 'front') {
    dir = new THREE.Vector3(0.04, 0.32, -1).normalize();
    up = new THREE.Vector3(0, 1, 0);
  } else {
    dir = new THREE.Vector3(0.98, 0.9, -1).normalize();
    up = new THREE.Vector3(0, 1, 0);
  }
  const points = cur.fitPoints.length ? cur.fitPoints : [cur.center];
  const margin = name === 'home' ? 1.05 : 1.03;
  const dist = fitDistance(cur.center, points, dir, up, v.camera.fov, v.camera.aspect, margin);
  return {
    pos: cur.center.clone().addScaledVector(dir, dist),
    target: cur.center.clone(),
    up,
    dist,
  };
}

function applyView(name, { instant = false } = {}) {
  const v = viewer;
  if (!v || !v.current) return;
  const spec = viewSpec(name);
  if (!spec) return;

  v.camera.up.copy(spec.up);
  v.controls.object.up.copy(spec.up);
  v.controls.minPolarAngle = name === 'top' ? 0 : 0.02;
  v.controls.maxPolarAngle = name === 'top' ? Math.PI : Math.PI * 0.495;
  v.controls.minDistance = Math.max(40, spec.dist * 0.22);
  v.controls.maxDistance = Math.max(400, spec.dist * 5);

  if (instant || !v.ready) {
    v.tween = null;
    v.controls.enabled = true;
    v.camera.position.copy(spec.pos);
    v.controls.target.copy(spec.target);
    v.camera.lookAt(spec.target);
    v.controls.update();
    return;
  }

  v.controls.enabled = false;
  v.tween = {
    fromPos: v.camera.position.clone(),
    toPos: spec.pos,
    fromTarget: v.controls.target.clone(),
    toTarget: spec.target,
    start: performance.now(),
    dur: 680,
  };
}

function updateRoomLabels() {
  const v = viewer;
  if (!v || !v.current) return;
  const stage = $('#stage');
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const labels = v.current.labels;
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    v.tmp.copy(label.world).project(v.camera);
    const on = v.tmp.z > -1 && v.tmp.z < 1 && Math.abs(v.tmp.x) < 1.3 && Math.abs(v.tmp.y) < 1.3;
    label.el.style.opacity = on ? '1' : '0';
    if (!on) continue;
    const x = (v.tmp.x * 0.5 + 0.5) * w;
    const y = (-v.tmp.y * 0.5 + 0.5) * h;
    label.el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}

/* ------------------------------------------------------------------ */
/* Async scene loading                                                 */
/* ------------------------------------------------------------------ */

async function loadCandidate() {
  const v = viewer;
  if (!v) return;
  const my = ++loadToken;
  const plan = DATA.plans[state.plan];
  const cand = plan.candidates[state.cand];
  showLoader('Loading part models…', 0.02);
  try {
    await partsPromise;
    if (my !== loadToken) return;
    showLoader('Assembling scene…', 1);
    await new Promise((r) => setTimeout(r, 24));
    if (my !== loadToken) return;
    buildScene(cand);
    if (my === loadToken) hideLoader();
  } catch (err) {
    if (my === loadToken) showViewerError(err);
  }
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

function wireUI() {
  $('#planTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-plan]');
    if (!btn) return;
    const i = Number(btn.dataset.plan);
    if (i === state.plan) return;
    selectPlan(i, 0);
  });

  $('#candTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cand]');
    if (!btn) return;
    selectCandidate(Number(btn.dataset.cand));
  });

  $('#resultsBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open]');
    if (!btn) return;
    selectPlan(Number(btn.dataset.plan), Number(btn.dataset.cand));
    $('#viewer').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
  });

  $('#renderStrip').addEventListener('click', (e) => {
    const fig = e.target.closest('.render-card');
    if (!fig) return;
    openLightbox(fig.dataset.src, fig.dataset.cap);
  });

  window.addEventListener('hashchange', () => {
    const h = readHash();
    if (!h) return;
    if (h.plan === state.plan && h.cand === state.cand) return;
    selectPlan(h.plan, h.cand, { hash: false });
  });

  setupLightbox();
  setupCopy();
  setupReveal();
}

function init() {
  if (!DATA) {
    $('#loaderText').textContent = 'Scene data failed to load.';
    return;
  }

  const initial = readHash();
  if (initial) {
    state.plan = initial.plan;
    state.cand = initial.cand;
  }

  renderPlanTabs();
  renderInputCard();
  renderCandidateTabs();
  renderCandidateChrome();
  buildResults();
  buildLibrary();

  viewer = initViewer();
  if (viewer) {
    partsPromise = loadPartLibrary();
    loadCandidate();
  } else {
    partsPromise = Promise.reject(new Error('WebGL unavailable'));
    partsPromise.catch(() => {});
  }

  wireUI();
  updateAutoRotateUI();
  syncViewButtons();
  syncWallButtons();
}

init();
