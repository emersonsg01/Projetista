// Renderizador por software (sem GPU, sem navegador): rasteriza os sólidos com z-buffer,
// sombreamento, contornos e arestas vivas em espaço de tela, plano de corte e
// tríade de eixos, e codifica PNG. É isso que permite ao Claude "enxergar" o modelo via MCP.
import zlib from 'node:zlib';
import { v3 } from '../core/kernel.js';
import { hex } from '../core/io.js';

export const VIEWS = {
  iso: [45, 30], isometric: [45, 30], front: [-90, 0], back: [90, 0], right: [0, 0], left: [180, 0],
  top: [-90, 90], bottom: [-90, -90], 'iso-back': [225, 30], 'iso-below': [45, -30],
};

function camera(view) {
  let az, el;
  if (Array.isArray(view)) [az, el] = view;
  else if (view && typeof view === 'object') { az = view.azimuth ?? 45; el = view.elevation ?? 30; }
  else [az, el] = VIEWS[view || 'iso'] || VIEWS.iso;
  const a = (az * Math.PI) / 180, e = (Math.min(89.999, Math.max(-89.999, el)) * Math.PI) / 180;
  const eye = [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)]; // do alvo para a câmera
  const d = v3.mul(eye, -1);
  let up = [0, 0, 1];
  if (Math.abs(el) > 89) up = [0, 1, 0];
  const right = v3.norm(v3.cross(d, up));
  const u = v3.cross(right, d);
  return { d, right, up: u, eye };
}

export function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3) : raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Renderiza uma vista. bodies: [{ name, m (Manifold), color }]
 * opts: { view, width, height, edges, section: { normal, offset }, highlight, background, sketches }
 */
