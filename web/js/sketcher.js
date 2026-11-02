// Ambiente de esboço 2D interativo: seleção de plano/face, ferramentas de desenho com
// ajuste (grade, pontos, horizontal/vertical), cotas paramétricas editáveis, restrições
// geométricas e indicação dos graus de liberdade. O solver é o do kernel (servidor).
import * as THREE from 'three';
import { rpc } from './rpc.js';
import { app, facesOf } from './store.js';
import { h, $, toast, setPrompt, ask } from './ui.js';

let S = null; // sessão ativa
const notify = (on) => window.dispatchEvent(new CustomEvent('sketchmode', { detail: on }));
const MAT = {
  line: (c) => new THREE.LineBasicMaterial({ color: c, depthTest: false }),
  dash: (c) => new THREE.LineDashedMaterial({ color: c, dashSize: 1, gapSize: 1, depthTest: false }),
};
const COLORS = { free: 0xe8590c, full: 0x1c4f9c, sel: 0x228be6, constr: 0x868e96, preview: 0x339af0, point: 0x1c4f9c, origin: 0xf59f00 };
const GLYPH = { horizontal: 'H', vertical: 'V', parallel: '∥', perpendicular: '⊥', equal: '=', fix: '🔒', tangent: 'T', concentric: '◎', coincident: '•', midpoint: 'M', symmetric: '⋈', pointOnLine: '⊸', pointOnCircle: '⊸' };
const DIM_TYPES = new Set(['length', 'distance', 'distanceX', 'distanceY', 'radius', 'diameter', 'angle']);

// ---------------------------------------------------------------- entrada no esboço
export function startSketch() {
  if (app.sketching) return;
  app.vp.showOrigin({ XY: true, XZ: true, YZ: true, axes: true });
  app.vp.hoverFilter = { faces: true, planes: true };
  setPrompt('Selecione um plano de origem ou uma face plana para criar o esboço  (Esc cancela)');
  app.planePick = async (e) => {
    const hit = app.vp.pick(e, { faces: true, planes: true });
    if (!hit) return;
    let plane;
    if (hit.kind === 'plane') plane = hit.plane;
    else {
      const f = (await facesOf(hit.body)).find((x) => x.index === hit.index);
      if (f.type !== 'Plane') { toast('O esboço precisa de uma face plana.', 'warn'); return; }
      plane = { face: { body: hit.body, normal: f.normal, near: f.centroid } };
    }
    endPlanePick();
    await rpc('tx_begin', { label: 'Esboço 2D' });
    const r = await rpc('add_feature', { feature: { type: 'sketch', plane, points: { O: [0, 0] }, entities: [], constraints: [{ type: 'fix', p: 'O', x: 0, y: 0 }] } });
    await enter(r.created);
  };
}
export function endPlanePick() {
  app.planePick = null;
  app.vp.hoverFilter = null;
  if (!app.originPinned) app.vp.showOrigin(false);
  setPrompt('');
}

export async function editSketch(name) {
  if (app.sketching) return;
  await rpc('tx_begin', { label: `Editar ${name}` });
  await rpc('explode_sketch', { name });
  await enter(name);
}

async function enter(name) {
  const info = await rpc('sketch_info', { name });
  S = new Session(name, info);
  app.sketching = S;
  notify(true);
  app.vp.setSketchesVisible(false);
  app.vp.setNavMode('none');
  const M = info.matrix;
  app.vp.lookAtPlane([M[8], M[9], M[10]], [M[4], M[5], M[6]], [M[12], M[13], M[14]]);
  S.redraw();
  S.status();
}

export async function finish() {
  if (!S) return;
  S.cancelTool();
  await S.chain;
  const name = S.name;
  exit();
  await rpc('tx_commit', { label: `Esboço ${name}` });
}
export async function cancel() {
  if (!S) return;
  exit();
  await rpc('tx_cancel');
}
function exit() {
  S.dispose();
  S = null;
  app.sketching = null;
  app.vp.tool = null;
  app.vp.setNavMode('orbit');
  app.vp.setSketchesVisible(app.settings.showSketches);
  notify(false);
  setPrompt('');
}

export function tool(kind) { if (S) S.setTool(kind); }
export function constraintTool(kind) { if (S) S.setTool('constraint', kind); }
export function toggleConstruction() { if (!S) return; S.construction = !S.construction; S.applyConstructionToSelection(); toast(S.construction ? 'Nova geometria: construção' : 'Nova geometria: normal'); }
export function deleteSelection() { S?.deleteSelection(); }
export function toggleGlyphs() { app.settings.showConstraints = !app.settings.showConstraints; S?.redraw(); }
export const session = () => S;

