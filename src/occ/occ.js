// Kernel B-rep exato (OpenCascade 7.x compilado para WASM com pthreads).
// Geometria analítica em dupla precisão: planos, cilindros, cones, toros, NURBS.
// Tolerância de modelagem: 1e-7 mm (Precision::Confusion do OCCT).
import { createRequire } from 'node:module';
import os from 'node:os';

const require = createRequire(import.meta.url);
let oc = null;
export const TOL = 1e-7;

export async function initOCC({ threads = true } = {}) {
  if (oc) return oc;
  const pkg = threads ? 'replicad-opencascadejs/multi' : 'replicad-opencascadejs';
  const wasm = require.resolve(threads ? 'replicad-opencascadejs/multi/wasm' : 'replicad-opencascadejs/wasm');
  const init = (await import(pkg)).default;
  oc = await init({ locateFile: (f) => (f.endsWith('.wasm') ? wasm : f) });
  oc.__threads = threads ? os.availableParallelism() : 1;
  return oc;
}
export const OC = () => { if (!oc) throw new Error('OpenCascade não inicializado'); return oc; };

// ------------------------------------------------------------------ arena
let arena = null;
/** Objetos criados durante um passo da regeneração são liberados juntos. */
export function withArena(a, fn) { const prev = arena; arena = a; try { return fn(); } finally { arena = prev; } }
const T = (o) => { if (arena && o && typeof o.delete === 'function') arena.t(o); return o; };

// ------------------------------------------------------------------ construtores básicos
export const P = (p) => T(new oc.gp_Pnt(p[0], p[1], p[2]));
export const D = (d) => T(new oc.gp_Dir(d[0], d[1], d[2]));
export const V = (v) => T(new oc.gp_Vec(v[0], v[1], v[2]));
export const Ax1 = (o, d) => T(new oc.gp_Ax1(P(o), D(d)));
export const Ax2 = (o, z, x) => T(x ? new oc.gp_Ax2(P(o), D(z), D(x)) : new oc.gp_Ax2(P(o), D(z)));
const progress = () => T(new oc.Message_ProgressRange());
const xyz = (p) => [p.X(), p.Y(), p.Z()];

export function list(shapes) {
  const l = T(new oc.NCollection_List_TopoDS_Shape());
  for (const s of shapes) l.Append(s);
  return l;
}

export function compound(shapes) {
  const b = T(new oc.TopoDS_Builder());
  const c = T(new oc.TopoDS_Compound());
  b.MakeCompound(c);
  for (const s of shapes) b.Add(c, s);
  return c;
}

export function* explore(shape, type) {
  const ex = T(new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum[`TopAbs_${type}`]));
  for (; ex.More(); ex.Next()) yield ex.Current();
}

/** Sub-formas únicas (o explorador repete arestas compartilhadas entre faces). */
export function unique(shape, type) {
  const cast = { FACE: 'Face', EDGE: 'Edge', VERTEX: 'Vertex', SOLID: 'Solid', WIRE: 'Wire', SHELL: 'Shell' }[type];
  const out = [];
  const buckets = new Map();
  for (const s of explore(shape, type)) {
    const k = type === 'EDGE' ? edgeKey(oc.TopoDS.Edge(s)) : type === 'VERTEX' ? xyz(oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(s))).map((x) => x.toFixed(5)).join() : null;
    if (k) {
      const b = buckets.get(k) || [];
      if (b.some((o) => o.IsSame(s))) continue;
      b.push(s); buckets.set(k, b);
    } else if (out.some((o) => o.IsSame(s))) continue;
    out.push(T(oc.TopoDS[cast](s)));
  }
  return out;
}
function edgeKey(e) {
  const c = T(new oc.BRepAdaptor_Curve(e));
  const m = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
  return [m.X(), m.Y(), m.Z()].map((x) => x.toFixed(4)).join();
}

