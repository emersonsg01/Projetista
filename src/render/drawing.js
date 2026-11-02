// Desenho técnico 2D (SVG) por remoção EXATA de linhas ocultas (HLR do OpenCascade):
// as arestas projetadas são as curvas verdadeiras do B-rep, não arestas de malha.
// Vistas ortográficas (1º diedro ABNT NBR 10067 / ISO E, ou 3º diedro ANSI), cotas gerais,
// chamadas de furos (n× Ø), isométrica e carimbo.
import { v3 } from '../core/kernel.js';
import { massProperties } from '../core/analysis.js';
import * as occ from '../occ/occ.js';
import { edgeInfos } from '../occ/select.js';

// direção para o observador (Z do projetor) e eixo X da folha
const VIEWS = {
  front: { z: [0, -1, 0], x: [1, 0, 0] },
  back: { z: [0, 1, 0], x: [-1, 0, 0] },
  top: { z: [0, 0, 1], x: [1, 0, 0] },
  bottom: { z: [0, 0, -1], x: [1, 0, 0] },
  right: { z: [1, 0, 0], x: [0, 1, 0] },
  left: { z: [-1, 0, 0], x: [0, -1, 0] },
};
function isoView() {
  const e = [Math.cos(Math.PI / 6) * Math.SQRT1_2, Math.cos(Math.PI / 6) * Math.SQRT1_2, 0.5];
  return { z: e, x: v3.norm(v3.cross([0, 0, 1], e)) };
}

function projectView(shape, view) {
  const h = occ.hiddenLines(shape, view.z, view.x);
  let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
  for (const pl of [...h.visible, ...h.hidden]) for (const p of pl) { mn = [Math.min(mn[0], p[0]), Math.min(mn[1], p[1])]; mx = [Math.max(mx[0], p[0]), Math.max(mx[1], p[1])]; }
  if (!Number.isFinite(mn[0])) { mn = [0, 0]; mx = [1, 1]; }
  return { vis: h.visible, hid: h.hidden, min: mn, max: mx, view };
}

/** Furos/círculos vistos de frente nesta vista, agrupados por diâmetro. */
function holeCallouts(bodies, view) {
  const groups = new Map();
  const yAxis = v3.cross(view.z, view.x);
  for (const b of bodies) {
    for (const e of edgeInfos(b.m)) {
      if (e.type !== 'Circle' || !e.closed || Math.abs(Math.abs(v3.dot(e.axis, view.z)) - 1) > 1e-6) continue;
      const d = +(2 * e.radius).toFixed(3);
      const c2 = [v3.dot(e.center, view.x), v3.dot(e.center, yAxis)];
      const g = groups.get(d) || [];
      if (!g.some((p) => Math.hypot(p[0] - c2[0], p[1] - c2[1]) < 1e-6)) g.push(c2);
      groups.set(d, g);
    }
  }
  return [...groups.entries()].map(([d, centers]) => ({ d, centers }));
}

