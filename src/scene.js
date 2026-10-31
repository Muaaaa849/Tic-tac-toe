// STRATA — three.js scene: photoreal board, pieces, camera rig, compositing.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as TX from './textures.js';

// ------------------------------------------------------------ dimensions
const CELL = 1;
const MARGIN = 0.6;          // board rim beyond the grid
const BOARD_T = 0.42;        // board thickness
const BEVEL = 0.07;
export const PIECE_R = 0.415;
export const PIECE_T = 0.2;
const GEM_R = 0.318;
const GEM_FLOOR = PIECE_T - 0.028;
const HOVER = 0.62;          // ghost hover height above the landing spot
const EXPLODE_GAP = 0.36;    // vertical gap between pieces in the reveal

export const GEM_HEX = [0xe3122d, 0x0fae4b, 0x1652ec];
const GLYPHS = ['triangle', 'circle', 'square'];
const NEUTRAL_BODY = new THREE.Color(0x5a5e66);

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// --------------------------------------------------------------- easing
const ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  inBack: (t) => { const c1 = 1.4; return (c1 + 1) * t * t * t - c1 * t * t; },
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
};

// ---------------------------------------------------- composite shader
const CompositeShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    center: { value: new THREE.Vector2(0.5, 0.5) },
    vignette: { value: 0.42 },
    grain: { value: 0.028 },
    aberration: { value: 0.0022 },
    seed: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 resolution, center;
    uniform float vignette, grain, aberration, seed;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main() {
      vec2 d = vUv - center;
      vec2 px = d * resolution;
      float dist = length(px) / (0.5 * length(resolution));
      // lens chromatic aberration (radial, grows toward the edges)
      vec2 off = d * aberration * dist * dist * 2.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // optical vignette
      col *= 1.0 - vignette * smoothstep(0.25, 1.15, dist);
      // split-tone grade: warm highlights, cool shadows
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= mix(vec3(0.965, 0.99, 1.04), vec3(1.035, 1.0, 0.965), smoothstep(0.05, 0.7, l));
      // gentle S-curve for contrast
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
      // film grain (luma-weighted, static per seed)
      float n = hash(gl_FragCoord.xy + seed) - 0.5;
      col += n * grain * (1.0 - 0.7 * l);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// --------------------------------------------------------------- helpers
function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function arc(points, cx, cy, r, a0, a1, steps) {
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    points.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
}

function makeBodyGeometry() {
  const R = PIECE_R, T = PIECE_T, cb = 0.028, ct = 0.036;
  const p = [new THREE.Vector2(0, 0)];
  p.push(new THREE.Vector2(R - cb - 0.06, 0));
  arc(p, R - cb, cb, cb, -Math.PI / 2, 0, 5);
  arc(p, R - ct, T - ct, ct, 0, Math.PI / 2, 7);
  const rimIn = GEM_R + 0.014;
  p.push(new THREE.Vector2(rimIn + 0.006, T));
  arc(p, rimIn, T - 0.006, 0.006, Math.PI / 2, Math.PI, 3);
  p.push(new THREE.Vector2(GEM_R + 0.008, GEM_FLOOR));
  p.push(new THREE.Vector2(0, GEM_FLOOR));
  const g = new THREE.LatheGeometry(p, 64);
  return g;
}

function makeGemGeometry() {
  const p = [];
  const r0 = GEM_R + 0.004;
  p.push(new THREE.Vector2(r0, GEM_FLOOR + 0.001));
  p.push(new THREE.Vector2(r0, PIECE_T - 0.016));
  const steps = 16, dome = 0.0125, base = PIECE_T - 0.016;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const r = r0 * Math.cos((t * Math.PI) / 2);
    const y = base + dome * Math.sin((t * Math.PI) / 2) + 0.0015 * Math.sin(t * Math.PI);
    p.push(new THREE.Vector2(Math.max(r, 0), y));
  }
  const g = new THREE.LatheGeometry(p, 64);
  // planar top-down UVs (for glow & glyph maps)
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / (2 * r0) + 0.5, 0.5 - pos.getZ(i) / (2 * r0));
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * Product-photography studio for reflections. The ceiling straight above is
 * kept dark so flat lacquer seen from the top-down camera stays rich instead
 * of mirroring a light; softboxes sit at oblique angles and paint highlights
 * on the curved gems and chamfered metal.
 */
function makeStudioEnvironment() {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(40, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          vec3 d = normalize(vP);
          float up = d.y;
          vec3 floorC = vec3(0.035, 0.028, 0.024);
          vec3 wall = vec3(0.07, 0.072, 0.08);
          vec3 ceil = vec3(0.045, 0.047, 0.055);
          vec3 c = mix(floorC, wall, smoothstep(-0.25, 0.1, up));
          c = mix(c, ceil, smoothstep(0.35, 0.9, up));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  s.add(room);
  const panel = (w, h, intensity, pos, color = 0xffffff) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(26, 16, 7.5, [-24, 22, -12], 0xfff3e2);   // key softbox (matches the sun direction)
  panel(34, 5, 3.2, [24, 13, 16], 0xdfe8ff);      // cool strip on the opposite side
  panel(18, 10, 2.0, [8, 18, -26], 0xffffff);     // kicker
  panel(30, 6, 1.4, [-6, 6, 30], 0xffe6c8);       // warm low bounce
  panel(16, 16, 0.4, [0, 36, 0], 0xffffff);        // faint overhead fill (keeps flat metal alive)
  return s;
}

/** Free GPU resources below a group (board textures are cached, so maps are kept). */
function disposeTree(root, materials) {
  root.traverse((o) => {
    if (o === root) return;
    o.geometry?.dispose();
    if (materials || Array.isArray(o.material)) {
      for (const m of [].concat(o.material || [])) m.dispose();
    }
  });
}

function rayBox(o, d, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = -Infinity, tmax = Infinity;
  const axes = [[o.x, d.x, minX, maxX], [o.y, d.y, minY, maxY], [o.z, d.z, minZ, maxZ]];
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return Infinity; continue; }
    let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin >= 0 ? tmin : (tmax >= 0 ? 0 : Infinity);
}

