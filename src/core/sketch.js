// Esboço 2D paramétrico com solver de restrições geométricas (Levenberg–Marquardt)
// e extração automática de perfis fechados (com furos por regra par/ímpar).

const EPS = 1e-9;

// ----------------------------------------------------------- expansão de formas
/**
 * Atalhos de alto nível ("shapes") viram pontos/entidades/restrições completas.
 * Os valores podem ser expressões ("largura/2") — elas ficam nas restrições, então
 * o esboço continua paramétrico.
 */
export function expandSketch(src, ev) {
  const points = { ...(src.points || {}) };
  const entities = [...(src.entities || [])];
  const constraints = [...(src.constraints || [])];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  const P = (x, y) => { const k = id('_p'); points[k] = [x, y]; return k; };

  for (const s of src.shapes || []) {
    const cons = s.construction || false;
    switch (s.type) {
      case 'rect': case 'rectangle': {
        const w = ev(s.width ?? s.w), h = ev(s.height ?? s.h);
        let x, y;
        if (s.center) { x = ev(s.center[0]) - w / 2; y = ev(s.center[1]) - h / 2; } else { x = ev(s.x ?? 0); y = ev(s.y ?? 0); }
        const a = P(x, y), b = P(x + w, y), c = P(x + w, y + h), d = P(x, y + h);
        const l = [[a, b], [b, c], [c, d], [d, a]].map(([p, q]) => { const k = id('_l'); entities.push({ id: k, type: 'line', a: p, b: q, construction: cons }); return k; });
        constraints.push({ type: 'horizontal', line: l[0] }, { type: 'horizontal', line: l[2] }, { type: 'vertical', line: l[1] }, { type: 'vertical', line: l[3] });
        constraints.push({ type: 'length', line: l[0], value: s.width ?? s.w }, { type: 'length', line: l[1], value: s.height ?? s.h });
        if (s.center) {
          const m = P(ev(s.center[0]), ev(s.center[1]));
          constraints.push({ type: 'fix', p: m, x: s.center[0], y: s.center[1] }, { type: 'midpoint', p: m, a, b: c });
        } else constraints.push({ type: 'fix', p: a, x: s.x ?? 0, y: s.y ?? 0 });
        break;
      }
      case 'circle': {
        const cx = s.center ? s.center[0] : s.cx ?? 0, cy = s.center ? s.center[1] : s.cy ?? 0;
        const r = s.radius ?? (s.diameter !== undefined ? `(${s.diameter})/2` : 5);
        const c = P(ev(cx), ev(cy));
        const k = id('_c');
        entities.push({ id: k, type: 'circle', c, r: ev(r), construction: cons });
        constraints.push({ type: 'fix', p: c, x: cx, y: cy }, { type: 'radius', circle: k, value: r });
        break;
      }
      case 'polygon': case 'polyline': {
        const ks = s.points.map(([x, y]) => P(ev(x), ev(y)));
        const closed = s.type === 'polygon' || s.closed;
        for (let i = 0; i < ks.length - (closed ? 0 : 1); i++) {
          entities.push({ id: id('_l'), type: 'line', a: ks[i], b: ks[(i + 1) % ks.length], construction: cons });
        }
        ks.forEach((k, i) => constraints.push({ type: 'fix', p: k, x: s.points[i][0], y: s.points[i][1] }));
        break;
      }
      case 'regularPolygon': {
        const cx = ev(s.center?.[0] ?? 0), cy = ev(s.center?.[1] ?? 0), r = ev(s.radius), sides = Math.round(ev(s.sides ?? 6));
        const rot = ev(s.rotation ?? 0) * Math.PI / 180;
        const pts = [];
        for (let i = 0; i < sides; i++) { const t = rot + (i * 2 * Math.PI) / sides; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
        const ks = pts.map(([x, y]) => P(x, y));
        ks.forEach((k, i) => { entities.push({ id: id('_l'), type: 'line', a: k, b: ks[(i + 1) % ks.length], construction: cons }); constraints.push({ type: 'fix', p: k, x: pts[i][0], y: pts[i][1] }); });
        break;
      }
      case 'slot': {
        // rasgo oblongo: centro, comprimento entre centros, largura, ângulo
        const cx = ev(s.center?.[0] ?? 0), cy = ev(s.center?.[1] ?? 0), L = ev(s.length), W = ev(s.width), ang = ev(s.angle ?? 0) * Math.PI / 180;
        const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux, r = W / 2;
        const c1 = [cx - ux * L / 2, cy - uy * L / 2], c2 = [cx + ux * L / 2, cy + uy * L / 2];
        const pts = {
          c1, c2,
          a: [c1[0] - nx * r, c1[1] - ny * r], b: [c2[0] - nx * r, c2[1] - ny * r],
          c: [c2[0] + nx * r, c2[1] + ny * r], d: [c1[0] + nx * r, c1[1] + ny * r],
        };
        const k = {}; for (const [nm, p] of Object.entries(pts)) { k[nm] = P(p[0], p[1]); constraints.push({ type: 'fix', p: k[nm], x: p[0], y: p[1] }); }
        entities.push({ id: id('_l'), type: 'line', a: k.a, b: k.b, construction: cons });
        entities.push({ id: id('_a'), type: 'arc', c: k.c2, a: k.b, b: k.c, construction: cons });
        entities.push({ id: id('_l'), type: 'line', a: k.c, b: k.d, construction: cons });
        entities.push({ id: id('_a'), type: 'arc', c: k.c1, a: k.d, b: k.a, construction: cons });
        break;
      }
      default:
        throw new Error(`Forma de esboço desconhecida: ${s.type}`);
    }
  }
  return { points, entities, constraints };
}

// ----------------------------------------------------------- solver
function buildSystem(sk, ev) {
  const pointIds = Object.keys(sk.points);
  const varIndex = new Map();
  const x0 = [];
  for (const k of pointIds) { varIndex.set(k, x0.length); x0.push(sk.points[k][0], sk.points[k][1]); }
  const ent = new Map(sk.entities.map((e) => [e.id, e]));
  const radiusIndex = new Map();
  for (const e of sk.entities) {
    if (e.type === 'circle') { radiusIndex.set(e.id, x0.length); x0.push(typeof e.r === 'number' ? e.r : ev(e.r ?? 5)); }
  }
  const pi = (k) => { const i = varIndex.get(k); if (i === undefined) throw new Error(`Ponto inexistente no esboço: ${k}`); return i; };
  const line = (k) => { const e = ent.get(k); if (!e || e.type !== 'line') throw new Error(`Linha inexistente: ${k}`); return [pi(e.a), pi(e.b)]; };
  const circ = (k) => {
    const e = ent.get(k);
    if (!e) throw new Error(`Círculo/arco inexistente: ${k}`);
    if (e.type === 'circle') return { c: pi(e.c), r: (x) => x[radiusIndex.get(k)] };
    if (e.type === 'arc') return { c: pi(e.c), r: (x) => Math.hypot(x[pi(e.a)] - x[pi(e.c)], x[pi(e.a) + 1] - x[pi(e.c) + 1]) };
    throw new Error(`${k} não é círculo/arco`);
  };

  const res = []; // funções x -> número
  const len = (x, a, b) => Math.hypot(x[b] - x[a], x[b + 1] - x[a + 1]);
  for (const c of sk.constraints) {
    const val = c.value !== undefined ? ev(c.value) : undefined;
    switch (c.type) {
      case 'coincident': { const a = pi(c.p), b = pi(c.q); res.push((x) => x[a] - x[b], (x) => x[a + 1] - x[b + 1]); break; }
      case 'fix': {
        const a = pi(c.p);
        if (c.x !== undefined) { const v = ev(c.x); res.push((x) => x[a] - v); }
        if (c.y !== undefined) { const v = ev(c.y); res.push((x) => x[a + 1] - v); }
        break;
      }
      case 'horizontal': { const [a, b] = c.line ? line(c.line) : [pi(c.p), pi(c.q)]; res.push((x) => x[a + 1] - x[b + 1]); break; }
      case 'vertical': { const [a, b] = c.line ? line(c.line) : [pi(c.p), pi(c.q)]; res.push((x) => x[a] - x[b]); break; }
      case 'distance': { const a = pi(c.p), b = pi(c.q); res.push((x) => len(x, a, b) - val); break; }
      case 'distanceX': { const a = pi(c.p), b = pi(c.q); res.push((x) => x[b] - x[a] - val); break; }
      case 'distanceY': { const a = pi(c.p), b = pi(c.q); res.push((x) => x[b + 1] - x[a + 1] - val); break; }
      case 'length': { const [a, b] = line(c.line); res.push((x) => len(x, a, b) - val); break; }
      case 'parallel': case 'perpendicular': {
        const [a, b] = line(c.l1), [d, e] = line(c.l2);
        res.push((x) => {
          const u = [x[b] - x[a], x[b + 1] - x[a + 1]], v = [x[e] - x[d], x[e + 1] - x[d + 1]];
          const n = Math.hypot(...u) * Math.hypot(...v) + EPS;
          return c.type === 'parallel' ? (u[0] * v[1] - u[1] * v[0]) / n : (u[0] * v[0] + u[1] * v[1]) / n;
        });
        break;
      }
      case 'angle': {
        const [a, b] = line(c.l1), [d, e] = line(c.l2), t = (val * Math.PI) / 180;
        res.push((x) => {
          const u = [x[b] - x[a], x[b + 1] - x[a + 1]], v = [x[e] - x[d], x[e + 1] - x[d + 1]];
          let ang = Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) - t;
          while (ang > Math.PI) ang -= 2 * Math.PI;
          while (ang < -Math.PI) ang += 2 * Math.PI;
          return ang;
        });
        break;
      }
      case 'equal': {
        const e1 = ent.get(c.l1 ?? c.a), e2 = ent.get(c.l2 ?? c.b);
        const size = (e) => (e.type === 'line' ? ((x) => { const [a, b] = line(e.id); return len(x, a, b); }) : circ(e.id).r);
        const s1 = size(e1), s2 = size(e2);
        res.push((x) => s1(x) - s2(x));
        break;
      }
      case 'radius': case 'diameter': { const k = circ(c.circle); const r = c.type === 'diameter' ? val / 2 : val; res.push((x) => k.r(x) - r); break; }
      case 'pointOnLine': {
        const p = pi(c.p), [a, b] = line(c.line);
        res.push((x) => ((x[b] - x[a]) * (x[p + 1] - x[a + 1]) - (x[b + 1] - x[a + 1]) * (x[p] - x[a])) / (len(x, a, b) + EPS));
        break;
      }
      case 'pointOnCircle': { const p = pi(c.p), k = circ(c.circle); res.push((x) => len(x, k.c, p) - k.r(x)); break; }
      case 'midpoint': {
        const p = pi(c.p); const [a, b] = c.line ? line(c.line) : [pi(c.a), pi(c.b)];
        res.push((x) => x[p] - (x[a] + x[b]) / 2, (x) => x[p + 1] - (x[a + 1] + x[b + 1]) / 2);
        break;
      }
      case 'tangent': {
        const [a, b] = line(c.line), k = circ(c.circle);
        res.push((x) => Math.abs(((x[b] - x[a]) * (x[k.c + 1] - x[a + 1]) - (x[b + 1] - x[a + 1]) * (x[k.c] - x[a])) / (len(x, a, b) + EPS)) - k.r(x));
        break;
      }
      case 'concentric': { const a = circ(c.c1).c, b = circ(c.c2).c; res.push((x) => x[a] - x[b], (x) => x[a + 1] - x[b + 1]); break; }
      case 'symmetric': {
        const p = pi(c.p), q = pi(c.q), [a, b] = line(c.line);
        res.push(
          (x) => { const mx = (x[p] + x[q]) / 2, my = (x[p + 1] + x[q + 1]) / 2; return ((x[b] - x[a]) * (my - x[a + 1]) - (x[b + 1] - x[a + 1]) * (mx - x[a])) / (len(x, a, b) + EPS); },
          (x) => ((x[q] - x[p]) * (x[b] - x[a]) + (x[q + 1] - x[p + 1]) * (x[b + 1] - x[a + 1])) / (len(x, a, b) + EPS),
        );
        break;
      }
      default: throw new Error(`Restrição desconhecida: ${c.type}`);
    }
  }
  // arcos: raio consistente entre início e fim
  for (const e of sk.entities) {
    if (e.type === 'arc') { const c = pi(e.c), a = pi(e.a), b = pi(e.b); res.push((x) => len(x, c, a) - len(x, c, b)); }
  }
  return { x0, res, varIndex, radiusIndex };
}

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) continue;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-14 ? 0 : r[n] / r[i]));
}

