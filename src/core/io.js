// Importação/exportação de malhas: STL (ascii/binário), OBJ, 3MF, GLB.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

// ----------------------------------------------------------------- leitura
export function readMeshFile(file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.obj') return readOBJ(buf.toString('utf8'));
  if (ext === '.stl') return readSTL(buf);
  throw new Error(`Formato não suportado para importação: ${ext} (use .stl ou .obj)`);
}

function readSTL(buf) {
  const head = buf.subarray(0, 512).toString('latin1');
  const n = buf.length >= 84 ? buf.readUInt32LE(80) : 0;
  const isBinary = buf.length === 84 + n * 50 || !/^\s*solid[\s\S]*facet/.test(head);
  const pos = [];
  if (isBinary) {
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) pos.push(buf.readFloatLE(o + k * 4));
    }
  } else {
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    const s = buf.toString('latin1');
    let m;
    while ((m = re.exec(s))) pos.push(+m[1], +m[2], +m[3]);
  }
  return weld(pos);
}

function readOBJ(s) {
  const v = [], idx = [];
  for (const line of s.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') v.push(+p[1], +p[2], +p[3]);
    else if (p[0] === 'f') {
      const f = p.slice(1).map((t) => { const i = parseInt(t.split('/')[0], 10); return i < 0 ? v.length / 3 + i : i - 1; });
      for (let k = 1; k + 1 < f.length; k++) idx.push(f[0], f[k], f[k + 1]);
    }
  }
  return { positions: new Float32Array(v), indices: new Uint32Array(idx) };
}

/** Solda vértices duplicados (STL é "sopa de triângulos"). */
function weld(pos) {
  const map = new Map(), out = [], idx = [];
  const q = (x) => Math.round(x * 1e5);
  for (let i = 0; i < pos.length; i += 3) {
    const key = `${q(pos[i])},${q(pos[i + 1])},${q(pos[i + 2])}`;
    let id = map.get(key);
    if (id === undefined) { id = out.length / 3; map.set(key, id); out.push(pos[i], pos[i + 1], pos[i + 2]); }
    idx.push(id);
  }
  // remove triângulos degenerados
  const clean = [];
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
    if (a !== b && b !== c && a !== c) clean.push(a, b, c);
  }
  return { positions: new Float32Array(out), indices: new Uint32Array(clean) };
}

// ----------------------------------------------------------------- escrita
let exportQuality = 'fine';
export function setExportQuality(q) { exportQuality = q; }
function meshArrays(m) {
  if (m.meshFor) { const t = m.meshFor(exportQuality); return { pos: Float32Array.from(t.positions), tri: t.indices }; }
  const g = m.getMesh();
  const n = g.numProp;
  const pos = new Float32Array((g.vertProperties.length / n) * 3);
  for (let i = 0, j = 0; i < g.vertProperties.length; i += n, j += 3) { pos[j] = g.vertProperties[i]; pos[j + 1] = g.vertProperties[i + 1]; pos[j + 2] = g.vertProperties[i + 2]; }
  return { pos, tri: g.triVerts };
}

export function toSTL(bodies) {
  const parts = bodies.map((b) => meshArrays(b.m));
  const ntri = parts.reduce((s, p) => s + p.tri.length / 3, 0);
  const buf = Buffer.alloc(84 + ntri * 50);
  buf.write('Projetista STL', 0, 'latin1');
  buf.writeUInt32LE(ntri, 80);
  let o = 84;
  for (const { pos, tri } of parts) {
    for (let t = 0; t < tri.length; t += 3) {
      const P = (k) => [pos[tri[t + k] * 3], pos[tri[t + k] * 3 + 1], pos[tri[t + k] * 3 + 2]];
      const a = P(0), b = P(1), c = P(2);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...nn) || 1;
      [nn[0] / l, nn[1] / l, nn[2] / l, ...a, ...b, ...c].forEach((x, k) => buf.writeFloatLE(x, o + k * 4));
      o += 50;
    }
  }
  return buf;
}

