// Registro de comandos (faixa de opções, busca, menu radial, atalhos) e os painéis de
// propriedades de cada feature.
import { rpc } from './rpc.js';
import { app, bodyNames, sketchNames, edgesOf, facesOf, r6 } from './store.js';
import { openPanel, activePanel } from './panel.js';
import { toast } from './ui.js';
import * as D from './dialogs.js';
import * as SK from './sketcher.js';

// ---------------------------------------------------------------- campos reutilizáveis
const AXES = [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }];
const OPS = [
  { value: 'join', label: 'Unir', icon: 'opJoin' }, { value: 'cut', label: 'Recortar', icon: 'opCut' },
  { value: 'intersect', label: 'Interseção', icon: 'opIntersect' }, { value: 'new', label: 'Novo sólido', icon: 'opNew' },
];
const nextBodyName = () => { let i = 1; const names = new Set(bodyNames()); while (names.has(`Corpo${i}`)) i++; return `Corpo${i}`; };
const outputFields = (opts = OPS) => [
  { key: 'operation', label: 'Booleana', type: 'segmented', options: opts, rerender: true },
  { key: 'target', label: 'Corpo alvo', type: 'select', options: () => bodyNames(), show: (s) => s.operation !== 'new' },
  { key: 'body', label: 'Nome do corpo', type: 'text', show: (s) => s.operation === 'new' },
  { key: 'material', label: 'Material', type: 'select', options: () => ['(padrão)', ...(app.materials || [])], show: (s) => s.operation === 'new' },
];
const outDefaults = () => (bodyNames().length ? { operation: 'join', target: bodyNames()[0], body: nextBodyName() } : { operation: 'new', body: nextBodyName() });
const outFeature = (s) => (s.operation === 'new'
  ? { operation: 'new', body: s.body || nextBodyName(), ...(s.material && s.material !== '(padrão)' ? { material: s.material } : {}) }
  : { operation: s.operation, target: s.target });
const outFrom = (f) => ({ operation: f.operation || 'new', target: f.target || bodyNames()[0], body: f.body, material: f.material || '(padrão)' });
const bodyField = (label = 'Corpo') => ({ key: 'body', label, type: 'select', options: () => bodyNames() });
const lastSketch = () => sketchNames().at(-1);
const parsePoints = (txt) => String(txt || '').split(/\n|;(?=\s*[-\d(])/).map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/[()[\]]/g, '').split(/[,\s]+/).filter(Boolean).map((x) => (isNaN(+x) ? x : +x))).filter((p) => p.length === 3);
const fmtPoints = (pts) => (pts || []).map((p) => p.join(', ')).join('\n');

function edgePick(label = 'Arestas') {
  return {
    key: 'edges', label, type: 'pick', filter: { edges: true }, prompt: 'Selecione arestas no modelo (clique de novo para remover)',
    items: (s) => s.edges || [], summary: (it) => `${it.length} aresta(s)`, clear: (s) => { s.edges = []; },
    accept: (hit, s) => hit.kind === 'edge' && (!s.body || hit.body === s.body),
    onPick: async (hit, s) => {
      if (!s.body) s.body = hit.body;
      const e = (await edgesOf(hit.body)).find((x) => x.index === hit.index);
      const list = (s.edges ||= []);
      const i = list.findIndex((x) => Math.hypot(...x.near.map((v, k) => v - e.mid[k])) < 1e-6);
      if (i >= 0) list.splice(i, 1); else list.push({ near: e.mid, type: e.type, length: e.length });
    },
    markers: (s) => (s.edges || []).map((x) => x.near),
  };
}
function facePick({ key = 'faces', label = 'Faces', multiple = true, prompt = 'Selecione faces', planar = false, bodyKey = 'body' } = {}) {
  return {
    key, label, type: 'pick', filter: { faces: true }, prompt, single: !multiple,
    items: (s) => (multiple ? s[key] || [] : s[key] ? [s[key]] : []),
    summary: (it) => (multiple ? `${it.length} face(s)` : `${it[0].type || 'Face'} em ${it[0].body}`),
    clear: (s) => { s[key] = multiple ? [] : null; },
    accept: (hit, s) => hit.kind === 'face' && (!bodyKey || !s[bodyKey] || !multiple || hit.body === s[bodyKey]),
    onPick: async (hit, s) => {
      const f = (await facesOf(hit.body)).find((x) => x.index === hit.index);
      if (planar && f.type !== 'Plane') { toast('Selecione uma face plana.', 'warn'); return; }
      const ref = { body: hit.body, type: f.type, ...(f.normal ? { normal: f.normal } : {}), near: f.centroid, point: r6(hit.point) };
      if (bodyKey && !s[bodyKey]) s[bodyKey] = hit.body;
      if (!multiple) { s[key] = ref; return; }
      const list = (s[key] ||= []);
      const i = list.findIndex((x) => Math.hypot(...x.near.map((v, k) => v - ref.near[k])) < 1e-6);
      if (i >= 0) list.splice(i, 1); else list.push(ref);
    },
    markers: (s) => (multiple ? s[key] || [] : s[key] ? [s[key]] : []).map((x) => x.point || x.near),
  };
}
const faceSel = (r) => ({ ...(r.type === 'Plane' ? { normal: r.normal } : { type: r.type.toLowerCase() }), near: r.near });

// ---------------------------------------------------------------- painéis de features
const P = {};