function jacobian(res, x) {
  const h = 1e-7;
  const r0 = res.map((f) => f(x));
  const J = res.map(() => new Array(x.length).fill(0));
  for (let j = 0; j < x.length; j++) {
    const old = x[j];
    x[j] = old + h;
    for (let i = 0; i < res.length; i++) J[i][j] = (res[i](x) - r0[i]) / h;
    x[j] = old;
  }
  return { J, r0 };
}

function rank(J, tol = 1e-6) {
  const M = J.map((r) => [...r]);
  const rows = M.length, cols = rows ? M[0].length : 0;
  let rk = 0;
  for (let c = 0; c < cols && rk < rows; c++) {
    let piv = rk;
    for (let r = rk + 1; r < rows; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < tol) continue;
    [M[rk], M[piv]] = [M[piv], M[rk]];
    for (let r = rk + 1; r < rows; r++) {
      const f = M[r][c] / M[rk][c];
      for (let k = c; k < cols; k++) M[r][k] -= f * M[rk][k];
    }
    rk++;
  }
  return rk;
}

export function solveSketch(raw, ev) {
  const sk = expandSketch(raw, ev);
  const { x0, res, varIndex, radiusIndex } = buildSystem(sk, ev);
  const x = [...x0];
  let lambda = 1e-3;
  const cost = (v) => res.reduce((s, f) => s + f(v) ** 2, 0);
  let c = cost(x);
  let iter = 0;
  for (; iter < 200 && c > 1e-20 && res.length; iter++) {
    const { J, r0 } = jacobian(res, x);
    const n = x.length;
    const JtJ = Array.from({ length: n }, () => new Array(n).fill(0));
    const Jtr = new Array(n).fill(0);
    for (let i = 0; i < J.length; i++) {
      const row = J[i];
      for (let a = 0; a < n; a++) {
        if (!row[a]) continue;
        Jtr[a] += row[a] * r0[i];
        for (let b = 0; b < n; b++) if (row[b]) JtJ[a][b] += row[a] * row[b];
      }
    }
    let improved = false;
    for (let tries = 0; tries < 10; tries++) {
      const A = JtJ.map((r, i) => r.map((v, j) => (i === j ? v + lambda * (1 + v) : v)));
      const d = solveLinear(A, Jtr.map((v) => -v));
      const xn = x.map((v, i) => v + d[i]);
      const cn = cost(xn);
      if (cn < c) { for (let i = 0; i < n; i++) x[i] = xn[i]; c = cn; lambda = Math.max(lambda / 3, 1e-12); improved = true; break; }
      lambda *= 4;
    }
    if (!improved) break;
  }

  const { J } = res.length ? jacobian(res, x) : { J: [] };
  const rk = J.length ? rank(J) : 0;
  const dof = x.length - rk;
  const redundant = res.length - rk;
  const solved = c < 1e-12;

  const pos = {};
  for (const [k, i] of varIndex) pos[k] = [x[i], x[i + 1]];
  const radii = {};
  for (const [k, i] of radiusIndex) radii[k] = x[i];

  const status = !solved ? (redundant > 0 ? 'conflito' : 'falhou') : dof === 0 ? 'totalmente restrito' : 'sub-restrito';
  const { loops, open } = extractProfiles(sk, pos, radii, raw.segments || 64);
  return { status, solved, dof, redundant, residual: Math.sqrt(c), iterations: iter, points: pos, radii, entities: sk.entities, constraints: sk.constraints, loops, exactLoops: loops.exact, openChains: open };
}

