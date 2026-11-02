// Análises de engenharia sobre a geometria EXATA (B-rep): propriedades de massa por
// integração de Gauss, interferência por booleana, distância mínima por extremos,
// seção por meio-espaço, além de checagem de manufatura e estimativa de custo.
import { v3 } from './kernel.js';
import { MATERIALS } from './materials.js';
import * as occ from '../occ/occ.js';
import { faceInfos } from '../occ/select.js';

const r = (x, d = 6) => +(+x).toFixed(d);

/** Massa, volume, área, CG, tensor de inércia e momentos principais (exatos). */
export function massProperties(body) {
  const p = body.m.props();
  const mat = MATERIALS[body.material] || { density: 1 };
  const rho = mat.density / 1000; // g/mm³
  const bb = body.m.boundingBox();
  const mass = p.volume * rho;
  const I = p.inertia.map((row) => row.map((x) => r(x * rho, 3)));
  return {
    material: body.material, density_g_cm3: mat.density,
    volume_mm3: r(p.volume), volume_cm3: r(p.volume / 1000, 6), surfaceArea_mm2: r(p.area),
    mass_g: r(mass), mass_kg: r(mass / 1000, 9),
    centerOfMass_mm: p.center.map((q) => r(q)),
    inertiaTensor_g_mm2_atCOM: { Ixx: I[0][0], Iyy: I[1][1], Izz: I[2][2], Ixy: I[0][1], Iyz: I[1][2], Ixz: I[0][2] },
    principalMoments_g_mm2: p.principal?.map((x) => r(x * rho, 3)),
    radiiOfGyration_mm: p.principal?.map((x) => r(Math.sqrt(x / p.volume), 4)),
    boundingBox: { min: bb.min.map((q) => r(q)), max: bb.max.map((q) => r(q)), size: v3.sub(bb.max, bb.min).map((q) => r(q)) },
    faces: body.m.faces().length, edges: body.m.edges().length, genus: body.m.genus(), validBRep: occ.isValid(body.m.shape),
    costEstimate_BRL: mat.pricePerKg ? r((mass / 1000) * mat.pricePerKg, 2) : null,
    method: 'B-rep exato, integração de Gauss (OpenCascade), tolerância 1e-9',
  };
}

/** Pares de corpos que se interpenetram, com volume exato da interferência. */
export function interference(bodies) {
  const list = [...bodies.entries()];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [na, a] = list[i], [nb, b] = list[j];
      const ba = a.m.boundingBox(), bbb = b.m.boundingBox();
      if (ba.max.some((v, k) => v < bbb.min[k] - 1e-6) || bbb.max.some((v, k) => v < ba.min[k] - 1e-6)) continue;
      const x = occ.common(a.m.shape, b.m.shape);
      const vol = occ.massProps(x).volume;
      if (vol > 1e-9) { const xb = occ.bbox(x); out.push({ a: na, b: nb, volume_mm3: r(vol), region: { min: xb.min.map((q) => r(q, 4)), max: xb.max.map((q) => r(q, 4)) } }); }
      else {
        const d = occ.distance(a.m.shape, b.m.shape);
        if (d.distance < 1e-6) out.push({ a: na, b: nb, contact: true, volume_mm3: 0 });
      }
    }
  }
  return out;
}

/** Menor distância exata entre dois corpos e os pontos de contato. */
export function clearance(a, b) {
  const d = occ.distance(a.m.shape, b.m.shape);
  return { gap_mm: r(d.distance, 9), pointOnA: d.p1.map((x) => r(x)), pointOnB: d.p2.map((x) => r(x)), touching: d.distance < 1e-7 };
}

/** Seção exata: corta o corpo por um plano e mede a área da face de corte. */
export function section(body, normal = [0, 0, 1], offset = 0) {
  const n = v3.norm(normal);
  const o = v3.mul(n, offset);
  const half = occ.common(body.m.shape, occ.halfSpace(o, v3.mul(n, -1)));
  let area = 0, contours = 0;
  const cutFaces = [];
  for (const f of occ.unique(half, 'FACE')) {
    const d = occ.describeFace(f);
    if (d.type === 'Plane' && v3.dot(d.normal, n) > 1 - 1e-9 && Math.abs(d.offset - offset) < 1e-7) {
      area += d.area; contours += occ.unique(f, 'WIRE').length;
      cutFaces.push({ area: r(d.area), centroid: d.centroid.map((x) => r(x)) });
    }
  }
  // momentos de área da seção (para cálculo de vigas): Ix, Iy em torno do centróide
  return { area_mm2: r(area), regions: cutFaces.length, contours, faces: cutFaces, method: 'exato (B-rep)' };
}