// ---------------------------------------------------------------- sessão
class Session {
  constructor(name, info) {
    this.name = name;
    this.M = info.matrix;
    this.m4 = new THREE.Matrix4().fromArray(info.matrix);
    this.points = { ...info.points };
    this.entities = info.entities.map((e) => ({ ...e }));
    this.constraints = info.constraints.map((c) => ({ ...c }));
    for (const e of this.entities) if (e.type === 'circle' && info.radii[e.id] !== undefined) e.r = info.radii[e.id];
    if (!this.points.O) { this.points.O = [0, 0]; this.constraints.push({ type: 'fix', p: 'O', x: 0, y: 0 }); }
    this.info = info;
    this.sel = new Set();
    this.construction = false;
    this.chain = Promise.resolve();
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(this.m4);
    app.vp.sketchGroup.add(this.group);
    this.labelsEl = $('#labels');
    this.makeGrid();
    this.toolState = null;
    this.cursor = null;
    app.vp.tool = this.handlers();
    app.vp.onFrame = () => this.placeLabels();
  }
  dispose() {
    app.vp.sketchGroup.remove(this.group);
    this.gridObj && app.vp.sketchGroup.remove(this.gridObj);
    this.labelsEl.innerHTML = '';
    this.editor?.remove();
    app.vp.onFrame = null;
  }
  uid(prefix) { let i = 1; const used = new Set([...Object.keys(this.points), ...this.entities.map((e) => e.id)]); while (used.has(`${prefix}${i}`)) i++; return `${prefix}${i}`; }