// ================================================================ scene
export class BoardScene {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.octx = overlay.getContext('2d');
    this.size = 0;
    this.height = 0;
    this.pieces = new Map();      // "x,y,z" → { group, color, x, y, z }
    this.heights = [];
    this.anims = new Set();
    this.dirty = true;
    this.options = { labels: true, glyphs: false, quality: 'auto' };
    this.viewTheta = 0;           // 0 = player 1 at the bottom, π = player 2
    this.labelTheta = 0;
    this.region = { x: 0, y: 0, w: 1, h: 1 };
    this.mode = 'top';
    this.lastMoveKey = null;
    this.onImpact = null;
    this.frameTimes = [];
    this.time = 0;

    this.initRenderer();
    this.initScene();
    this.initPost();
    this.applyQuality();
    this.resize();

    this._loop = this.loop.bind(this);
    this.prev = performance.now();
    requestAnimationFrame(this._loop);
  }

  // ------------------------------------------------------------ setup
  initRenderer() {
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, alpha: false, stencil: false,
      powerPreference: 'high-performance',
    });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;
    this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
    this.maxAniso = r.capabilities.getMaxAnisotropy();
    this.webgl2 = r.capabilities.isWebGL2;
    const q = this.isMobile ? 'medium' : 'high';
    this.autoQuality = q;
    this.dprCap = q === 'high' ? 2 : 1.75;
  }

  initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060708);
    scene.fog = new THREE.Fog(0x060708, 18, 42);
    this.scene = scene;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = makeStudioEnvironment();
    const env = pmrem.fromScene(envScene, 0.02).texture;
    scene.environment = env;
    scene.environmentIntensity = 1.0;
    pmrem.dispose();
    envScene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

    // key light — soft shadows to the lower right (for player 1)
    const key = new THREE.DirectionalLight(0xfff0dc, 2.3);
    key.position.set(-5.5, 12, -3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.012;
    key.shadow.radius = 4;
    key.shadow.camera.near = 2;
    key.shadow.camera.far = 30;
    scene.add(key, key.target);
    this.key = key;

    const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x2a1d14, 0.12);
    scene.add(hemi);

    // tablecloth
    const tt = TX.makeTableTextures(512);
    for (const t of [tt.map, tt.normal]) { t.repeat.set(70, 70); t.anisotropy = this.maxAniso; }
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({ map: tt.map, normalMap: tt.normal, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.94, metalness: 0, envMapIntensity: 0.5 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -BOARD_T;
    table.receiveShadow = true;
    scene.add(table);
    this.table = table;

    // shared textures & geometry
    this.metalTex = TX.makeTurnedMetalTextures();
    this.gemGlow = TX.makeGemGlowTexture();
    this.glyphMaps = GLYPHS.map((k) => TX.makeGlyphMap(k));
    this.shadowTex = TX.makeContactShadowTexture();
    this.ringTex = TX.makeRingTexture();
    this.bodyGeo = makeBodyGeometry();
    this.gemGeo = makeGemGeometry();
    this.shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.sideTex = TX.makeWoodSideTextures(512);
    for (const t of [this.sideTex.map, this.sideTex.normal]) t.repeat.set(0.45, 0.45);

    this.initMaterials();

    this.boardGroup = new THREE.Group();
    this.pieceGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    scene.add(this.boardGroup, this.pieceGroup, this.fxGroup);

    this.initGhost();
    this.boardTexCache = new Map();
  }

  initMaterials() {
    const m = this.metalTex;
    const bodyOf = () => new THREE.MeshStandardMaterial({
      color: NEUTRAL_BODY.clone(), metalness: 1, roughness: 1,
      roughnessMap: m.orm, normalMap: m.normal, normalScale: new THREE.Vector2(0.22, 0.22),
      envMapIntensity: 1.15,
    });
    const gemOf = (i) => new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(GEM_HEX[i]), metalness: 0, roughness: 0.16,
      clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.76, specularIntensity: 1,
      emissive: new THREE.Color(GEM_HEX[i]), emissiveMap: this.gemGlow, emissiveIntensity: 0.32,
      envMapIntensity: 1.2,
    });
    this.bodyMats = [0, 1, 2].map(bodyOf);
    this.gemMats = [0, 1, 2].map(gemOf);
    this.winBodyMats = [0, 1, 2].map(bodyOf);
    this.winGemMats = [0, 1, 2].map(gemOf);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.7,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false,
    });
  }

  initGhost() {
    const ghost = new THREE.Group();
    this.ghostBody = new THREE.MeshStandardMaterial({
      color: 0xd8dde6, metalness: 0.85, roughness: 0.25, transparent: true, opacity: 0.5, depthWrite: false,
      envMapIntensity: 1.3,
    });
    this.ghostGem = new THREE.MeshStandardMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.2, transparent: true, opacity: 0.82, depthWrite: false,
      emissive: 0xffffff, emissiveIntensity: 0.6,
    });
    const b = new THREE.Mesh(this.bodyGeo, this.ghostBody);
    const g = new THREE.Mesh(this.gemGeo, this.ghostGem);
    b.castShadow = true;
    ghost.add(b, g);
    ghost.visible = false;
    ghost.renderOrder = 10;
    this.ghost = ghost;
    this.ghostState = { x: -1, y: -1, color: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: new THREE.Vector3(), alpha: 0, shown: false, appear: 0 };

    this.ringMat = new THREE.MeshBasicMaterial({
      map: this.ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      color: 0xffffff, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.ringMat);
    this.ring.visible = false;
    this.ring.renderOrder = 11;

    this.lastMat = new THREE.MeshBasicMaterial({
      color: 0xffe2a8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.lastMarker = new THREE.Mesh(new THREE.RingGeometry(GEM_R + 0.024, PIECE_R - 0.05, 64).rotateX(-Math.PI / 2), this.lastMat);
    this.lastMarker.visible = false;
    this.lastMarker.renderOrder = 12;

    this.scene.add(ghost, this.ring, this.lastMarker);
  }

  initPost() {
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType, samples: this.webgl2 ? 4 : 0,
    });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.5, 1.0);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composite = new ShaderPass(CompositeShader);
    composer.addPass(this.composite);
    this.composer = composer;
  }

  // ----------------------------------------------------------- quality
  setOptions(opts) {
    Object.assign(this.options, opts);
    const glyphs = this.options.glyphs;
    for (const mats of [this.gemMats, this.winGemMats]) {
      mats.forEach((mat, i) => { mat.map = glyphs ? this.glyphMaps[i] : null; mat.needsUpdate = true; });
    }
    this.applyQuality();
    this.invalidate();
  }

  applyQuality() {
    const q = this.options.quality === 'auto' ? this.autoQuality : this.options.quality;
    const dpr = window.devicePixelRatio || 1;
    const cap = this.options.quality === 'auto' ? this.dprCap : (q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    const ratio = Math.min(dpr, cap);
    if (ratio !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(ratio);
      this.composer.setPixelRatio(ratio);
      this.resize();
    }
    this.bloom.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.key.shadow.radius = q === 'low' ? 2 : 4;
    this.quality = q;
  }

  /** Called with frame times while animating; steps resolution down on slow devices. */
  adaptQuality(dt) {
    if (this.options.quality !== 'auto') return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (avg > 0.034 && this.dprCap > 1) {
      this.dprCap = Math.max(1, this.dprCap - 0.25);
      if (this.dprCap <= 1.25 && this.autoQuality !== 'low') this.autoQuality = this.dprCap <= 1 ? 'low' : 'medium';
      this.applyQuality();
    }
  }

  // ------------------------------------------------------------ layout
  /** Board region in CSS pixels (relative to the canvas). */
  setRegion(region) {
    this.region = region;
    this.updateFraming();
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    this.W = w; this.H = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.composite.uniforms.resolution.value.set(w * pr, h * pr);
    const odpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round(w * odpr);
    this.overlay.height = Math.round(h * odpr);
    this.odpr = odpr;
    this.camera.aspect = w / h;
    this.updateFraming();
  }

  boardHalf() { return (this.size * CELL) / 2 + MARGIN; }

  /** Camera rig for a mode, given the current layout. */
  rigFor(mode) {
    const { W, H } = this;
    const reg = this.region;
    const cx = reg.x + reg.w / 2, cy = reg.y + reg.h / 2;
    const half = Math.max(40, Math.min(reg.w, reg.h) / 2);
    const Bh = this.boardHalf() || 3;
    const k = 3.7;                 // camera distance / board half-size → perspective strength
    const pad = 1.04;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan((H * pad) / (2 * k * half)));
    const base = { target: new THREE.Vector3(0, 0, 0), radius: k * Bh, phi: 0.0001, theta: this.viewTheta, fov, cx, cy };
    if (mode === 'reveal') {
      const tall = this.height * (PIECE_T + EXPLODE_GAP);
      return { ...base, target: new THREE.Vector3(0, tall * 0.3, 0), radius: k * Bh * 1.12 + tall * 0.7, phi: 0.82, theta: this.viewTheta + 0.22 };
    }
    if (mode === 'title') {
      return { ...base, target: new THREE.Vector3(0, 0.25, 0), radius: k * Bh * 0.9, phi: 0.98, theta: this.viewTheta + 0.6 };
    }
    return base;
  }

  updateFraming() {
    if (this.rigAnim) return; // being animated — the animation reads rigFor() each frame
    if (this.controls?.enabled) {
      const r = this.rigFor(this.mode);
      this.camera.fov = r.fov;
      this.setOffset(r.cx, r.cy);
      this.camera.updateProjectionMatrix();
    } else {
      this.applyRig(this.rigFor(this.mode));
    }
    this.invalidate();
  }

  setOffset(cx, cy) {
    const { W, H } = this;
    this.camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    this.composite.uniforms.center.value.set(cx / W, 1 - cy / H);
  }

  applyRig(r) {
    const s = Math.sin(r.phi);
    this.camera.position.set(
      r.target.x + r.radius * s * Math.sin(r.theta),
      r.target.y + r.radius * Math.cos(r.phi),
      r.target.z + r.radius * s * Math.cos(r.theta),
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(r.target);
    this.camera.fov = r.fov;
    this.camera.near = Math.max(0.05, r.radius * 0.2);
    this.camera.far = r.radius * 4 + 60;
    this.setOffset(r.cx, r.cy);
    this.camera.updateProjectionMatrix();
    this.currentRig = r;
  }

  currentSpherical() {
    const t = this.controls?.enabled ? this.controls.target.clone() : (this.currentRig?.target.clone() || new THREE.Vector3());
    const off = this.camera.position.clone().sub(t);
    const radius = off.length();
    return {
      target: t, radius,
      phi: Math.acos(THREE.MathUtils.clamp(off.y / radius, -1, 1)),
      theta: Math.atan2(off.x, off.z),
      fov: this.camera.fov,
      cx: this.currentRig?.cx ?? this.W / 2, cy: this.currentRig?.cy ?? this.H / 2,
    };
  }

  /** Smoothly move the camera to another mode. */
  setMode(mode, duration = 1.4) {
    this.mode = mode;
    if (this.controls) this.controls.enabled = false;
    const from = this.currentSpherical();
    if (reduceMotion()) duration = Math.min(duration, 0.5);
    return new Promise((resolve) => {
      if (this.rigAnim) this.anims.delete(this.rigAnim);
      let t = 0;
      const a = {
        update: (dt) => {
          t = Math.min(1, t + dt / duration);
          const e = ease.inOutCubic(t);
          const to = this.rigFor(mode);
          // shortest way around for theta
          let dth = to.theta - from.theta;
          dth = Math.atan2(Math.sin(dth), Math.cos(dth));
          this.applyRig({
            target: from.target.clone().lerp(to.target, e),
            radius: THREE.MathUtils.lerp(from.radius, to.radius, e),
            phi: THREE.MathUtils.lerp(from.phi, to.phi, e),
            theta: from.theta + dth * e,
            fov: THREE.MathUtils.lerp(from.fov, to.fov, e),
            cx: THREE.MathUtils.lerp(from.cx, to.cx, e),
            cy: THREE.MathUtils.lerp(from.cy, to.cy, e),
          });
          if (t >= 1) {
            this.rigAnim = null;
            if (mode === 'reveal' || mode === 'title') this.enableOrbit(mode);
            resolve();
            return false;
          }
          return true;
        },
      };
      this.rigAnim = a;
      this.anims.add(a);
      this.invalidate();
    });
  }

  enableOrbit(mode) {
    if (!this.controls) {
      this.controls = new OrbitControls(this.camera, this.canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.enablePan = false;
      this.controls.rotateSpeed = 0.7;
      this.controls.addEventListener('change', () => this.invalidate());
    }
    const c = this.controls;
    const r = this.currentRig;
    c.target.copy(r.target);
    c.minDistance = r.radius * 0.55;
    c.maxDistance = r.radius * 1.6;
    c.minPolarAngle = 0.05;
    c.maxPolarAngle = 1.32;
    c.autoRotate = !reduceMotion();
    c.autoRotateSpeed = mode === 'title' ? 0.45 : 0.7;
    c.enableZoom = mode !== 'title';
    c.enableRotate = mode !== 'title';
    c.enabled = true;
    c.update();
  }

  /** Rotate the top-down view (π = player 2 at the bottom of the screen). */
  setViewTheta(theta, animate = true) {
    this.viewTheta = theta;
    this.labelTheta = theta;
    if (this.mode !== 'top') return Promise.resolve();
    if (!animate) { this.updateFraming(); return Promise.resolve(); }
    return this.setMode('top', 0.7);
  }

  setLabelTheta(theta) {
    if (this.labelTheta === theta) return;
    const from = this.labelTheta;
    this.labelTheta = theta;
    this.labelAnim = { from, to: theta, t: 0 };
    this.invalidate();
  }

  // ------------------------------------------------------------- board
  colX(x) { return (x - (this.size - 1) / 2) * CELL; }
  colZ(y) { return (y - (this.size - 1) / 2) * CELL; }

  newBoard(size, height) {
    this.clearPieces();
    this.size = size;
    this.height = height;
    this.heights = new Array(size * size).fill(0);
    disposeTree(this.boardGroup, false);
    this.boardGroup.clear();

    const W = size * CELL + MARGIN * 2;
    const shape = roundedRectShape(W - BEVEL * 2, W - BEVEL * 2, 0.24);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: BOARD_T - BEVEL * 2, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL,
      bevelSegments: 6, curveSegments: 12,
    });
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.max.y, 0);

    // planar UVs on the caps, measured from the actual cap extent
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const capGroup = geo.groups[0];
    let capHalf = 0;
    for (let i = capGroup.start; i < capGroup.start + capGroup.count; i++) capHalf = Math.max(capHalf, Math.abs(pos.getX(i)));
    for (let i = capGroup.start; i < capGroup.start + capGroup.count; i++) {
      uv.setXY(i, (pos.getX(i) + capHalf) / (2 * capHalf), (-pos.getZ(i) + capHalf) / (2 * capHalf));
    }
    uv.needsUpdate = true;

    const key = `${size}`;
    let tx = this.boardTexCache.get(key);
    if (!tx) {
      const res = this.isMobile ? 1024 : 2048;
      tx = TX.makeBoardTextures(size, capHalf * 2, CELL, res);
      for (const t of [tx.map, tx.orm, tx.normal]) t.anisotropy = this.maxAniso;
      this.boardTexCache.set(key, tx);
    }
    const top = new THREE.MeshPhysicalMaterial({
      map: tx.map, normalMap: tx.normal, normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: tx.orm, metalnessMap: tx.orm, roughness: 1, metalness: 1,
      clearcoat: 0.55, clearcoatRoughness: 0.16, envMapIntensity: 0.9,
    });
    const side = new THREE.MeshPhysicalMaterial({
      map: this.sideTex.map, normalMap: this.sideTex.normal, normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.5, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.2, envMapIntensity: 0.9,
    });
    const board = new THREE.Mesh(geo, [top, side]);
    board.receiveShadow = true;
    board.castShadow = true;
    this.boardGroup.add(board);

    // fit the shadow camera to the board
    const sc = this.key.shadow.camera;
    const ext = W / 2 + 1.4;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
    sc.updateProjectionMatrix();

    this.updateFraming();
    this.invalidate();
  }

  // ------------------------------------------------------------ pieces
  makePiece(color) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMats[color]);
    const gem = new THREE.Mesh(this.gemGeo, this.gemMats[color]);
    body.castShadow = true; body.receiveShadow = true;
    gem.receiveShadow = true;
    group.add(body, gem);
    group.userData = { body, gem, color };
    return group;
  }

  addContactShadow(piece, z) {
    if (z !== 0) return;
    const s = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    s.scale.setScalar(PIECE_R * 2.5);
    s.position.y = 0.002;
    s.renderOrder = 1;
    piece.add(s);
    piece.userData.shadow = s;
  }

  key3(x, y, z) { return `${x},${y},${z}`; }

  clearPieces() {
    for (const p of this.pieces.values()) this.pieceGroup.remove(p.group);
    this.pieces.clear();
    this.heights = new Array(this.size * this.size).fill(0);
    disposeTree(this.fxGroup, true);
    this.fxGroup.clear();
    this.lastMarker.visible = false;
    this.lastMoveKey = null;
    this.resetMaterials();
    this.invalidate();
  }

  /** Instantly mirror a game's columns (resume / title demo). */
  setPieces(cols) {
    this.clearPieces();
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const col = cols[y * this.size + x];
        col.forEach((c, z) => this.addPieceInstant(x, y, z, c));
      }
    }
    this.invalidate();
  }

  addPieceInstant(x, y, z, color) {
    const g = this.makePiece(color);
    g.position.set(this.colX(x), z * PIECE_T, this.colZ(y));
    g.rotation.y = Math.random() * Math.PI * 2;
    this.addContactShadow(g, z);
    this.pieceGroup.add(g);
    this.pieces.set(this.key3(x, y, z), { group: g, color, x, y, z });
    this.heights[y * this.size + x] = Math.max(this.heights[y * this.size + x], z + 1);
    return g;
  }

  heightAt(x, y) { return this.heights[y * this.size + x] || 0; }

  /** Drop a new piece from the ghost (or from above). Resolves after impact. */
  dropPiece({ x, y, z, color }) {
    const g = this.makePiece(color);
    const rest = z * PIECE_T;
    const start = this.ghost.visible && this.ghostState.x === x && this.ghostState.y === y
      ? this.ghost.position.y : rest + HOVER + 0.2;
    g.position.set(this.colX(x), start, this.colZ(y));
    g.rotation.y = this.ghost.visible ? this.ghost.rotation.y : Math.random() * Math.PI * 2;
    this.addContactShadow(g, z);
    if (g.userData.shadow) g.userData.shadow.visible = false;
    this.pieceGroup.add(g);
    this.pieces.set(this.key3(x, y, z), { group: g, color, x, y, z });
    this.heights[y * this.size + x] = z + 1;
    this.hideGhost(true);

    return new Promise((resolve) => {
      let vy = -1.0, py = start, bounces = 0, wob = 0, wobV = 0, settled = false, settleT = 0;
      const gravity = 36;
      const axis = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      const baseQ = g.quaternion.clone();
      const q = new THREE.Quaternion();
      const a = {
        update: (dt) => {
          // sub-step for a stable bounce
          const steps = 3;
          for (let s = 0; s < steps; s++) {
            const h = dt / steps;
            if (!settled) {
              vy -= gravity * h;
              py += vy * h;
              if (py <= rest) {
                py = rest;
                const impactV = -vy;
                if (bounces === 0) {
                  this.onImpact?.({ x, y, z, color, strength: Math.min(1, impactV / 6), onBoard: z === 0 });
                  if (g.userData.shadow) g.userData.shadow.visible = true;
                  resolve();
                  wobV = Math.min(impactV, 6) * 0.11;
                }
                vy = impactV * 0.24;
                bounces++;
                if (vy < 0.3 || bounces > 3) { settled = true; vy = 0; }
              }
            }
            // coin-like wobble: damped oscillator
            const k = 700, c = 14;
            wobV += (-k * wob - c * wobV) * h;
            wob += wobV * h;
          }
          g.quaternion.copy(baseQ).premultiply(q.setFromAxisAngle(axis, wob));
          g.position.y = py + Math.abs(Math.sin(wob)) * PIECE_R * 0.6;
          if (settled) {
            settleT += dt;
            if (settleT > 0.35 && Math.abs(wob) < 0.0008 && Math.abs(wobV) < 0.01) {
              g.quaternion.copy(baseQ);
              g.position.y = rest;
              return false;
            }
          }
          return true;
        },
      };
      this.anims.add(a);
      this.invalidate();
    });
  }

  removePiece({ x, y, z }) {
    const k = this.key3(x, y, z);
    const p = this.pieces.get(k);
    if (!p) return Promise.resolve();
    this.pieces.delete(k);
    this.heights[y * this.size + x] = z;
    if (this.lastMoveKey === k) { this.lastMarker.visible = false; this.lastMoveKey = null; }
    const g = p.group;
    const y0 = g.position.y;
    return this.tween(0.32, (t) => {
      const e = ease.inBack(t);
      g.position.y = y0 + e * 0.9;
      g.scale.setScalar(1 - ease.inOutCubic(t) * 0.95);
    }).then(() => { this.pieceGroup.remove(g); this.invalidate(); });
  }

  /** Mark the last move (for the next player to notice). */
  setLastMove(move) {
    if (!move) { this.lastMarker.visible = false; this.lastMoveKey = null; this.invalidate(); return; }
    this.lastMoveKey = this.key3(move.x, move.y, move.z);
    this.lastMarker.position.set(this.colX(move.x), (move.z + 1) * PIECE_T + 0.0015, this.colZ(move.y));
    this.lastMarker.visible = true;
    this.lastMat.color.set(move.player === 0 ? 0xffd27a : 0xdfe7f5);
    this.tween(0.6, (t) => { this.lastMat.opacity = 0.55 * ease.outCubic(t); });
  }

  // ------------------------------------------------------------- ghost
  showGhost(x, y, color) {
    const gs = this.ghostState;
    const h = this.heightAt(x, y);
    const target = new THREE.Vector3(this.colX(x), h * PIECE_T + HOVER, this.colZ(y));
    if (!this.ghost.visible) {
      gs.pos.copy(target).setY(target.y + 0.35);
      gs.vel.set(0, 0, 0);
      gs.appear = 0;
      this.ghost.rotation.y = Math.random() * Math.PI * 2;
    }
    gs.target.copy(target);
    gs.x = x; gs.y = y;
    gs.landY = h * PIECE_T;
    this.setGhostColor(color);
    this.ghost.visible = true;
    this.ring.visible = true;
    gs.shown = true;
    this.invalidate();
  }

  setGhostColor(color) {
    const c = new THREE.Color(GEM_HEX[color]);
    this.ghostState.color = color;
    this.ghostGem.color.copy(c);
    this.ghostGem.emissive.copy(c);
    this.ghostGem.map = this.options.glyphs ? this.glyphMaps[color] : null;
    this.ghostGem.needsUpdate = true;
    this.ringMat.color.copy(c).lerp(new THREE.Color(0xffffff), 0.35);
    this.invalidate();
  }

  hideGhost(instant = false) {
    this.ghostState.shown = false;
    this.ghostState.x = this.ghostState.y = -1;
    if (instant) { this.ghost.visible = false; this.ring.visible = false; }
    this.invalidate();
  }

  updateGhost(dt) {
    const gs = this.ghostState;
    if (!this.ghost.visible) return false;
    if (!gs.shown) {
      gs.appear = Math.max(0, gs.appear - dt * 6);
      if (gs.appear <= 0) { this.ghost.visible = false; this.ring.visible = false; return true; }
    } else {
      gs.appear = Math.min(1, gs.appear + dt * 5);
    }
    // critically damped spring toward the target column
    const w = 26;
    const acc = gs.target.clone().sub(gs.pos).multiplyScalar(w * w).sub(gs.vel.clone().multiplyScalar(2 * w));
    gs.vel.addScaledVector(acc, dt);
    gs.pos.addScaledVector(gs.vel, dt);
    const bob = Math.sin(this.time * 3.2) * 0.035;
    this.ghost.position.set(gs.pos.x, gs.pos.y + bob, gs.pos.z);
    this.ghost.rotation.y += dt * 0.25;
    const a = ease.outCubic(gs.appear);
    this.ghost.scale.setScalar(0.85 + 0.15 * a);
    this.ghostBody.opacity = 0.42 * a;
    this.ghostGem.opacity = 0.8 * a;
    this.ghostGem.emissiveIntensity = 0.5 + Math.sin(this.time * 3.2) * 0.12;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4.4);
    this.ring.position.set(gs.pos.x, gs.landY + 0.004, gs.pos.z);
    this.ring.scale.setScalar(PIECE_R * 2 * (1.16 + pulse * 0.06));
    this.ringMat.opacity = (0.55 + pulse * 0.35) * a;
    return true;
  }

  /** Feedback when a full column is tapped. */
  flashFull(x, y) {
    const h = this.heightAt(x, y);
    const top = this.pieces.get(this.key3(x, y, h - 1));
    const ring = this.ring.clone();
    ring.material = this.ringMat.clone();
    ring.material.color.set(0xff5a4a);
    ring.position.set(this.colX(x), h * PIECE_T + 0.004, this.colZ(y));
    ring.scale.setScalar(PIECE_R * 2.3);
    ring.visible = true;
    this.fxGroup.add(ring);
    const x0 = top ? top.group.position.x : 0;
    this.tween(0.45, (t) => {
      ring.material.opacity = (1 - t) * 0.95;
      if (top) top.group.position.x = x0 + Math.sin(t * Math.PI * 6) * 0.04 * (1 - t);
    }).then(() => { this.fxGroup.remove(ring); if (top) top.group.position.x = x0; });
  }

  // ------------------------------------------------------------ reveal
  resetMaterials() {
    this.winnersMarked = false;
    for (let i = 0; i < 3; i++) {
      for (const m of [this.bodyMats[i], this.winBodyMats[i]]) { m.color.copy(NEUTRAL_BODY); m.emissive?.set(0x000000); }
      for (const m of [this.gemMats[i], this.winGemMats[i]]) {
        m.color.set(GEM_HEX[i]); m.emissive.set(GEM_HEX[i]); m.emissiveIntensity = 0.32;
      }
    }
  }

  /**
   * Game over: stacks separate and tint so every buried color becomes visible,
   * winning pieces glow, and a beam traces each winning line.
   */
  /** Swap the winning pieces to glowing materials (only the visible tops show from above). */
  markWinners(result) {
    if (result?.type !== 'win' || this.winnersMarked) return Promise.resolve();
    this.winnersMarked = true;
    const winSet = new Set();
    for (const line of result.lines) for (const [x, y, z] of line.cells) winSet.add(this.key3(x, y, z));
    for (const [k, p] of this.pieces) {
      if (winSet.has(k)) {
        p.group.userData.body.material = this.winBodyMats[p.color];
        p.group.userData.gem.material = this.winGemMats[p.color];
      }
    }
    this.lastMarker.visible = false;
    return this.tween(0.5, (t) => {
      for (const m of this.winGemMats) m.emissiveIntensity = 0.32 + ease.outCubic(t) * 0.9;
    });
  }

  reveal(result) {
    this.hideGhost(true);
    this.lastMarker.visible = false;
    const winColor = result?.type === 'win' ? result.color : -1;
    this.markWinners(result);
    const tintStart = this.bodyMats.map((m) => m.color.clone());
    const tintTo = GEM_HEX.map((h) => new THREE.Color(h));
    const dim = result?.type === 'win' ? 0.55 : 1;
    const moves = [...this.pieces.values()].map((p) => ({ p, y0: p.group.position.y, y1: p.z * (PIECE_T + EXPLODE_GAP) }));

    const camP = this.setMode('reveal', 1.6);
    const pieceP = this.tween(1.5, (t) => {
      for (const { p, y0, y1 } of moves) {
        const delay = Math.min(0.35, p.z * 0.06);
        const tt = THREE.MathUtils.clamp((t * 1.5 - delay) / (1.5 - 0.35), 0, 1);
        p.group.position.y = THREE.MathUtils.lerp(y0, y1, ease.outBack(tt));
      }
      const e = ease.inOutCubic(t);
      for (let i = 0; i < 3; i++) {
        this.bodyMats[i].color.copy(tintStart[i]).lerp(tintTo[i], 0.55 * e).multiplyScalar(THREE.MathUtils.lerp(1, i === winColor ? 0.8 : dim + 0.15, e));
        this.gemMats[i].color.set(GEM_HEX[i]).multiplyScalar(THREE.MathUtils.lerp(1, dim, e));
        this.gemMats[i].emissiveIntensity = THREE.MathUtils.lerp(0.32, 0.32 * dim, e);
        this.winBodyMats[i].color.copy(tintStart[i]).lerp(tintTo[i], 0.85 * e);
        this.winGemMats[i].emissiveIntensity = THREE.MathUtils.lerp(1.22, 1.6, e);
      }
    });

    if (result?.type === 'win') {
      pieceP.then(() => {
        for (const line of result.lines) this.addBeam(line.cells, result.color);
        this.winPulse = true;
      });
    }
    return Promise.all([camP, pieceP]);
  }

  addBeam(cells, color) {
    const pts = cells.map(([x, y, z]) => new THREE.Vector3(this.colX(x), z * (PIECE_T + EXPLODE_GAP) + PIECE_T * 0.5, this.colZ(y)));
    const a = pts[0], b = pts[pts.length - 1];
    const dir = b.clone().sub(a);
    const len = dir.length() + 0.9;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(GEM_HEX[color]).lerp(new THREE.Color(0xffffff), 0.35).multiplyScalar(2.2),
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 16, 1, true), mat);
    const glowMat = mat.clone();
    glowMat.color = new THREE.Color(GEM_HEX[color]).multiplyScalar(1.2);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1, 24, 1, true), glowMat);
    const beam = new THREE.Group();
    beam.add(core, glow);
    beam.position.copy(mid);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    beam.scale.set(1, 0.001, 1);
    beam.renderOrder = 20;
    this.fxGroup.add(beam);
    this.tween(0.7, (t) => {
      const e = ease.outCubic(t);
      beam.scale.set(1, len * e, 1);
      mat.opacity = e;
      glowMat.opacity = 0.35 * e;
    });
    beam.userData.mats = [mat, glowMat];
  }

  /** Clear the board with a staggered lift-off, then return to the top view. */
  sweep() {
    this.winPulse = false;
    const list = [...this.pieces.values()];
    const beams = [...this.fxGroup.children];
    const P = this.tween(0.9, (t) => {
      for (const p of list) {
        const d = Math.hypot(p.x - (this.size - 1) / 2, p.y - (this.size - 1) / 2) / this.size;
        const tt = THREE.MathUtils.clamp((t - d * 0.5 - p.z * 0.03) / 0.45, 0, 1);
        const e = ease.inBack(tt);
        if (p.y0 === undefined) p.y0 = p.group.position.y;
        p.group.position.y = p.y0 + e * 1.6;
        p.group.scale.setScalar(Math.max(0.001, 1 - ease.inOutCubic(tt)));
      }
      for (const b of beams) for (const m of b.userData.mats || []) m.opacity *= 0.85;
    });
    return P.then(() => { this.clearPieces(); });
  }

  // ------------------------------------------------------------- input
  /** Column under a screen point (CSS px relative to viewport), or null. */
  pick(clientX, clientY, tolerance = 0.35) {
    if (!this.size) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const rc = this.raycaster || (this.raycaster = new THREE.Raycaster());
    rc.setFromCamera(ndc, this.camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    let best = null, bestT = Infinity;
    const n = this.size;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const cx = this.colX(x), cz = this.colZ(y);
        const h = this.heightAt(x, y) * PIECE_T + 0.001;
        const t = rayBox(o, d, cx - CELL / 2, -0.01, cz - CELL / 2, cx + CELL / 2, h, cz + CELL / 2);
        if (t < bestT) { bestT = t; best = { x, y }; }
      }
    }
    if (best) return best;
    // forgiving edges: snap to the nearest edge column
    if (Math.abs(d.y) > 1e-6) {
      const t = -o.y / d.y;
      const px = o.x + d.x * t, pz = o.z + d.z * t;
      const half = (n * CELL) / 2;
      if (Math.abs(px) < half + tolerance && Math.abs(pz) < half + tolerance) {
        const x = THREE.MathUtils.clamp(Math.floor((px + half) / CELL), 0, n - 1);
        const y = THREE.MathUtils.clamp(Math.floor((pz + half) / CELL), 0, n - 1);
        return { x, y };
      }
    }
    return null;
  }

  /** Screen position (CSS px) of a world point. */
  project(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.W, y: (-p.y * 0.5 + 0.5) * this.H, z: p.z };
  }

  // ------------------------------------------------------- animations
  tween(duration, fn) {
    if (reduceMotion()) duration *= 0.6;
    return new Promise((resolve) => {
      let t = 0;
      const a = {
        update: (dt) => {
          t = Math.min(1, t + dt / duration);
          fn(t);
          if (t >= 1) { resolve(); return false; }
          return true;
        },
      };
      this.anims.add(a);
      this.invalidate();
    });
  }

  invalidate() { this.dirty = true; }

  loop(now) {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - this.prev) / 1000);
    this.prev = now;
    this.time += dt;
    let active = false;
    for (const a of [...this.anims]) {
      if (!a.update(dt)) this.anims.delete(a);
      active = true;
    }
    if (this.updateGhost(dt)) active = true;
    if (this.labelAnim) {
      // real time (not the clamped frame dt) so slow frames never leave labels mid-turn
      this.labelAnim.start ??= now;
      this.labelAnim.t = Math.min(1, (now - this.labelAnim.start) / 450);
      if (this.labelAnim.t >= 1) this.labelAnim = null;
      active = true;
    }
    if (this.winPulse) {
      const s = 1.3 + Math.sin(this.time * 3.0) * 0.5;
      for (const m of this.winGemMats) m.emissiveIntensity = s;
      for (const b of this.fxGroup.children) {
        const [core, glow] = b.userData.mats || [];
        if (glow) glow.opacity = 0.3 + Math.sin(this.time * 3.0) * 0.1;
        if (core) core.opacity = 0.9;
      }
      active = true;
    }
    if (this.controls?.enabled) {
      if (this.controls.update(dt)) active = true;
      if (this.controls.autoRotate) active = true;
    }
    if (active || this.dirty) {
      this.render();
      this.dirty = false;
      if (active) this.adaptQuality(dt);
    }
  }

  render() {
    this.composer.render();
    this.drawOverlay();
  }

  // ----------------------------------------------------- height labels
  drawOverlay() {
    const ctx = this.octx;
    const s = this.odpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    // A clear with nothing drawn afterwards is not always presented by every
    // browser, so also hide the layer whenever labels are not wanted.
    const show = !!(this.options.labels && this.mode === 'top' && this.size && !this.rigAnim);
    if (show !== this.overlayShown) {
      this.overlay.style.visibility = show ? 'visible' : 'hidden';
      this.overlayShown = show;
    }
    if (!show) return;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    let th = this.labelTheta;
    if (this.labelAnim) {
      const { from, to, t } = this.labelAnim;
      let d = to - from; d = Math.atan2(Math.sin(d), Math.cos(d));
      th = from + d * ease.inOutCubic(t);
    }
    // screen-space rotation of the labels relative to the camera view
    // (world yaw and canvas rotation turn in opposite senses)
    const rot = this.viewTheta - th;
    const c0 = this.project(new THREE.Vector3(0, 0, 0));
    const c1 = this.project(new THREE.Vector3(CELL, 0, 0));
    const cellPx = Math.hypot(c1.x - c0.x, c1.y - c0.y);
    const fs = THREE.MathUtils.clamp(cellPx * 0.2, 9, 15);
    const off = new THREE.Vector3();
    // offset toward the viewer's lower-right corner of each piece (in world space)
    const ox = 0.27 * Math.cos(th) + 0.27 * Math.sin(th);
    const oz = -0.27 * Math.sin(th) + 0.27 * Math.cos(th);
    ctx.font = `600 ${fs}px -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const h = this.heightAt(x, y);
        if (!h) continue;
        off.set(this.colX(x) + ox, h * PIECE_T + 0.002, this.colZ(y) + oz);
        const p = this.project(off);
        const r = fs * 0.72;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rot);
        ctx.fillStyle = 'rgba(8,9,12,0.62)';
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = h >= this.height ? 'rgba(255,120,100,0.9)' : 'rgba(255,255,255,0.22)';
        ctx.stroke();
        ctx.fillStyle = h >= this.height ? '#ffb4a8' : 'rgba(255,255,255,0.92)';
        ctx.fillText(String(h), 0, fs * 0.04);
        ctx.restore();
      }
    }
  }

  dispose() {
    this.renderer.dispose();
  }
}