// ------------------------------------------------------------------ transformações
export function trsfFromMatrix(m) {
  // m: 4x4 coluna-major (só rotação + translação; escala uniforme tratada à parte)
  const t = T(new oc.gp_Trsf());
  t.SetValues(m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]);
  return t;
}
export function transform(shape, trsf) { return T(T(new oc.BRepBuilderAPI_Transform(shape, trsf, true, false)).Shape()); }
export function translate(shape, v) { const t = T(new oc.gp_Trsf()); t.SetTranslation(V(v)); return transform(shape, t); }
export function rotate(shape, center, axis, deg) { const t = T(new oc.gp_Trsf()); t.SetRotation(Ax1(center, axis), (deg * Math.PI) / 180); return transform(shape, t); }
export function scale(shape, center, s) { const t = T(new oc.gp_Trsf()); t.SetScale(P(center), s); return transform(shape, t); }
export function mirror(shape, origin, normal) { const t = T(new oc.gp_Trsf()); t.SetMirror(Ax2(origin, normal)); return transform(shape, t); }
export function place(shape, matrix) { return transform(shape, trsfFromMatrix(matrix)); }

// ------------------------------------------------------------------ booleanas (paralelas)
function boolOp(Cls, args, tools, fuzzy) {
  const op = T(new oc[Cls]());
  op.SetArguments(list(args));
  op.SetTools(list(tools));
  op.SetRunParallel(true);
  if (fuzzy) op.SetFuzzyValue(fuzzy);
  op.SetNonDestructive(true);
  op.Build(progress());
  if (!op.IsDone()) throw new Error(`Falha na operação booleana (${Cls.replace('BRepAlgoAPI_', '')})`);
  op.SimplifyResult(true, true, 1e-6);
  return T(op.Shape());
}
export const fuse = (a, b, fz) => boolOp('BRepAlgoAPI_Fuse', [a], Array.isArray(b) ? b : [b], fz);
export const cut = (a, b, fz) => boolOp('BRepAlgoAPI_Cut', [a], Array.isArray(b) ? b : [b], fz);
export const common = (a, b, fz) => boolOp('BRepAlgoAPI_Common', [a], Array.isArray(b) ? b : [b], fz);
export function fuseAll(shapes) {
  if (shapes.length === 1) return shapes[0];
  return fuse(shapes[0], shapes.slice(1));
}

/** Une faces coplanares/arestas colineares deixadas pelas booleanas. */
export function clean(shape) {
  try {
    const u = T(new oc.ShapeUpgrade_UnifySameDomain(shape, true, true, false));
    u.Build();
    return T(u.Shape());
  } catch { return shape; }
}

// ------------------------------------------------------------------ primitivas
export const box = (min, max) => T(T(new oc.BRepPrimAPI_MakeBox(P(min), P(max))).Shape());
export const cylinder = (o, dir, r, h) => T(T(new oc.BRepPrimAPI_MakeCylinder(Ax2(o, dir), r, h)).Shape());
export const sphere = (c, r) => T(T(new oc.BRepPrimAPI_MakeSphere(P(c), r)).Shape());
export const torus = (o, dir, R, r) => T(T(new oc.BRepPrimAPI_MakeTorus(Ax2(o, dir), R, r)).Shape());
/** Cone/tronco exato (revolução de um trapézio, já que MakeCone não está no build). */
export function cone(o, dir, r1, r2, h) {
  const pts = [[0, 0, 0], [r1, 0, 0], [r2, 0, h], [0, 0, h]];
  const w = polygonWire(dedupe(pts));
  const f = T(T(new oc.BRepBuilderAPI_MakeFace(w, true)).Face());
  const s = T(T(new oc.BRepPrimAPI_MakeRevol(f, Ax1([0, 0, 0], [0, 0, 1]), 2 * Math.PI, false)).Shape());
  const M = frame(o, dir);
  return place(s, M);
}
const dedupe = (pts) => pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 1e-9; });