  // ---------------------------------------------------------- geometria auxiliar
  W(u, v) { return new THREE.Vector3(u, v, 0); } // coordenadas locais do grupo (o grupo carrega a matriz do plano)
  wpp() { return app.vp.worldPerPixel(new THREE.Vector3(this.M[12], this.M[13], this.M[14])); }
  gridStep() {
    const raw = this.wpp() * 14;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw);
  }
  makeGrid() {
    const box = app.vp.modelBox(true);
    const size = Math.max(200, box.getSize(new THREE.Vector3()).length() * 2);
    const step = Math.pow(10, Math.round(Math.log10(size / 40)));
    const n = Math.ceil(size / step);
    const dark = app.settings.theme === 'dark';
    const grid = new THREE.GridHelper(n * step, n, dark ? 0x56606e : 0x9aa5b5, dark ? 0x3a414c : 0xd5dbe3);
    grid.rotation.x = Math.PI / 2;
    grid.material.transparent = true; grid.material.opacity = 0.7; grid.material.depthWrite = false;
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false; holder.matrix.copy(this.m4);
    holder.add(grid);
    const axes = new THREE.Group();
    const ax = (a, b, c) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([this.W(...a), this.W(...b)]), MAT.line(c));
    axes.add(ax([-n * step / 2, 0], [n * step / 2, 0], 0xe03131), ax([0, -n * step / 2], [0, n * step / 2], 0x2f9e44));
    holder.add(axes);
    this.gridObj = holder;
    app.vp.sketchGroup.add(holder);
  }
  entityPoints(e, n = 64) {
    const P = this.points;
    if (e.type === 'line') return [P[e.a], P[e.b]];
    if (e.type === 'circle') { const c = P[e.c]; return Array.from({ length: n + 1 }, (_, i) => [c[0] + e.r * Math.cos((2 * Math.PI * i) / n), c[1] + e.r * Math.sin((2 * Math.PI * i) / n)]); }
    if (e.type === 'arc') {
      const c = P[e.c], a = P[e.a], b = P[e.b];
      const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
      const t0 = Math.atan2(a[1] - c[1], a[0] - c[0]); let t1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
      if (t1 <= t0) t1 += 2 * Math.PI;
      return Array.from({ length: n + 1 }, (_, i) => { const t = t0 + ((t1 - t0) * i) / n; return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]; });
    }
    return [];
  }
  radiusOf(e) { if (e.type === 'circle') return e.r; const c = this.points[e.c], a = this.points[e.a]; return Math.hypot(a[0] - c[0], a[1] - c[1]); }

  // ---------------------------------------------------------- desenho
  redraw() {
    this.group.clear();
    const full = this.info.dof === 0 && this.info.solved !== false;
    for (const e of this.entities) {
      const pts = this.entityPoints(e);
      if (!pts.length) continue;
      const color = this.sel.has(e.id) ? COLORS.sel : e.construction ? COLORS.constr : full ? COLORS.full : COLORS.free;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => this.W(p[0], p[1]))), e.construction ? MAT.dash(color) : MAT.line(color));
      if (e.construction) { line.material.dashSize = this.wpp() * 6; line.material.gapSize = this.wpp() * 4; line.computeLineDistances(); }
      line.renderOrder = 20;
      this.group.add(line);
    }
    // pontos
    const used = new Set(this.entities.flatMap((e) => [e.a, e.b, e.c].filter(Boolean)));
    const ptsArr = [], cols = [];
    for (const [id, p] of Object.entries(this.points)) {
      void used;
      ptsArr.push(this.W(p[0], p[1]));
      const c = new THREE.Color(id === 'O' ? COLORS.origin : this.sel.has(id) ? COLORS.sel : COLORS.point);
      cols.push(c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry().setFromPoints(ptsArr);
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false }));
    pts.renderOrder = 21;
    this.group.add(pts);
    if (this.preview) this.group.add(this.preview);
    if (this.cursorMark) this.group.add(this.cursorMark);
    this.buildLabels();
  }
  setPreview(polylines, color = COLORS.preview) {
    if (!polylines) { this.preview = null; this.redraw(); return; }
    const grp = new THREE.Group();
    for (const pl of polylines) {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pl.map((p) => this.W(p[0], p[1]))), MAT.dash(color));
      l.material.dashSize = this.wpp() * 5; l.material.gapSize = this.wpp() * 3; l.computeLineDistances(); l.renderOrder = 22;
      grp.add(l);
    }
    this.preview = grp;
    this.redraw();
  }
  setCursor(p, snapped) {
    if (!p) { this.cursorMark = null; return; }
    const g = new THREE.BufferGeometry().setFromPoints([this.W(p.u, p.v)]);
    this.cursorMark = new THREE.Points(g, new THREE.PointsMaterial({ size: snapped ? 11 : 6, sizeAttenuation: false, color: snapped ? 0xf08c00 : 0x339af0, depthTest: false }));
    this.cursorMark.renderOrder = 23;
  }

  // ---------------------------------------------------------- cotas e símbolos (HTML)
  buildLabels() {
    this.labelsEl.innerHTML = '';
    this.labels = [];
    const P = this.points;
    const ent = new Map(this.entities.map((e) => [e.id, e]));
    const off = this.wpp() * 14;
    const mid = (a, b, side, e) => {
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (!side || !e) return m;
      const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1;
      return [m[0] - (d[1] / l) * off * side, m[1] + (d[0] / l) * off * side];
    };
    for (const [i, c] of this.constraints.entries()) {
      let anchor = null, text = null, cls = 'dimlabel';
      const val = c.value;
      const show = (v) => (typeof v === 'number' ? (+v.toFixed(3)).toString().replace('.', ',') : String(v));
      if (c.type === 'length') { const e = ent.get(c.line); if (!e) continue; anchor = mid(P[e.a], P[e.b], 1, e); text = show(val); }
      else if (c.type === 'distance' || c.type === 'distanceX' || c.type === 'distanceY') { if (!P[c.p] || !P[c.q]) continue; anchor = mid(P[c.p], P[c.q], 0); text = (c.type === 'distanceX' ? '↔ ' : c.type === 'distanceY' ? '↕ ' : '') + show(val); }
      else if (c.type === 'radius' || c.type === 'diameter') { const e = ent.get(c.circle); if (!e) continue; const ctr = P[e.c], r = this.radiusOf(e); anchor = [ctr[0] + r * 0.72, ctr[1] + r * 0.72]; text = `${c.type === 'radius' ? 'R' : 'Ø'}${show(val)}`; }
      else if (c.type === 'angle') { const a = ent.get(c.l1), b = ent.get(c.l2); if (!a || !b) continue; anchor = mid(mid(P[a.a], P[a.b], 0), mid(P[b.a], P[b.b], 0), 0); text = `${show(val)}°`; }
      else if (app.settings.showConstraints && GLYPH[c.type] && c.p !== 'O') {
        cls = 'glyph';
        const e = ent.get(c.line || c.l1 || c.circle || c.c1);
        if (e?.type === 'line') anchor = mid(P[e.a], P[e.b], -1, e);
        else if (e) anchor = P[e.c];
        else if (c.p && P[c.p]) anchor = P[c.p];
        text = GLYPH[c.type];
      }
      if (!anchor) continue;
      const el = h('div', { class: cls, title: cls === 'glyph' ? c.type : 'Duplo clique para editar' }, text);
      if (cls === 'dimlabel') el.addEventListener('dblclick', (ev) => { ev.stopPropagation(); this.editDimension(i); });
      if (cls === 'glyph') el.addEventListener('click', (ev) => { ev.stopPropagation(); this.sel.clear(); this.selConstraint = i; this.redraw(); setPrompt(`Restrição ${c.type} selecionada — Delete remove`); });
      this.labelsEl.append(el);
      this.labels.push({ el, anchor, ci: i });
    }
    this.placeLabels();
  }
  placeLabels() {
    for (const l of this.labels || []) {
      const w = new THREE.Vector3(l.anchor[0], l.anchor[1], 0).applyMatrix4(this.m4);
      const s = app.vp.toScreen(w);
      l.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
    }
  }
  editDimension(i) {
    const c = this.constraints[i];
    this.editor?.remove();
    const anchorEl = this.labels.find((l) => l.ci === i)?.el;
    const inp = h('input', { class: 'dimedit', value: typeof c.value === 'number' ? +c.value.toFixed(6) : c.value });
    const r = anchorEl?.getBoundingClientRect(), vr = app.vp.el.getBoundingClientRect();
    inp.style.left = `${(r ? r.left - vr.left : vr.width / 2) - 10}px`;
    inp.style.top = `${(r ? r.top - vr.top : vr.height / 2) - 4}px`;
    app.vp.el.append(inp);
    this.editor = inp;
    setTimeout(() => { inp.focus(); inp.select(); }, 10);
    const done = (apply) => {
      if (!this.editor) return;
      this.editor = null; inp.remove();
      if (!apply) return;
      const t = inp.value.trim().replace(',', '.');
      if (!t) return;
      c.value = !isNaN(+t) ? +t : inp.value.trim();
      this.commit();
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
  }

  // ---------------------------------------------------------- sincronização com o solver
  commit(opts = {}) {
    this.prune();
    this.chain = this.chain.then(async () => {
      const prev = this.info;
      const pts = Object.fromEntries(Object.entries(this.points).map(([k, p]) => [k, [+p[0].toFixed(9), +p[1].toFixed(9)]]));
      await rpc('update_feature', { name: this.name, patch: { points: pts, entities: this.entities, constraints: this.constraints } });
      const info = await rpc('sketch_info', { name: this.name });
      if (opts.guard && (info.redundant > prev.redundant || (prev.residual < 1e-6 && info.residual > 1e-6))) {
        // a nova restrição conflita: desfaz como no Inventor ("sobre-restringiria o esboço")
        this.constraints.pop();
        toast('Essa restrição sobre-restringe o esboço e não foi adicionada.', 'warn');
        await rpc('update_feature', { name: this.name, patch: { constraints: this.constraints } });
        this.apply(await rpc('sketch_info', { name: this.name }));
        return;
      }
      this.apply(info);
    }).catch((e) => toast(e.message, 'err'));
    return this.chain;
  }
  /** Remove pontos soltos (de ferramentas canceladas) que não pertencem a nada. */
  prune() {
    const keep = new Set(['O']);
    for (const e of this.entities) for (const k of ['a', 'b', 'c', 'p']) if (e[k]) keep.add(e[k]);
    for (const c of this.constraints) for (const k of ['p', 'q', 'a', 'b']) if (c[k]) keep.add(c[k]);
    const t = this.toolState;
    for (const pk of t?.picks || []) if (pk.id) keep.add(pk.id);
    for (const id of Object.keys(this.points)) if (!keep.has(id)) delete this.points[id];
  }
  apply(info) {
    this.info = info;
    for (const [k, p] of Object.entries(info.points)) this.points[k] = p;
    for (const e of this.entities) if (e.type === 'circle' && info.radii[e.id] !== undefined) e.r = info.radii[e.id];
    this.redraw();
    this.status();
  }
  status() {
    const i = this.info;
    const msg = i.status === 'conflito' ? '⚠ Restrições em conflito' : i.dof === 0 ? 'Esboço totalmente restrito' : `${i.dof} grau(s) de liberdade — adicione cotas ou restrições`;
    setPrompt(`${this.toolPrompt || 'Esboço'} · ${msg} · ${i.profiles} perfil(is) fechado(s)`);
  }

  // ---------------------------------------------------------- seleção na tela
  snap(ev, from) {
    const hit = app.vp.planePoint(ev, this.M);
    if (!hit) return null;
    const wpp = this.wpp();
    let best = null;
    for (const [id, p] of Object.entries(this.points)) {
      const d = Math.hypot(p[0] - hit.u, p[1] - hit.v) / wpp;
      if (d < 9 && (!best || d < best.d)) best = { d, id, p };
    }
    if (best) return { u: best.p[0], v: best.p[1], pointId: best.id, snapped: true };
    let u = hit.u, v = hit.v, hv = null;
    if (from) {
      const du = u - from[0], dv = v - from[1];
      if (Math.abs(dv) < Math.abs(du) * Math.tan((2 * Math.PI) / 180)) { v = from[1]; hv = 'horizontal'; }
      else if (Math.abs(du) < Math.abs(dv) * Math.tan((2 * Math.PI) / 180)) { u = from[0]; hv = 'vertical'; }
    }
    if (app.settings.gridSnap) {
      const st = this.gridStep();
      if (hv !== 'vertical') u = Math.round(u / st) * st;
      if (hv !== 'horizontal') v = Math.round(v / st) * st;
    }
    return { u, v, hv };
  }
  pointAt(ev, px = 9) {
    const hit = app.vp.planePoint(ev, this.M);
    if (!hit) return null;
    const wpp = this.wpp();
    let best = null;
    for (const [id, p] of Object.entries(this.points)) { const d = Math.hypot(p[0] - hit.u, p[1] - hit.v) / wpp; if (d < px && (!best || d < best.d)) best = { d, id }; }
    return best?.id || null;
  }
  entityAt(ev, px = 7) {
    const hit = app.vp.planePoint(ev, this.M);
    if (!hit) return null;
    const wpp = this.wpp(), q = [hit.u, hit.v];
    let best = null;
    for (const e of this.entities) {
      let d;
      if (e.type === 'line') d = segDist(q, this.points[e.a], this.points[e.b]);
      else { const c = this.points[e.c]; d = Math.abs(Math.hypot(q[0] - c[0], q[1] - c[1]) - this.radiusOf(e)); if (e.type === 'arc' && !onArc(q, c, this.points[e.a], this.points[e.b])) d = Infinity; }
      d /= wpp;
      if (d < px && (!best || d < best.d)) best = { d, e };
    }
    return best?.e || null;
  }
  getPoint(s) {
    if (s.pointId) return s.pointId;
    const id = this.uid('p');
    this.points[id] = [s.u, s.v];
    return id;
  }

  // ---------------------------------------------------------- ferramentas
  setTool(kind, sub) {
    this.cancelTool();
    this.toolState = { kind, sub, picks: [] };
    const prompts = {
      line: 'Linha: clique no ponto inicial (cadeia contínua; Esc termina)', circle: 'Círculo: clique no centro', arc: 'Arco: clique no início, no fim e num ponto do arco',
      rect: 'Retângulo: clique no primeiro canto', rectCenter: 'Retângulo: clique no centro', polygon: 'Polígono: clique no centro', slot: 'Rasgo: clique no primeiro centro',
      sketchPoint: 'Ponto: clique para posicionar', dimension: 'Cota: clique numa linha, círculo, arco ou em dois pontos',
      constraint: `Restrição ${sub}: selecione a geometria`,
    };
    this.toolPrompt = prompts[kind];
    if (kind === 'polygon') ask({ title: 'Polígono', label: 'Número de lados', value: this.polySides || 6 }).then((v) => { if (v) this.polySides = Math.max(3, Math.min(64, parseInt(v, 10) || 6)); });
    this.status();
  }
  cancelTool() {
    this.toolState = null;
    this.toolPrompt = null;
    this.preview = null;
    this.cursorMark = null;
    this.redraw();
    if (this.info) this.status();
  }

  handlers() {
    let drag = null;
    return {
      pointermove: (ev) => {
        if (drag) { const p = app.vp.planePoint(ev, this.M); if (p) { this.points[drag] = [p.u, p.v]; this.dragMoved = true; this.redraw(); } return true; }
        const t = this.toolState;
        if (!t) {
          const ent = this.entityAt(ev);
          app.vp.el.style.cursor = this.pointAt(ev) ? 'move' : ent ? 'pointer' : '';
          return false;
        }
        const from = t.picks.length ? t.picks.at(-1).uv : null;
        const s = this.snap(ev, t.kind === 'line' || t.kind === 'rect' ? from : null);
        if (!s) return true;
        this.setCursor(s, s.snapped);
        this.previewTool(s);
        return true;
      },
      pointerdown: (ev) => {
        if (ev.button !== 0) return false;
        const t = this.toolState;
        if (!t) {
          const pid = this.pointAt(ev);
          if (pid && pid !== 'O') { drag = pid; return true; }
          return false;
        }
        return true;
      },
      pointerup: (ev) => {
        if (ev.button !== 0) return false;
        if (drag) {
          const moved = this.dragMoved; drag = null; this.dragMoved = false;
          if (moved) this.commit(); else this.selectAt(ev);
          return true;
        }
        const t = this.toolState;
        if (!t) { this.selectAt(ev); return true; }
        this.clickTool(ev);
        return true;
      },
      dblclick: () => true,
      contextmenu: () => {
        if (this.toolState?.picks.length) { if (this.toolState.kind === 'line') this.toolState.picks = []; else this.toolState.picks.pop(); this.setPreview(null); return true; }
        return false;
      },
    };
  }

  selectAt(ev) {
    const pid = this.pointAt(ev);
    const ent = pid ? null : this.entityAt(ev);
    if (!ev.ctrlKey && !ev.shiftKey) this.sel.clear();
    this.selConstraint = null;
    const id = pid || ent?.id;
    if (id) this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id);
    this.redraw();
  }

  previewTool(s) {
    const t = this.toolState, P = t.picks.map((x) => x.uv), q = [s.u, s.v];
    let pl = null;
    switch (t.kind) {
      case 'line': if (P.length) pl = [[P[0], q]]; break;
      case 'circle': if (P.length) { const r = Math.hypot(q[0] - P[0][0], q[1] - P[0][1]); pl = [circlePts(P[0], r)]; } break;
      case 'arc': if (P.length === 1) pl = [[P[0], q]]; else if (P.length === 2) { const a = arc3(P[0], P[1], q); pl = a ? [a.pts] : [[P[0], P[1]]]; } break;
      case 'rect': if (P.length) pl = [[P[0], [q[0], P[0][1]], q, [P[0][0], q[1]], P[0]]]; break;
      case 'rectCenter': if (P.length) { const c = P[0], dx = q[0] - c[0], dy = q[1] - c[1]; pl = [[[c[0] - dx, c[1] - dy], [c[0] + dx, c[1] - dy], [c[0] + dx, c[1] + dy], [c[0] - dx, c[1] + dy], [c[0] - dx, c[1] - dy]]]; } break;
      case 'polygon': if (P.length) { const n = this.polySides || 6, c = P[0], r = Math.hypot(q[0] - c[0], q[1] - c[1]), a0 = Math.atan2(q[1] - c[1], q[0] - c[0]); pl = [Array.from({ length: n + 1 }, (_, i) => [c[0] + r * Math.cos(a0 + (2 * Math.PI * i) / n), c[1] + r * Math.sin(a0 + (2 * Math.PI * i) / n)])]; } break;
      case 'slot': if (P.length === 1) pl = [[P[0], q]]; else if (P.length === 2) pl = [slotPts(P[0], P[1], distToLine(q, P[0], P[1]))]; break;
      default: pl = null;
    }
    this.setPreview(pl);
  }

  async clickTool(ev) {
    const t = this.toolState;
    if (t.kind === 'dimension') return this.dimensionClick(ev);
    if (t.kind === 'constraint') return this.constraintClick(ev);
    const from = t.picks.length ? t.picks.at(-1).uv : null;
    const s = this.snap(ev, t.kind === 'line' || t.kind === 'rect' ? from : null);
    if (!s) return;
    t.picks.push({ uv: [s.u, s.v], s });
    const P = t.picks;
    const cons = this.construction;
    const add = (e) => { this.entities.push({ construction: cons || undefined, ...e }); return e.id; };
    const C = (c) => this.constraints.push(c);
    switch (t.kind) {
      case 'sketchPoint': { const p = this.getPoint(s); add({ id: this.uid('pt'), type: 'point', p }); t.picks = []; break; }
      case 'line': {
        if (P.length < 2) { P[0].id = this.getPoint(s); return; }
        const a = P[0].id, b = this.getPoint(s);
        if (a === b) { P.pop(); return; }
        const id = add({ id: this.uid('l'), type: 'line', a, b });
        if (s.hv) C({ type: s.hv, line: id });
        const closed = !!s.pointId;
        t.picks = closed ? [] : [{ uv: [s.u, s.v], id: b }];
        if (closed) this.setPreview(null);
        break;
      }
      case 'circle': {
        if (P.length < 2) { P[0].id = this.getPoint(s); return; }
        const c = P[0].id, r = Math.hypot(P[1].uv[0] - P[0].uv[0], P[1].uv[1] - P[0].uv[1]);
        if (r < 1e-9) { P.pop(); return; }
        add({ id: this.uid('c'), type: 'circle', c, r });
        t.picks = []; break;
      }
      case 'arc': {
        if (P.length < 3) return;
        const a3 = arc3(P[0].uv, P[1].uv, P[2].uv);
        if (!a3) { t.picks = []; break; }
        const pa = this.getPoint(P[0].s), pb = this.getPoint(P[1].s);
        const pc = this.uid('p'); this.points[pc] = a3.c;
        add({ id: this.uid('a'), type: 'arc', c: pc, a: a3.ccw ? pa : pb, b: a3.ccw ? pb : pa });
        t.picks = []; break;
      }
      case 'rect': case 'rectCenter': {
        if (P.length < 2) return;
        let c1, c3, center = null;
        if (t.kind === 'rect') { c1 = P[0].uv; c3 = P[1].uv; } else { center = P[0].uv; c1 = [2 * center[0] - P[1].uv[0], 2 * center[1] - P[1].uv[1]]; c3 = P[1].uv; }
        if (Math.abs(c1[0] - c3[0]) < 1e-9 || Math.abs(c1[1] - c3[1]) < 1e-9) { t.picks = []; break; }
        const ids = [t.kind === 'rect' ? this.getPoint(P[0].s) : null, null, t.kind === 'rect' ? this.getPoint(P[1].s) : this.getPoint(P[1].s), null];
        const corners = [c1, [c3[0], c1[1]], c3, [c1[0], c3[1]]];
        corners.forEach((p, i) => { if (!ids[i]) { ids[i] = this.uid('p'); this.points[ids[i]] = p; } });
        const L = [0, 1, 2, 3].map((i) => add({ id: this.uid('l'), type: 'line', a: ids[i], b: ids[(i + 1) % 4] }));
        C({ type: 'horizontal', line: L[0] }); C({ type: 'horizontal', line: L[2] }); C({ type: 'vertical', line: L[1] }); C({ type: 'vertical', line: L[3] });
        if (center) { const pc = this.getPoint(P[0].s); C({ type: 'midpoint', p: pc, a: ids[0], b: ids[2] }); }
        t.picks = []; break;
      }
      case 'polygon': {
        if (P.length < 2) return;
        const n = this.polySides || 6, c = P[0].uv, r = Math.hypot(P[1].uv[0] - c[0], P[1].uv[1] - c[1]), a0 = Math.atan2(P[1].uv[1] - c[1], P[1].uv[0] - c[0]);
        if (r < 1e-9) { t.picks = []; break; }
        const pc = this.getPoint(P[0].s);
        const circ = add({ id: this.uid('c'), type: 'circle', c: pc, r, construction: true });
        const ids = Array.from({ length: n }, (_, i) => { const id = this.uid('p'); this.points[id] = [c[0] + r * Math.cos(a0 + (2 * Math.PI * i) / n), c[1] + r * Math.sin(a0 + (2 * Math.PI * i) / n)]; return id; });
        const L = ids.map((id, i) => add({ id: this.uid('l'), type: 'line', a: id, b: ids[(i + 1) % n] }));
        ids.forEach((id) => C({ type: 'pointOnCircle', p: id, circle: circ }));
        for (let i = 1; i < n; i++) C({ type: 'equal', l1: L[0], l2: L[i] });
        t.picks = []; break;
      }
      case 'slot': {
        if (P.length < 3) return;
        const [a, b] = [P[0].uv, P[1].uv], w = distToLine(P[2].uv, a, b);
        if (w < 1e-9 || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) { t.picks = []; break; }
        const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d), nrm = [-d[1] / l, d[0] / l];
        const c1 = this.getPoint(P[0].s), c2 = this.getPoint(P[1].s);
        const mk = (p) => { const id = this.uid('p'); this.points[id] = p; return id; };
        const pa = mk([a[0] - nrm[0] * w, a[1] - nrm[1] * w]), pb = mk([b[0] - nrm[0] * w, b[1] - nrm[1] * w]), pcc = mk([b[0] + nrm[0] * w, b[1] + nrm[1] * w]), pd = mk([a[0] + nrm[0] * w, a[1] + nrm[1] * w]);
        const l1 = add({ id: this.uid('l'), type: 'line', a: pa, b: pb }), l2 = add({ id: this.uid('l'), type: 'line', a: pcc, b: pd });
        const a1 = add({ id: this.uid('a'), type: 'arc', c: c2, a: pb, b: pcc }), a2 = add({ id: this.uid('a'), type: 'arc', c: c1, a: pd, b: pa });
        C({ type: 'tangent', line: l1, circle: a1 }); C({ type: 'tangent', line: l1, circle: a2 }); C({ type: 'tangent', line: l2, circle: a1 }); C({ type: 'equal', l1: a1, l2: a2 });
        t.picks = []; break;
      }
      default: break;
    }
    if (!t.picks.length) this.setPreview(null);
    await this.commit();
  }

  async dimensionClick(ev) {
    const t = this.toolState;
    const pid = this.pointAt(ev), ent = pid ? null : this.entityAt(ev);
    const P = this.points;
    if (!t.picks.length) {
      if (ent?.type === 'circle' || ent?.type === 'arc') {
        const r = this.radiusOf(ent);
        this.constraints.push(ent.type === 'circle' ? { type: 'diameter', circle: ent.id, value: +(2 * r).toFixed(3) } : { type: 'radius', circle: ent.id, value: +r.toFixed(3) });
        return this.afterDimension();
      }
      if (ent?.type === 'line' || pid) { t.picks.push({ pid, ent }); this.toolPrompt = ent ? 'Cota: clique em outra linha (ângulo) ou em área vazia (comprimento)' : 'Cota: clique no segundo ponto'; this.status(); return; }
      return;
    }
    const first = t.picks[0];
    t.picks = [];
    if (first.ent) {
      if (ent?.type === 'line' && ent.id !== first.ent.id) {
        const d1 = dirOf(P, first.ent), d2 = dirOf(P, ent);
        const ang = (Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]) * 180) / Math.PI;
        this.constraints.push({ type: 'angle', l1: first.ent.id, l2: ent.id, value: +ang.toFixed(3) });
      } else {
        const e = first.ent, len = Math.hypot(P[e.b][0] - P[e.a][0], P[e.b][1] - P[e.a][1]);
        this.constraints.push({ type: 'length', line: e.id, value: +len.toFixed(3) });
      }
      return this.afterDimension();
    }
    if (pid && first.pid && pid !== first.pid) {
      let p = first.pid, q = pid;
      const du = P[q][0] - P[p][0], dv = P[q][1] - P[p][1];
      if (Math.abs(du) > 3 * Math.abs(dv)) { if (du < 0) [p, q] = [q, p]; this.constraints.push({ type: 'distanceX', p, q, value: +Math.abs(du).toFixed(3) }); }
      else if (Math.abs(dv) > 3 * Math.abs(du)) { if (dv < 0) [p, q] = [q, p]; this.constraints.push({ type: 'distanceY', p, q, value: +Math.abs(dv).toFixed(3) }); }
      else this.constraints.push({ type: 'distance', p, q, value: +Math.hypot(du, dv).toFixed(3) });
      return this.afterDimension();
    }
    this.status();
  }
  async afterDimension() {
    this.toolPrompt = 'Cota: clique numa linha, círculo, arco ou em dois pontos';
    await this.commit({ guard: true });
    const idx = this.constraints.length - 1;
    if (DIM_TYPES.has(this.constraints[idx]?.type)) this.editDimension(idx);
  }

  async constraintClick(ev) {
    const t = this.toolState, kind = t.sub;
    const pid = this.pointAt(ev), ent = pid ? null : this.entityAt(ev);
    if (!pid && !ent) return;
    t.picks.push({ pid, ent });
    const picks = t.picks;
    const isLine = (x) => x?.ent?.type === 'line', isCirc = (x) => x?.ent && x.ent.type !== 'line', isPt = (x) => !!x?.pid;
    const P = this.points;
    let c = null, need = 2;
    switch (kind) {
      case 'horizontal': case 'vertical':
        if (isLine(picks[0])) c = { type: kind, line: picks[0].ent.id };
        else if (picks.length === 2 && isPt(picks[0]) && isPt(picks[1])) c = { type: kind, p: picks[0].pid, q: picks[1].pid };
        break;
      case 'fix':
        if (isPt(picks[0])) c = { type: 'fix', p: picks[0].pid, x: +P[picks[0].pid][0].toFixed(6), y: +P[picks[0].pid][1].toFixed(6) };
        else if (isLine(picks[0])) { const e = picks[0].ent; this.constraints.push({ type: 'fix', p: e.a, x: +P[e.a][0].toFixed(6), y: +P[e.a][1].toFixed(6) }); c = { type: 'fix', p: e.b, x: +P[e.b][0].toFixed(6), y: +P[e.b][1].toFixed(6) }; }
        else if (isCirc(picks[0])) { const e = picks[0].ent; c = { type: 'fix', p: e.c, x: +P[e.c][0].toFixed(6), y: +P[e.c][1].toFixed(6) }; }
        need = 1; break;
      case 'coincident':
        if (picks.length === 2) {
          const [a, b] = picks;
          if (isPt(a) && isPt(b)) c = { type: 'coincident', p: a.pid, q: b.pid };
          else if (isPt(a) && isLine(b)) c = { type: 'pointOnLine', p: a.pid, line: b.ent.id };
          else if (isLine(a) && isPt(b)) c = { type: 'pointOnLine', p: b.pid, line: a.ent.id };
          else if (isPt(a) && isCirc(b)) c = { type: 'pointOnCircle', p: a.pid, circle: b.ent.id };
          else if (isCirc(a) && isPt(b)) c = { type: 'pointOnCircle', p: b.pid, circle: a.ent.id };
        }
        break;
      case 'parallel': case 'perpendicular':
        if (picks.length === 2 && isLine(picks[0]) && isLine(picks[1])) c = { type: kind, l1: picks[0].ent.id, l2: picks[1].ent.id };
        break;
      case 'tangent':
        if (picks.length === 2) { const L = picks.find(isLine), K = picks.find(isCirc); if (L && K) c = { type: 'tangent', line: L.ent.id, circle: K.ent.id }; }
        break;
      case 'equal':
        if (picks.length === 2 && picks[0].ent && picks[1].ent && isLine(picks[0]) === isLine(picks[1])) c = { type: 'equal', l1: picks[0].ent.id, l2: picks[1].ent.id };
        break;
      case 'concentric':
        if (picks.length === 2 && isCirc(picks[0]) && isCirc(picks[1])) c = { type: 'concentric', c1: picks[0].ent.id, c2: picks[1].ent.id };
        break;
      case 'midpoint':
        if (picks.length === 2) { const pt = picks.find(isPt), L = picks.find(isLine); if (pt && L) c = { type: 'midpoint', p: pt.pid, line: L.ent.id }; }
        break;
      case 'symmetric':
        need = 3;
        if (picks.length === 3 && isPt(picks[0]) && isPt(picks[1]) && isLine(picks[2])) c = { type: 'symmetric', p: picks[0].pid, q: picks[1].pid, line: picks[2].ent.id };
        break;
      default: break;
    }
    if (c) { this.constraints.push(c); t.picks = []; await this.commit({ guard: true }); return; }
    if (picks.length >= need) { t.picks = []; toast('Seleção incompatível com essa restrição.', 'warn'); }
    this.toolPrompt = `Restrição ${kind}: selecione a ${picks.length + 1}ª geometria`;
    this.status();
  }

  applyConstructionToSelection() {
    let changed = false;
    for (const e of this.entities) if (this.sel.has(e.id)) { e.construction = this.construction || undefined; changed = true; }
    if (changed) this.commit();
  }

  deleteSelection() {
    if (this.selConstraint !== null && this.selConstraint !== undefined) { this.constraints.splice(this.selConstraint, 1); this.selConstraint = null; this.commit(); return; }
    if (!this.sel.size) { toast('Selecione geometria para excluir.', 'warn'); return; }
    const delEnt = new Set(this.entities.filter((e) => this.sel.has(e.id)).map((e) => e.id));
    const delPts = new Set([...this.sel].filter((id) => this.points[id] && id !== 'O'));
    // entidades que usam pontos excluídos também saem
    for (const e of this.entities) if ([e.a, e.b, e.c, e.p].some((p) => delPts.has(p))) delEnt.add(e.id);
    this.entities = this.entities.filter((e) => !delEnt.has(e.id));
    const used = new Set(this.entities.flatMap((e) => [e.a, e.b, e.c, e.p].filter(Boolean)));
    for (const id of Object.keys(this.points)) if (id !== 'O' && (delPts.has(id) || !used.has(id))) delete this.points[id];
    const alive = (c) => Object.entries(c).every(([k, v]) => !['p', 'q', 'a', 'b', 'line', 'l1', 'l2', 'circle', 'c1', 'c2'].includes(k) || this.points[v] || this.entities.some((e) => e.id === v));
    this.constraints = this.constraints.filter(alive);
    this.sel.clear();
    this.commit();
  }
}

