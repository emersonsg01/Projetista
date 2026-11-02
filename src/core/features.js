// Features paramétricas sobre o kernel B-rep exato (OpenCascade).
// Cada feature é JSON puro, reavaliada em ordem na linha do tempo.
import fs from 'node:fs';
import { v3, axisVec, frameMatrix, planeFrame, planeMatrix, applyMat } from './kernel.js';
import { solveSketch } from './sketch.js';
import { MATERIALS } from './materials.js';
import { readMeshFile } from './io.js';
import * as occ from '../occ/occ.js';
import { Solid } from '../occ/body.js';
import { selectFaces, selectEdges } from '../occ/select.js';

// ---------------------------------------------------------------- utilidades
export function mul4(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

// Tabela ISO métrica: [Ø broca p/ rosca, passagem média ISO 273, Ø rebaixo ISO 4762, prof. rebaixo, passo grosso]
const ISO = {
  M2: [1.6, 2.4, 4.4, 2.2, 0.4], 'M2.5': [2.05, 2.9, 5.5, 2.7, 0.45], M3: [2.5, 3.4, 6.5, 3.4, 0.5], M4: [3.3, 4.5, 8, 4.4, 0.7],
  M5: [4.2, 5.5, 10, 5.4, 0.8], M6: [5.0, 6.6, 11, 6.4, 1.0], M8: [6.8, 9.0, 15, 8.6, 1.25], M10: [8.5, 11, 18, 10.6, 1.5],
  M12: [10.2, 13.5, 20, 12.6, 1.75], M16: [14, 17.5, 26, 16.6, 2.0], M20: [17.5, 22, 33, 20.6, 2.5], M24: [21, 26, 40, 24.8, 3.0],
};
export const ISO_THREADS = ISO;

function bodyOf(ctx, name) {
  const b = ctx.bodies.get(name);
  if (!b) throw new Error(`Corpo '${name}' não existe (corpos: ${[...ctx.bodies.keys()].join(', ') || 'nenhum'})`);
  return b;
}
const dirOf = (ctx, d, def) => axisVec(Array.isArray(d) ? ctx.vec(d) : d || def);

function bigSize(ctx) {
  let d = 100;
  for (const b of ctx.bodies.values()) {
    const bb = b.m.boundingBox();
    d = Math.max(d, v3.len(v3.sub(bb.max, bb.min)) + v3.len(bb.max) + v3.len(bb.min));
  }
  return d * 2;
}

function setShape(b, shape, f) {
  b.m = Solid.of(occ.clean(shape));
  b.feature = f.name;
}

/** Aplica o resultado de uma feature sólida: novo corpo ou operação sobre um alvo. */
function output(ctx, f, tool) {
  const op = f.operation || 'new';
  if (op === 'new') {
    const name = f.body || ctx.autoName('Corpo');
    if (ctx.bodies.has(name) && !f.replace) throw new Error(`Corpo '${name}' já existe — use operation "join"/"cut"/"intersect" com target, ou outro nome`);
    const mat = f.material || ctx.doc.defaultMaterial;
    ctx.bodies.set(name, { m: Solid.of(tool), color: f.color || MATERIALS[mat]?.color || ctx.nextColor(), material: mat, feature: f.name });
    return name;
  }
  const tname = f.target || f.body;
  if (!tname) throw new Error(`Operação "${op}" requer 'target' (corpo alvo)`);
  const t = bodyOf(ctx, tname);
  const r = op === 'join' ? occ.fuse(t.m.shape, tool) : op === 'cut' ? occ.cut(t.m.shape, tool) : op === 'intersect' ? occ.common(t.m.shape, tool) : null;
  if (!r) throw new Error(`Operação desconhecida: ${op}`);
  setShape(t, r, f);
  if (t.m.isEmpty()) ctx.warn(`O corpo '${tname}' ficou vazio após "${op}"`);
  return tname;
}

// ---------------------------------------------------------------- perfis de esboço → faces exatas
function loopWire(loop, M) {
  const W = (p) => applyMat(M, [p[0], p[1], 0]);
  const n = [M[8], M[9], M[10]];
  const edges = loop.map((s) => {
    if (s.type === 'circle') return occ.circleEdge(W(s.c), n, s.r);
    if (s.type === 'arc') return occ.arcEdge(W(s.a), W(s.m), W(s.b));
    return occ.lineEdge(W(s.a), W(s.b));
  });
  return occ.wire(edges);
}
const polyArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };
function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Faces planas do esboço, com furos resolvidos por aninhamento (par/ímpar). */
function sketchFaces(ctx, name) {
  const s = ctx.sketches.get(name);
  if (!s) throw new Error(`Esboço '${name}' não existe`);
  const { loops, exactLoops, openChains } = s.solved;
  if (!loops.length) throw new Error(`Esboço '${name}' não tem perfis fechados${openChains.length ? ` (${openChains.length} cadeia(s) aberta(s))` : ''}`);
  const info = loops.map((poly, i) => ({ i, poly, area: Math.abs(polyArea(poly)), probe: centroidInside(poly) }));
  for (const a of info) a.parents = info.filter((b) => b !== a && b.area > a.area && inside(a.probe, b.poly));
  const faces = [];
  for (const a of info) {
    if (a.parents.length % 2) continue; // é furo
    let f = occ.faceFromWires(loopWire(exactLoops[a.i], s.matrix));
    const holes = info.filter((h) => h.parents.length === a.parents.length + 1 && h.parents.includes(a));
    if (holes.length) f = firstFace(occ.cut(f, holes.map((h) => occ.faceFromWires(loopWire(exactLoops[h.i], s.matrix)))));
    faces.push(f);
  }
  return { s, faces };
}
function centroidInside(poly) {
  // ponto interior robusto: centro de uma pequena aresta deslocado para dentro
  const a = polyArea(poly) > 0 ? 1 : -1;
  const [p, q] = [poly[0], poly[1 % poly.length]];
  const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const t = [q[0] - p[0], q[1] - p[1]], l = Math.hypot(...t) || 1;
  return [m[0] - (a * t[1] / l) * 1e-4, m[1] + (a * t[0] / l) * 1e-4];
}
function firstFace(shape) { return occ.unique(shape, 'FACE')[0] || shape; }