// ----------------------------------------------------------- perfis
function arcPoints(c, a, b, segs) {
  const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
  let t0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  let t1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  if (t1 <= t0 + 1e-12) t1 += 2 * Math.PI;
  const n = Math.max(4, Math.ceil(((t1 - t0) / (2 * Math.PI)) * segs));
  const out = [];
  for (let i = 0; i <= n; i++) { const t = t0 + ((t1 - t0) * i) / n; out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); }
  return out;
}

function arcMid(c, a, b) {
  const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const t0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  let t1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  if (t1 <= t0 + 1e-12) t1 += 2 * Math.PI;
  const t = (t0 + t1) / 2;
  return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
}

function extractProfiles(sk, pos, radii, segs) {
  const loops = [];
  // união de pontos coincidentes (por posição)
  const keys = Object.keys(pos);
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = pos[keys[i]], b = pos[keys[j]];
      if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) parent.set(find(keys[j]), find(keys[i]));
    }
  }
  const edges = [];
  const segLoops = []; // geometria exata de cada laço (para o kernel B-rep)
  for (const e of sk.entities) {
    if (e.construction) continue;
    if (e.type === 'circle') {
      const c = pos[e.c], r = radii[e.id], pts = [];
      for (let i = 0; i < segs; i++) { const t = (i * 2 * Math.PI) / segs; pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); }
      loops.push(pts);
      segLoops.push([{ type: 'circle', c, r }]);
    } else if (e.type === 'line') {
      edges.push({ u: find(e.a), v: find(e.b), pts: [pos[e.a], pos[e.b]], seg: { type: 'line', a: pos[e.a], b: pos[e.b] } });
    } else if (e.type === 'arc') {
      const pts = arcPoints(pos[e.c], pos[e.a], pos[e.b], segs);
      edges.push({ u: find(e.a), v: find(e.b), pts, seg: { type: 'arc', a: pos[e.a], m: arcMid(pos[e.c], pos[e.a], pos[e.b]), b: pos[e.b] } });
    }
  }
  const used = new Array(edges.length).fill(false);
  const open = [];
  for (let s = 0; s < edges.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    const start = edges[s].u;
    let cur = edges[s].v;
    const chain = [...edges[s].pts];
    const segsOut = [edges[s].seg];
    let closed = cur === start;
    while (!closed) {
      const nx = edges.findIndex((e, i) => !used[i] && (e.u === cur || e.v === cur));
      if (nx < 0) break;
      used[nx] = true;
      const e = edges[nx];
      const fwd = e.u === cur;
      const pts = fwd ? e.pts : [...e.pts].reverse();
      chain.push(...pts.slice(1));
      segsOut.push(fwd ? e.seg : { ...e.seg, a: e.seg.b, b: e.seg.a });
      cur = fwd ? e.v : e.u;
      closed = cur === start;
    }
    if (closed) { chain.pop(); loops.push(chain); segLoops.push(segsOut); } else open.push(chain);
  }
  loops.exact = segLoops;
  return { loops, open };
}
