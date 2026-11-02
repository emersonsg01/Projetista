// Seleção semântica e estável de faces e arestas no B-rep exato.
// Em vez de "Face23" (que muda quando o modelo é editado), o usuário/Claude descreve
// a INTENÇÃO: { normal:"+z", pick:"max" }, { type:"circle", radius: 3 }, { near:[x,y,z] }…
import { describeFace, describeEdge, explore } from './occ.js';
import { axisVec, v3 } from '../core/kernel.js';

const EPS = 1e-6;

export function faceInfos(solid) {
  return (solid._faceInfo ||= solid.faces().map((f, i) => ({ index: i, face: f, ...describeFace(f) })));
}
export function edgeInfos(solid) {
  return (solid._edgeInfo ||= solid.edges().map((e, i) => ({ index: i, edge: e, ...describeEdge(e) })));
}

function inBox(p, w) {
  if (!w) return true;
  return [0, 1, 2].every((k) => (w.min?.[k] ?? -Infinity) - EPS <= p[k] && p[k] <= (w.max?.[k] ?? Infinity) + EPS);
}

/** Retorna as faces que satisfazem o seletor (por padrão, só a melhor). */
export function selectFaces(solid, sel, ev = (x) => x) {
  if (Array.isArray(sel)) return sel.flatMap((s) => selectFaces(solid, s, ev));
  let c = faceInfos(solid);
  if (sel.index !== undefined) return [].concat(sel.index).map((i) => { if (!c[i]) throw new Error(`Face ${i} não existe`); return c[i]; });
  const type = sel.type ? sel.type[0].toUpperCase() + sel.type.slice(1).toLowerCase() : sel.normal ? 'Plane' : null;
  if (type) c = c.filter((f) => f.type === type);
  if (sel.normal) { const n = axisVec(Array.isArray(sel.normal) ? sel.normal.map(ev) : sel.normal); c = c.filter((f) => f.normal && v3.dot(f.normal, n) > (sel.tolerance ?? 0.9999)); }
  if (sel.radius !== undefined) { const r = ev(sel.radius); c = c.filter((f) => f.radius !== undefined && Math.abs(f.radius - r) < (sel.radiusTol ?? 1e-4)); }
  if (sel.within) c = c.filter((f) => inBox(f.centroid, { min: sel.within.min?.map(ev), max: sel.within.max?.map(ev) }));
  if (sel.minArea !== undefined) c = c.filter((f) => f.area >= ev(sel.minArea));
  if (!c.length) throw new Error(`Nenhuma face corresponde ao seletor ${JSON.stringify(sel)}`);
  if (sel.near) { const p = sel.near.map(ev); c.sort((a, b) => v3.len(v3.sub(a.centroid, p)) - v3.len(v3.sub(b.centroid, p))); }
  else if (sel.pick === 'min') c.sort((a, b) => (a.offset ?? a.centroid[2]) - (b.offset ?? b.centroid[2]));
  else if (sel.pick === 'largest') c.sort((a, b) => b.area - a.area);
  else if (sel.pick === 'smallest') c.sort((a, b) => a.area - b.area);
  else c.sort((a, b) => (b.offset ?? b.centroid[2]) - (a.offset ?? a.centroid[2]) || b.area - a.area);
  return sel.all ? c : c.slice(0, sel.count ?? 1);
}

/**
 * Seletor de arestas. Exemplos:
 *  "all" · {type:"line", parallel:"z"} · {onFace:{normal:"+z"}} · {type:"circle", radius:3}
 *  {near:[10,0,5]} · {within:{min:[..],max:[..]}} · {minLength: 5} · [seletor1, seletor2] (união)
 */
export function selectEdges(solid, sel, ev = (x) => x) {
  if (sel === 'all' || sel === undefined) return edgeInfos(solid).filter((e) => !isSeam(solid, e));
  if (Array.isArray(sel)) {
    const out = [];
    for (const s of sel) for (const e of selectEdges(solid, s, ev)) if (!out.includes(e)) out.push(e);
    return out;
  }
  let c = edgeInfos(solid).filter((e) => !isSeam(solid, e));
  if (sel.index !== undefined) return [].concat(sel.index).map((i) => { const e = edgeInfos(solid)[i]; if (!e) throw new Error(`Aresta ${i} não existe`); return e; });
  if (sel.type) { const t = sel.type[0].toUpperCase() + sel.type.slice(1).toLowerCase(); c = c.filter((e) => e.type === t); }
  if (sel.parallel) { const d = axisVec(sel.parallel); c = c.filter((e) => e.direction && Math.abs(v3.dot(e.direction, d)) > 0.9999); }
  if (sel.perpendicular) { const d = axisVec(sel.perpendicular); c = c.filter((e) => (e.direction && Math.abs(v3.dot(e.direction, d)) < 1e-4) || (e.axis && Math.abs(v3.dot(e.axis, d)) > 0.9999)); }
  if (sel.radius !== undefined) { const r = ev(sel.radius); c = c.filter((e) => e.radius !== undefined && Math.abs(e.radius - r) < 1e-4); }
  if (sel.minLength !== undefined) c = c.filter((e) => e.length >= ev(sel.minLength));
  if (sel.maxLength !== undefined) c = c.filter((e) => e.length <= ev(sel.maxLength));
  if (sel.within) c = c.filter((e) => inBox(e.mid, { min: sel.within.min?.map(ev), max: sel.within.max?.map(ev) }));
  if (sel.onFace) {
    const faces = selectFaces(solid, sel.onFace, ev);
    const ids = new Set();
    for (const f of faces) for (const e of edgeInfos(solid)) if (faceHasEdge(f.face, e.edge)) ids.add(e.index);
    c = c.filter((e) => ids.has(e.index));
  }
  if (sel.near) { const p = sel.near.map(ev); c.sort((a, b) => v3.len(v3.sub(a.mid, p)) - v3.len(v3.sub(b.mid, p))); c = c.slice(0, sel.count ?? 1); }
  if (!c.length) throw new Error(`Nenhuma aresta corresponde ao seletor ${JSON.stringify(sel)}`);
  return c;
}

function faceHasEdge(face, edge) {
  for (const e of explore(face, 'EDGE')) if (e.IsSame(edge)) return true;
  return false;
}
/** Arestas de costura (seam) de superfícies periódicas não são arestas "reais". */
function isSeam(solid, e) {
  if (e._seam !== undefined) return e._seam;
  for (const f of solid.faces()) {
    let n = 0;
    for (const x of explore(f, 'EDGE')) if (x.IsSame(e.edge)) n++;
    if (n >= 2) return (e._seam = true);
  }
  return (e._seam = false);
}

export function summarizeFaces(solid) {
  return faceInfos(solid).map(({ face, ...f }) => round(f));
}
export function summarizeEdges(solid) {
  return edgeInfos(solid).filter((e) => !isSeam(solid, e)).map(({ edge, _seam, ...e }) => round(e));
}
const round = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' ? +v.toFixed(6) : v)));