/** Faces resultantes de offset 2D exato (cantos com arco). */
function offsetFaces(face, d) {
  const sh = occ.offsetWire(face, d, 'Arc');
  const wires = occ.unique(sh, 'WIRE');
  if (!wires.length) throw new Error('Offset 2D eliminou o perfil (valor grande demais)');
  const fs_ = wires.map((w) => occ.faceFromWires(w)).sort((a, b) => occ.faceArea(b) - occ.faceArea(a));
  return fs_.length > 1 ? firstFace(occ.cut(fs_[0], fs_.slice(1))) : fs_[0];
}

function placeMatrix(f, ctx) { return frameMatrix(ctx.vec(f.at || [0, 0, 0]), dirOf(ctx, f.axis, 'z')); }

/** Spine 3D com curvas de dobra (raio) nos cantos — tubulação real. */
function spineWire(pts, bend) {
  if (pts.length === 2 || !bend) return occ.polygonWire(pts, false);
  const edges = [];
  let cur = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], u = v3.norm(v3.sub(p, pts[i - 1])), w = v3.norm(v3.sub(pts[i + 1], p));
    const th = Math.acos(Math.max(-1, Math.min(1, v3.dot(u, w))));
    if (th < 1e-6) continue;
    const t = bend * Math.tan(th / 2);
    const A = v3.sub(p, v3.mul(u, t)), B = v3.add(p, v3.mul(w, t));
    const phi = (Math.PI - th) / 2;
    const M = v3.add(p, v3.mul(v3.norm(v3.sub(w, u)), bend / Math.sin(phi) - bend));
    if (v3.len(v3.sub(A, cur)) > 1e-9) edges.push(occ.lineEdge(cur, A));
    edges.push(occ.arcEdge(A, M, B));
    cur = B;
  }
  edges.push(occ.lineEdge(cur, pts.at(-1)));
  return occ.wire(edges);
}