// ---------------------------------------------------------------- geometria 2D
function segDist(q, a, b) {
  const d = [b[0] - a[0], b[1] - a[1]], l2 = d[0] * d[0] + d[1] * d[1] || 1;
  const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / l2));
  return Math.hypot(q[0] - a[0] - t * d[0], q[1] - a[1] - t * d[1]);
}
function distToLine(q, a, b) { const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1; return Math.abs((d[0] * (q[1] - a[1]) - d[1] * (q[0] - a[0])) / l); }
function onArc(q, c, a, b) {
  const ang = (p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  let t0 = ang(a), t1 = ang(b), t = ang(q);
  if (t1 <= t0) t1 += 2 * Math.PI;
  if (t < t0) t += 2 * Math.PI;
  return t <= t1;
}
function dirOf(P, e) { const a = P[e.a], b = P[e.b], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; }
function circlePts(c, r, n = 64) { return Array.from({ length: n + 1 }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]); }
/** Arco por três pontos (início, fim, ponto do arco) → centro e sentido. */
function arc3(a, b, m) {
  const d = 2 * (a[0] * (b[1] - m[1]) + b[0] * (m[1] - a[1]) + m[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const s = (p) => p[0] * p[0] + p[1] * p[1];
  const c = [(s(a) * (b[1] - m[1]) + s(b) * (m[1] - a[1]) + s(m) * (a[1] - b[1])) / d, (s(a) * (m[0] - b[0]) + s(b) * (a[0] - m[0]) + s(m) * (b[0] - a[0])) / d];
  const ccw = onArc(m, c, a, b);
  const [p0, p1] = ccw ? [a, b] : [b, a];
  const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const t0 = Math.atan2(p0[1] - c[1], p0[0] - c[0]); let t1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  if (t1 <= t0) t1 += 2 * Math.PI;
  const pts = Array.from({ length: 49 }, (_, i) => { const t = t0 + ((t1 - t0) * i) / 48; return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]; });
  return { c, ccw, pts };
}
function slotPts(a, b, w) {
  const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1, n = [-d[1] / l, d[0] / l];
  const ang = Math.atan2(d[1], d[0]);
  const out = [];
  for (let i = 0; i <= 24; i++) { const t = ang - Math.PI / 2 + (Math.PI * i) / 24; out.push([b[0] + w * Math.cos(t), b[1] + w * Math.sin(t)]); }
  for (let i = 0; i <= 24; i++) { const t = ang + Math.PI / 2 + (Math.PI * i) / 24; out.push([a[0] + w * Math.cos(t), a[1] + w * Math.sin(t)]); }
  out.push(out[0]);
  void n;
  return out;
}