export function frame(o, z, x) {
  const n = norm(z);
  let xd = x ? norm(x) : Math.abs(n[2]) < 0.9 ? norm(cross([0, 0, 1], n)) : [1, 0, 0];
  const d = dot(xd, n); xd = norm([xd[0] - n[0] * d, xd[1] - n[1] * d, xd[2] - n[2] * d]);
  const y = cross(n, xd);
  return [xd[0], xd[1], xd[2], 0, y[0], y[1], y[2], 0, n[0], n[1], n[2], 0, o[0], o[1], o[2], 1];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ------------------------------------------------------------------ arestas, wires e faces exatas
export const lineEdge = (a, b) => T(T(new oc.BRepBuilderAPI_MakeEdge(P(a), P(b))).Edge());
export const arcEdge = (a, m, b) => T(T(new oc.BRepBuilderAPI_MakeEdge(T(new oc.GC_MakeArcOfCircle(P(a), P(m), P(b))).Value())).Edge());
export function circleEdge(c, normal, r) {
  const circ = T(new oc.gp_Circ(Ax2(c, normal), r));
  return T(T(new oc.BRepBuilderAPI_MakeEdge(circ)).Edge());
}
export function wire(edges) {
  const mw = T(new oc.BRepBuilderAPI_MakeWire());
  for (const e of edges) mw.Add(e);
  if (!mw.IsDone()) throw new Error('Não foi possível formar um contorno fechado (wire)');
  return T(mw.Wire());
}
export function polygonWire(pts, closed = true) {
  const edges = [];
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) edges.push(lineEdge(pts[i], pts[(i + 1) % pts.length]));
  return wire(edges);
}
export function faceFromWires(outer, holes = []) {
  const mf = T(new oc.BRepBuilderAPI_MakeFace(outer, true));
  for (const h of holes) mf.Add(h);
  if (!mf.IsDone()) throw new Error('Falha ao criar face a partir do perfil');
  return T(mf.Face());
}

/** Offset 2D exato de um wire plano (arcos verdadeiros nos cantos). */
export function offsetWire(face, d, join = 'Arc') {
  const mo = T(new oc.BRepOffsetAPI_MakeOffset(face, oc.GeomAbs_JoinType[`GeomAbs_${join}`], false));
  mo.Perform(d, 0);
  if (!mo.IsDone()) throw new Error('Falha no offset 2D do perfil');
  return T(mo.Shape());
}

// ------------------------------------------------------------------ operações de forma
export const prism = (shape, vec) => T(T(new oc.BRepPrimAPI_MakePrism(shape, V(vec), false, true)).Shape());
export const revol = (shape, o, axis, deg) => T(T(new oc.BRepPrimAPI_MakeRevol(shape, Ax1(o, axis), (deg * Math.PI) / 180, false)).Shape());

export function loft(wires, { solid = true, ruled = false } = {}) {
  const ts = T(new oc.BRepOffsetAPI_ThruSections(solid, ruled, 1e-6));
  for (const w of wires) ts.AddWire(w);
  ts.CheckCompatibility(true);
  ts.Build(progress());
  if (!ts.IsDone()) throw new Error('Falha no loft (perfis incompatíveis?)');
  return T(ts.Shape());
}

export function pipe(spine, profileFace) {
  const p = T(new oc.BRepOffsetAPI_MakePipe(spine, profileFace));
  p.Build(progress());
  if (!p.IsDone()) throw new Error('Falha na varredura');
  return T(p.Shape());
}

export function fillet(shape, edges, radius) {
  const mf = T(new oc.BRepFilletAPI_MakeFillet(shape));
  for (const e of edges) mf.Add(radius, e);
  mf.Build(progress());
  if (!mf.IsDone()) throw new Error(`Filete de raio ${radius} falhou (raio grande demais para a geometria vizinha?)`);
  return T(mf.Shape());
}
export function chamfer(shape, edges, d1, d2) {
  const mc = T(new oc.BRepFilletAPI_MakeChamfer(shape));
  for (const e of edges) {
    if (d2 === undefined) mc.Add(d1, e);
    else {
      const f = adjacentFace(shape, e);
      mc.Add(d1, d2, e, f);
    }
  }
  mc.Build(progress());
  if (!mc.IsDone()) throw new Error('Chanfro falhou (distância grande demais?)');
  return T(mc.Shape());
}
export function adjacentFace(shape, edge) {
  for (const f of explore(shape, 'FACE')) for (const e of explore(f, 'EDGE')) if (e.IsSame(edge)) return T(oc.TopoDS.Face(f));
  throw new Error('Aresta sem face adjacente');
}