export function technicalDrawing(doc, opts = {}) {
  const names = opts.bodies || [...doc.bodies.keys()];
  const bodies = names.map((n) => ({ name: n, ...doc.bodies.get(n) })).filter((b) => b.m);
  if (!bodies.length) throw new Error('Nada para desenhar');
  const shape = bodies.length === 1 ? bodies[0].m.shape : occ.compound(bodies.map((b) => b.m.shape));
  const first = (opts.projection || 'first') === 'first';
  const hidden = opts.hiddenLines !== false;
  const sheet = opts.sheet === 'A4' ? { w: 297, h: 210, name: 'A4' } : { w: 420, h: 297, name: 'A3' };
  const views = {
    front: projectView(shape, VIEWS.front),
    top: projectView(shape, VIEWS.top),
    side: projectView(shape, first ? VIEWS.left : VIEWS.right),
    iso: projectView(shape, isoView()),
  };
  const size = (v) => [v.max[0] - v.min[0], v.max[1] - v.min[1]];
  const [fw, fh] = size(views.front), [, th] = size(views.top), [sw] = size(views.side);
  const areaW = sheet.w - 60, areaH = sheet.h - 80;
  const totalW = fw + sw + 50, totalH = fh + th + 50;
  const std = [20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
  let scale = Math.min(areaW / totalW, areaH / totalH);
  scale = std.find((x) => x <= scale) || scale;
  const gap = 28, fx = 38, fy = 28;
  const pos = { front: [fx, fy], side: [fx + fw * scale + gap, fy], top: [fx, fy + fh * scale + gap] };
  if (!first) { pos.top = [fx, fy]; pos.front = [fx, fy + th * scale + gap]; pos.side = [fx + fw * scale + gap, fy + th * scale + gap]; }
  const [iw, ih] = size(views.iso);
  const isoS = Math.min(110 / iw, 80 / ih);
  pos.iso = [sheet.w - 20 - iw * isoS - 10, sheet.h - 62 - ih * isoS - 12];

  const f = (x) => x.toFixed(3);
  const num = (x) => (+x.toFixed(3)).toString();
  const out = [];
  const drawView = (v, [ox, oy], k, label, dims, holes) => {
    const X = (q) => ox + (q[0] - v.min[0]) * k, Y = (q) => oy + (v.max[1] - q[1]) * k;
    const path = (pl) => pl.map((p, i) => `${i ? 'L' : 'M'}${f(X(p))} ${f(Y(p))}`).join('');
    let s = '<g class="view">';
    if (hidden && v.hid.length) s += `<path class="hid" d="${v.hid.map(path).join('')}"/>`;
    s += `<path class="vis" d="${v.vis.map(path).join('')}"/>`;
    const w = (v.max[0] - v.min[0]) * k, h = (v.max[1] - v.min[1]) * k;
    if (dims) {
      const yb = oy + h + 8, xl = ox - 8;
      s += `<path class="ext" d="M${f(ox)} ${f(oy + h + 1)}V${f(yb + 2)}M${f(ox + w)} ${f(oy + h + 1)}V${f(yb + 2)}M${f(ox - 1)} ${f(oy)}H${f(xl - 2)}M${f(ox - 1)} ${f(oy + h)}H${f(xl - 2)}"/>`;
      s += `<line x1="${f(ox)}" y1="${f(yb)}" x2="${f(ox + w)}" y2="${f(yb)}" class="dim" marker-start="url(#a)" marker-end="url(#a)"/>`;
      s += `<text x="${f(ox + w / 2)}" y="${f(yb - 1.2)}" class="dt">${num(v.max[0] - v.min[0])}</text>`;
      s += `<line x1="${f(xl)}" y1="${f(oy)}" x2="${f(xl)}" y2="${f(oy + h)}" class="dim" marker-start="url(#a)" marker-end="url(#a)"/>`;
      s += `<text x="${f(xl - 1.2)}" y="${f(oy + h / 2)}" class="dt" transform="rotate(-90 ${f(xl - 1.2)} ${f(oy + h / 2)})">${num(v.max[1] - v.min[1])}</text>`;
    }
    for (const [gi, g] of (holes || []).entries()) {
      // chamada do furo: linha de chamada até o primeiro centro, texto "n× Øx"
      const c = g.centers[0];
      const cx = X(c), cy = Y(c), tx = ox + w + 6, ty = oy + 6 + gi * 6;
      s += `<path class="ldr" d="M${f(cx)} ${f(cy)}L${f(tx - 1)} ${f(ty - 1)}H${f(tx + 18)}"/><text x="${f(tx)}" y="${f(ty - 1.6)}" class="ht">${g.centers.length > 1 ? `${g.centers.length}× ` : ''}Ø${num(g.d)}</text>`;
      for (const cc of g.centers) s += `<path class="ctr" d="M${f(X(cc) - 1.5)} ${f(Y(cc))}H${f(X(cc) + 1.5)}M${f(X(cc))} ${f(Y(cc) - 1.5)}V${f(Y(cc) + 1.5)}"/>`;
    }
    s += `<text x="${f(ox + w / 2)}" y="${f(oy + h + (dims ? 16 : 7))}" class="lbl">${label}</text></g>`;
    out.push(s);
  };
  // chamadas de furos na vista superior (furos verticais), coordenadas no plano da vista
  const topHoles = holeCallouts(bodies, VIEWS.top).map((g) => ({ ...g, centers: g.centers }));
  drawView(views.front, pos.front, scale, 'VISTA FRONTAL', true);
  drawView(views.top, pos.top, scale, 'VISTA SUPERIOR', true, topHoles);
  drawView(views.side, pos.side, scale, first ? 'VISTA LATERAL ESQUERDA' : 'VISTA LATERAL DIREITA', true);
  drawView(views.iso, pos.iso, isoS, 'ISOMÉTRICA (sem escala)', false);

  const mp = bodies.map((b) => massProperties(b));
  const mass = mp.reduce((s, m) => s + m.mass_g, 0);
  const mats = [...new Set(bodies.map((b) => b.material))].join(', ');
  const scaleTxt = scale >= 1 ? `${scale}:1` : `1:${+(1 / scale).toFixed(2)}`;
  const tb = { x: sheet.w - 190, y: sheet.h - 45, w: 180, h: 35 };
  const date = new Date().toLocaleDateString('pt-BR');
  const title = opts.title || doc.name;
  // símbolo de projeção (tronco de cone) no carimbo
  const sx = tb.x + 160, sy = tb.y + 23;
  const sym = first
    ? `<path class="vis" d="M${sx - 12} ${sy - 3}L${sx - 4} ${sy - 5}V${sy + 5}L${sx - 12} ${sy + 3}Z"/><circle cx="${sx + 6}" cy="${sy}" r="5" class="vis" fill="none"/><circle cx="${sx + 6}" cy="${sy}" r="2.5" class="vis" fill="none"/>`
    : `<circle cx="${sx - 8}" cy="${sy}" r="5" class="vis" fill="none"/><circle cx="${sx - 8}" cy="${sy}" r="2.5" class="vis" fill="none"/><path class="vis" d="M${sx + 2} ${sy - 5}L${sx + 10} ${sy - 3}V${sy + 3}L${sx + 2} ${sy + 5}Z"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.w}mm" height="${sheet.h}mm" viewBox="0 0 ${sheet.w} ${sheet.h}">
<defs><marker id="a" viewBox="0 0 10 10" refX="0" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,5 L10,2 L10,8 Z" fill="#000"/></marker>
<style>.vis{stroke:#000;stroke-width:.35;fill:none;stroke-linecap:round;stroke-linejoin:round}.hid{stroke:#444;stroke-width:.18;fill:none;stroke-dasharray:1.6 .9}
.dim{stroke:#000;stroke-width:.18}.ext{stroke:#000;stroke-width:.13;fill:none}.ldr{stroke:#000;stroke-width:.15;fill:none}.ctr{stroke:#000;stroke-width:.13;fill:none}
.dt{font:3px sans-serif;text-anchor:middle}.ht{font:2.8px sans-serif}.lbl{font:bold 3px sans-serif;text-anchor:middle}.tb{font:2.6px sans-serif}.tbb{font:bold 4.2px sans-serif}</style></defs>
<rect width="${sheet.w}" height="${sheet.h}" fill="#fff"/>
<rect x="10" y="10" width="${sheet.w - 20}" height="${sheet.h - 20}" fill="none" stroke="#000" stroke-width=".7"/>
${out.join('\n')}
<g><rect x="${tb.x}" y="${tb.y}" width="${tb.w}" height="${tb.h}" fill="none" stroke="#000" stroke-width=".5"/>
<line x1="${tb.x}" y1="${tb.y + 12}" x2="${tb.x + tb.w}" y2="${tb.y + 12}" stroke="#000" stroke-width=".3"/>
<line x1="${tb.x + 90}" y1="${tb.y + 12}" x2="${tb.x + 90}" y2="${tb.y + tb.h}" stroke="#000" stroke-width=".3"/>
<text x="${tb.x + 3}" y="${tb.y + 8}" class="tbb">${esc(title)}</text>
<text x="${tb.x + 3}" y="${tb.y + 18}" class="tb">Material: ${esc(mats)}</text>
<text x="${tb.x + 3}" y="${tb.y + 23}" class="tb">Massa: ${mass.toFixed(2)} g</text>
<text x="${tb.x + 3}" y="${tb.y + 28}" class="tb">Unidades: mm · Tolerância geral ISO 2768-m</text>
<text x="${tb.x + 93}" y="${tb.y + 18}" class="tb">Escala: ${scaleTxt} · Folha ${sheet.name}</text>
<text x="${tb.x + 93}" y="${tb.y + 23}" class="tb">${first ? '1º diedro (ABNT)' : '3º diedro (ANSI)'}</text>
<text x="${tb.x + 93}" y="${tb.y + 28}" class="tb">${date} · Projetista CAD</text>
${sym}
</g></svg>`;
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