P.extrude = {
  type: 'extrude', prompt: 'Escolha o perfil e a distância',
  defaults: () => ({ sketch: lastSketch(), extent: 'distance', distance: 20, direction: 'normal', taper: 0, twist: 0, cornerRadius: '', thinWall: '', ...outDefaults() }),
  fromFeature: (f) => ({ ...outFrom(f), sketch: f.sketch, extent: f.distance === 'through' ? 'through' : 'distance', distance: f.distance === 'through' ? 20 : f.distance, direction: f.direction || 'normal', distance2: f.distance2 ?? 10, taper: f.taper ?? 0, twist: f.twist ?? 0, cornerRadius: f.cornerRadius ?? '', thinWall: f.thinWall ?? '' }),
  valid: (s) => !!s.sketch,
  toFeature: (s) => ({
    type: 'extrude', sketch: s.sketch, distance: s.extent === 'through' ? 'through' : s.distance,
    direction: s.extent === 'through' && s.direction === 'normal' ? 'symmetric' : s.direction,
    ...(s.direction === 'two-sides' ? { distance2: s.distance2 ?? 10 } : {}),
    ...(s.taper ? { taper: s.taper } : {}), ...(s.twist ? { twist: s.twist } : {}),
    ...(s.cornerRadius !== '' && s.cornerRadius !== 0 ? { cornerRadius: s.cornerRadius } : {}),
    ...(s.thinWall !== '' && s.thinWall !== 0 ? { thinWall: s.thinWall } : {}),
    ...outFeature(s),
  }),
  sections: [
    { title: 'Entrada geométrica', fields: [{ key: 'sketch', label: 'Perfil (esboço)', type: 'select', options: () => sketchNames() }] },
    { title: 'Comportamento', fields: [
      { key: 'direction', label: 'Direção', type: 'segmented', options: [{ value: 'normal', label: 'Padrão', icon: 'dirNormal' }, { value: 'reverse', label: 'Invertida', icon: 'dirReverse' }, { value: 'symmetric', label: 'Simétrica', icon: 'dirSym' }, { value: 'two-sides', label: 'Dois lados', icon: 'dirTwo' }], rerender: true },
      { key: 'extent', label: 'Extensão', type: 'segmented', labels: true, options: [{ value: 'distance', label: 'Distância' }, { value: 'through', label: 'Através de tudo' }], rerender: true },
      { key: 'distance', label: 'Distância A', type: 'expr', unit: 'mm', show: (s) => s.extent !== 'through' },
      { key: 'distance2', label: 'Distância B', type: 'expr', unit: 'mm', show: (s) => s.direction === 'two-sides' },
    ] },
    { title: 'Saída', fields: outputFields() },
    { title: 'Configurações avançadas', fields: [
      { key: 'taper', label: 'Ângulo de afunilamento', type: 'expr', unit: '°' },
      { key: 'twist', label: 'Torção', type: 'expr', unit: '°' },
      { key: 'cornerRadius', label: 'Arredondar cantos do perfil', type: 'expr', unit: 'mm' },
      { key: 'thinWall', label: 'Parede fina (espessura)', type: 'expr', unit: 'mm' },
    ] },
  ],
};

P.revolve = {
  type: 'revolve', prompt: 'Escolha o perfil e o eixo de revolução',
  defaults: () => ({ sketch: lastSketch(), axis: 'y', angle: 360, ...outDefaults() }),
  fromFeature: (f) => ({ ...outFrom(f), sketch: f.sketch, axis: f.axis || 'y', angle: f.angle ?? 360 }),
  valid: (s) => !!s.sketch,
  toFeature: (s) => ({ type: 'revolve', sketch: s.sketch, axis: s.axis, angle: s.angle, ...outFeature(s) }),
  sections: [
    { title: 'Entrada geométrica', fields: [
      { key: 'sketch', label: 'Perfil (esboço)', type: 'select', options: () => sketchNames() },
      { key: 'axis', label: 'Eixo do esboço', type: 'segmented', labels: true, options: [{ value: 'x', label: 'Eixo X' }, { value: 'y', label: 'Eixo Y' }] },
    ] },
    { title: 'Comportamento', fields: [{ key: 'angle', label: 'Ângulo', type: 'expr', unit: '°' }] },
    { title: 'Saída', fields: outputFields() },
  ],
};

P.loft = {
  type: 'loft', prompt: 'Marque duas ou mais seções na ordem',
  defaults: () => ({ sections: sketchNames().slice(-2), ruled: false, ...outDefaults() }),
  fromFeature: (f) => ({ ...outFrom(f), sections: f.sections, ruled: !!f.ruled }),
  valid: (s) => (s.sections || []).length >= 2,
  toFeature: (s) => ({ type: 'loft', sections: s.sections, ...(s.ruled ? { ruled: true } : {}), ...outFeature(s) }),
  sections: [
    { title: 'Seções', fields: [{ key: 'sections', label: 'Esboços', type: 'checklist', options: () => sketchNames() }, { key: 'ruled', label: 'Superfícies regradas (retas)', type: 'toggle' }] },
    { title: 'Saída', fields: outputFields() },
  ],
};

P.sweep = {
  type: 'sweep', prompt: 'Escolha o perfil e digite os pontos do caminho',
  defaults: () => ({ profile: lastSketch(), path: '0, 0, 0\n0, 0, 40\n30, 0, 60', bendRadius: 5, ...outDefaults() }),
  fromFeature: (f) => ({ ...outFrom(f), profile: f.profile, path: fmtPoints(f.path), bendRadius: f.bendRadius ?? 0 }),
  valid: (s) => !!s.profile && parsePoints(s.path).length >= 2,
  toFeature: (s) => ({ type: 'sweep', profile: s.profile, path: parsePoints(s.path), ...(s.bendRadius ? { bendRadius: s.bendRadius } : {}), ...outFeature(s) }),
  sections: [
    { title: 'Entrada geométrica', fields: [
      { key: 'profile', label: 'Perfil (esboço)', type: 'select', options: () => sketchNames() },
      { key: 'path', label: 'Caminho (x, y, z por linha)', type: 'textarea', rows: 4 },
      { key: 'bendRadius', label: 'Raio de dobra', type: 'expr', unit: 'mm' },
    ] },
    { title: 'Saída', fields: outputFields() },
  ],
};

P.pipe = {
  type: 'pipe', prompt: 'Digite os pontos do caminho do tubo',
  defaults: () => ({ path: '0, 0, 0\n0, 0, 50\n40, 0, 50', diameter: 12, wall: 1.5, hollow: true, bendRadius: '', ...outDefaults(), operation: 'new' }),
  fromFeature: (f) => ({ ...outFrom(f), path: fmtPoints(f.path), diameter: f.diameter ?? (f.radius ? `(${f.radius})*2` : 12), wall: f.wall ?? 1.5, hollow: f.wall !== undefined || f.innerRadius !== undefined, bendRadius: f.bendRadius ?? '' }),
  valid: (s) => parsePoints(s.path).length >= 2,
  toFeature: (s) => ({ type: 'pipe', path: parsePoints(s.path), diameter: s.diameter, ...(s.hollow ? { wall: s.wall } : {}), ...(s.bendRadius !== '' ? { bendRadius: s.bendRadius } : {}), ...outFeature(s) }),
  sections: [
    { title: 'Caminho', fields: [{ key: 'path', label: 'Pontos (x, y, z por linha)', type: 'textarea', rows: 4 }, { key: 'bendRadius', label: 'Raio de curvatura', type: 'expr', unit: 'mm', placeholder: '2 × raio' }] },
    { title: 'Seção', fields: [{ key: 'diameter', label: 'Diâmetro externo', type: 'expr', unit: 'mm' }, { key: 'hollow', label: 'Oco', type: 'toggle' }, { key: 'wall', label: 'Parede', type: 'expr', unit: 'mm', show: (s) => s.hollow }] },
    { title: 'Saída', fields: outputFields() },
  ],
};

