// Utilidades geométricas compartilhadas (vetores, matrizes, planos) e a Arena que
// libera objetos do kernel WASM em bloco.

/**
 * Arena: registra todos os objetos WASM criados durante uma regeneração para que
 * possam ser liberados de uma vez quando a próxima regeneração terminar.
 */
export class Arena {
  constructor() { this.items = []; }
  t(obj) { if (obj && typeof obj.delete === 'function') this.items.push(obj); return obj; }
  dispose() {
    for (const o of this.items) { try { o.delete(); } catch { /* já liberado */ } }
    this.items = [];
  }
}

export const DEG = Math.PI / 180;

// ---- álgebra vetorial mínima ----
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

const AXES = {
  x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1],
  '+x': [1, 0, 0], '+y': [0, 1, 0], '+z': [0, 0, 1],
  '-x': [-1, 0, 0], '-y': [0, -1, 0], '-z': [0, 0, -1],
};
export function axisVec(a) {
  if (Array.isArray(a)) return v3.norm(a);
  const v = AXES[String(a || 'z').toLowerCase()];
  if (!v) throw new Error(`Eixo inválido: ${a}`);
  return v;
}

/** Matriz 4x4 coluna-major que leva o eixo +Z local para `dir`, com origem em `origin`. */
export function frameMatrix(origin, zDir, xHint) {
  const z = v3.norm(zDir);
  let x = xHint ? v3.norm(xHint) : (Math.abs(z[2]) < 0.9 ? v3.norm(v3.cross([0, 0, 1], z)) : [1, 0, 0]);
  x = v3.norm(v3.sub(x, v3.mul(z, v3.dot(x, z)))); // ortogonaliza
  const y = v3.cross(z, x);
  const o = origin || [0, 0, 0];
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1];
}

/** Planos de esboço nomeados (origem, normal, eixo X do esboço). */
export function planeFrame(plane) {
  if (!plane || typeof plane === 'string') {
    const p = String(plane || 'XY').toUpperCase();
    if (p === 'XY') return { origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0] };
    if (p === 'XZ') return { origin: [0, 0, 0], normal: [0, -1, 0], xDir: [1, 0, 0] };
    if (p === 'YZ') return { origin: [0, 0, 0], normal: [1, 0, 0], xDir: [0, 1, 0] };
    throw new Error(`Plano desconhecido: ${plane}`);
  }
  return {
    origin: plane.origin || [0, 0, 0],
    normal: v3.norm(plane.normal || [0, 0, 1]),
    xDir: plane.xDir ? v3.norm(plane.xDir) : undefined,
  };
}

export function planeMatrix(frame) {
  return frameMatrix(frame.origin, frame.normal, frame.xDir);
}

/** Aplica a matriz coluna-major a um ponto. */
export function applyMat(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
