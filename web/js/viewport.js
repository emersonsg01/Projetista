// Janela gráfica: cena three.js (GPU), câmeras perspectiva/ortográfica, cubo de navegação,
// pré-seleção e seleção de faces/arestas/planos do B-rep, corte, estilos visuais e
// renderização sob demanda para o Claude.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
const b64 = (s, T) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };

export const VIEW_DIRS = {
  iso: [1, -1, 0.8], home: [1, -1, 0.8], front: [0, -1, 0], back: [0, 1, 0], top: [0, 0, 1], bottom: [0, 0, -1],
  right: [1, 0, 0], left: [-1, 0, 0], 'iso-back': [-1, 1, 0.8], 'iso-below': [1, -1, -0.8],
};

const ANALYSIS = {
  zebra: `float s = fract(dot(normalize(reflect(-vView, vN)), vec3(0.0, 1.0, 0.0)) * 9.0);
    gl_FragColor = vec4(vec3(step(0.5, s)) * 0.9 + 0.05, 1.0);`,
  draft: `float c = dot(normalize(vWN), uPull);
    float ang = degrees(asin(clamp(c, -1.0, 1.0)));
    vec3 col = ang >= uMinDraft ? vec3(0.25, 0.75, 0.35) : ang <= -uMinDraft ? vec3(0.3, 0.5, 0.95) : vec3(0.95, 0.72, 0.15);
    if (abs(c) > 0.999) col = vec3(0.78);
    float l = 0.55 + 0.45 * max(dot(normalize(vN), normalize(vec3(0.3, 0.5, 1.0))), 0.0);
    gl_FragColor = vec4(col * l, 1.0);`,
  curvature: `vec3 dn = fwidth(normalize(vWN));
    float k = clamp(length(dn) * 6.0, 0.0, 1.0);
    gl_FragColor = vec4(mix(vec3(0.2, 0.35, 0.85), vec3(0.95, 0.3, 0.2), k), 1.0);`,
};

export class Viewport {
  constructor(el) {
    this.el = el;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(devicePixelRatio);
    r.localClippingEnabled = true;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.domElement.className = 'gl';
    el.prepend(r.domElement);
    const gl = r.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'WebGL';

    this.scene = new THREE.Scene();
    this.scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.add(new THREE.HemisphereLight(0xeef3ff, 0x40403a, 0.75));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.1);
    this.scene.add(this.sun);
    this.model = new THREE.Group();
    this.overlay = new THREE.Group();
    this.sketchGroup = new THREE.Group();
    this.origin = this.makeOrigin();
    this.scene.add(this.model, this.overlay, this.sketchGroup, this.origin);
    this.triad = this.makeTriad();