const ISO = ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M16', 'M20', 'M24'];
P.hole = {
  type: 'hole', prompt: 'Clique numa face plana para posicionar furos (vários cliques = vários furos)',
  defaults: () => ({ positions: '', direction: null, target: null, holeType: 'simple', sizeMode: 'iso', size: 'M5', fit: 'clearance', diameter: 6, depthMode: 'through', depth: 10, cbDiameter: '', cbDepth: '', csDiameter: '', csAngle: 90 }),
  fromFeature: (f) => ({ positions: fmtPoints(f.positions || [f.at]), direction: f.direction, target: f.target, holeType: f.holeType || 'simple', sizeMode: f.size ? 'iso' : 'diameter', size: f.size || 'M5', fit: f.fit || 'clearance', diameter: f.diameter ?? 6, depthMode: f.depth === undefined || f.depth === 'through' ? 'through' : 'distance', depth: f.depth ?? 10, cbDiameter: f.cbDiameter ?? '', cbDepth: f.cbDepth ?? '', csDiameter: f.csDiameter ?? '', csAngle: f.csAngle ?? 90 }),
  valid: (s) => !!s.target && parsePoints(s.positions).length > 0,
  toFeature: (s) => ({
    type: 'hole', target: s.target, positions: parsePoints(s.positions), direction: s.direction || '-z', holeType: s.holeType,
    ...(s.sizeMode === 'iso' ? { size: s.size, fit: s.fit } : { diameter: s.diameter }),
    ...(s.depthMode === 'through' ? {} : { depth: s.depth }),
    ...(s.holeType === 'counterbore' && s.cbDiameter !== '' ? { cbDiameter: s.cbDiameter } : {}),
    ...(s.holeType === 'counterbore' && s.cbDepth !== '' ? { cbDepth: s.cbDepth } : {}),
    ...(s.holeType === 'countersink' && s.csDiameter !== '' ? { csDiameter: s.csDiameter } : {}),
    ...(s.holeType === 'countersink' ? { csAngle: s.csAngle } : {}),
  }),
  markers: (s) => parsePoints(s.positions).filter((p) => p.every((x) => typeof x === 'number')),
  sections: [
    { title: 'Posicionamento', fields: [
      { key: 'face', label: 'Face', type: 'pick', filter: { faces: true }, prompt: 'Clique numa face plana para posicionar furos',
        items: (s) => parsePoints(s.positions), summary: (it) => `${it.length} furo(s) em ${''}`, clear: (s) => { s.positions = ''; s.target = null; },
        accept: (hit) => hit.kind === 'face',
        onPick: async (hit, s) => {
          const f = (await facesOf(hit.body)).find((x) => x.index === hit.index);
          if (f.type !== 'Plane') { toast('Furos precisam de uma face plana.', 'warn'); return; }
          s.target ||= hit.body;
          s.direction = f.normal.map((x) => -x);
          s.positions = [s.positions, r6(hit.point).join(', ')].filter(Boolean).join('\n');
        } },
      { key: 'positions', label: 'Centros (x, y, z)', type: 'textarea', rows: 3, hint: 'Edite para coordenadas exatas' },
    ] },
    { title: 'Tipo', fields: [
      { key: 'holeType', label: 'Tipo', type: 'segmented', labels: true, options: [{ value: 'simple', label: 'Simples' }, { value: 'counterbore', label: 'Rebaixo' }, { value: 'countersink', label: 'Escareado' }], rerender: true },
      { key: 'sizeMode', label: 'Dimensão', type: 'segmented', labels: true, options: [{ value: 'iso', label: 'Rosca ISO' }, { value: 'diameter', label: 'Diâmetro' }], rerender: true },
      { key: 'size', label: 'Tamanho', type: 'select', options: ISO, show: (s) => s.sizeMode === 'iso' },
      { key: 'fit', label: 'Ajuste', type: 'segmented', labels: true, options: [{ value: 'clearance', label: 'Passagem' }, { value: 'tap', label: 'Para rosca' }], show: (s) => s.sizeMode === 'iso' },
      { key: 'diameter', label: 'Diâmetro', type: 'expr', unit: 'mm', show: (s) => s.sizeMode === 'diameter' },
      { key: 'cbDiameter', label: 'Ø rebaixo', type: 'expr', unit: 'mm', placeholder: 'auto (ISO 4762)', show: (s) => s.holeType === 'counterbore' },
      { key: 'cbDepth', label: 'Prof. rebaixo', type: 'expr', unit: 'mm', placeholder: 'auto', show: (s) => s.holeType === 'counterbore' },
      { key: 'csDiameter', label: 'Ø escareado', type: 'expr', unit: 'mm', placeholder: 'auto', show: (s) => s.holeType === 'countersink' },
      { key: 'csAngle', label: 'Ângulo', type: 'expr', unit: '°', show: (s) => s.holeType === 'countersink' },
    ] },
    { title: 'Terminação', fields: [
      { key: 'depthMode', label: 'Terminação', type: 'segmented', labels: true, options: [{ value: 'through', label: 'Passante' }, { value: 'distance', label: 'Distância' }], rerender: true },
      { key: 'depth', label: 'Profundidade', type: 'expr', unit: 'mm', show: (s) => s.depthMode === 'distance' },
    ] },
  ],
};