export function thickSolid(shape, removeFaces, thickness) {
  const ts = T(new oc.BRepOffsetAPI_MakeThickSolid());
  ts.MakeThickSolidByJoin(shape, list(removeFaces), -Math.abs(thickness), 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Arc, false, progress());
  if (!ts.IsDone()) throw new Error('Casca falhou (espessura incompatível com raios/paredes do corpo?)');
  return T(ts.Shape());
}
export function offsetShape(shape, d) {
  const os_ = T(new oc.BRepOffsetAPI_MakeOffsetShape());
  os_.PerformByJoin(shape, d, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Arc, false, progress());
  if (!os_.IsDone()) throw new Error('Offset 3D falhou');
  return T(os_.Shape());
}
export function draft(shape, faces, pullDir, deg, neutralOrigin) {
  const da = T(new oc.BRepOffsetAPI_DraftAngle(shape));
  const pln = T(new oc.gp_Pln(P(neutralOrigin), D(pullDir)));
  for (const f of faces) {
    da.Add(f, D(pullDir), (deg * Math.PI) / 180, pln, true);
    if (!da.AddDone()) throw new Error('Ângulo de saída não aplicável a uma das faces');
  }
  da.Build(progress());
  if (!da.IsDone()) throw new Error('Ângulo de saída falhou');
  return T(da.Shape());
}
export function halfSpace(origin, normal, size = 1e5) {
  // meio-espaço do lado +normal
  const pln = T(new oc.gp_Pln(P(origin), D(normal)));
  const f = T(T(new oc.BRepBuilderAPI_MakeFace(pln, -size, size, -size, size)).Face());
  return T(T(new oc.BRepPrimAPI_MakeHalfSpace(f, P([origin[0] + normal[0], origin[1] + normal[1], origin[2] + normal[2]]))).Solid());
}
export function sew(faces, tol = 1e-4) {
  const s = T(new oc.BRepBuilderAPI_Sewing(tol, true, true, true, false));
  for (const f of faces) s.Add(f);
  s.Perform(progress());
  const sh = T(s.SewedShape());
  try { return T(T(new oc.BRepBuilderAPI_MakeSolid(T(oc.TopoDS.Shell(sh)))).Solid()); } catch { return sh; }
}

// ------------------------------------------------------------------ consultas exatas
export function isValid(shape) { return T(new oc.BRepCheck_Analyzer(shape, true, false, false)).IsValid(); }

export function bbox(shape, optimal = true) {
  const b = T(new oc.Bnd_Box());
  if (optimal) oc.BRepBndLib.AddOptimal(shape, b, false, false); else oc.BRepBndLib.Add(shape, b, true);
  if (b.IsVoid()) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min: [b.GetXMin(), b.GetYMin(), b.GetZMin()], max: [b.GetXMax(), b.GetYMax(), b.GetZMax()] };
}

/** Propriedades de massa por integração de Gauss sobre a geometria exata. */
export function massProps(shape, eps = 1e-9) {
  const g = T(new oc.GProp_GProps());
  oc.BRepGProp.VolumeProperties(shape, g, eps, true, false);
  const cm = g.CentreOfMass();
  const c = xyz(cm);
  // tensor de inércia no CG a partir de momentos sobre eixos (gp_Mat não está exposto no build)
  const Iax = (u) => g.MomentOfInertia(Ax1(c, u));
  const Ixx = Iax([1, 0, 0]), Iyy = Iax([0, 1, 0]), Izz = Iax([0, 0, 1]);
  const r2 = Math.SQRT1_2;
  const Txy = Iax([r2, r2, 0]) - (Ixx + Iyy) / 2, Tyz = Iax([0, r2, r2]) - (Iyy + Izz) / 2, Txz = Iax([r2, 0, r2]) - (Ixx + Izz) / 2;
  const m = [[Ixx, Txy, Txz], [Txy, Iyy, Tyz], [Txz, Tyz, Izz]];
  const s = T(new oc.GProp_GProps());
  oc.BRepGProp.SurfaceProperties(shape, s, eps, false);
  const principal = symEigen(m);
  return { volume: g.Mass(), area: s.Mass(), center: c, inertia: m, principal };
}
/** Autovalores de matriz simétrica 3x3 (Jacobi): momentos principais de inércia. */
function symEigen(A) {
  const a = A.map((r) => [...r]);
  for (let it = 0; it < 50; it++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-12 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-30)) break;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
  }
  return [a[0][0], a[1][1], a[2][2]].sort((x, y) => x - y);
}
export function length(edge) { const g = T(new oc.GProp_GProps()); oc.BRepGProp.LinearProperties(edge, g, false, false); return g.Mass(); }
export function faceArea(face) { const g = T(new oc.GProp_GProps()); oc.BRepGProp.SurfaceProperties(face, g, 1e-9, false); return g.Mass(); }