export function toOBJ(bodies) {
  let s = '# Projetista OBJ\n', base = 1;
  for (const b of bodies) {
    const { pos, tri } = meshArrays(b.m);
    s += `o ${b.name}\n`;
    for (let i = 0; i < pos.length; i += 3) s += `v ${pos[i]} ${pos[i + 1]} ${pos[i + 2]}\n`;
    for (let t = 0; t < tri.length; t += 3) s += `f ${tri[t] + base} ${tri[t + 1] + base} ${tri[t + 2] + base}\n`;
    base += pos.length / 3;
  }
  return Buffer.from(s);
}

function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name);
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function to3MF(bodies) {
  let objs = '', items = '', mats = '';
  bodies.forEach((b, i) => { mats += `<base name="${esc(b.material || b.name)}" displaycolor="${(b.color || '#888888').toUpperCase()}FF"/>`; });
  bodies.forEach((b, i) => {
    const { pos, tri } = meshArrays(b.m);
    let v = '', t = '';
    for (let k = 0; k < pos.length; k += 3) v += `<vertex x="${pos[k]}" y="${pos[k + 1]}" z="${pos[k + 2]}"/>`;
    for (let k = 0; k < tri.length; k += 3) t += `<triangle v1="${tri[k]}" v2="${tri[k + 1]}" v3="${tri[k + 2]}"/>`;
    objs += `<object id="${i + 2}" name="${esc(b.name)}" type="model" pid="1" pindex="${i}"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`;
    items += `<item objectid="${i + 2}"/>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="pt-BR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Projetista</metadata><resources><basematerials id="1">${mats}</basematerials>${objs}</resources><build>${items}</build></model>`;
  return zip([
    ['[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')],
    ['_rels/.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')],
    ['3D/3dmodel.model', Buffer.from(model)],
  ]);
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

export function toGLB(bodies) {
  // glTF 2.0 binário; converte Z-up (CAD) para Y-up (glTF)
  const bins = [], meshes = [], nodes = [], accessors = [], views = [], materials = [];
  let off = 0;
  const push = (arr, target) => { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const pad = (4 - (b.length % 4)) % 4; views.push({ buffer: 0, byteOffset: off, byteLength: b.length, target }); bins.push(b, Buffer.alloc(pad)); off += b.length + pad; return views.length - 1; };
  bodies.forEach((b, i) => {
    const { pos, tri } = meshArrays(b.m);
    const p = new Float32Array(pos.length);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < pos.length; k += 3) {
      p[k] = pos[k] / 1000; p[k + 1] = pos[k + 2] / 1000; p[k + 2] = -pos[k + 1] / 1000; // mm -> m, Z-up -> Y-up
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[k + a]); mx[a] = Math.max(mx[a], p[k + a]); }
    }
    const pv = push(p, 34962), iv = push(new Uint32Array(tri), 34963);
    accessors.push({ bufferView: pv, componentType: 5126, count: p.length / 3, type: 'VEC3', min: mn, max: mx });
    accessors.push({ bufferView: iv, componentType: 5125, count: tri.length, type: 'SCALAR' });
    const c = hex(b.color || '#888888');
    materials.push({ name: b.material || b.name, pbrMetallicRoughness: { baseColorFactor: [...c, 1], metallicFactor: 0.1, roughnessFactor: 0.6 } });
    meshes.push({ name: b.name, primitives: [{ attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1, material: i }] });
    nodes.push({ name: b.name, mesh: i });
  });
  const bin = Buffer.concat(bins);
  const json = { asset: { version: '2.0', generator: 'Projetista' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, materials, accessors, bufferViews: views, buffers: [{ byteLength: bin.length }] };
  let jb = Buffer.from(JSON.stringify(json));
  jb = Buffer.concat([jb, Buffer.alloc((4 - (jb.length % 4)) % 4, 0x20)]);
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + jb.length + 8 + bin.length, 8);
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(jb.length, 0); c1.writeUInt32LE(0x4e4f534a, 4);
  const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, c1, jb, c2, bin]);
}

export function hex(c) {
  const s = c.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
}