/** Propriedades de uma face (por índice), para medição interativa precisa. */
export function faceInfo(body, index) {
  const f = faceInfos(body.m)[index];
  if (!f) throw new Error(`Face ${index} não existe`);
  const { face, ...rest } = f;
  return JSON.parse(JSON.stringify(rest, (k, v) => (typeof v === 'number' ? r(v) : v)));
}

/** Medição exata entre duas faces: distância mínima e ângulo entre normais/eixos. */
export function measureFaces(bA, ia, bB, ib) {
  const fa = faceInfos(bA.m)[ia], fb = faceInfos(bB.m)[ib];
  if (!fa || !fb) throw new Error('Face inexistente');
  const d = occ.distance(fa.face, fb.face);
  const out = { distance_mm: r(d.distance, 9), pointA: d.p1.map((x) => r(x)), pointB: d.p2.map((x) => r(x)), faceA: fa.type, faceB: fb.type };
  const va = fa.normal || fa.axis, vb = fb.normal || fb.axis;
  if (va && vb) out.angle_deg = r((Math.acos(Math.max(-1, Math.min(1, Math.abs(v3.dot(va, vb))))) * 180) / Math.PI, 6);
  if (fa.type === 'Plane' && fb.type === 'Plane') {
    const sg = v3.dot(fa.normal, fb.normal);
    if (Math.abs(Math.abs(sg) - 1) < 1e-9) out.parallelDistance_mm = r(Math.abs(fb.offset * Math.sign(sg) - fa.offset), 9);
  }
  if (fa.type === 'Cylinder' && fb.type === 'Cylinder') out.axisDistance_mm = r(v3.len(v3.cross(v3.sub(fb.axisPoint, fa.axisPoint), fa.axis)), 9);
  return out;
}

/** Verificação para impressão 3D / manufatura (sobre malha fina do B-rep). */
export function printCheck(body, opts = {}) {
  const maxOverhang = opts.overhangAngle ?? 45;
  const layer = opts.layerHeight ?? 0.2;
  const g = body.m.getMesh();
  const vp = g.vertProperties, tv = g.triVerts;
  const bb = body.m.boundingBox();
  const floor = bb.min[2];
  let overhang = 0, total = 0;
  const cosLim = Math.cos(((90 - maxOverhang) * Math.PI) / 180);
  for (let t = 0; t < tv.length; t += 3) {
    const Pp = [0, 1, 2].map((k) => [vp[tv[t + k] * 3], vp[tv[t + k] * 3 + 1], vp[tv[t + k] * 3 + 2]]);
    const cr = v3.cross(v3.sub(Pp[1], Pp[0]), v3.sub(Pp[2], Pp[0]));
    const a = v3.len(cr) / 2;
    total += a;
    const nz = cr[2] / (2 * a || 1);
    const onBed = Math.max(Pp[0][2], Pp[1][2], Pp[2][2]) - floor < 1e-3;
    if (nz < -cosLim && !onBed) overhang += a;
  }
  const mp = massProperties(body);
  const size = mp.boundingBox.size;
  const printedVol = mp.volume_mm3 * 0.35 + mp.surfaceArea_mm2 * 0.8;
  const issues = [];
  if (overhang / total > 0.05) issues.push(`Balanços acima de ${maxOverhang}° em ${(100 * overhang / total).toFixed(1)}% da superfície — considere suportes ou reorientar.`);
  if (Math.min(...size) < layer * 3) issues.push('Alguma dimensão é menor que 3 camadas.');
  if (opts.minWall !== false) {
    // paredes finas: offset exato para dentro de meia espessura mínima
    const t = (opts.minWall ?? 0.8) / 2;
    try {
      const inner = occ.offsetShape(body.m.shape, -t);
      const v = occ.massProps(inner).volume;
      const comps = occ.unique(inner, 'SOLID').length;
      if (comps === 0 || v <= 0) issues.push(`Todas as paredes são mais finas que ${2 * t} mm.`);
      else if (comps > occ.unique(body.m.shape, 'SOLID').length) issues.push(`Há regiões mais finas que ${2 * t} mm (o offset interno separa o sólido em ${comps} partes).`);
    } catch { issues.push('Não foi possível verificar paredes finas (offset 3D falhou nesta geometria).'); }
  }
  return {
    overhangArea_mm2: r(overhang, 3), overhangPercent: r((100 * overhang) / total, 2), surfaceArea_mm2: r(total, 3),
    size_mm: size, layers: Math.ceil(size[2] / layer),
    estimatedPrintTime_min: r(printedVol / 12 / 60, 1),
    estimatedFilament_g: r((printedVol * (MATERIALS[body.material]?.density || 1.24)) / 1000, 1),
    issues, verdict: issues.length ? 'atenção' : 'ok para imprimir',
  };
}