export function distance(a, b) {
  const d = T(new oc.BRepExtrema_DistShapeShape(a, b));
  if (!d.IsDone()) throw new Error('Cálculo de distância falhou');
  return { distance: d.Value(), p1: xyz(d.PointOnShape1(1)), p2: xyz(d.PointOnShape2(1)), inner: d.InnerSolution() };
}

/** Descrição geométrica exata de uma face. */
export function describeFace(f) {
  const a = T(new oc.BRepAdaptor_Surface(f, true));
  const type = a.GetType().replace('GeomAbs_', '');
  const rev = f.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
  const out = { type, area: faceArea(f) };
  if (type === 'Plane') {
    const ax = a.Plane().Axis();
    let n = xyz(ax.Direction()); if (rev) n = n.map((x) => -x);
    const o = xyz(ax.Location());
    out.normal = n; out.offset = dot(n, o); out.origin = o;
  } else if (type === 'Cylinder') {
    const c = a.Cylinder(); out.radius = c.Radius(); out.axis = xyz(c.Axis().Direction()); out.axisPoint = xyz(c.Axis().Location()); out.inward = rev;
  } else {
    try {
      if (type === 'Sphere') { const s = a.Sphere(); out.radius = s.Radius(); out.center = xyz(s.Location()); }
      else if (type === 'Torus') { const t = a.Torus(); out.majorRadius = t.MajorRadius(); out.minorRadius = t.MinorRadius(); out.axis = xyz(t.Axis().Direction()); }
    } catch { /* tipo de superfície sem binding no build: só o tipo é informado */ }
  }
  const g = T(new oc.GProp_GProps()); oc.BRepGProp.SurfaceProperties(f, g, 1e-7, false); out.centroid = xyz(g.CentreOfMass());
  return out;
}

/** Descrição geométrica exata de uma aresta. */
export function describeEdge(e) {
  const c = T(new oc.BRepAdaptor_Curve(e));
  const type = c.GetType().replace('GeomAbs_', '');
  const u0 = c.FirstParameter(), u1 = c.LastParameter();
  const out = { type, length: length(e), start: xyz(c.Value(u0)), end: xyz(c.Value(u1)), mid: xyz(c.Value((u0 + u1) / 2)) };
  if (type === 'Line') out.direction = norm([out.end[0] - out.start[0], out.end[1] - out.start[1], out.end[2] - out.start[2]]);
  if (type === 'Circle') { const k = c.Circle(); out.radius = k.Radius(); out.center = xyz(k.Location()); out.axis = xyz(k.Axis().Direction()); out.closed = Math.abs(u1 - u0 - 2 * Math.PI) < 1e-9; }
  return out;
}

/** Discretiza uma aresta para exibição/desenho, com deflexão controlada. */
export function edgePolyline(e, angDefl = 0.1, chordDefl = 0.01) {
  const c = T(new oc.BRepAdaptor_Curve(e));
  if (c.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line) return [xyz(c.Value(c.FirstParameter())), xyz(c.Value(c.LastParameter()))];
  try {
    const td = T(new oc.GCPnts_TangentialDeflection(c, angDefl, chordDefl, 2, 1e-9, 1e-7));
    const pts = [];
    for (let i = 1; i <= td.NbPoints(); i++) pts.push(xyz(td.Value(i)));
    return pts;
  } catch {
    const pts = [];
    for (let i = 0; i <= 32; i++) pts.push(xyz(c.Value(c.FirstParameter() + ((c.LastParameter() - c.FirstParameter()) * i) / 32)));
    return pts;
  }
}

// ------------------------------------------------------------------ tesselagem
/**
 * Malha de exibição/exportação a partir do B-rep. `linDefl` é o erro cordal máximo
 * em mm; a tesselagem roda em paralelo em todos os núcleos (pthreads).
 */