export function renderView(bodies, opts = {}) {
  const W = opts.width || 800, H = opts.height || 600, SS = 2;
  const w = W * SS, h = H * SS;
  const cam = camera(opts.view);
  const sec = opts.section ? { n: v3.norm(opts.section.normal || [0, 0, 1]), o: opts.section.offset || 0 } : null;

  // coleta triângulos
  const tris = [];
  let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
  bodies.forEach((b, bi) => {
    const g = b.m.getMesh();
    const np = g.numProp, vp = g.vertProperties, tv = g.triVerts;
    const col = hex(b.color || '#8899aa');
    const dim = opts.highlight && opts.highlight !== b.name;
    for (let t = 0; t < tv.length; t += 3) {
      const P = [0, 1, 2].map((k) => [vp[tv[t + k] * np], vp[tv[t + k] * np + 1], vp[tv[t + k] * np + 2]]);
      const proj = P.map((p) => [v3.dot(p, cam.right), v3.dot(p, cam.up), v3.dot(p, cam.d)]);
      for (const q of proj) { mn = [Math.min(mn[0], q[0]), Math.min(mn[1], q[1])]; mx = [Math.max(mx[0], q[0]), Math.max(mx[1], q[1])]; }
      const n = v3.norm(v3.cross(v3.sub(P[1], P[0]), v3.sub(P[2], P[0])));
      tris.push({ proj, n, col, id: bi + 1, dim });
    }
  });
  const rgb = Buffer.alloc(W * H * 3);
  const bg = opts.background || [[0.93, 0.95, 0.98], [0.78, 0.82, 0.88]];
  if (!tris.length) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = y / H; for (let c = 0; c < 3; c++) rgb[(y * W + x) * 3 + c] = 255 * (bg[0][c] * (1 - t) + bg[1][c] * t); }
    return { png: encodePNG(W, H, rgb), width: W, height: H };
  }
  const span = Math.max(mx[0] - mn[0], mx[1] - mn[1], 1e-6);
  const margin = 0.12;
  const scale = Math.min(w / (mx[0] - mn[0] || span), h / (mx[1] - mn[1] || span)) * (1 - 2 * margin);
  const cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2;
  const toS = (q) => [w / 2 + (q[0] - cx) * scale, h / 2 - (q[1] - cy) * scale, q[2]];

  const zb = new Float32Array(w * h).fill(Infinity);
  const color = new Float32Array(w * h * 3);
  const ids = new Uint16Array(w * h);
  const nbuf = new Float32Array(w * h * 3);
  const light = v3.norm(v3.add(v3.mul(cam.eye, 1), v3.add(v3.mul(cam.up, 0.6), v3.mul(cam.right, -0.4))));

  for (const T of tris) {
    const s = T.proj.map(toS);
    const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[1][1] - s[0][1]) * (s[2][0] - s[0][0]);
    if (Math.abs(area) < 1e-12) continue;
    const front = v3.dot(T.n, cam.d) < 0;
    const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(w - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(h - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    // cor do triângulo
    let c;
    if (front) {
      const diff = Math.max(0, v3.dot(T.n, light));
      const hv = v3.norm(v3.add(light, cam.eye));
      const spec = Math.pow(Math.max(0, v3.dot(T.n, hv)), 40) * 0.25;
      const k = 0.35 + 0.65 * diff;
      c = T.col.map((x) => Math.min(1, x * k + spec));
      if (T.dim) c = c.map((x) => x * 0.35 + 0.6);
    } else c = [0.85, 0.2, 0.2]; // interior exposto pelo corte
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((s[1][0] - px) * (s[2][1] - py) - (s[1][1] - py) * (s[2][0] - px)) / area;
        const w1 = ((s[2][0] - px) * (s[0][1] - py) - (s[2][1] - py) * (s[0][0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * s[0][2] + w1 * s[1][2] + w2 * s[2][2];
        const i = y * w + x;
        if (z >= zb[i]) continue;
        if (sec) {
          const wx = w0 * T.proj[0][0] + w1 * T.proj[1][0] + w2 * T.proj[2][0];
          const wy = w0 * T.proj[0][1] + w1 * T.proj[1][1] + w2 * T.proj[2][1];
          const p = v3.add(v3.add(v3.mul(cam.right, wx), v3.mul(cam.up, wy)), v3.mul(cam.d, z));
          if (v3.dot(p, sec.n) > sec.o) continue;
        } else if (!front) continue;
        zb[i] = z; ids[i] = T.id;
        color[i * 3] = c[0]; color[i * 3 + 1] = c[1]; color[i * 3 + 2] = c[2];
        nbuf[i * 3] = front ? T.n[0] : 9; nbuf[i * 3 + 1] = T.n[1]; nbuf[i * 3 + 2] = T.n[2];
      }
    }
  }

  // linhas: contorno (mudança de id/profundidade) e arestas vivas (mudança de normal)
  const edges = opts.edges !== false;
  const zr = span * scale; // escala de profundidade em pixels
  const isEdge = (i, j) => {
    if (ids[i] !== ids[j]) return true;
    if (!ids[i]) return false;
    if (Math.abs(zb[i] - zb[j]) * scale > Math.max(3, zr * 0.004)) return true;
    const dot = nbuf[i * 3] * nbuf[j * 3] + nbuf[i * 3 + 1] * nbuf[j * 3 + 1] + nbuf[i * 3 + 2] * nbuf[j * 3 + 2];
    return dot < 0.86;
  };
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      let r = 0, g = 0, b = 0, line = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = X * SS + sx, y = Y * SS + sy, i = y * w + x;
        if (ids[i]) { r += color[i * 3]; g += color[i * 3 + 1]; b += color[i * 3 + 2]; }
        else { const t = y / h; r += bg[0][0] * (1 - t) + bg[1][0] * t; g += bg[0][1] * (1 - t) + bg[1][1] * t; b += bg[0][2] * (1 - t) + bg[1][2] * t; }
        if (edges && ((x + 1 < w && isEdge(i, i + 1)) || (y + 1 < h && isEdge(i, i + w)))) line++;
      }
      const n = SS * SS, lk = Math.min(1, (line / n) * 1.6);
      const o = (Y * W + X) * 3;
      rgb[o] = 255 * ((r / n) * (1 - lk) + 0.1 * lk);
      rgb[o + 1] = 255 * ((g / n) * (1 - lk) + 0.12 * lk);
      rgb[o + 2] = 255 * ((b / n) * (1 - lk) + 0.16 * lk);
    }
  }

  // esboços (linhas) e tríade de eixos
  const drawLine = (a, b, col, thick = 1) => {
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1;
    for (let k = 0; k <= steps; k++) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * k) / steps), y = Math.round(a[1] + ((b[1] - a[1]) * k) / steps);
      for (let dx = -thick + 1; dx < thick; dx++) for (let dy = -thick + 1; dy < thick; dy++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const o = (Y * W + X) * 3; rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
      }
    }
  };
  const proj2 = (p) => { const q = toS([v3.dot(p, cam.right), v3.dot(p, cam.up), 0]); return [q[0] / SS, q[1] / SS]; };
  for (const poly of opts.sketchLines || []) {
    for (let k = 0; k + 1 < poly.length; k++) drawLine(proj2(poly[k]), proj2(poly[k + 1]), [230, 120, 20], 1);
  }
  const o = [48, H - 48], L = 32;
  for (const [ax, col] of [[[1, 0, 0], [220, 50, 50]], [[0, 1, 0], [40, 170, 60]], [[0, 0, 1], [50, 90, 230]]]) {
    drawLine(o, [o[0] + v3.dot(ax, cam.right) * L, o[1] - v3.dot(ax, cam.up) * L], col, 2);
  }
  return { png: encodePNG(W, H, rgb), width: W, height: H, mmPerPixel: SS / scale };
}

/** Folha 2x2 com quatro vistas (iso, frente, topo, direita) numa única imagem. */
export function renderSheet(bodies, opts = {}) {
  const W = opts.width || 1000, H = opts.height || 800;
  const hw = Math.floor(W / 2), hh = Math.floor(H / 2);
  const views = opts.views || ['iso', 'front', 'top', 'right'];
  const out = Buffer.alloc(W * H * 3, 255);
  for (let k = 0; k < 4; k++) {
    const r = renderView(bodies, { ...opts, view: views[k], width: hw, height: hh, raw: true });
    const img = decodeRaw(r.png, hw, hh);
    const ox = (k % 2) * hw, oy = Math.floor(k / 2) * hh;
    for (let y = 0; y < hh; y++) img.copy(out, ((oy + y) * W + ox) * 3, y * hw * 3, (y + 1) * hw * 3);
  }
  for (let x = 0; x < W; x++) for (const y of [hh]) { const o = (y * W + x) * 3; out[o] = out[o + 1] = out[o + 2] = 120; }
  for (let y = 0; y < H; y++) { const o = (y * W + hw) * 3; out[o] = out[o + 1] = out[o + 2] = 120; }
  return { png: encodePNG(W, H, out), width: W, height: H, views };
}

function decodeRaw(png, w, h) {
  // extrai os pixels do PNG que nós mesmos geramos (filtro 0, um IDAT)
  let p = 8, idat = [];
  while (p < png.length) {
    const len = png.readUInt32BE(p), type = png.toString('latin1', p + 4, p + 8);
    if (type === 'IDAT') idat.push(png.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) raw.copy(out, y * w * 3, y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1));
  return out;
}