const edgeFeature = (type, extra) => ({
  type, prompt: 'Selecione as arestas',
  defaults: () => ({ body: null, edges: [], all: false, ...extra.defaults }),
  fromFeature: (f) => ({ body: f.body, all: f.edges === 'all', edges: Array.isArray(f.edges) ? f.edges.filter((e) => e.near).map((e) => ({ near: e.near })) : [], ...extra.from(f), keepSelector: f.edges }),
  valid: (s) => !!s.body && (s.all || (s.edges || []).length > 0 || s.keepSelector),
  toFeature: (s) => ({ type, body: s.body, edges: s.all ? 'all' : (s.edges || []).length ? s.edges.map((e) => ({ near: e.near })) : s.keepSelector, ...extra.to(s) }),
});
P.fillet = {
  ...edgeFeature('fillet', { defaults: { radius: 2 }, from: (f) => ({ radius: f.radius }), to: (s) => ({ radius: s.radius }) }),
  sections: [
    { title: 'Arestas', fields: [edgePick(), { key: 'all', label: 'Todas as arestas do corpo', type: 'toggle' }, { key: 'body', label: 'Corpo', type: 'select', options: () => bodyNames(), show: (s) => s.all }] },
    { title: 'Raio', fields: [{ key: 'radius', label: 'Raio', type: 'expr', unit: 'mm' }] },
  ],
};
P.chamfer = {
  ...edgeFeature('chamfer', { defaults: { distance: 1, twoDist: false, distance2: 1 }, from: (f) => ({ distance: f.distance, twoDist: f.distance2 !== undefined, distance2: f.distance2 ?? 1 }), to: (s) => ({ distance: s.distance, ...(s.twoDist ? { distance2: s.distance2 } : {}) }) }),
  sections: [
    { title: 'Arestas', fields: [edgePick(), { key: 'all', label: 'Todas as arestas do corpo', type: 'toggle' }, { key: 'body', label: 'Corpo', type: 'select', options: () => bodyNames(), show: (s) => s.all }] },
    { title: 'Dimensões', fields: [{ key: 'distance', label: 'Distância', type: 'expr', unit: 'mm' }, { key: 'twoDist', label: 'Duas distâncias', type: 'toggle' }, { key: 'distance2', label: 'Distância 2', type: 'expr', unit: 'mm', show: (s) => s.twoDist }] },
  ],
};

P.shell = {
  type: 'shell', prompt: 'Selecione as faces a remover (abertas)',
  defaults: () => ({ body: bodyNames()[0], thickness: 2, faces: [] }),
  fromFeature: (f) => ({ body: f.body, thickness: f.thickness, faces: [], keep: f.openFaces }),
  valid: (s) => !!s.body,
  toFeature: (s) => ({ type: 'shell', body: s.body, thickness: s.thickness, openFaces: s.faces?.length ? s.faces.map(faceSel) : s.keep || [] }),
  sections: [
    { title: 'Entrada', fields: [bodyField(), facePick({ label: 'Remover faces', prompt: 'Selecione as faces que ficarão abertas' })] },
    { title: 'Espessura', fields: [{ key: 'thickness', label: 'Espessura', type: 'expr', unit: 'mm' }] },
  ],
};