export function tessellate(shape, { linDefl = 0.02, angDefl = 0.25, relative = false, edges = true } = {}) {
  new oc.BRepMesh_IncrementalMesh(shape, linDefl, relative, angDefl, true).delete();
  const pos = [], idx = [], faceOf = [];
  const faces = unique(shape, 'FACE');
  faces.forEach((f, fi) => {
    const loc = T(new oc.TopLoc_Location());
    const tri = oc.BRep_Tool.Triangulation(f, loc, 0);
    if (!tri) return;
    const tr = loc.Transformation();
    const base = pos.length / 3;
    const n = tri.NbNodes();
    for (let i = 1; i <= n; i++) { const p = tri.Node(i).Transformed(tr); pos.push(p.X(), p.Y(), p.Z()); p.delete(); }
    const rev = f.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    const nt = tri.NbTriangles();
    for (let i = 1; i <= nt; i++) {
      const t = tri.Triangle(i);
      const a = t.Value(1) - 1 + base, b = t.Value(2) - 1 + base, c = t.Value(3) - 1 + base;
      if (rev) idx.push(a, c, b); else idx.push(a, b, c);
      faceOf.push(fi);
      t.delete();
    }
  });
  const out = { positions: new Float64Array(pos), indices: new Uint32Array(idx), faceIds: new Uint32Array(faceOf), faceCount: faces.length };
  if (edges) {
    // arestas de costura (seam) de superfícies periódicas não são desenhadas, mas mantêm o índice
    const seams = new Set();
    const all = unique(shape, 'EDGE');
    // índice geométrico: cada aresta de costura é localizada entre poucas candidatas
    const byKey = new Map();
    all.forEach((e, i) => { const k = edgeKey(e); (byKey.get(k) || byKey.set(k, []).get(k)).push(i); });
    for (const f of faces) {
      const seen = [];
      for (const e of explore(f, 'EDGE')) {
        if (seen.some((x) => x.IsSame(e))) for (const i of byKey.get(edgeKey(oc.TopoDS.Edge(e))) || []) { if (all[i].IsSame(e)) seams.add(i); }
        else seen.push(e);
      }
    }
    out.edges = all.map((e, i) => (seams.has(i) ? [] : edgePolyline(e, angDefl / 2, linDefl)));
  }
  return out;
}

// ------------------------------------------------------------------ STEP / BRep
export function writeSTEP(shapes, names = []) {
  const w = T(new oc.STEPControl_Writer());
  shapes.forEach((s) => w.Transfer(s, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress()));
  const fname = `/tmp_${Date.now()}.step`;
  w.Write(fname);
  let txt = Buffer.from(oc.FS.readFile(fname)).toString('latin1');
  oc.FS.unlink(fname);
  if (names.length) txt = txt.replace("FILE_NAME('", `FILE_NAME('${names.join('+')}`);
  return Buffer.from(txt, 'latin1');
}
export function readSTEP(buf) {
  const fname = `/in_${Date.now()}.step`;
  oc.FS.writeFile(fname, buf);
  const r = T(new oc.STEPControl_Reader());
  const st = r.ReadFile(fname);
  oc.FS.unlink(fname);
  if (String(st) !== 'IFSelect_RetDone' && st !== oc.IFSelect_ReturnStatus?.IFSelect_RetDone) throw new Error(`Leitura STEP falhou (${st})`);
  r.TransferRoots(progress());
  return T(r.OneShape());
}
export const toBRep = (s) => oc.BRepToolsWrapper.Write(s);
export const fromBRep = (txt) => T(oc.BRepToolsWrapper.Read(txt));

// ------------------------------------------------------------------ HLR (desenho técnico exato)
export function hiddenLines(shape, dir, up) {
  const algo = T(new oc.HLRBRep_Algo());
  algo.Add(shape, 0);
  const ax = Ax2([0, 0, 0], dir, up);
  algo.Projector(T(new oc.HLRAlgo_Projector(ax)));
  algo.Update();
  algo.Hide();
  const h = T(new oc.HLRBRep_HLRToShape(algo));
  const grab = (s) => {
    if (!s || s.IsNull()) return [];
    return unique(s, 'EDGE').map((e) => edgePolyline(e, 0.05, 0.005).map((p) => [p[0], p[1]]));
  };
  return {
    visible: [...grab(h.VCompound()), ...grab(h.OutLineVCompound()), ...grab(h.Rg1LineVCompound?.() ?? null)],
    hidden: [...grab(h.HCompound()), ...grab(h.OutLineHCompound())],
  };
}