    this.persp = new THREE.PerspectiveCamera(35, 1, 0.1, 1e6);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e6, 1e6);
    for (const c of [this.persp, this.ortho]) c.up.set(0, 0, 1);
    this.persp.position.set(220, -220, 180);
    this.camera = this.persp;
    this.controls = this.makeControls(this.camera);

    this.bodies = new Map();
    this.style = 'shadedEdges';
    this.sectionPlane = null;
    this.hover = null;
    this.hoverFilter = null;
    this.selection = [];
    this.tool = null; // ferramenta ativa (esboço) recebe os eventos primeiro
    this.history = [];
    this.navMode = 'orbit';
    this.version = 0;
    this.setTheme('light');

    new ResizeObserver(() => this.resize()).observe(el);
    this.bindEvents();
    this.navcube = new NavCube(this);
    r.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------- base
  makeControls(cam) {
    const c = new OrbitControls(cam, this.renderer.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.15;
    c.zoomToCursor = true;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
    if (this.controls) { c.target.copy(this.controls.target); this.controls.dispose(); }
    return c;
  }
  setNavMode(mode) {
    this.navMode = mode;
    const L = { orbit: THREE.MOUSE.ROTATE, pan: THREE.MOUSE.PAN, zoom: THREE.MOUSE.DOLLY, none: null }[mode];
    this.controls.mouseButtons = { LEFT: L, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
  }
  setTheme(theme) {
    this.theme = theme;
    const [top, bottom] = theme === 'dark' ? ['#3b424d', '#1b1e23'] : ['#b9c4d3', '#f4f6f9'];
    const cv = document.createElement('canvas'); cv.width = 2; cv.height = 256;
    const g = cv.getContext('2d'); const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, top); grad.addColorStop(1, bottom); g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = tex;
    this.edgeColor = theme === 'dark' ? 0x0b0d10 : 0x1a1d22;
    this.bodies?.forEach((b) => b.edges.material.color.set(this.edgeColor));
  }
  resize() {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height);
    this.persp.aspect = r.width / r.height;
    this.persp.updateProjectionMatrix();
    this.updateOrtho();
  }
  updateOrtho() {
    const r = this.el.getBoundingClientRect();
    const d = this.persp.position.distanceTo(this.controls.target);
    const h = d * Math.tan((this.persp.fov * Math.PI) / 360);
    this.ortho.left = -h * (r.width / r.height); this.ortho.right = -this.ortho.left; this.ortho.top = h; this.ortho.bottom = -h;
    this.ortho.updateProjectionMatrix();
  }
  setProjection(kind) {
    const next = kind === 'ortho' ? this.ortho : this.persp;
    if (next === this.camera) return;
    next.position.copy(this.camera.position); next.up.copy(this.camera.up); next.quaternion.copy(this.camera.quaternion);
    if (next === this.ortho) { this.updateOrtho(); this.ortho.zoom = 1; this.ortho.updateProjectionMatrix(); }
    this.camera = next;
    this.controls = this.makeControls(next);
    this.setNavMode(this.navMode);
  }
  frame() {
    if (this.anim) this.stepAnim();
    this.controls.update();
    // planos de recorte acompanham a distância (boa precisão de profundidade sem depth logarítmico)
    const dist = this.camera.position.distanceTo(this.controls.target);
    const R = this.sceneRadius || 100;
    const near = Math.max(dist / 400, 0.005), far = dist + R * 6 + 10;
    if (Math.abs(this.persp.near - near) / near > 0.05 || Math.abs(this.persp.far - far) / far > 0.05) { this.persp.near = near; this.persp.far = far; this.persp.updateProjectionMatrix(); }
    if (this.camera === this.persp) this.updateOrtho();
    this.sun.position.copy(this.camera.position).add(new THREE.Vector3(60, 40, 140));
    this.renderer.render(this.scene, this.camera);
    this.navcube.render();
    this.renderTriad();
    this.onFrame?.();
  }

  // ---------------------------------------------------------------- origem e tríade
  makeOrigin() {
    const g = new THREE.Group();
    g.visible = false;
    const mk = (name, color, rot) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      const border = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
      const grp = new THREE.Group(); grp.add(m, border); grp.rotation.set(...rot);
      grp.userData = { plane: name }; m.userData = { plane: name };
      return grp;
    };
    this.planes = { XY: mk('XY', 0x2b78d4, [0, 0, 0]), XZ: mk('XZ', 0x2f9e44, [Math.PI / 2, 0, 0]), YZ: mk('YZ', 0xd9480f, [0, Math.PI / 2, 0]) };
    Object.values(this.planes).forEach((p) => g.add(p));
    const axes = new THREE.AxesHelper(1); axes.userData.axes = true; g.add(axes);
    this.originAxes = axes;
    return g;
  }
  sizeOrigin() {
    const b = this.modelBox(true);
    const s = Math.max(60, b.getSize(new THREE.Vector3()).length() * 0.6);
    Object.values(this.planes).forEach((p) => p.scale.setScalar(s));
    this.originAxes.scale.setScalar(s * 0.6);
  }
  showOrigin(flags) {
    // flags: true/false ou { XY, XZ, YZ, axes }
    const all = flags === true || flags === false ? { XY: flags, XZ: flags, YZ: flags, axes: flags } : flags;
    this.sizeOrigin();
    for (const k of ['XY', 'XZ', 'YZ']) this.planes[k].visible = !!all[k];
    this.originAxes.visible = !!all.axes;
    this.origin.visible = Object.values(all).some(Boolean);
  }
  makeTriad() {
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, -10, 10);
    const add = (dir, color) => { const a = new THREE.ArrowHelper(new THREE.Vector3(...dir), new THREE.Vector3(), 1.1, color, 0.32, 0.18); scene.add(a); };
    add([1, 0, 0], 0xd6336c); add([0, 1, 0], 0x2f9e44); add([0, 0, 1], 0x2b78d4);
    return { scene, cam };
  }
  renderTriad() {
    // tríade de eixos no canto inferior esquerdo, desenhada por cima da cena
    const r = this.renderer, s = 90;
    const size = r.getSize(new THREE.Vector2());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.triad.cam.position.copy(dir.multiplyScalar(4)); this.triad.cam.up.copy(this.camera.up); this.triad.cam.lookAt(0, 0, 0);
    r.autoClear = false;
    r.setViewport(4, 4, s, s); r.setScissor(4, 4, s, s); r.setScissorTest(true);
    r.clearDepth();
    r.render(this.triad.scene, this.triad.cam);
    r.setScissorTest(false); r.setViewport(0, 0, size.x, size.y); r.autoClear = true;
  }

  // ---------------------------------------------------------------- modelo
  setScene(m, opts = {}) {
    this.model.clear();
    this.bodies.clear();
    this.version = m.version;
    const clip = this.sectionPlane ? [this.sectionPlane] : [];
    for (const b of m.bodies) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b64(b.positions, Float32Array), 3));
      g.setIndex(new THREE.BufferAttribute(b64(b.indices, Uint32Array), 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const grp = new THREE.Group(); grp.name = b.name;
      const mesh = new THREE.Mesh(g, this.material(b, clip));
      mesh.userData = { body: b.name };
      const cap = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xc92a2a, side: THREE.BackSide, clippingPlanes: clip }));
      cap.visible = !!this.sectionPlane; cap.userData.cap = true;
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.BufferAttribute(b64(b.edges, Float32Array), 3));
      const edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: this.edgeColor, clippingPlanes: clip }));
      edges.userData = { body: b.name, edgeLines: true };
      edges.visible = this.style !== 'shaded';
      grp.add(mesh, cap, edges);
      grp.visible = !opts.hidden?.has(b.name);
      this.model.add(grp);
      this.bodies.set(b.name, { meta: b, group: grp, mesh, cap, edges, faceIds: b64(b.faceIds, Uint32Array), edgeIds: b64(b.edgeIds, Uint32Array), faceGeo: new Map() });
    }
    this.sketchLines = new THREE.Group();
    for (const line of m.sketches || []) {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(line.map((p) => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color: 0xd9480f }));
      this.sketchLines.add(l);
    }
    this.sketchLines.visible = opts.showSketches !== false;
    this.model.add(this.sketchLines);
    const box = this.modelBox(true);
    this.sceneRadius = Math.max(50, box.getSize(new THREE.Vector3()).length() / 2 + box.getCenter(new THREE.Vector3()).length());
    this.refreshHighlights();
  }
  material(b, clip, forced) {
    const mode = forced || this.style;
    if (ANALYSIS[mode]) return this.analysisMaterial(mode, clip);
    const metal = /Aço|Alum|Latão|Cobre|Titân|Inox/.test(b.material || '');
    const m = new THREE.MeshPhysicalMaterial({
      color: b.color, metalness: metal ? 0.35 : 0.05, roughness: metal ? 0.32 : 0.45, clearcoat: 0.08,
      clippingPlanes: clip, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    if (mode === 'wire') m.visible = false;
    if (mode === 'xray') { m.transparent = true; m.opacity = 0.35; m.depthWrite = false; }
    return m;
  }
  analysisMaterial(mode, clip) {
    return new THREE.ShaderMaterial({
      clipping: true, clippingPlanes: clip, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      uniforms: { uPull: { value: new THREE.Vector3(0, 0, 1) }, uMinDraft: { value: 1.0 } },
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        #include <clipping_planes_pars_vertex>
        varying vec3 vN; varying vec3 vWN; varying vec3 vView;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vWN = normal; vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
          #include <clipping_planes_vertex>
        }`,
      fragmentShader: `uniform vec3 uPull; uniform float uMinDraft; varying vec3 vN; varying vec3 vWN; varying vec3 vView;
        #include <logdepthbuf_pars_fragment>
        #include <clipping_planes_pars_fragment>
        void main(){
          #include <logdepthbuf_fragment>
          #include <clipping_planes_fragment>
          ${ANALYSIS[mode]}
        }`,
    });
  }
  setStyle(style) {
    this.style = style;
    const clip = this.sectionPlane ? [this.sectionPlane] : [];
    this.bodies.forEach((b) => { b.mesh.material = this.material(b.meta, clip); b.edges.visible = style !== 'shaded'; });
  }
  setBodyVisible(name, v) { const b = this.bodies.get(name); if (b) b.group.visible = v; }
  setSketchesVisible(v) { if (this.sketchLines) this.sketchLines.visible = v; }

  // ---------------------------------------------------------------- corte
  setSection(sec) {
    // sec: { axis: 'x'|'y'|'z', offset, flip } ou null
    if (!sec) this.sectionPlane = null;
    else {
      const n = new THREE.Vector3(sec.axis === 'x' ? 1 : 0, sec.axis === 'y' ? 1 : 0, sec.axis === 'z' ? 1 : 0);
      if (!sec.flip) n.negate();
      this.sectionPlane = new THREE.Plane(n, sec.flip ? -sec.offset : sec.offset);
    }
    const clip = this.sectionPlane ? [this.sectionPlane] : [];
    this.bodies.forEach((b) => {
      for (const o of [b.mesh, b.cap, b.edges]) { o.material.clippingPlanes = clip; o.material.needsUpdate = true; }
      b.cap.visible = !!this.sectionPlane;
    });
  }

  // ---------------------------------------------------------------- câmera
  modelBox(includeSketch = false) {
    const box = new THREE.Box3();
    this.bodies.forEach((b) => { if (b.group.visible) box.expandByObject(b.mesh); });
    if (includeSketch || box.isEmpty()) { if (this.sketchGroup.children.length) box.expandByObject(this.sketchGroup); if (this.sketchLines?.visible) box.expandByObject(this.sketchLines); }
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, -10), new THREE.Vector3(50, 50, 40));
    return box;
  }
  viewState() { return { pos: this.camera.position.clone(), target: this.controls.target.clone(), up: this.camera.up.clone(), zoom: this.camera.zoom }; }
  pushHistory() { this.history.push(this.viewState()); if (this.history.length > 30) this.history.shift(); }
  previousView() { const s = this.history.pop(); if (s) this.animateTo(s.pos, s.target, s.up, false); }

  fit(dir, opts = {}) {
    const box = opts.box || this.modelBox(opts.includeSketch);
    const c = box.getCenter(new THREE.Vector3());
    const rad = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2);
    const d = dir ? new THREE.Vector3(...(Array.isArray(dir) ? dir : dir.toArray())).normalize() : this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = (rad / Math.sin((this.persp.fov * Math.PI) / 360)) * 1.08;
    // vista de topo/baixo: a frente fica para baixo na tela (Y para cima)
    const up = opts.up ? new THREE.Vector3(...opts.up) : Math.abs(d.z) > 0.999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    this.animateTo(c.clone().add(d.multiplyScalar(dist)), c, up, opts.instant);
    if (this.camera === this.ortho) { this.ortho.zoom = 1; this.ortho.updateProjectionMatrix(); }
  }
  setView(name) { this.pushHistory(); this.fit(VIEW_DIRS[name] || VIEW_DIRS.iso); }
  lookAtPlane(normal, up, center) {
    this.pushHistory();
    const box = this.modelBox(true);
    if (center) box.expandByPoint(new THREE.Vector3(...center));
    this.fit(normal, { up, box });
  }
  animateTo(pos, target, up, instant) {
    const from = this.viewState();
    if (instant) { this.camera.position.copy(pos); this.controls.target.copy(target); this.camera.up.copy(up); this.camera.lookAt(target); return; }
    this.anim = { from, to: { pos, target, up }, t0: performance.now(), dur: 380 };
  }
  stepAnim() {
    const a = this.anim;
    const t = Math.min(1, (performance.now() - a.t0) / a.dur), k = t * t * (3 - 2 * t);
    // interpola em coordenadas esféricas em torno do alvo para girar suavemente
    const tgt = a.from.target.clone().lerp(a.to.target, k);
    const r0 = a.from.pos.clone().sub(a.from.target), r1 = a.to.pos.clone().sub(a.to.target);
    const q = new THREE.Quaternion().setFromUnitVectors(r0.clone().normalize(), r1.clone().normalize());
    const qk = new THREE.Quaternion().slerp(q, k);
    const len = r0.length() + (r1.length() - r0.length()) * k;
    const dir = r0.clone().normalize().applyQuaternion(qk);
    this.camera.position.copy(tgt).add(dir.multiplyScalar(len));
    this.camera.up.copy(a.from.up.clone().lerp(a.to.up, k).normalize());
    this.controls.target.copy(tgt);
    this.camera.lookAt(tgt);
    if (t >= 1) this.anim = null;
  }

  // ---------------------------------------------------------------- utilidades de tela
  ndc(ev) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }
  ray(ev) { const rc = new THREE.Raycaster(); rc.setFromCamera(this.ndc(ev), this.camera); return rc; }
  worldPerPixel(at) {
    const h = this.renderer.domElement.clientHeight || 1;
    if (this.camera === this.ortho) return (this.ortho.top - this.ortho.bottom) / this.ortho.zoom / h;
    const d = this.camera.position.distanceTo(at || this.controls.target);
    return (2 * d * Math.tan((this.persp.fov * Math.PI) / 360)) / h;
  }
  toScreen(p) {
    const v = (p.isVector3 ? p.clone() : new THREE.Vector3(...p)).project(this.camera);
    const c = this.renderer.domElement;
    return { x: ((v.x + 1) / 2) * c.clientWidth, y: ((1 - v.y) / 2) * c.clientHeight, behind: v.z > 1 };
  }
  /** Interseção do cursor com um plano de esboço (matriz 4×4 coluna-major) → coordenadas locais. */
  planePoint(ev, M) {
    const m = new THREE.Matrix4().fromArray(M);
    const o = new THREE.Vector3().setFromMatrixPosition(m);
    const n = new THREE.Vector3().setFromMatrixColumn(m, 2).normalize();
    const hit = this.ray(ev).ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, o), new THREE.Vector3());
    if (!hit) return null;
    const local = hit.clone().applyMatrix4(m.clone().invert());
    return { u: local.x, v: local.y, world: hit };
  }

  // ---------------------------------------------------------------- seleção (pick)
  pick(ev, f = { faces: true }) {
    const rc = this.ray(ev);
    const visible = [...this.bodies.values()].filter((b) => b.group.visible);
    const fh = f.faces || f.edges || f.bodies ? rc.intersectObjects(visible.map((b) => b.mesh), false)[0] : null;
    if (f.edges) {
      const wpp = this.worldPerPixel(fh?.point);
      rc.params.Line.threshold = wpp * 6;
      const eh = rc.intersectObjects(visible.map((b) => b.edges), false).filter((h) => !fh || h.distance <= fh.distance + wpp * 8)[0];
      if (eh) {
        const b = this.bodies.get(eh.object.userData.body);
        const edge = b.edgeIds[Math.floor(eh.index / 2)];
        if (edge !== undefined) return { kind: 'edge', body: b.meta.name, index: edge, point: eh.point.toArray() };
      }
    }
    if (f.planes && this.origin.visible) {
      const ph = rc.intersectObjects(Object.values(this.planes).filter((p) => p.visible).map((p) => p.children[0]), false)[0];
      if (ph && (!fh || ph.distance < fh.distance)) return { kind: 'plane', plane: ph.object.userData.plane, point: ph.point.toArray() };
    }
    if (fh && (f.faces || f.bodies)) {
      const b = this.bodies.get(fh.object.userData.body);
      const face = b.faceIds[fh.faceIndex];
      const n = fh.face.normal.clone().transformDirection(fh.object.matrixWorld);
      if (f.bodies && !f.faces) return { kind: 'body', body: b.meta.name, point: fh.point.toArray() };
      return { kind: 'face', body: b.meta.name, index: face, point: fh.point.toArray(), normal: n.toArray() };
    }
    return null;
  }

  // ---------------------------------------------------------------- destaques
  faceGeometry(b, face) {
    if (b.faceGeo.has(face)) return b.faceGeo.get(face);
    const src = b.mesh.geometry, idx = src.index.array, ids = b.faceIds, out = [];
    for (let t = 0; t < ids.length; t++) if (ids[t] === face) out.push(idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', src.getAttribute('position'));
    g.setIndex(out);
    b.faceGeo.set(face, g);
    return g;
  }
  edgeObject(b, edge, color) {
    const pos = b.edges.geometry.getAttribute('position').array, ids = b.edgeIds;
    const grp = new THREE.Group();
    const rad = this.worldPerPixel() * 1.6;
    for (let s = 0; s < ids.length; s++) {
      if (ids[s] !== edge) continue;
      const a = new THREE.Vector3(pos[6 * s], pos[6 * s + 1], pos[6 * s + 2]), c = new THREE.Vector3(pos[6 * s + 3], pos[6 * s + 4], pos[6 * s + 5]);
      const len = a.distanceTo(c);
      if (len < 1e-9) continue;
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 6), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      cyl.position.copy(a).add(c).multiplyScalar(0.5);
      cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize());
      cyl.renderOrder = 10;
      grp.add(cyl);
    }
    return grp;
  }
  highlightObject(h, color, opacity) {
    if (h.kind === 'face') {
      const b = this.bodies.get(h.body);
      if (!b) return null;
      const m = new THREE.Mesh(this.faceGeometry(b, h.index), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
      m.renderOrder = 5;
      return m;
    }
    if (h.kind === 'edge') { const b = this.bodies.get(h.body); return b ? this.edgeObject(b, h.index, color) : null; }
    if (h.kind === 'body') {
      const b = this.bodies.get(h.body);
      if (!b) return null;
      const m = new THREE.Mesh(b.mesh.geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity * 0.6, depthTest: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.renderOrder = 5;
      return m;
    }
    if (h.kind === 'plane') { const p = this.planes[h.plane]; p.children[0].material.opacity = 0.35; return null; }
    return null;
  }
  refreshHighlights() {
    this.overlay.clear();
    Object.values(this.planes).forEach((p) => { p.children[0].material.opacity = 0.12; });
    for (const s of this.selection) { const o = this.highlightObject(s, 0x1f6fe0, 0.45); if (o) this.overlay.add(o); }
    if (this.hover && !this.selection.some((s) => same(s, this.hover))) { const o = this.highlightObject(this.hover, 0x4dabf7, 0.3); if (o) this.overlay.add(o); }
    for (const m of this.markers || []) this.overlay.add(m);
  }
  setSelection(list) { this.selection = list; this.refreshHighlights(); }
  setMarkers(points, color = 0xf08c00) {
    this.markers = points.map((p) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(this.worldPerPixel() * 4, 14, 10), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      m.position.set(...p); m.renderOrder = 12; return m;
    });
    this.refreshHighlights();
  }

  // ---------------------------------------------------------------- eventos
  bindEvents() {
    const dom = this.renderer.domElement;
    let down = null;
    dom.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, button: e.button, t: performance.now() };
      if (this.tool?.pointerdown?.(e)) { e.stopImmediatePropagation(); }
    }, true);
    dom.addEventListener('pointermove', (e) => {
      if (this.tool?.pointermove?.(e)) return;
      if (e.buttons) return;
      const filt = this.hoverFilter || this.idleFilter;
      if (filt) {
        cancelAnimationFrame(this._hov);
        this._hov = requestAnimationFrame(() => {
          const h = this.pick(e, filt);
          const accept = h && (!filt.accept || filt.accept(h));
          const nh = accept ? h : null;
          if (!same(nh, this.hover)) { this.hover = nh; this.refreshHighlights(); }
        });
      }
    });
    dom.addEventListener('pointerup', (e) => {
      if (this.tool?.pointerup?.(e)) return;
      if (!down || down.button !== e.button) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
      down = null;
      if (moved) return;
      if (e.button === 0) this.onClick?.(e);
    });
    dom.addEventListener('dblclick', (e) => { if (!this.tool?.dblclick?.(e)) this.onDoubleClick?.(e); });
    dom.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!this.tool?.contextmenu?.(e)) this.onContextMenu?.(e); });
    dom.addEventListener('pointerleave', () => { if (this.hover) { this.hover = null; this.refreshHighlights(); } });
  }

  // ---------------------------------------------------------------- render para o Claude (GPU)
  async renderForClaude(o) {
    const views = o.sheet ? ['iso', 'front', 'top', 'right'] : [o.view || 'iso'];
    const W = o.width || (o.sheet ? 1000 : 800), H = o.height || (o.sheet ? 800 : 600);
    const cw = o.sheet ? W / 2 : W, ch = o.sheet ? H / 2 : H;
    const off = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    off.setPixelRatio(1); off.setSize(cw, ch); off.localClippingEnabled = true; off.toneMapping = THREE.ACESFilmicToneMapping;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const saved = [];
    const keep = (obj, key, val) => { saved.push([obj, key, obj[key]]); obj[key] = val; };
    keep(this.scene, 'background', new THREE.Color(0xe9edf3));
    keep(this.origin, 'visible', false); keep(this.overlay, 'visible', false); keep(this.sketchGroup, 'visible', false);
    if (this.sketchLines) keep(this.sketchLines, 'visible', !!o.showSketches);
    let clip = [];
    if (o.section) { const n = new THREE.Vector3(...o.section.normal).normalize(); clip = [new THREE.Plane(n.clone().negate(), o.section.offset)]; }
    this.bodies.forEach((b) => {
      keep(b.group, 'visible', o.bodies?.length ? o.bodies.includes(b.meta.name) : true);
      const mat = this.material(b.meta, clip, o.visual || 'shadedEdges');
      if (o.highlight && o.highlight !== b.meta.name) { mat.transparent = true; mat.opacity = 0.25; }
      keep(b.mesh, 'material', mat);
      keep(b.edges, 'visible', true);
      keep(b.edges, 'material', new THREE.LineBasicMaterial({ color: 0x1a1d22, clippingPlanes: clip }));
      keep(b.cap, 'visible', !!o.section);
      keep(b.cap, 'material', new THREE.MeshBasicMaterial({ color: 0xc92a2a, side: THREE.BackSide, clippingPlanes: clip }));
    });
    const box = this.modelBox();
    views.forEach((v, i) => {
      const cam = new THREE.PerspectiveCamera(30, cw / ch, 0.1, 1e7); cam.up.set(0, 0, 1);
      const d = typeof v === 'string' ? new THREE.Vector3(...(VIEW_DIRS[v] || VIEW_DIRS.iso)).normalize()
        : new THREE.Vector3(Math.cos((v.elevation * Math.PI) / 180) * Math.cos((v.azimuth * Math.PI) / 180), Math.cos((v.elevation * Math.PI) / 180) * Math.sin((v.azimuth * Math.PI) / 180), Math.sin((v.elevation * Math.PI) / 180));
      if (Math.abs(d.z) > 0.999) cam.up.set(0, 1, 0);
      const c = box.getCenter(new THREE.Vector3()), rad = box.getSize(new THREE.Vector3()).length() / 2;
      const dist = (rad / Math.sin((cam.fov * Math.PI) / 360)) * 1.05;
      cam.position.copy(c).add(d.multiplyScalar(dist)); cam.near = dist / 100; cam.far = dist * 100; cam.lookAt(c); cam.updateProjectionMatrix();
      this.sun.position.copy(cam.position).add(new THREE.Vector3(60, 40, 140));
      off.render(this.scene, cam);
      ctx.drawImage(off.domElement, (i % 2) * cw, Math.floor(i / 2) * ch);
    });
    if (o.sheet) { ctx.strokeStyle = '#8a94a3'; ctx.beginPath(); ctx.moveTo(cw, 0); ctx.lineTo(cw, H); ctx.moveTo(0, ch); ctx.lineTo(W, ch); ctx.stroke(); }
    for (let i = saved.length - 1; i >= 0; i--) { const [obj, k, v] = saved[i]; obj[k] = v; }
    off.dispose();
    return { image: canvas.toDataURL('image/png').split(',')[1], width: W, height: H, views, gpu: this.gpuName };
  }
}

export const same = (a, b) => (!a && !b) || (a && b && a.kind === b.kind && a.body === b.body && a.index === b.index && a.plane === b.plane);

// ---------------------------------------------------------------- cubo de navegação
class NavCube {
  constructor(vp) {
    this.vp = vp;
    this.canvas = document.getElementById('navcube');
    this.r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.r.setPixelRatio(devicePixelRatio);
    this.r.setSize(118, 118);
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1.05, 1.05, 1.05, -1.05, 0.1, 10);
    const labels = ['DIREITA', 'ESQUERDA', 'SUPERIOR', 'INFERIOR', 'FRENTE', 'TRÁS'];
    this.mats = labels.map((t, i) => new THREE.MeshBasicMaterial({ map: this.faceTexture(t, i) }));
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.mats);
    this.cube.rotation.x = Math.PI / 2; // Y local → Z do mundo
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(this.cube.geometry), new THREE.LineBasicMaterial({ color: 0x5c6470 }));
    this.cube.add(edges);
    this.scene.add(this.cube);
    this.hl = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x4dabf7, transparent: true, opacity: 0.45, depthTest: false }));
    this.hl.visible = false;
    this.scene.add(this.hl);
    this.canvas.addEventListener('pointermove', (e) => this.hover(e));
    this.canvas.addEventListener('pointerleave', () => { this.hl.visible = false; });
    this.canvas.addEventListener('click', (e) => { const d = this.dirAt(e); if (d) { vp.pushHistory(); vp.fit(d); } });
  }
  faceTexture(text, i) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 128); grad.addColorStop(0, '#fbfcfd'); grad.addColorStop(1, '#dfe4ea');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#3d4450'; g.font = `600 ${text.length > 7 ? 17 : 20}px "Segoe UI", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(64, 64);
    if (i === 2) g.rotate(Math.PI); // face superior legível com a frente embaixo
    g.fillText(text, 0, 0); g.restore();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  localHit(e) {
    const rect = this.canvas.getBoundingClientRect();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.cam);
    const h = rc.intersectObject(this.cube, false)[0];
    return h ? this.cube.worldToLocal(h.point.clone()) : null;
  }
  dirAt(e) {
    const p = this.localHit(e);
    if (!p) return null;
    const t = 0.5 - 0.16;
    const local = new THREE.Vector3(Math.abs(p.x) > t ? Math.sign(p.x) : 0, Math.abs(p.y) > t ? Math.sign(p.y) : 0, Math.abs(p.z) > t ? Math.sign(p.z) : 0);
    return local.applyQuaternion(this.cube.quaternion).toArray();
  }
  hover(e) {
    const d = this.dirAt(e);
    if (!d) { this.hl.visible = false; return; }
    const v = new THREE.Vector3(...d);
    const n = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)].filter((x) => x > 0.5).length;
    // destaca a região: face (placa), aresta (barra) ou canto (cubinho)
    const s = (x) => (Math.abs(x) > 0.5 ? 0.18 : n === 1 ? 0.72 : n === 2 ? 0.62 : 0.18);
    this.hl.scale.set(s(v.x), s(v.y), s(v.z));
    this.hl.position.set(v.x * 0.5, v.y * 0.5, v.z * 0.5);
    this.hl.visible = true;
  }
  render() {
    const vp = this.vp;
    const dir = vp.camera.position.clone().sub(vp.controls.target).normalize();
    this.cam.position.copy(dir.multiplyScalar(4)); this.cam.up.copy(vp.camera.up); this.cam.lookAt(0, 0, 0);
    this.r.render(this.scene, this.cam);
  }
}