P.draft = {
  type: 'draft', prompt: 'Faces laterais recebem o ângulo de saída (ou selecione faces)',
  defaults: () => ({ body: bodyNames()[0], pull: 'z', angle: 2, faces: [] }),
  fromFeature: (f) => ({ body: f.body, pull: f.pull || 'z', angle: f.angle, faces: [], keep: f.faces }),
  valid: (s) => !!s.body,
  toFeature: (s) => ({ type: 'draft', body: s.body, pull: s.pull, angle: s.angle, ...(s.faces?.length ? { faces: s.faces.map(faceSel) } : s.keep ? { faces: s.keep } : {}) }),
  sections: [
    { title: 'Entrada', fields: [bodyField(), { key: 'pull', label: 'Direção de extração', type: 'segmented', labels: true, options: [{ value: 'z', label: '+Z' }, { value: '-z', label: '−Z' }, { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] }, facePick({ label: 'Faces (opcional)', prompt: 'Selecione faces (vazio = todas as laterais)' })] },
    { title: 'Ângulo', fields: [{ key: 'angle', label: 'Ângulo de saída', type: 'expr', unit: '°' }] },
  ],
};

P.push_pull = {
  type: 'push_pull', prompt: 'Selecione uma face plana',
  defaults: () => ({ face: null, distance: 5 }),
  fromFeature: (f) => ({ face: { body: f.body, type: 'Plane', normal: f.face?.normal, near: f.face?.near || f.face?.centroid || [0, 0, 0] }, distance: f.distance }),
  valid: (s) => !!s.face,
  toFeature: (s) => ({ type: 'push_pull', body: s.face.body, face: { normal: s.face.normal, near: s.face.near }, distance: s.distance }),
  sections: [{ title: 'Entrada', fields: [facePick({ key: 'face', label: 'Face', multiple: false, planar: true, bodyKey: null, prompt: 'Selecione a face a empurrar/puxar' }), { key: 'distance', label: 'Distância (+ puxa, − empurra)', type: 'expr', unit: 'mm' }] }],
};

P.boolean = {
  type: 'boolean', prompt: 'Escolha o corpo base e as ferramentas',
  defaults: () => ({ target: bodyNames()[0], tools: bodyNames().slice(1, 2), operation: 'join', keepTools: false }),
  fromFeature: (f) => ({ target: f.target, tools: f.tools, operation: f.operation || 'join', keepTools: !!f.keepTools }),
  valid: (s) => !!s.target && (s.tools || []).length > 0 && !s.tools.includes(s.target),
  toFeature: (s) => ({ type: 'boolean', target: s.target, tools: s.tools, operation: s.operation, ...(s.keepTools ? { keepTools: true } : {}) }),
  sections: [{ title: 'Combinar', fields: [
    { key: 'target', label: 'Corpo base', type: 'select', options: () => bodyNames() },
    { key: 'tools', label: 'Corpos ferramenta', type: 'checklist', options: (a, s) => bodyNames().filter((b) => b !== s.target) },
    { key: 'operation', label: 'Operação', type: 'segmented', options: OPS.slice(0, 3) },
    { key: 'keepTools', label: 'Manter corpos ferramenta', type: 'toggle' },
  ] }],
};

P.transform = {
  type: 'transform', prompt: 'Mover / girar corpo',
  defaults: () => ({ body: bodyNames()[0], translate: [0, 0, 0], rotate: [0, 0, 0], center: [0, 0, 0], copy: '' }),
  fromFeature: (f) => ({ body: f.body, translate: f.translate || [0, 0, 0], rotate: f.rotate || [0, 0, 0], center: f.center || [0, 0, 0], copy: f.copy || '' }),
  valid: (s) => !!s.body,
  toFeature: (s) => ({ type: 'transform', body: s.body, translate: s.translate, rotate: s.rotate, center: s.center, ...(s.copy ? { copy: s.copy } : {}) }),
  sections: [{ title: 'Mover corpo', fields: [bodyField(), { key: 'translate', label: 'Deslocamento', type: 'vec3' }, { key: 'rotate', label: 'Rotação (°)', type: 'vec3' }, { key: 'center', label: 'Centro de rotação', type: 'vec3' }, { key: 'copy', label: 'Criar cópia com nome', type: 'text', placeholder: '(mover o original)' }] }],
};

P.mirror = {
  type: 'mirror', prompt: 'Espelhar corpo por um plano de origem',
  defaults: () => ({ body: bodyNames()[0], plane: 'x', offset: 0, mode: 'merge', copy: '' }),
  fromFeature: (f) => ({ body: f.body, plane: typeof f.normal === 'string' ? f.normal.replace(/[+-]/, '') : 'x', offset: f.offset ?? 0, mode: f.copy ? 'copy' : 'merge', copy: f.copy || '' }),
  valid: (s) => !!s.body,
  toFeature: (s) => ({ type: 'mirror', body: s.body, normal: s.plane, offset: s.offset, ...(s.mode === 'copy' ? { copy: s.copy || `${s.body}_espelho` } : {}) }),
  sections: [{ title: 'Espelhar', fields: [bodyField(),
    { key: 'plane', label: 'Plano', type: 'segmented', labels: true, options: [{ value: 'x', label: 'YZ' }, { value: 'y', label: 'XZ' }, { value: 'z', label: 'XY' }] },
    { key: 'offset', label: 'Deslocamento do plano', type: 'expr', unit: 'mm' },
    { key: 'mode', label: 'Resultado', type: 'segmented', labels: true, options: [{ value: 'merge', label: 'Unir' }, { value: 'copy', label: 'Novo corpo' }], rerender: true },
    { key: 'copy', label: 'Nome', type: 'text', show: (s) => s.mode === 'copy' }] }],
};

P.pattern_linear = {
  type: 'pattern_linear', prompt: 'Padrão retangular de um corpo',
  defaults: () => ({ body: bodyNames()[0], direction: 'x', count: 3, spacing: 20, two: false, direction2: 'y', count2: 2, spacing2: 20 }),
  fromFeature: (f) => ({ body: f.body, direction: f.direction || 'x', count: f.count, spacing: f.spacing, two: !!f.direction2, direction2: f.direction2 || 'y', count2: f.count2 ?? 2, spacing2: f.spacing2 ?? 20 }),
  valid: (s) => !!s.body,
  toFeature: (s) => ({ type: 'pattern_linear', body: s.body, direction: s.direction, count: s.count, spacing: s.spacing, ...(s.two ? { direction2: s.direction2, count2: s.count2, spacing2: s.spacing2 } : {}) }),
  sections: [{ title: 'Direção 1', fields: [bodyField(), { key: 'direction', label: 'Direção', type: 'segmented', labels: true, options: AXES }, { key: 'count', label: 'Quantidade', type: 'expr' }, { key: 'spacing', label: 'Espaçamento', type: 'expr', unit: 'mm' }] },
    { title: 'Direção 2', fields: [{ key: 'two', label: 'Usar segunda direção', type: 'toggle' }, { key: 'direction2', label: 'Direção', type: 'segmented', labels: true, options: AXES, show: (s) => s.two }, { key: 'count2', label: 'Quantidade', type: 'expr', show: (s) => s.two }, { key: 'spacing2', label: 'Espaçamento', type: 'expr', unit: 'mm', show: (s) => s.two }] }],
};

P.pattern_circular = {
  type: 'pattern_circular', prompt: 'Padrão circular de um corpo',
  defaults: () => ({ body: bodyNames()[0], axis: 'z', center: [0, 0, 0], count: 6, angle: 360 }),
  fromFeature: (f) => ({ body: f.body, axis: f.axis || 'z', center: f.center || [0, 0, 0], count: f.count, angle: f.angle ?? 360 }),
  valid: (s) => !!s.body,
  toFeature: (s) => ({ type: 'pattern_circular', body: s.body, axis: s.axis, center: s.center, count: s.count, angle: s.angle }),
  sections: [{ title: 'Padrão circular', fields: [bodyField(), { key: 'axis', label: 'Eixo', type: 'segmented', labels: true, options: AXES }, { key: 'center', label: 'Centro', type: 'vec3' }, { key: 'count', label: 'Quantidade', type: 'expr' }, { key: 'angle', label: 'Ângulo total', type: 'expr', unit: '°' }] }],
};

P.split = {
  type: 'split', prompt: 'Dividir corpo por um plano',
  defaults: () => ({ body: bodyNames()[0], normal: 'z', offset: 0, keep: 'both', otherBody: '' }),
  fromFeature: (f) => ({ body: f.body, normal: f.normal || 'z', offset: f.offset ?? 0, keep: f.keep || 'both', otherBody: f.otherBody || '' }),
  valid: (s) => !!s.body,
  toFeature: (s) => ({ type: 'split', body: s.body, normal: s.normal, offset: s.offset, keep: s.keep, ...(s.otherBody ? { otherBody: s.otherBody } : {}) }),
  sections: [{ title: 'Dividir', fields: [bodyField(), { key: 'normal', label: 'Normal do plano', type: 'segmented', labels: true, options: AXES }, { key: 'offset', label: 'Posição', type: 'expr', unit: 'mm' },
    { key: 'keep', label: 'Manter', type: 'segmented', labels: true, options: [{ value: 'both', label: 'Ambos' }, { value: 'positive', label: 'Lado +' }, { value: 'negative', label: 'Lado −' }] }] }],
};

P.offset_body = {
  type: 'offset_body', prompt: 'Espessar / offset 3D',
  defaults: () => ({ body: bodyNames()[0], distance: 1, copy: '' }),
  fromFeature: (f) => ({ body: f.body, distance: f.distance, copy: f.copy || '' }),
  valid: (s) => !!s.body,
  toFeature: (s) => ({ type: 'offset_body', body: s.body, distance: s.distance, ...(s.copy ? { copy: s.copy } : {}) }),
  sections: [{ title: 'Offset', fields: [bodyField(), { key: 'distance', label: 'Distância (±)', type: 'expr', unit: 'mm' }, { key: 'copy', label: 'Novo corpo', type: 'text', placeholder: '(substituir)' }] }],
};

P.mate = {
  type: 'mate', prompt: 'Selecione a face do corpo a mover e depois a face de destino',
  defaults: () => ({ a: null, b: null, offset: 0, angle: 0, align: 'centroid' }),
  fromFeature: (f) => ({ a: { body: f.body, type: 'Plane', normal: f.face?.normal, near: f.face?.near || [0, 0, 0] }, b: { body: f.to?.body, type: 'Plane', normal: f.to?.normal, near: f.to?.near || [0, 0, 0] }, offset: f.offset ?? 0, angle: f.angle ?? 0, align: f.align || 'centroid' }),
  valid: (s) => !!s.a && !!s.b && s.a.body !== s.b.body,
  toFeature: (s) => ({ type: 'mate', body: s.a.body, face: { normal: s.a.normal, near: s.a.near }, to: { body: s.b.body, normal: s.b.normal, near: s.b.near }, offset: s.offset, ...(s.angle ? { angle: s.angle } : {}), align: s.align }),
  sections: [{ title: 'Restrição de montagem', fields: [
    facePick({ key: 'a', label: 'Face a mover', multiple: false, planar: true, bodyKey: null, prompt: 'Selecione a face do corpo que vai se mover' }),
    facePick({ key: 'b', label: 'Face de destino', multiple: false, planar: true, bodyKey: null, prompt: 'Selecione a face de destino (outro corpo)' }),
    { key: 'offset', label: 'Folga', type: 'expr', unit: 'mm' }, { key: 'angle', label: 'Ângulo', type: 'expr', unit: '°' },
    { key: 'align', label: 'Alinhar', type: 'segmented', labels: true, options: [{ value: 'centroid', label: 'Centros' }, { value: 'plane', label: 'Só o plano' }] },
  ] }],
};

const primitive = (type, fields, defaults) => ({
  type, prompt: 'Defina as dimensões e a posição',
  defaults: () => ({ ...defaults, at: [0, 0, 0], ...outDefaults(), operation: 'new' }),
  fromFeature: (f) => ({ ...defaults, ...f, ...outFrom(f), at: f.at || [0, 0, 0] }),
  toFeature: (s) => { const o = { type, at: s.at }; for (const f of fields) if (s[f.key] !== '' && s[f.key] !== undefined) o[f.key] = s[f.key]; return { ...o, ...outFeature(s) }; },
  sections: [{ title: 'Dimensões', fields: [...fields, { key: 'at', label: 'Posição', type: 'vec3' }] }, { title: 'Saída', fields: outputFields() }],
});
P.box = primitive('box', [{ key: 'width', label: 'Largura (X)', type: 'expr', unit: 'mm' }, { key: 'depth', label: 'Profundidade (Y)', type: 'expr', unit: 'mm' }, { key: 'height', label: 'Altura (Z)', type: 'expr', unit: 'mm' }, { key: 'fillet', label: 'Arredondar arestas', type: 'expr', unit: 'mm' }], { width: 40, depth: 30, height: 20, fillet: '' });
P.cylinder = primitive('cylinder', [{ key: 'diameter', label: 'Diâmetro', type: 'expr', unit: 'mm' }, { key: 'height', label: 'Altura', type: 'expr', unit: 'mm' }, { key: 'axis', label: 'Eixo', type: 'select', options: ['z', 'x', 'y'] }], { diameter: 20, height: 30, axis: 'z' });
P.sphere = primitive('sphere', [{ key: 'diameter', label: 'Diâmetro', type: 'expr', unit: 'mm' }], { diameter: 30 });
P.torus = primitive('torus', [{ key: 'majorRadius', label: 'Raio maior', type: 'expr', unit: 'mm' }, { key: 'minorRadius', label: 'Raio menor', type: 'expr', unit: 'mm' }, { key: 'axis', label: 'Eixo', type: 'select', options: ['z', 'x', 'y'] }], { majorRadius: 20, minorRadius: 5, axis: 'z' });
P.cone = primitive('cone', [{ key: 'radius1', label: 'Raio da base', type: 'expr', unit: 'mm' }, { key: 'radius2', label: 'Raio do topo', type: 'expr', unit: 'mm' }, { key: 'height', label: 'Altura', type: 'expr', unit: 'mm' }, { key: 'axis', label: 'Eixo', type: 'select', options: ['z', 'x', 'y'] }], { radius1: 15, radius2: 5, height: 30, axis: 'z' });

P.import_step = {
  type: 'import_step', prompt: 'Importar geometria STEP (B-rep exato)',
  defaults: () => ({ file: '', at: [0, 0, 0], scale: 1, body: nextBodyName() }),
  fromFeature: (f) => ({ file: f.file, at: f.at || [0, 0, 0], scale: f.scale ?? 1, body: f.body }),
  valid: (s) => !!s.file,
  toFeature: (s) => ({ type: 'import_step', file: s.file, at: s.at, ...(s.scale !== 1 ? { scale: s.scale } : {}), operation: 'new', body: s.body }),
  sections: [{ title: 'Arquivo', fields: [
    { key: 'pickFile', label: 'Escolher arquivo STEP…', type: 'button', action: async (s, panel) => { const f = await D.chooseFile(['step', 'stp']); if (f) { s.file = f; panel.render(); panel.apply(); } } },
    { key: 'file', label: 'Arquivo', type: 'text' }, { key: 'at', label: 'Posição', type: 'vec3' }, { key: 'scale', label: 'Escala', type: 'expr' }, { key: 'body', label: 'Nome do corpo', type: 'text' }] }],
};

// Medir: painel sem feature (não altera o modelo)
const MEASURE = {
  noFeature: true, noTransaction: true, okLabel: 'Fechar', prompt: 'Selecione a primeira face',
  defaults: () => ({ a: null, b: null, result: null }),
  sections: [{ title: 'Seleção', fields: [
    facePick({ key: 'a', label: 'Seleção 1', multiple: false, bodyKey: null, prompt: 'Selecione a primeira face' }),
    facePick({ key: 'b', label: 'Seleção 2', multiple: false, bodyKey: null, prompt: 'Selecione a segunda face (opcional)' }),
  ] }, { title: 'Resultado', fields: [{ key: 'out', type: 'info', text: (s) => s.result || 'Selecione uma face para ver suas propriedades exatas.' }] }],
  live: async (s, a, panel) => {
    const idx = async (ref) => (await facesOf(ref.body)).find((f) => Math.hypot(...f.centroid.map((v, k) => v - ref.near[k])) < 1e-6)?.index;
    try {
      if (s.a && s.b) {
        const m = await rpc('measure', { a: { body: s.a.body, face: await idx(s.a) }, b: { body: s.b.body, face: await idx(s.b) } });
        s.result = `Distância mínima: ${m.distance_mm} mm` + (m.parallelDistance_mm !== undefined ? `\nEntre planos: ${m.parallelDistance_mm} mm` : '') + (m.axisDistance_mm !== undefined ? `\nEntre eixos: ${m.axisDistance_mm} mm` : '') + (m.angle_deg !== undefined ? `\nÂngulo: ${m.angle_deg}°` : '');
        app.vp.setMarkers([m.pointA, m.pointB], 0xf08c00);
      } else if (s.a) {
        const f = await rpc('face_info', { body: s.a.body, face: await idx(s.a) });
        s.result = `${f.type} · área ${f.area} mm²` + (f.radius !== undefined ? `\nRaio ${f.radius} mm (Ø ${+(2 * f.radius).toFixed(6)})` : '') + (f.normal ? `\nNormal (${f.normal.join(', ')})` : '') + `\nCentróide (${f.centroid.join(', ')})`;
      }
    } catch (e) { s.result = `Erro: ${e.message}`; }
    panel.render();
  },
};

// Vista de corte: painel sem feature
const SECTION = {
  noFeature: true, noTransaction: true, prompt: 'Ajuste o plano de corte',
  defaults: () => ({ axis: 'y', offset: 0, flip: false }),
  sections: [{ title: 'Vista de corte', fields: [
    { key: 'axis', label: 'Plano normal a', type: 'segmented', labels: true, options: AXES, rerender: true },
    { key: 'offset', label: 'Posição', type: 'expr', unit: 'mm' },
    { key: 'flip', label: 'Inverter lado', type: 'toggle' },
    { key: 'clear', label: 'Remover corte', type: 'button', action: (s, panel) => { app.vp.setSection(null); panel.close(); } },
  ] }],
  live: (s) => app.vp.setSection({ axis: s.axis, offset: +s.offset || 0, flip: s.flip }),
  onCancel: () => app.vp.setSection(null),
};

// ---------------------------------------------------------------- registro
const panelCmd = (id, label, iconName, panel, key) => ({ id, label, icon: iconName, key, panel: { ...panel, id, label, icon: iconName } });
export const COMMANDS = {};
const reg = (c) => { COMMANDS[c.id] = c; };

[
  ['extrude', 'Extrusão', 'extrude', P.extrude, 'E'], ['revolve', 'Revolução', 'revolve', P.revolve, 'R'], ['loft', 'Loft', 'loft', P.loft],
  ['sweep', 'Varredura', 'sweep', P.sweep], ['pipe', 'Tubo', 'pipe', P.pipe], ['hole', 'Furo', 'hole', P.hole, 'H'],
  ['fillet', 'Filete', 'fillet', P.fillet, 'F'], ['chamfer', 'Chanfro', 'chamfer', P.chamfer, 'Shift+K'], ['shell', 'Casca', 'shell', P.shell],
  ['draft', 'Saída', 'draft', P.draft], ['push_pull', 'Pressionar/Puxar', 'pushpull', P.push_pull, 'Q'], ['boolean', 'Combinar', 'combine', P.boolean],
  ['transform', 'Mover corpo', 'move', P.transform, 'Shift+M'], ['mirror', 'Espelhar', 'mirror', P.mirror], ['pattern_linear', 'Retangular', 'patternRect', P.pattern_linear],
  ['pattern_circular', 'Circular', 'patternCirc', P.pattern_circular], ['split', 'Dividir', 'split', P.split], ['offset_body', 'Espessar', 'offset', P.offset_body],
  ['mate', 'Junta', 'mate', P.mate, 'J'], ['box', 'Caixa', 'box', P.box], ['cylinder', 'Cilindro', 'cylinder', P.cylinder], ['sphere', 'Esfera', 'sphere', P.sphere],
  ['torus', 'Toro', 'torus', P.torus], ['cone', 'Cone', 'cone', P.cone], ['import_step', 'Importar STEP', 'importStep', P.import_step],
  ['measure', 'Medir', 'measure', MEASURE, 'M'], ['section', 'Vista de corte', 'section', SECTION],
].forEach(([id, label, ic, panel, key]) => reg(panelCmd(id, label, ic, panel, key)));

const simple = (id, label, iconName, run, extra = {}) => reg({ id, label, icon: iconName, run, ...extra });
simple('sketch2d', 'Iniciar esboço 2D', 'sketch2d', () => SK.startSketch(), { key: 'S' });
simple('new', 'Novo', 'new', () => D.newDocument(), { key: 'Ctrl+N' });
simple('open', 'Abrir', 'open', () => D.openDocument(), { key: 'Ctrl+O' });
simple('save', 'Salvar', 'save', () => D.saveDocument(), { key: 'Ctrl+S' });
simple('saveAs', 'Salvar como', 'saveAs', () => D.saveDocument(true));
simple('undo', 'Desfazer', 'undo', () => rpc('undo').catch((e) => toast(e.message, 'warn')), { key: 'Ctrl+Z' });
simple('redo', 'Refazer', 'redo', () => rpc('redo').catch((e) => toast(e.message, 'warn')), { key: 'Ctrl+Y' });
simple('rebuild', 'Reconstruir tudo', 'rebuild', () => D.rebuildAll());
simple('importMesh', 'Importar STL/OBJ', 'import', () => D.importMesh());
simple('exportStep', 'STEP', 'stepFile', () => D.exportAs('step'));
simple('exportStl', 'STL', 'stlFile', () => D.exportAs('stl'));
simple('export3mf', '3MF', 'mfFile', () => D.exportAs('3mf'));
simple('exportGlb', 'GLB', 'glbFile', () => D.exportAs('glb'));
simple('exportObj', 'OBJ', 'export', () => D.exportAs('obj'));
simple('drawing', 'Desenho técnico', 'drawing', () => D.drawingDialog());
simple('iprops', 'Propriedades físicas', 'iprops', () => D.ipropsDialog());
simple('interference', 'Interferência', 'interference', () => D.interferenceDialog());
simple('printCheck', 'Verificar impressão 3D', 'print3d', () => D.printDialog());
simple('bom', 'Lista de materiais', 'bom', () => D.bomDialog());
simple('params', 'Parâmetros', 'params', () => D.paramsDialog(), { key: 'Ctrl+Shift+P' });
simple('study', 'Estudo paramétrico', 'study', () => D.studyDialog());
simple('optimize', 'Otimizar', 'optimize', () => D.optimizeDialog());
simple('macro', 'Macros (script)', 'macro', () => D.macroDialog());
simple('resources', 'Recursos do sistema', 'resources', () => D.resourcesDialog());
simple('options', 'Opções do aplicativo', 'options', () => D.optionsDialog());
simple('configs', 'Configurações (tabela)', 'configs', () => D.configsDialog());
simple('saveVersion', 'Salvar versão', 'saveVersion', () => D.saveVersion());
simple('versions', 'Histórico de versões', 'versions', () => D.versionsDialog());
simple('claude', 'Conectar o Claude', 'claude', () => D.claudeDialog());
simple('activity', 'Atividade do Claude', 'activity', () => D.activityDialog());
simple('appearance', 'Material e aparência', 'appearance', () => D.appearanceDialog());
simple('fit', 'Zoom tudo', 'fit', () => app.vp.fit(), { key: 'Home' });
simple('home', 'Vista inicial', 'home', () => app.vp.setView('home'), { key: 'F6' });
simple('previous', 'Vista anterior', 'previous', () => app.vp.previousView(), { key: 'F5' });
simple('lookAt', 'Olhar para', 'lookAt', () => D.lookAtCommand());
simple('ortho', 'Ortográfica', 'ortho', () => D.setProjection('ortho'));
simple('persp', 'Perspectiva', 'persp', () => D.setProjection('persp'));
simple('theme', 'Tema claro/escuro', 'theme', () => D.toggleTheme());
simple('zebra', 'Zebra', 'zebra', () => D.setStyle('zebra'));
simple('draftAnalysis', 'Ângulo de saída', 'draftAnalysis', () => D.setStyle('draft'));
simple('curvature', 'Curvatura', 'curvature', () => D.setStyle('curvature'));
simple('shaded', 'Sombreado', 'visual', () => D.setStyle('shaded'));
simple('shadedEdges', 'Sombreado com arestas', 'edges', () => D.setStyle('shadedEdges'));
simple('wire', 'Aramado', 'edges', () => D.setStyle('wire'));
simple('xray', 'Raio X', 'visual', () => D.setStyle('xray'));
simple('origin', 'Mostrar origem', 'axis', () => { app.originPinned = !app.originPinned; app.vp.showOrigin(app.originPinned); });

// esboço
simple('finishSketch', 'Concluir esboço', 'finish', () => SK.finish(), { key: 'Ctrl+Enter' });
simple('cancelSketch', 'Cancelar esboço', 'cancel', () => SK.cancel());
for (const [id, label, ic, key] of [['line', 'Linha', 'line', 'L'], ['circle', 'Círculo', 'circle', 'C'], ['arc', 'Arco (3 pontos)', 'arc', 'A'], ['rect', 'Retângulo', 'rect', 'T'], ['rectCenter', 'Retângulo pelo centro', 'rectCenter'], ['polygon', 'Polígono', 'polygon'], ['slot', 'Rasgo', 'slot'], ['sketchPoint', 'Ponto', 'sketchPoint']]) simple(`sk_${id}`, label, ic, () => SK.tool(id), { key, sketch: true });
simple('sk_dimension', 'Cota', 'dimension', () => SK.tool('dimension'), { key: 'D', sketch: true });
simple('sk_construction', 'Construção', 'construction', () => SK.toggleConstruction(), { sketch: true });
simple('sk_delete', 'Excluir', 'delete', () => SK.deleteSelection(), { key: 'Delete', sketch: true });
for (const [id, label] of [['coincident', 'Coincidente'], ['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['parallel', 'Paralela'], ['perpendicular', 'Perpendicular'], ['tangent', 'Tangente'], ['equal', 'Igual'], ['fix', 'Fixa'], ['concentric', 'Concêntrica'], ['symmetric', 'Simétrica'], ['midpoint', 'Ponto médio']]) simple(`sk_${id}`, label, id, () => SK.constraintTool(id), { sketch: true });
simple('sk_showConstraints', 'Mostrar restrições', 'eye', () => SK.toggleGlyphs(), { sketch: true });

// mapa feature → comando de edição
export const EDIT_CMD = Object.fromEntries(Object.keys(P).map((k) => [k, k]));
EDIT_CMD.round_edges = 'fillet';

export function runCommand(id) {
  const c = COMMANDS[id];
  if (!c) return;
  if (c.sketch && !app.sketching) { toast('Disponível só no ambiente de esboço.', 'warn'); return; }
  if (!c.sketch && app.sketching && c.panel) { toast('Conclua o esboço primeiro (Concluir esboço).', 'warn'); return; }
  if (!['undo', 'redo', 'fit', 'home', 'previous'].includes(id)) app.lastCommand = id;
  if (c.panel) return openPanel(c.panel);
  return c.run();
}

export function editFeature(name) {
  const f = app.state.features.find((x) => x.name === name);
  if (!f) return;
  if (f.type === 'sketch') return SK.editSketch(name);
  const cmdId = EDIT_CMD[f.type];
  if (cmdId && COMMANDS[cmdId]?.panel) return openPanel(COMMANDS[cmdId].panel, { edit: name });
  return D.jsonEditDialog(name);
}

export const isPanelOpen = () => !!activePanel();