// ---------------------------------------------------------------- features
export const FEATURES = {
  // ======== primitivas
  box: {
    label: 'Caixa',
    apply(f, ctx) {
      const w = ctx.num(f.width), d = ctx.num(f.depth ?? f.width), h = ctx.num(f.height ?? f.width);
      const at = ctx.vec(f.at || [0, 0, 0]);
      const z0 = f.centered ? at[2] - h / 2 : at[2];
      let s = occ.box([at[0] - w / 2, at[1] - d / 2, z0], [at[0] + w / 2, at[1] + d / 2, z0 + h]);
      if (f.fillet) s = occ.fillet(s, occ.unique(s, 'EDGE'), ctx.num(f.fillet));
      if (f.chamfer) s = occ.chamfer(s, occ.unique(s, 'EDGE'), ctx.num(f.chamfer));
      return output(ctx, f, s);
    },
  },
  cylinder: {
    label: 'Cilindro',
    apply(f, ctx) {
      const r = f.radius !== undefined ? ctx.num(f.radius) : ctx.num(f.diameter) / 2;
      const h = ctx.num(f.height), dir = dirOf(ctx, f.axis, 'z');
      let o = ctx.vec(f.at || [0, 0, 0]);
      if (f.centered) o = v3.sub(o, v3.mul(dir, h / 2));
      return output(ctx, f, occ.cylinder(o, dir, r, h));
    },
  },
  cone: {
    label: 'Cone',
    apply(f, ctx) {
      const h = ctx.num(f.height), dir = dirOf(ctx, f.axis, 'z');
      let o = ctx.vec(f.at || [0, 0, 0]);
      if (f.centered) o = v3.sub(o, v3.mul(dir, h / 2));
      return output(ctx, f, occ.cone(o, dir, ctx.num(f.radius1), ctx.num(f.radius2 ?? 0), h));
    },
  },
  sphere: {
    label: 'Esfera',
    apply(f, ctx) {
      const r = f.radius !== undefined ? ctx.num(f.radius) : ctx.num(f.diameter) / 2;
      return output(ctx, f, occ.sphere(ctx.vec(f.at || [0, 0, 0]), r));
    },
  },
  torus: {
    label: 'Toro',
    apply(f, ctx) { return output(ctx, f, occ.torus(ctx.vec(f.at || [0, 0, 0]), dirOf(ctx, f.axis, 'z'), ctx.num(f.majorRadius), ctx.num(f.minorRadius))); },
  },

  // ======== esboço
  sketch: {
    label: 'Esboço',
    apply(f, ctx) {
      let frame;
      if (f.plane && f.plane.face) {
        const sel = f.plane.face;
        const face = selectFaces(bodyOf(ctx, sel.body).m, sel, ctx.ev)[0];
        if (face.type !== 'Plane') throw new Error('Esboço só pode ser criado em face plana');
        frame = { origin: v3.mul(face.normal, face.offset), normal: face.normal, xDir: f.plane.xDir };
      } else frame = planeFrame(f.plane);
      if (f.offset) frame = { ...frame, origin: v3.add(frame.origin, v3.mul(frame.normal, ctx.num(f.offset))) };
      const solved = solveSketch({ ...f, segments: 72 }, ctx.ev);
      if (!solved.solved) ctx.warn(`Esboço '${f.name}': restrições não satisfeitas (${solved.status}, resíduo ${solved.residual.toExponential(2)})`);
      ctx.sketches.set(f.name, { solved, frame, matrix: planeMatrix(frame) });
      return { dof: solved.dof, status: solved.status, profiles: solved.loops.length };
    },
  },

  // ======== features baseadas em esboço
  extrude: {
    label: 'Extrusão',
    apply(f, ctx) {
      const { s, faces: base } = sketchFaces(ctx, f.sketch);
      const n = [s.matrix[8], s.matrix[9], s.matrix[10]];
      const through = f.distance === 'through' || f.distance === 'all';
      let d = through ? bigSize(ctx) : ctx.num(f.distance);
      let dir = f.direction || (through ? 'symmetric' : 'normal');
      if (d < 0) { d = -d; dir = dir === 'normal' ? 'reverse' : dir; }
      let faces = base;
      if (f.cornerRadius) {
        const r = ctx.num(f.cornerRadius);
        faces = faces.map((fc) => offsetFaces(offsetFaces(offsetFaces(offsetFaces(fc, -r), r), r), -r));
      }
      if (f.offset2D) faces = faces.map((fc) => offsetFaces(fc, ctx.num(f.offset2D)));
      if (f.thinWall) faces = faces.map((fc) => firstFace(occ.cut(fc, offsetFaces(fc, -ctx.num(f.thinWall)))));
      const taper = f.taper ? ctx.num(f.taper) : 0;
      const solids = [];
      for (const fc of faces) {
        let solid;
        if (taper) {
          // ângulo de saída verdadeiro: loft regrado entre o perfil e seu offset 2D exato
          const top = offsetFaces(fc, -d * Math.tan((taper * Math.PI) / 180));
          const topT = occ.translate(top, v3.mul(n, d));
          const outerA = occ.unique(fc, 'WIRE'), outerB = occ.unique(topT, 'WIRE');
          if (outerA.length !== outerB.length) throw new Error('Afunilamento mudou a topologia do perfil — reduza o ângulo');
          solid = occ.loft([outerA[0], outerB[0]], { ruled: true });
          for (let k = 1; k < outerA.length; k++) solid = occ.cut(solid, occ.loft([outerA[k], outerB[k]], { ruled: true }));
        } else if (f.twist) {
          const tw = ctx.num(f.twist), steps = Math.max(2, Math.ceil(Math.abs(tw) / 15));
          const c = applyMat(s.matrix, [0, 0, 0]);
          const wires = [];
          for (let k = 0; k <= steps; k++) wires.push(occ.unique(occ.rotate(occ.translate(fc, v3.mul(n, (d * k) / steps)), c, n, (tw * k) / steps), 'WIRE')[0]);
          solid = occ.loft(wires, { ruled: false });
        } else solid = occ.prism(fc, v3.mul(n, d));
        if (dir === 'reverse') solid = occ.translate(solid, v3.mul(n, -d));
        else if (dir === 'symmetric') solid = occ.translate(solid, v3.mul(n, -d / 2));
        else if (dir === 'two-sides') solid = occ.fuse(solid, occ.prism(fc, v3.mul(n, -ctx.num(f.distance2))));
        if (f.startOffset) solid = occ.translate(solid, v3.mul(n, ctx.num(f.startOffset)));
        solids.push(solid);
      }
      return output(ctx, f, occ.fuseAll(solids));
    },
  },
  revolve: {
    label: 'Revolução',
    apply(f, ctx) {
      const { s, faces } = sketchFaces(ctx, f.sketch);
      const axis = (f.axis || 'y').toLowerCase();
      const o = applyMat(s.matrix, [0, 0, 0]);
      const ad = axis === 'x' ? [s.matrix[0], s.matrix[1], s.matrix[2]] : [s.matrix[4], s.matrix[5], s.matrix[6]];
      const ang = f.angle !== undefined ? ctx.num(f.angle) : 360;
      const solids = faces.map((fc) => occ.revol(fc, o, ad, ang));
      return output(ctx, f, occ.fuseAll(solids));
    },
  },
  loft: {
    label: 'Loft',
    apply(f, ctx) {
      const wires = f.sections.map((name) => { const { faces } = sketchFaces(ctx, name); return occ.unique(faces[0], 'WIRE')[0]; });
      return output(ctx, f, occ.loft(wires, { ruled: !!f.ruled }));
    },
  },
  sweep: {
    label: 'Varredura',
    apply(f, ctx) {
      // perfil (esboço) varrido ao longo de um caminho 3D com dobras de raio opcional
      const { faces } = sketchFaces(ctx, f.profile);
      const spine = spineWire(f.path.map((p) => ctx.vec(p)), f.bendRadius ? ctx.num(f.bendRadius) : 0);
      return output(ctx, f, occ.fuseAll(faces.map((fc) => occ.pipe(spine, fc))));
    },
  },
  pipe: {
    label: 'Tubo',
    apply(f, ctx) {
      const path = f.path.map((p) => ctx.vec(p));
      const r = f.radius !== undefined ? ctx.num(f.radius) : ctx.num(f.diameter) / 2;
      const bend = f.bendRadius !== undefined ? ctx.num(f.bendRadius) : 2 * r;
      const spine = spineWire(path, bend);
      const d0 = v3.norm(v3.sub(path[1], path[0]));
      const prof = (rad) => occ.faceFromWires(occ.wire([occ.circleEdge(path[0], d0, rad)]));
      let solid = occ.pipe(spine, prof(r));
      if (f.wall !== undefined || f.innerRadius !== undefined) {
        const ri = f.innerRadius !== undefined ? ctx.num(f.innerRadius) : r - ctx.num(f.wall);
        if (ri <= 0) throw new Error('Parede maior que o raio');
        solid = occ.cut(solid, occ.pipe(spine, prof(ri)));
      }
      return output(ctx, f, solid);
    },
  },

  // ======== furos (assistente de furos)
  hole: {
    label: 'Furo',
    apply(f, ctx) {
      const iso = f.size ? ISO[f.size] : null;
      if (f.size && !iso) throw new Error(`Rosca '${f.size}' fora da tabela ISO (${Object.keys(ISO).join(', ')})`);
      const type = f.holeType || 'simple';
      const dia = f.diameter !== undefined ? ctx.num(f.diameter) : iso ? (f.fit === 'tap' || f.threaded ? iso[0] : iso[1]) : 5;
      const through = f.depth === undefined || f.depth === 'through';
      const depth = through ? bigSize(ctx) : ctx.num(f.depth);
      const e = 0.05;
      const parts = [occ.cylinder([0, 0, -e], [0, 0, 1], dia / 2, depth + e)];
      if (!through && f.tipAngle !== 0) {
        const tip = (dia / 2) / Math.tan(((f.tipAngle ?? 118) * Math.PI) / 360);
        parts.push(occ.cone([0, 0, depth], [0, 0, 1], dia / 2, 0, tip));
      }
      if (type === 'counterbore') {
        const cd = f.cbDiameter !== undefined ? ctx.num(f.cbDiameter) : iso ? iso[2] : dia * 1.8;
        const ch = f.cbDepth !== undefined ? ctx.num(f.cbDepth) : iso ? iso[3] : dia;
        parts.push(occ.cylinder([0, 0, -e], [0, 0, 1], cd / 2, ch + e));
      } else if (type === 'countersink') {
        const cd = f.csDiameter !== undefined ? ctx.num(f.csDiameter) : iso ? iso[1] * 2 : dia * 2;
        const ang = f.csAngle !== undefined ? ctx.num(f.csAngle) : 90;
        const hgt = (cd / 2 - dia / 2) / Math.tan((ang * Math.PI) / 360);
        const k = Math.tan((ang * Math.PI) / 360);
        parts.push(occ.cone([0, 0, -e], [0, 0, 1], cd / 2 + e * k, dia / 2, hgt + e));
      }
      const tool = occ.fuseAll(parts);
      const positions = f.positions || [f.at || [0, 0, 0]];
      const dir = dirOf(ctx, f.direction, '-z');
      const tools = positions.map((p) => occ.place(tool, frameMatrix(ctx.vec(p), dir)));
      return output(ctx, { ...f, operation: 'cut' }, occ.compound(tools));
    },
  },

  // ======== acabamento de arestas e faces (exato)
  fillet: {
    label: 'Filete',
    apply(f, ctx) {
      const b = bodyOf(ctx, f.body);
      const edges = selectEdges(b.m, f.edges ?? 'all', ctx.ev);
      setShape(b, occ.fillet(b.m.shape, edges.map((e) => e.edge), ctx.num(f.radius)), f);
      return { body: f.body, edges: edges.length };
    },
  },
  chamfer: {
    label: 'Chanfro',
    apply(f, ctx) {
      const b = bodyOf(ctx, f.body);
      const edges = selectEdges(b.m, f.edges ?? 'all', ctx.ev);
      const d2 = f.distance2 !== undefined ? ctx.num(f.distance2) : undefined;
      setShape(b, occ.chamfer(b.m.shape, edges.map((e) => e.edge), ctx.num(f.distance), d2), f);
      return { body: f.body, edges: edges.length };
    },
  },
  draft: {
    label: 'Ângulo de saída',
    apply(f, ctx) {
      // inclinação de faces para desmoldagem (injeção/fundição)
      const b = bodyOf(ctx, f.body);
      const pull = dirOf(ctx, f.pull, 'z');
      const faces = f.faces ? selectFaces(b.m, f.faces, ctx.ev) : selectFaces(b.m, { type: 'plane', all: true }, ctx.ev).filter((x) => Math.abs(v3.dot(x.normal, pull)) < 1e-6);
      setShape(b, occ.draft(b.m.shape, faces.map((x) => x.face), pull, ctx.num(f.angle), ctx.vec(f.neutral || [0, 0, 0])), f);
      return { body: f.body, faces: faces.length };
    },
  },
  shell: {
    label: 'Casca',
    apply(f, ctx) {
      const b = bodyOf(ctx, f.body);
      const open = (f.openFaces || []).flatMap((s) => selectFaces(b.m, typeof s === 'string' ? { normal: s } : s, ctx.ev).map((x) => x.face));
      const r = occ.thickSolid(b.m.shape, open, ctx.num(f.thickness));
      if (!occ.isValid(r) || occ.massProps(r).volume <= 0) throw new Error('Casca gerou sólido inválido (combinação de filetes/furos nas faces abertas). Tente aplicar a casca antes dos filetes.');
      setShape(b, r, f);
      return f.body;
    },
  },
  round_edges: {
    label: 'Arredondar todas as arestas',
    apply(f, ctx) { return FEATURES.fillet.apply({ ...f, edges: 'all' }, ctx); },
  },
  offset_body: {
    label: 'Offset 3D',
    apply(f, ctx) {
      const b = bodyOf(ctx, f.body);
      const s = occ.offsetShape(b.m.shape, ctx.num(f.distance));
      if (f.copy) ctx.bodies.set(f.copy, { ...b, m: Solid.of(s), color: ctx.nextColor(), feature: f.name });
      else setShape(b, s, f);
      return f.copy || f.body;
    },
  },
  push_pull: {
    label: 'Empurrar/Puxar',
    apply(f, ctx) {
      // estilo SketchUp: a face selecionada é extrudada exatamente ao longo da normal
      const b = bodyOf(ctx, f.body);
      const face = selectFaces(b.m, f.face || { normal: '+z' }, ctx.ev)[0];
      if (face.type !== 'Plane') throw new Error('Empurrar/Puxar exige face plana');
      const d = ctx.num(f.distance);
      const tool = occ.prism(face.face, v3.mul(face.normal, d));
      setShape(b, d >= 0 ? occ.fuse(b.m.shape, tool) : occ.cut(b.m.shape, tool), f);
      return f.body;
    },
  },

  // ======== operações sobre corpos
  boolean: {
    label: 'Booleana',
    apply(f, ctx) {
      const tools = f.tools.map((t) => bodyOf(ctx, t).m.shape);
      const r = output(ctx, { ...f, operation: f.operation || 'join' }, tools.length === 1 ? tools[0] : occ.compound(tools));
      if (!f.keepTools) for (const t of f.tools) ctx.bodies.delete(t);
      return r;
    },
  },
  transform: {
    label: 'Mover/Girar',
    apply(f, ctx) {
      const b = bodyOf(ctx, f.body);
      let s = b.m.shape;
      const c = f.center ? ctx.vec(f.center) : [0, 0, 0];
      if (f.scale !== undefined) {
        if (Array.isArray(f.scale)) throw new Error('Escala não uniforme não é suportada no B-rep exato');
        s = occ.scale(s, c, ctx.num(f.scale));
      }
      if (f.rotate) {
        const r = ctx.vec(f.rotate);
        if (r[0]) s = occ.rotate(s, c, [1, 0, 0], r[0]);
        if (r[1]) s = occ.rotate(s, c, [0, 1, 0], r[1]);
        if (r[2]) s = occ.rotate(s, c, [0, 0, 1], r[2]);
      }
      if (f.rotateAxis) s = occ.rotate(s, c, dirOf(ctx, f.rotateAxis.axis, 'z'), ctx.num(f.rotateAxis.angle));
      if (f.translate) s = occ.translate(s, ctx.vec(f.translate));
      if (f.copy) ctx.bodies.set(f.copy, { ...b, m: Solid.of(s), feature: f.name });
      else { b.m = Solid.of(s); b.feature = f.name; }
      return f.copy || f.body;
    },
  },
  mirror: {
    label: 'Espelhar',
    apply(f, ctx) {
      const b = bodyOf(ctx, f.body);
      const n = dirOf(ctx, f.normal, 'x');
      const m = occ.mirror(b.m.shape, v3.mul(n, f.offset ? ctx.num(f.offset) : 0), n);
      if (f.copy) ctx.bodies.set(f.copy, { ...b, m: Solid.of(m), feature: f.name });
      else setShape(b, occ.fuse(b.m.shape, m), f);
      return f.copy || f.body;
    },
  },
  pattern_linear: {
    label: 'Padrão retangular',
    apply(f, ctx) {
      const b = bodyOf(ctx, f.body);
      const d1 = dirOf(ctx, f.direction, 'x'), n1 = Math.round(ctx.num(f.count)), s1 = ctx.num(f.spacing);
      const d2 = f.direction2 ? dirOf(ctx, f.direction2) : null, n2 = f.count2 ? Math.round(ctx.num(f.count2)) : 1, s2 = f.spacing2 ? ctx.num(f.spacing2) : 0;
      const copies = [];
      for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
        if (f.skip?.some(([a, c]) => a === i && c === (j || 0))) continue;
        const t = v3.add(v3.mul(d1, i * s1), d2 ? v3.mul(d2, j * s2) : [0, 0, 0]);
        copies.push(i || j ? occ.translate(b.m.shape, t) : b.m.shape);
      }
      const s = occ.fuseAll(copies);
      if (f.copy) ctx.bodies.set(f.copy, { ...b, m: Solid.of(s), feature: f.name }); else setShape(b, s, f);
      return f.copy || f.body;
    },
  },
  pattern_circular: {
    label: 'Padrão circular',
    apply(f, ctx) {
      const b = bodyOf(ctx, f.body);
      const n = Math.round(ctx.num(f.count)), total = f.angle !== undefined ? ctx.num(f.angle) : 360;
      const step = Math.abs(total - 360) < 1e-9 ? total / n : total / Math.max(1, n - 1);
      const c = ctx.vec(f.center || [0, 0, 0]), ax = dirOf(ctx, f.axis, 'z');
      const copies = [];
      for (let i = 0; i < n; i++) copies.push(i ? occ.rotate(b.m.shape, c, ax, i * step) : b.m.shape);
      const s = occ.fuseAll(copies);
      if (f.copy) ctx.bodies.set(f.copy, { ...b, m: Solid.of(s), feature: f.name }); else setShape(b, s, f);
      return f.copy || f.body;
    },
  },
  split: {
    label: 'Dividir corpo',
    apply(f, ctx) {
      const b = bodyOf(ctx, f.body);
      const n = dirOf(ctx, f.normal, 'z'), off = f.offset ? ctx.num(f.offset) : 0;
      const o = v3.mul(n, off);
      const pos = occ.common(b.m.shape, occ.halfSpace(o, n));
      const neg = occ.common(b.m.shape, occ.halfSpace(o, v3.mul(n, -1)));
      const keep = f.keep || 'both';
      if (keep === 'positive') setShape(b, pos, f);
      else if (keep === 'negative') setShape(b, neg, f);
      else { setShape(b, pos, f); ctx.bodies.set(f.otherBody || `${f.body}_b`, { ...b, m: Solid.of(neg), color: ctx.nextColor(), feature: f.name }); }
      return f.body;
    },
  },
  mate: {
    label: 'Junta de montagem',
    apply(f, ctx) {
      // face-com-face: gira e move o corpo para encostar (com folga), como mates/juntas
      const mov = bodyOf(ctx, f.body);
      const fa = selectFaces(mov.m, f.face || { normal: '-z' }, ctx.ev)[0];
      const fb = selectFaces(bodyOf(ctx, f.to.body).m, f.to, ctx.ev)[0];
      if (fa.type !== 'Plane' || fb.type !== 'Plane') throw new Error('Junta exige faces planas');
      const target = v3.mul(fb.normal, -1);
      let s = mov.m.shape, ca = fa.centroid;
      const c = v3.dot(fa.normal, target);
      if (c < 1 - 1e-12) {
        let axis = v3.cross(fa.normal, target);
        if (v3.len(axis) < 1e-9) axis = Math.abs(fa.normal[0]) < 0.9 ? v3.cross(fa.normal, [1, 0, 0]) : v3.cross(fa.normal, [0, 1, 0]);
        const ang = (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
        s = occ.rotate(s, ca, v3.norm(axis), ang);
      }
      if (f.angle) s = occ.rotate(s, ca, fb.normal, ctx.num(f.angle));
      const gap = f.offset ? ctx.num(f.offset) : 0;
      let dest = v3.add(fb.centroid, v3.mul(fb.normal, gap));
      if (f.align === 'plane') dest = v3.add(ca, v3.mul(fb.normal, v3.dot(v3.sub(dest, ca), fb.normal)));
      s = occ.translate(s, v3.add(v3.sub(dest, ca), f.shift ? ctx.vec(f.shift) : [0, 0, 0]));
      mov.m = Solid.of(s); mov.feature = f.name;
      return f.body;
    },
  },
  import_step: {
    label: 'Importar STEP',
    apply(f, ctx) {
      let s = occ.readSTEP(fs.readFileSync(f.file));
      if (f.scale) s = occ.scale(s, [0, 0, 0], ctx.num(f.scale));
      if (f.at) s = occ.translate(s, ctx.vec(f.at));
      return output(ctx, f, s);
    },
  },
  import_mesh: {
    label: 'Importar malha',
    apply(f, ctx) {
      // costura os triângulos num sólido B-rep (faces planas)
      const { positions: p, indices: t } = readMeshFile(f.file);
      if (t.length / 3 > 60000) throw new Error(`Malha muito densa para converter em B-rep (${t.length / 3} triângulos; limite 60k)`);
      const P = (i) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
      const faces = [];
      for (let k = 0; k < t.length; k += 3) {
        try { faces.push(occ.faceFromWires(occ.polygonWire([P(t[k]), P(t[k + 1]), P(t[k + 2])]))); } catch { /* triângulo degenerado */ }
      }
      let s = occ.sew(faces);
      if (f.scale) s = occ.scale(s, [0, 0, 0], ctx.num(f.scale));
      if (f.at) s = occ.translate(s, ctx.vec(f.at));
      return output(ctx, f, s);
    },
  },
  appearance: {
    label: 'Aparência/Material',
    apply(f, ctx) {
      const b = bodyOf(ctx, f.body);
      if (f.material) {
        if (!MATERIALS[f.material]) throw new Error(`Material desconhecido: ${f.material}`);
        b.material = f.material;
        if (!f.color) b.color = MATERIALS[f.material].color;
      }
      if (f.color) b.color = f.color;
      return f.body;
    },
  },
  delete_body: { label: 'Remover corpo', apply(f, ctx) { bodyOf(ctx, f.body); ctx.bodies.delete(f.body); return f.body; } },
  rename_body: { label: 'Renomear corpo', apply(f, ctx) { const b = bodyOf(ctx, f.body); ctx.bodies.delete(f.body); ctx.bodies.set(f.to, b); return f.to; } },
};

export const FEATURE_PREFIX = {
  box: 'Caixa', cylinder: 'Cilindro', cone: 'Cone', sphere: 'Esfera', torus: 'Toro', sketch: 'Esboço', extrude: 'Extrusão',
  revolve: 'Revolução', loft: 'Loft', sweep: 'Varredura', pipe: 'Tubo', hole: 'Furo', fillet: 'Filete', chamfer: 'Chanfro',
  draft: 'Saída', boolean: 'Booleana', transform: 'Mover', mirror: 'Espelho', pattern_linear: 'PadrãoRet', pattern_circular: 'PadrãoCirc',
  split: 'Divisão', shell: 'Casca', round_edges: 'Filete', offset_body: 'Offset', push_pull: 'PushPull', mate: 'Junta',
  import_step: 'STEP', import_mesh: 'Importação', appearance: 'Aparência', delete_body: 'Remover', rename_body: 'Renomear',
};
