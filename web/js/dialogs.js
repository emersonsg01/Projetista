// Diálogos e ações de documento: Arquivo (backstage), Parâmetros (fx), Propriedades físicas,
// desenho técnico, inspeções, estudos, macros, recursos, opções, versões e Claude.
import { rpc } from './rpc.js';
import { app, bodyNames, saveSettings } from './store.js';
import { h, ico, $, dialog, toast, ask, fmt, setPrompt } from './ui.js';
import { icon } from './icons.js';

const desktop = () => !!window.projetista?.desktop;
const fileName = (p) => String(p).split(/[\\/]/).pop();

// ---------------------------------------------------------------- arquivos
export async function chooseFile(exts) {
  if (desktop() && window.projetista.pickFile) return window.projetista.pickFile({ exts });
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: exts.map((e) => `.${e}`).join(',') });
    inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) return resolve(null);
      setPrompt(`Enviando ${f.name}…`);
      const r = await fetch(`/api/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f }).then((x) => x.json()).catch(() => null);
      setPrompt('');
      resolve(r?.path || null);
    });
    inp.click();
  });
}
async function chooseSave(defaultName, exts) {
  if (desktop() && window.projetista.saveFile) return window.projetista.saveFile({ defaultName, exts });
  const name = await ask({ title: 'Salvar como', label: 'Nome do arquivo (pasta de projetos)', value: defaultName });
  return name || null;
}
const slug = (s) => String(s || 'modelo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').toLowerCase();

export async function newDocument() {
  if (app.state?.features.length && !confirm('Criar um novo documento? Alterações não salvas no arquivo atual continuam no salvamento automático.')) return;
  await rpc('new_document', { name: 'Peça1' });
  app.docFile = null;
  window.dispatchEvent(new CustomEvent('doc-tab', { detail: 'doc' }));
}
export async function openDocument() {
  const files = (await rpc('list_files')).filter((f) => /\.projetista(\.json)?$/.test(f.file));
  const d = dialog({
    id: 'open', title: 'Abrir', iconName: 'open', width: 560,
    body: (b) => {
      const list = h('div', { class: 'filelist' });
      if (!files.length) list.append(h('div', { class: 'muted' }, 'Nenhum projeto na pasta de projetos.'));
      for (const f of files) list.append(h('div', { class: 'fileitem', ondblclick: () => go(f.path) }, ico('part'), h('div', {}, h('b', {}, f.file), h('div', { class: 'muted' }, new Date(f.modified).toLocaleString('pt-BR'))), h('button', { onclick: () => go(f.path) }, 'Abrir')));
      b.append(list);
    },
    buttons: [{ label: 'Procurar…', action: async () => { const p = await chooseFile(['projetista', 'json']); if (p) go(p); } }, { label: 'Cancelar', action: ({ close }) => close() }],
  });
  async function go(p) { d.close(); await rpc('open', { file: p }); app.docFile = p; toast(`Aberto: ${fileName(p)}`); window.dispatchEvent(new CustomEvent('doc-tab', { detail: 'doc' })); }
}
export async function saveDocument(as = false) {
  let file = app.docFile;
  if (as || !file) {
    const f = await chooseSave(`${slug(app.state?.name)}.projetista`, ['projetista']);
    if (!f) return;
    file = /\.projetista(\.json)?$/.test(f) ? f : `${f}.projetista`;
  }
  const r = await rpc('save', { file });
  app.docFile = r.file;
  toast(`Salvo: ${r.file}`);
}
export async function rebuildAll() { const r = await rpc('rebuild'); toast(`Modelo reconstruído em ${r.regenMs} ms`); }
export async function importMesh() {
  const f = await chooseFile(['stl', 'obj']);
  if (f) await rpc('add_feature', { feature: { type: 'import_mesh', file: f } }).then((r) => r.errors?.length && toast(r.errors[0], 'err'));
}
// ---------------------------------------------------------------- exportação
export const EXPORT_FORMATS = [
  { id: 'step', ext: 'step', name: 'STEP', icon: 'stepFile', desc: 'Geometria exata (B-rep). Para SolidWorks, Inventor, Fusion, FreeCAD e usinagem (CAM).' },
  { id: 'stl', ext: 'stl', name: 'STL', icon: 'stlFile', desc: 'Malha de triângulos. Padrão da impressão 3D.', mesh: true },
  { id: '3mf', ext: '3mf', name: '3MF', icon: 'mfFile', desc: 'Malha com cores e materiais. Ideal para Orca, Bambu e Prusa.', mesh: true },
  { id: 'obj', ext: 'obj', name: 'OBJ', icon: 'objFile', desc: 'Malha simples, aceita por quase todo software 3D.', mesh: true },
  { id: 'glb', ext: 'glb', name: 'GLB', icon: 'glbFile', desc: 'glTF binário com cores. Web, realidade aumentada, Blender.', mesh: true },
  { id: 'svg', ext: 'svg', name: 'Desenho SVG', icon: 'drawing', desc: 'Folha A3/A4 com vistas, linhas ocultas, cotas e carimbo.' },
];
const QUALITIES = [['normal', 'Normal', '0,02 mm'], ['fine', 'Fina', '0,005 mm'], ['ultra', 'Ultra', '0,001 mm']];
const extToFormat = (ext) => EXPORT_FORMATS.find((f) => f.ext === ext || (f.id === 'step' && ext === 'stp'))?.id;

/** Baixa um arquivo da pasta de projetos pelo navegador (sem bloqueio de pop-up). */
function download(href, name) {
  const a = h('a', { href: `${href}${href.includes('?') ? '&' : '?'}download`, download: name, style: { display: 'none' } });
  document.body.append(a); a.click(); a.remove();
}

export async function exportAs(fmtName) { return exportDialog({ format: fmtName }); }

export async function exportDialog(opts = {}) {
  const st = app.settings;
  const sep = desktop() ? '\\' : '/';
  const s = {
    format: opts.format || st.lastExportFormat || 'step',
    which: app.selectedBody ? 'selected' : 'all',
    picked: new Set(app.selectedBody ? [app.selectedBody] : bodyNames()),
    quality: st.exportQuality || 'fine',
    projection: opts.projection || 'first', sheet: opts.sheet || 'A3', title: opts.title || app.state?.name || '',
    folder: st.exportDir || (desktop() ? `${await window.projetista.homeDir?.() || ''}${sep}Exportações` : 'Exportações'),
    name: slug(app.state?.name),
    after: st.exportAfter ?? true,
    busy: false, result: null, error: null,
  };
  const d = dialog({ id: 'export', title: 'Exportar', iconName: 'export', width: 720, body: (b) => render(b) });
  function current() { return EXPORT_FORMATS.find((f) => f.id === s.format) || EXPORT_FORMATS[0]; }
  // no Windows, normaliza separadores; a pasta precisa ser completa (C:\… ou \\servidor\…)
  function folderNorm() { return (desktop() ? s.folder.trim().replace(/\//g, '\\') : s.folder.trim()).replace(/[\\/]+$/, ''); }
  function folderOk() { return !desktop() || /^([a-zA-Z]:\\|\\\\[^\\]+\\)/.test(`${folderNorm()}\\`); }
  function target() { return `${folderNorm()}${sep}${s.name || 'modelo'}.${current().ext}`; }
  function render(b) {
    b.innerHTML = '';
    const f = current();
    const bodies = bodyNames();
    // 1. formato
    const cards = h('div', { class: 'fmt-grid' }, ...EXPORT_FORMATS.map((x) => h('button', { class: `fmt ${x.id === s.format ? 'on' : ''}`, onclick: () => { s.format = x.id; s.result = s.error = null; render(b); } },
      h('span', { class: 'ico', html: icon(x.icon) }), h('b', {}, x.name), h('span', { class: 'muted' }, x.desc))));
    // 2. o que exportar
    const which = h('div', { class: 'exp-row' }, h('span', { class: 'exp-label' }, 'Corpos'),
      h('div', { class: 'seg' },
        h('button', { class: s.which === 'all' ? 'on' : '', onclick: () => { s.which = 'all'; render(b); } }, `Todos (${bodies.length})`),
        h('button', { class: s.which === 'selected' ? 'on' : '', onclick: () => { s.which = 'selected'; render(b); } }, 'Escolher…')));
    const pick = s.which === 'selected' ? h('div', { class: 'exp-bodies' }, ...bodies.map((n) => {
      const cb = h('input', { type: 'checkbox', checked: s.picked.has(n) });
      cb.addEventListener('change', () => { cb.checked ? s.picked.add(n) : s.picked.delete(n); render(b); });
      return h('label', {}, cb, n);
    })) : '';
    // 3. opções do formato
    const extra = f.mesh
      ? h('div', { class: 'exp-row' }, h('span', { class: 'exp-label' }, 'Precisão da malha'), h('div', { class: 'seg' }, ...QUALITIES.map(([v, l, tol]) => h('button', { class: s.quality === v ? 'on' : '', title: `Erro cordal máximo ${tol}`, onclick: () => { s.quality = v; render(b); } }, `${l} · ${tol}`))))
      : f.id === 'svg'
        ? h('div', { class: 'exp-row' }, h('span', { class: 'exp-label' }, 'Desenho'),
          h('div', { class: 'seg' }, ...[['first', '1º diedro (ABNT)'], ['third', '3º diedro (ANSI)']].map(([v, l]) => h('button', { class: s.projection === v ? 'on' : '', onclick: () => { s.projection = v; render(b); } }, l))),
          h('div', { class: 'seg' }, ...['A3', 'A4'].map((v) => h('button', { class: s.sheet === v ? 'on' : '', onclick: () => { s.sheet = v; render(b); } }, v))))
        : h('div', { class: 'exp-row' }, h('span', { class: 'exp-label' }, 'Precisão'), h('span', { class: 'muted' }, 'Exata — as superfícies são gravadas como B-rep, sem aproximação por triângulos.'));
    // 4. destino
    const folder = h('input', { value: s.folder, readonly: !desktop() ? true : undefined });
    folder.addEventListener('change', () => { s.folder = folder.value; render(b); });
    const name = h('input', { value: s.name, spellcheck: 'false' });
    name.addEventListener('change', () => {
      // se o usuário digitar uma extensão conhecida, o formato acompanha
      const m = name.value.trim().match(/^(.*)\.([a-z0-9]{2,4})$/i);
      // caracteres proibidos em nomes de arquivo do Windows viram "_"
      const clean = (t) => t.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
      if (m && extToFormat(m[2].toLowerCase())) { s.name = clean(m[1]); s.format = extToFormat(m[2].toLowerCase()); } else s.name = clean(name.value.trim());
      render(b);
    });
    const dest = h('div', { class: 'exp-dest' },
      h('label', { class: 'exp-row' }, h('span', { class: 'exp-label' }, 'Pasta'), folder, desktop() ? h('button', { onclick: async () => { const p = await window.projetista.pickFolder({ defaultPath: s.folder }); if (p) { s.folder = p; render(b); } } }, 'Procurar…') : h('span', { class: 'muted small' }, 'pasta de projetos')),
      h('label', { class: 'exp-row' }, h('span', { class: 'exp-label' }, 'Nome do arquivo'), name, h('span', { class: 'exp-ext' }, `.${f.ext}`)),
      h('label', { class: 'exp-row check' }, (() => { const c = h('input', { type: 'checkbox', checked: s.after }); c.addEventListener('change', () => { s.after = c.checked; }); return c; })(), desktop() ? 'Mostrar o arquivo na pasta ao concluir' : 'Baixar o arquivo ao concluir'),
      folderOk() ? h('div', { class: 'exp-final' }, 'Arquivo final: ', h('code', {}, target()))
        : h('div', { class: 'exp-status err' }, '⚠ Informe a pasta completa (por exemplo C:\\Users\\voce\\Documents) ou use Procurar…'));
    // 5. situação
    const status = s.busy ? h('div', { class: 'exp-status busy' }, h('span', { class: 'spinner' }), `Exportando ${f.name}…`)
      : s.error ? h('div', { class: 'exp-status err' }, '⚠ ', s.error)
        : s.result ? h('div', { class: 'exp-status ok' }, h('div', {}, '✔ Exportado: ', h('b', {}, fileName(s.result.file)), ` (${fmtSize(s.result.bytes)}${s.result.ms !== undefined ? ` em ${s.result.ms} ms` : ''})`),
          h('div', { class: 'muted small' }, s.result.file),
          h('div', { class: 'row' }, desktop() ? h('button', { onclick: () => window.projetista.showFile(s.result.file) }, 'Mostrar na pasta') : '', desktop() ? h('button', { onclick: () => window.projetista.openExternal(s.result.file) }, 'Abrir arquivo') : '',
            !desktop() && s.result.download ? h('button', { onclick: () => download(s.result.download, fileName(s.result.file)) }, 'Baixar de novo') : ''))
          : '';
    const noBodies = !bodies.length;
    const canGo = !s.busy && !noBodies && (s.which === 'all' || s.picked.size > 0) && s.name && folderOk();
    b.append(
      h('div', { class: 'exp-step' }, h('span', { class: 'n' }, '1'), 'Formato'), cards,
      h('div', { class: 'exp-step' }, h('span', { class: 'n' }, '2'), 'Conteúdo e precisão'), which, pick, extra,
      h('div', { class: 'exp-step' }, h('span', { class: 'n' }, '3'), 'Destino'), dest,
      noBodies ? h('div', { class: 'exp-status err' }, '⚠ O modelo ainda não tem corpos sólidos. Crie um recurso antes de exportar.') : status,
      h('div', { class: 'exp-actions' }, h('button', { onclick: () => d.close() }, 'Fechar'), h('button', { class: 'primary big', disabled: !canGo || undefined, onclick: () => go(b) }, `Exportar ${f.name}`)));
  }
  async function go(b) {
    const f = current();
    s.busy = true; s.error = s.result = null; render(b);
    const bodies = s.which === 'all' ? undefined : [...s.picked];
    const file = desktop() ? target() : `${s.folder}/${s.name}.${f.ext}`;
    try {
      s.result = f.id === 'svg'
        ? await rpc('drawing', { file, bodies, projection: s.projection, sheet: s.sheet, title: s.title, hiddenLines: true })
        : await rpc('export', { format: f.id, file, bodies, quality: s.quality });
      Object.assign(st, { lastExportFormat: f.id, exportQuality: s.quality, exportAfter: s.after, ...(desktop() ? { exportDir: folderNorm() } : {}) });
      saveSettings();
      if (s.after) { if (desktop()) window.projetista.showFile(s.result.file); else if (s.result.download) download(s.result.download, fileName(s.result.file)); }
      toast(`Exportado: ${fileName(s.result.file)}`);
    } catch (e) {
      s.error = e.message;
    }
    s.busy = false;
    render(b);
  }
}
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

// ---------------------------------------------------------------- backstage (Arquivo)
export function backstage() {
  const el = $('#backstage');
  if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
  el.innerHTML = '';
  const close = () => el.classList.add('hidden');
  const item = (iconName, label, fn, sub) => h('button', { class: 'bs-item', onclick: () => { close(); fn(); } }, ico(iconName), h('span', {}, label, sub ? h('small', {}, sub) : ''));
  const left = h('div', { class: 'bs-left' },
    h('button', { class: 'bs-back', onclick: close }, '←'),
    item('new', 'Novo', newDocument, 'Peça (mm)'), item('open', 'Abrir', openDocument), item('save', 'Salvar', () => saveDocument()), item('saveAs', 'Salvar como', () => saveDocument(true)),
    h('div', { class: 'bs-sep' }),
    item('importStep', 'Importar STEP', () => import('./commands.js').then((m) => m.runCommand('import_step'))), item('import', 'Importar STL/OBJ', importMesh),
    item('export', 'Exportar…', () => exportDialog(), 'STEP, STL, 3MF, OBJ, GLB, SVG'),
    item('drawing', 'Desenho técnico', drawingDialog),
    h('div', { class: 'bs-sep' }),
    item('iprops', 'iPropriedades', ipropsDialog), item('options', 'Opções', optionsDialog), item('claude', 'Conectar o Claude', claudeDialog));
  const right = h('div', { class: 'bs-right' }, h('h2', {}, 'Documentos recentes'), h('div', { class: 'muted' }, 'carregando…'));
  el.append(left, right);
  el.classList.remove('hidden');
  rpc('list_files').then((files) => {
    right.lastChild.remove();
    const list = h('div', { class: 'filelist' });
    for (const f of files.filter((x) => /\.projetista(\.json)?$/.test(x.file)).slice(0, 14)) list.append(h('div', { class: 'fileitem', onclick: async () => { close(); await rpc('open', { file: f.path }); app.docFile = f.path; window.dispatchEvent(new CustomEvent('doc-tab', { detail: 'doc' })); } }, ico('part'), h('div', {}, h('b', {}, f.file), h('div', { class: 'muted' }, new Date(f.modified).toLocaleString('pt-BR')))));
    if (!list.children.length) list.append(h('div', { class: 'muted' }, 'Nenhum projeto salvo ainda.'));
    right.append(list);
  });
}

// ---------------------------------------------------------------- parâmetros (fx)
export function paramsDialog() {
  const d = dialog({ id: 'params', title: 'Parâmetros', iconName: 'params', width: 760, body: (b) => render(b), buttons: [{ label: 'Concluído', primary: true, action: ({ close }) => close() }] });
  function render(b) {
    b.innerHTML = '';
    const s = app.state;
    const tbl = h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Nome'), h('th', {}, 'Equação'), h('th', {}, 'Valor nominal'), h('th', {}, 'Comentário'), h('th', {}, ''))));
    const tb = h('tbody');
    tb.append(h('tr', { class: 'group' }, h('td', { colspan: 5 }, 'Parâmetros do usuário')));
    for (const [k, def] of Object.entries(s.parameterDefs)) {
      const v = s.parameters[k];
      const eq = h('input', { value: def.expr });
      eq.addEventListener('change', () => rpc('set_parameter', { name: k, expr: isNaN(+eq.value) || eq.value.trim() === '' ? eq.value : +eq.value, comment: def.comment }).catch((e) => toast(e.message, 'err')));
      const cm = h('input', { value: def.comment || '' });
      cm.addEventListener('change', () => rpc('set_parameter', { name: k, expr: def.expr, comment: cm.value }));
      tb.append(h('tr', {}, h('td', {}, h('b', {}, k)), h('td', {}, eq), h('td', { class: typeof v === 'object' ? 'bad' : 'num' }, typeof v === 'object' ? `⚠ ${v.error}` : fmt(v, 6)), h('td', {}, cm), h('td', {}, h('button', { class: 'icon-btn', title: 'Excluir', html: icon('delete'), onclick: () => rpc('delete_parameter', { name: k }) }))));
    }
    // parâmetros do modelo: campos numéricos/expressões de cada feature, editáveis
    tb.append(h('tr', { class: 'group' }, h('td', { colspan: 5 }, 'Parâmetros do modelo')));
    const NUM = ['distance', 'distance2', 'radius', 'diameter', 'height', 'width', 'depth', 'thickness', 'angle', 'count', 'spacing', 'count2', 'spacing2', 'offset', 'taper', 'twist', 'fillet', 'majorRadius', 'minorRadius', 'radius1', 'radius2', 'wall', 'bendRadius', 'cornerRadius', 'thinWall', 'cbDiameter', 'cbDepth', 'csDiameter', 'csAngle'];
    for (const f of s.features) {
      for (const k of NUM) {
        if (f[k] === undefined || f[k] === 'through') continue;
        const eq = h('input', { value: f[k] });
        eq.addEventListener('change', () => rpc('update_feature', { name: f.name, patch: { [k]: isNaN(+eq.value) ? eq.value : +eq.value } }));
        tb.append(h('tr', {}, h('td', { class: 'muted' }, `${f.name}.${k}`), h('td', {}, eq), h('td', {}, ''), h('td', { class: 'muted' }, f.type), h('td', {})));
      }
    }
    tbl.append(tb);
    const add = h('div', { class: 'row' }, h('button', { onclick: async () => {
      const name = await ask({ title: 'Novo parâmetro', label: 'Nome', value: `p${Object.keys(s.parameterDefs).length + 1}` });
      if (!name) return;
      const expr = await ask({ title: 'Novo parâmetro', label: `Equação de ${name}`, value: '10' });
      if (expr === null) return;
      rpc('set_parameter', { name, expr: isNaN(+expr) ? expr : +expr }).catch((e) => toast(e.message, 'err'));
    } }, '+ Adicionar numérico'), h('span', { class: 'muted' }, 'Equações aceitam unidades (mm, cm, in, deg) e funções (sin, sqrt, max, if…).'));
    b.append(h('div', { class: 'scroll' }, tbl), add);
  }
  d.refresh = () => render(d.body);
  app.onStateDialogs.add(d);
  return d;
}

// ---------------------------------------------------------------- propriedades físicas (iProperties)
export function ipropsDialog() {
  const d = dialog({
    id: 'iprops', title: 'iPropriedades — Física', iconName: 'iprops', width: 560,
    body: (b) => render(b),
    buttons: [{ label: 'Fechar', primary: true, action: ({ close }) => close() }],
  });
  async function render(b) {
    b.innerHTML = '';
    const bodies = bodyNames();
    if (!bodies.length) { b.append(h('div', { class: 'muted' }, 'Nenhum corpo no modelo.')); return; }
    const sel = h('select', {}, ...bodies.map((n) => h('option', {}, n)));
    sel.value = app.selectedBody && bodies.includes(app.selectedBody) ? app.selectedBody : bodies[0];
    const mat = h('select', {}, ...(app.materials || []).map((m) => h('option', {}, m)));
    const out = h('div', { class: 'props' }, h('span', { class: 'muted' }, 'calculando…'));
    const load = async () => {
      const m = await rpc('mass_properties', { body: sel.value });
      mat.value = m.material;
      const I = m.inertiaTensor_g_mm2_atCOM;
      out.innerHTML = '';
      const row = (k, v) => out.append(h('div', { class: 'prow' }, h('span', {}, k), h('b', {}, v)));
      row('Massa', `${fmt(m.mass_g, 4)} g`); row('Área', `${fmt(m.surfaceArea_mm2, 4)} mm²`); row('Volume', `${fmt(m.volume_mm3, 4)} mm³`);
      row('Densidade', `${fmt(m.density_g_cm3, 4)} g/cm³`);
      row('Centro de gravidade', m.centerOfMass_mm.map((x) => fmt(x, 4)).join(' ; ') + ' mm');
      row('Momentos principais', (m.principalMoments_g_mm2 || []).map((x) => fmt(x, 2)).join(' ; ') + ' g·mm²');
      row('Ixx ; Iyy ; Izz (no CG)', [I.Ixx, I.Iyy, I.Izz].map((x) => fmt(x, 2)).join(' ; ') + ' g·mm²');
      row('Ixy ; Iyz ; Ixz', [I.Ixy, I.Iyz, I.Ixz].map((x) => fmt(x, 2)).join(' ; ') + ' g·mm²');
      row('Raios de giração', (m.radiiOfGyration_mm || []).map((x) => fmt(x, 3)).join(' ; ') + ' mm');
      row('Caixa delimitadora', m.boundingBox.size.map((x) => fmt(x, 3)).join(' × ') + ' mm');
      row('Faces / arestas / gênero', `${m.faces} / ${m.edges} / ${m.genus}`);
      row('B-rep válido', m.validBRep ? 'sim' : 'NÃO');
      row('Custo estimado de material', m.costEstimate_BRL !== null ? `R$ ${fmt(m.costEstimate_BRL, 2)}` : '—');
      out.append(h('div', { class: 'muted small' }, m.method));
    };
    sel.addEventListener('change', load);
    mat.addEventListener('change', async () => { await rpc('add_feature', { feature: { type: 'appearance', body: sel.value, material: mat.value } }); load(); });
    b.append(h('div', { class: 'form2' }, h('label', {}, 'Corpo', sel), h('label', {}, 'Material', mat)), out);
    load();
  }
  return d;
}

// ---------------------------------------------------------------- desenho técnico
export function drawingDialog() {
  let svgText = null, file = null;
  const d = dialog({
    id: 'drawing', title: 'Desenho técnico', iconName: 'drawing', width: Math.min(innerWidth - 80, 1100), height: Math.min(innerHeight - 100, 780),
    body: (b) => {
      const proj = h('select', {}, h('option', { value: 'first' }, '1º diedro (ABNT/ISO)'), h('option', { value: 'third' }, '3º diedro (ANSI)'));
      const sheet = h('select', {}, h('option', {}, 'A3'), h('option', {}, 'A4'));
      const hidden = h('input', { type: 'checkbox', checked: true });
      const title = h('input', { value: app.state?.name || '' });
      const view = h('div', { class: 'svgview' }, h('div', { class: 'muted' }, 'Gere o desenho para visualizar.'));
      let zoom = 1;
      view.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.3, Math.min(8, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); const s = view.querySelector('svg'); if (s) s.style.width = `${100 * zoom}%`; });
      const gen = async () => {
        view.innerHTML = '<div class="muted">gerando por remoção exata de linhas ocultas…</div>';
        const r = await rpc('drawing', { projection: proj.value, sheet: sheet.value, hiddenLines: hidden.checked, title: title.value }).catch((e) => { view.textContent = e.message; });
        if (!r) return;
        file = r.file;
        svgText = await fetch(r.download || `/files/${encodeURIComponent(fileName(r.file))}`).then((x) => x.text());
        view.innerHTML = svgText;
        const s = view.querySelector('svg'); s.removeAttribute('height'); s.style.width = `${100 * zoom}%`; s.style.height = 'auto';
      };
      b.append(h('div', { class: 'row' }, h('label', {}, 'Projeção ', proj), h('label', {}, 'Folha ', sheet), h('label', {}, hidden, ' Linhas ocultas'), h('label', {}, 'Título ', title), h('button', { class: 'primary', onclick: gen }, 'Gerar')), view);
      gen();
    },
    buttons: [
      { label: 'Exportar SVG…', action: () => exportDialog({ format: 'svg' }) },
      { label: 'Abrir no visualizador do sistema', action: () => { if (file) desktop() ? window.projetista.openExternal(file) : window.open(`/files/${encodeURIComponent(fileName(file))}`, '_blank'); } },
      { label: 'Fechar', primary: true, action: ({ close }) => close() },
    ],
  });
  return d;
}

// ---------------------------------------------------------------- inspeções
export async function interferenceDialog() {
  const d = dialog({ id: 'interf', title: 'Análise de interferência', iconName: 'interference', width: 560, body: h('div', { class: 'muted' }, 'calculando (booleanas exatas)…'), buttons: [{ label: 'Fechar', primary: true, action: ({ close }) => { app.vp.setSelection([]); close(); } }] });
  const r = await rpc('interference');
  d.body.innerHTML = '';
  if (!r.length) { d.body.append(h('div', { class: 'ok-msg' }, '✔ Nenhuma interferência entre os corpos.')); return; }
  const tbl = h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Corpo A'), h('th', {}, 'Corpo B'), h('th', {}, 'Volume (mm³)'), h('th', {}, 'Região'))));
  const tb = h('tbody');
  for (const x of r) tb.append(h('tr', { class: 'clickable', onclick: () => app.vp.setSelection([{ kind: 'body', body: x.a }, { kind: 'body', body: x.b }]) }, h('td', {}, x.a), h('td', {}, x.b), h('td', { class: 'num' }, x.contact ? 'contato' : fmt(x.volume_mm3, 4)), h('td', { class: 'muted' }, x.region ? `${x.region.min.map((v) => fmt(v, 1)).join(',')} → ${x.region.max.map((v) => fmt(v, 1)).join(',')}` : '')));
  tbl.append(tb);
  d.body.append(tbl);
}
export function printDialog() {
  dialog({
    id: 'print', title: 'Verificar impressão 3D', iconName: 'print3d', width: 560,
    body: (b) => {
      const sel = h('select', {}, ...bodyNames().map((n) => h('option', {}, n)));
      const ang = h('input', { value: 45, style: { width: '60px' } }), wall = h('input', { value: 0.8, style: { width: '60px' } });
      const out = h('div', { class: 'props' });
      const run = async () => {
        out.innerHTML = '<span class="muted">analisando…</span>';
        const r = await rpc('print_check', { body: sel.value, overhangAngle: +ang.value, minWall: +wall.value });
        out.innerHTML = '';
        const row = (k, v) => out.append(h('div', { class: 'prow' }, h('span', {}, k), h('b', {}, v)));
        row('Veredito', r.verdict === 'ok para imprimir' ? '✔ ok para imprimir' : '⚠ atenção');
        row('Balanços', `${fmt(r.overhangPercent, 2)} % (${fmt(r.overhangArea_mm2, 1)} mm²)`);
        row('Dimensões', r.size_mm.map((x) => fmt(x, 2)).join(' × ') + ' mm');
        row('Camadas (0,2 mm)', r.layers); row('Tempo estimado', `${fmt(r.estimatedPrintTime_min, 0)} min`); row('Filamento', `${fmt(r.estimatedFilament_g, 1)} g`);
        for (const i of r.issues) out.append(h('div', { class: 'warn-msg' }, `⚠ ${i}`));
      };
      b.append(h('div', { class: 'row' }, h('label', {}, 'Corpo ', sel), h('label', {}, 'Balanço máx. (°) ', ang), h('label', {}, 'Parede mín. (mm) ', wall), h('button', { class: 'primary', onclick: run }, 'Analisar')), out);
      if (bodyNames().length) run();
    },
    buttons: [{ label: 'Fechar', primary: true, action: ({ close }) => close() }],
  });
}
export async function bomDialog() {
  const d = dialog({ id: 'bom', title: 'Lista de materiais', iconName: 'bom', width: 680, body: h('div', { class: 'muted' }, 'calculando…'), buttons: [{ label: 'Fechar', primary: true, action: ({ close }) => close() }] });
  const r = await rpc('bom');
  d.body.innerHTML = '';
  const tbl = h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, ...['Item', 'Material', 'Qtd', 'Massa (g)', 'Dimensões (mm)', 'Custo (R$)'].map((x) => h('th', {}, x)))));
  const tb = h('tbody');
  for (const x of r.rows) tb.append(h('tr', {}, h('td', {}, x.item), h('td', {}, x.material), h('td', { class: 'num' }, x.qty), h('td', { class: 'num' }, fmt(x.mass_g, 3)), h('td', {}, x.size_mm.map((v) => fmt(v, 2)).join(' × ')), h('td', { class: 'num' }, x.cost_BRL !== null ? fmt(x.cost_BRL, 2) : '—')));
  tb.append(h('tr', { class: 'total' }, h('td', { colspan: 3 }, 'Total'), h('td', { class: 'num' }, fmt(r.totalMass_g, 2)), h('td', {}), h('td', { class: 'num' }, fmt(r.totalCost_BRL, 2))));
  tbl.append(tb);
  d.body.append(tbl);
}

// ---------------------------------------------------------------- estudos e otimização (paralelos)
export function studyDialog() {
  dialog({
    id: 'study', title: 'Estudo paramétrico (paralelo)', iconName: 'study', width: 620,
    body: (b) => {
      const params = Object.keys(app.state.parameterDefs);
      if (!params.length) { b.append(h('div', { class: 'muted' }, 'Crie parâmetros primeiro (Gerenciar › Parâmetros).')); return; }
      const p = h('select', {}, ...params.map((k) => h('option', {}, k)));
      const a = h('input', { value: 10, style: { width: '70px' } }), z = h('input', { value: 100, style: { width: '70px' } }), n = h('input', { value: 32, style: { width: '60px' } });
      const out = h('div');
      const run = async () => {
        const N = Math.max(2, +n.value), A = +a.value, Z = +z.value;
        const values = Array.from({ length: N }, (_, i) => +(A + ((Z - A) * i) / (N - 1)).toFixed(6));
        out.innerHTML = `<div class="muted">calculando ${N} variantes em paralelo…</div>`;
        const r = await rpc('parameter_study', { parameter: p.value, values });
        const max = Math.max(...r.rows.map((x) => x.mass_g || 0)) || 1;
        out.innerHTML = '';
        out.append(h('div', { class: 'muted' }, `${r.rows.length} variantes em ${r.wallMs} ms usando ${r.workers} workers`));
        const tbl = h('table', { class: 'grid study' }, h('thead', {}, h('tr', {}, h('th', {}, p.value), h('th', {}, 'Massa (g)'), h('th', {}, ''), h('th', {}, 'Volume (mm³)'))));
        const tb = h('tbody');
        for (const x of r.rows) tb.append(h('tr', {}, h('td', { class: 'num' }, x.value), h('td', { class: 'num' }, x.ok ? fmt(x.mass_g, 3) : '⚠'), h('td', {}, h('div', { class: 'bar', style: { width: `${(100 * (x.mass_g || 0)) / max}%` } })), h('td', { class: 'num' }, x.ok ? fmt(x.volume_mm3, 1) : x.errors?.[0] || '')));
        tbl.append(tb);
        out.append(h('div', { class: 'scroll', style: { maxHeight: '360px' } }, tbl));
      };
      b.append(h('div', { class: 'row' }, h('label', {}, 'Parâmetro ', p), h('label', {}, 'de ', a), h('label', {}, 'até ', z), h('label', {}, 'variantes ', n), h('button', { class: 'primary', onclick: run }, 'Rodar')), out);
    },
    buttons: [{ label: 'Fechar', primary: true, action: ({ close }) => close() }],
  });
}
export function optimizeDialog() {
  dialog({
    id: 'optimize', title: 'Otimização paramétrica (paralela)', iconName: 'optimize', width: 640,
    body: (b) => {
      const params = Object.keys(app.state.parameterDefs);
      if (!params.length) { b.append(h('div', { class: 'muted' }, 'Crie parâmetros primeiro.')); return; }
      const rows = params.map((k) => {
        const v = app.state.parameters[k];
        const use = h('input', { type: 'checkbox', checked: params.indexOf(k) < 2 }), lo = h('input', { value: typeof v === 'number' ? +(v * 0.5).toFixed(3) : 1, style: { width: '70px' } }), hi = h('input', { value: typeof v === 'number' ? +(v * 1.5).toFixed(3) : 10, style: { width: '70px' } });
        return { k, use, lo, hi, el: h('tr', {}, h('td', {}, use), h('td', {}, k), h('td', {}, lo), h('td', {}, hi)) };
      });
      const obj = h('input', { value: 'mass', style: { width: '160px' } });
      const dir = h('select', {}, h('option', { value: 'min' }, 'Minimizar'), h('option', { value: 'max' }, 'Maximizar'));
      const cons = h('textarea', { rows: 3, placeholder: 'uma restrição por linha, ex.: sz <= 50' });
      const evals = h('input', { value: 120, style: { width: '70px' } });
      const out = h('div', { class: 'props' });
      const run = async () => {
        const variables = Object.fromEntries(rows.filter((r) => r.use.checked).map((r) => [r.k, { min: +r.lo.value, max: +r.hi.value }]));
        out.innerHTML = '<span class="muted">otimizando em todos os núcleos…</span>';
        const r = await rpc('optimize', { variables, objective: obj.value, minimize: dir.value === 'min', constraints: cons.value.split('\n').map((x) => x.trim()).filter(Boolean), maxEvaluations: +evals.value }).catch((e) => ({ error: e.message }));
        out.innerHTML = '';
        if (r.error) { out.append(h('div', { class: 'warn-msg' }, r.error)); return; }
        out.append(h('div', { class: 'muted' }, `${r.evaluated} avaliações (${r.feasible} viáveis) em ${r.wallMs} ms · ${r.workers} workers`));
        if (!r.best) { out.append(h('div', { class: 'warn-msg' }, r.note)); return; }
        out.append(h('div', { class: 'prow' }, h('span', {}, 'Melhor objetivo'), h('b', {}, fmt(r.best.objective, 4))));
        for (const [k, v] of Object.entries(r.best.parameters)) out.append(h('div', { class: 'prow' }, h('span', {}, k), h('b', {}, fmt(v, 4))));
        out.append(h('button', { class: 'primary', onclick: () => rpc('set_parameters', { parameters: r.best.parameters }).then(() => toast('Parâmetros otimizados aplicados')) }, 'Aplicar ao modelo'));
      };
      b.append(h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Variável'), h('th', {}, 'Mín.'), h('th', {}, 'Máx.'))), h('tbody', {}, ...rows.map((r) => r.el))),
        h('div', { class: 'row' }, h('label', {}, 'Objetivo ', obj), dir, h('label', {}, 'Avaliações ', evals)), h('div', { class: 'muted small' }, 'Objetivo e restrições usam mass, volume, area, sx, sy, sz e os parâmetros.'), cons, h('div', { class: 'row' }, h('button', { class: 'primary', onclick: run }, 'Otimizar')), out);
    },
    buttons: [{ label: 'Fechar', primary: true, action: ({ close }) => close() }],
  });
}

// ---------------------------------------------------------------- macros
const SAMPLE = `// Macro: grade de pinos paramétrica (vira uma única operação desfazível)
cad.param('n', 5); cad.param('passo', 14);
cad.box({ width: 'n*passo+6', depth: 'n*passo+6', height: 4, body: 'Placa', fillet: 1 });
for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++)
  cad.cylinder({ diameter: 4 + (i + j) * 0.5, height: 6, at: [(i - 2) * 14, (j - 2) * 14, 4], operation: 'join', target: 'Placa' });`;
export function macroDialog() {
  dialog({
    id: 'macro', title: 'Macros (JavaScript)', iconName: 'macro', width: 720,
    body: (b) => {
      const ta = h('textarea', { class: 'code', rows: 16, spellcheck: 'false' });
      ta.value = localStorage.getItem('projetista.macro') || SAMPLE;
      const out = h('pre', { class: 'out' });
      b.append(h('div', { class: 'muted small' }, 'API: cad.<feature>({...}) para cada tipo (box, sketch, extrude, hole, fillet…), cad.param(nome, expr), cad.update(nome, patch), console.log().'), ta,
        h('div', { class: 'row' }, h('button', { class: 'primary', onclick: async () => {
          try { localStorage.setItem('projetista.macro', ta.value); } catch { /* ignora */ }
          out.textContent = 'executando…';
          try { const r = await rpc('run_script', { code: ta.value }); out.textContent = `criadas: ${r.created.join(', ')}\n${r.logs.join('\n')}${r.errors.length ? '\nERROS:\n' + r.errors.join('\n') : ''}`; } catch (e) { out.textContent = `Erro: ${e.message}`; }
        } }, 'Executar ▶')), out);
    },
    buttons: [{ label: 'Fechar', primary: true, action: ({ close }) => close() }],
  });
}

// ---------------------------------------------------------------- recursos da máquina
export function resourcesDialog() {
  let timer;
  const d = dialog({ id: 'resources', title: 'Recursos do sistema', iconName: 'resources', width: 560, body: h('div', { class: 'muted' }, 'coletando…'), onClose: () => clearInterval(timer), buttons: [{ label: 'Fechar', primary: true, action: ({ close }) => close() }] });
  const poll = async () => {
    const r = await rpc('resources').catch(() => null);
    if (!r) return;
    const g = r.gpu?.[0];
    d.body.innerHTML = `
      <h4>CPU — ${r.cpu.model} · ${r.cpu.logical} threads · ${r.cpu.average}%</h4>
      <div class="cores">${r.cpu.perCore.map((x) => `<div title="${x}%"><i style="height:${x}%"></i></div>`).join('')}</div>
      <h4>Memória</h4><div class="muted">Sistema ${(r.memory.systemTotalGb - r.memory.systemFreeGb).toFixed(1)} / ${r.memory.systemTotalGb} GB · processo ${r.memory.processRssMb} MB · heap do kernel ${r.memory.kernelHeapMb} MB</div>
      <div class="meter"><i style="width:${(100 * (1 - r.memory.systemFreeGb / r.memory.systemTotalGb)).toFixed(1)}%"></i></div>
      <h4>Kernel</h4><div class="muted">${r.kernelThreads} threads no kernel principal · workers ${r.pool.workers}/${r.pool.maxWorkers} (ocupados ${r.pool.busy}, fila ${r.pool.queued}, concluídos ${r.pool.completed}) · até ${r.pool.heapLimitMbPerWorker} MB por worker</div>
      <h4>GPU — ${g ? g.name : app.vp.gpuName}</h4>
      ${g ? `<div class="muted">VRAM ${g.vramUsedMb} / ${g.vramTotalMb} MB · uso ${g.utilization}% · ${g.temperatureC} °C</div><div class="meter"><i style="width:${(100 * g.vramUsedMb) / g.vramTotalMb}%"></i></div>` : '<div class="muted">nvidia-smi indisponível</div>'}
      <div class="muted small">Renderizador desta janela: ${app.vp.gpuName}</div>`;
  };
  poll();
  timer = setInterval(poll, 1500);
}

// ---------------------------------------------------------------- opções
export function optionsDialog() {
  dialog({
    id: 'options', title: 'Opções do aplicativo', iconName: 'options', width: 520,
    body: (b) => {
      const st = app.settings;
      const sel = (key, opts, on) => { const s = h('select', {}, ...opts.map(([v, l]) => h('option', { value: v, selected: st[key] === v }, l))); s.addEventListener('change', () => { st[key] = s.value; saveSettings(); on?.(s.value); }); return s; };
      const chk = (key, on) => { const c = h('input', { type: 'checkbox', checked: !!st[key] }); c.addEventListener('change', () => { st[key] = c.checked; saveSettings(); on?.(c.checked); }); return c; };
      b.append(
        h('h4', {}, 'Aparência'),
        h('label', { class: 'field' }, h('span', {}, 'Tema'), sel('theme', [['light', 'Claro'], ['dark', 'Escuro']], (v) => applyTheme(v))),
        h('label', { class: 'field' }, h('span', {}, 'Estilo visual'), sel('style', [['shadedEdges', 'Sombreado com arestas'], ['shaded', 'Sombreado'], ['wire', 'Aramado'], ['xray', 'Raio X']], (v) => app.vp.setStyle(v))),
        h('label', { class: 'field' }, h('span', {}, 'Qualidade de exibição'), sel('quality', [['draft', 'Rascunho (0,1 mm)'], ['normal', 'Normal (0,02 mm)'], ['fine', 'Fina (0,005 mm)']], (v) => rpc('set_display_quality', { quality: v }))),
        h('h4', {}, 'Esboço'),
        h('label', { class: 'field' }, chk('gridSnap'), h('span', {}, 'Ajustar à grade')),
        h('label', { class: 'field' }, chk('showConstraints'), h('span', {}, 'Mostrar símbolos de restrição')),
        h('h4', {}, 'Exportação'),
        h('label', { class: 'field' }, h('span', {}, 'Tesselagem de STL/3MF'), sel('exportQuality', [['normal', 'Normal (0,02 mm)'], ['fine', 'Fina (0,005 mm)'], ['ultra', 'Ultra (0,001 mm)']])),
      );
    },
    buttons: [{ label: 'Fechar', primary: true, action: ({ close }) => close() }],
  });
}
export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  app.vp.setTheme(t);
  window.projetista?.setTitleBar?.(t);
}
export function toggleTheme() { app.settings.theme = app.settings.theme === 'dark' ? 'light' : 'dark'; saveSettings(); applyTheme(app.settings.theme); }
export function setStyle(s) { app.settings.style = app.vp.style === s ? 'shadedEdges' : s; saveSettings(); app.vp.setStyle(app.settings.style); window.dispatchEvent(new Event('ribbon-refresh')); }
export function setProjection(p) { app.settings.projection = p; saveSettings(); app.vp.setProjection(p); window.dispatchEvent(new Event('ribbon-refresh')); }
export function lookAtCommand() {
  setPrompt('Olhar para: clique numa face plana', true);
  app.vp.hoverFilter = { faces: true };
  app.oneShotPick = async (e) => {
    const hit = app.vp.pick(e, { faces: true });
    app.oneShotPick = null; app.vp.hoverFilter = null; setPrompt('');
    if (!hit) return;
    const { facesOf } = await import('./store.js');
    const f = (await facesOf(hit.body)).find((x) => x.index === hit.index);
    if (f?.normal) app.vp.lookAtPlane(f.normal);
    else app.vp.lookAtPlane(hit.normal);
  };
}

// ---------------------------------------------------------------- configurações, versões, aparência
export function configsDialog() {
  const d = dialog({ id: 'configs', title: 'Tabela de configurações', iconName: 'configs', width: 720, body: (b) => render(b), buttons: [{ label: 'Fechar', primary: true, action: ({ close }) => close() }] });
  function render(b) {
    b.innerHTML = '';
    const s = app.state, params = Object.keys(s.parameterDefs), names = Object.keys(s.configurations);
    const tbl = h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Configuração'), ...params.map((p) => h('th', {}, p)), h('th', {}, ''))));
    const tb = h('tbody');
    for (const n of names) {
      const cfg = s.configurations[n];
      tb.append(h('tr', { class: s.activeConfiguration === n ? 'active' : '' }, h('td', {}, h('b', {}, n)), ...params.map((p) => {
        const inp = h('input', { value: cfg[p] ?? '', placeholder: String(s.parameterDefs[p].expr) });
        inp.addEventListener('change', () => { const v = { ...cfg }; if (inp.value === '') delete v[p]; else v[p] = isNaN(+inp.value) ? inp.value : +inp.value; rpc('set_configuration', { name: n, values: v }); });
        return h('td', {}, inp);
      }), h('td', {}, h('button', { onclick: () => rpc('activate_configuration', { name: n }) }, s.activeConfiguration === n ? '● ativa' : 'Ativar'))));
    }
    tbl.append(tb);
    b.append(h('div', { class: 'scroll' }, tbl), h('div', { class: 'row' },
      h('button', { onclick: async () => { const n = await ask({ title: 'Nova configuração', label: 'Nome (ex.: P, M, G)', value: `Config${names.length + 1}` }); if (n) rpc('set_configuration', { name: n, values: {} }); } }, '+ Nova configuração'),
      h('button', { onclick: () => rpc('activate_configuration', { name: null }) }, 'Voltar ao padrão'),
      h('span', { class: 'muted' }, `Ativa: ${s.activeConfiguration || 'padrão'}`)));
  }
  d.refresh = () => render(d.body);
  app.onStateDialogs.add(d);
}
export async function saveVersion() { const label = await ask({ title: 'Salvar versão', label: 'Descrição', value: `Versão ${(app.state.versions?.length || 0) + 1}` }); if (label) { await rpc('save_version', { label }); toast('Versão salva'); } }
export function versionsDialog() {
  const d = dialog({ id: 'versions', title: 'Histórico de versões', iconName: 'versions', width: 520, body: (b) => render(b), buttons: [{ label: '+ Salvar versão atual', action: () => saveVersion() }, { label: 'Fechar', primary: true, action: ({ close }) => close() }] });
  function render(b) {
    b.innerHTML = '';
    const v = app.state.versions || [];
    if (!v.length) b.append(h('div', { class: 'muted' }, 'Nenhuma versão salva.'));
    for (const x of [...v].reverse()) b.append(h('div', { class: 'fileitem' }, ico('versions'), h('div', {}, h('b', {}, x.label), h('div', { class: 'muted' }, new Date(x.time).toLocaleString('pt-BR'))), h('button', { onclick: () => rpc('restore_version', { id: x.id }).then(() => toast(`Restaurada: ${x.label}`)) }, 'Restaurar')));
  }
  d.refresh = () => render(d.body);
  app.onStateDialogs.add(d);
}
export function appearanceDialog(bodyName) {
  dialog({
    id: 'appearance', title: 'Material e aparência', iconName: 'appearance', width: 420,
    body: (b) => {
      const sel = h('select', {}, ...bodyNames().map((n) => h('option', { selected: n === (bodyName || app.selectedBody) }, n)));
      const mat = h('select', {}, h('option', { value: '' }, '(manter)'), ...(app.materials || []).map((m) => h('option', {}, m)));
      const col = h('input', { type: 'color', value: (app.scene?.bodies.find((x) => x.name === sel.value)?.color) || '#4f8cff' });
      b.append(h('label', { class: 'field' }, h('span', {}, 'Corpo'), sel), h('label', { class: 'field' }, h('span', {}, 'Material'), mat), h('label', { class: 'field' }, h('span', {}, 'Cor'), col));
      b.apply = () => rpc('add_feature', { feature: { type: 'appearance', body: sel.value, ...(mat.value ? { material: mat.value } : {}), color: col.value } });
      b.applyMat = () => rpc('add_feature', { feature: { type: 'appearance', body: sel.value, material: mat.value } });
    },
    buttons: [{ label: 'Aplicar', primary: true, action: ({ body, close }) => { body.apply(); close(); } }, { label: 'Cancelar', action: ({ close }) => close() }],
  });
}

// ---------------------------------------------------------------- Claude
export async function claudeDialog() {
  const info = await rpc('info');
  const cli = info.cli.replace(/\\/g, '/'), exe = info.exe?.replace(/\\/g, '/');
  const cfg = exe ? { mcpServers: { projetista: { command: exe, args: [cli, 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } } } } : { mcpServers: { projetista: { command: 'node', args: [cli, 'mcp'] } } };
  const code = exe ? `claude mcp add projetista -e ELECTRON_RUN_AS_NODE=1 -- "${exe}" "${cli}" mcp` : `claude mcp add projetista -- node "${cli}" mcp`;
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('Copiado'));
  dialog({
    id: 'claude', title: 'Conectar o Claude ao Projetista', iconName: 'claude', width: 640,
    body: h('div', {},
      h('p', {}, 'O Projetista é um servidor MCP. Com o app aberto, o Claude trabalha neste mesmo documento e as imagens que ele pede são renderizadas pela sua GPU.'),
      h('h4', {}, 'Claude Code'), h('pre', { class: 'out' }, code), h('button', { onclick: () => copy(code) }, 'Copiar'),
      h('h4', {}, 'Claude Desktop — claude_desktop_config.json'), h('pre', { class: 'out' }, JSON.stringify(cfg, null, 2)), h('button', { onclick: () => copy(JSON.stringify(cfg, null, 2)) }, 'Copiar'),
      h('p', { class: 'muted' }, 'Depois peça, por exemplo: “Projete um suporte de parede para um roteador de 120×30 mm, imprimível em PETG, e me mostre as vistas.”')),
    buttons: [{ label: 'Fechar', primary: true, action: ({ close }) => close() }],
  });
}
export function activityDialog() {
  const d = dialog({ id: 'activity', title: 'Atividade', iconName: 'activity', width: 520, body: (b) => render(b), buttons: [{ label: 'Fechar', primary: true, action: ({ close }) => close() }] });
  function render(b) {
    b.innerHTML = '';
    const list = [...(app.activities || [])].reverse();
    if (!list.length) b.append(h('div', { class: 'muted' }, 'Nenhuma atividade ainda.'));
    for (const a of list.slice(0, 80)) b.append(h('div', { class: `act-row ${a.source}` }, h('span', { class: 'muted' }, new Date(a.time).toLocaleTimeString('pt-BR')), a.source === 'claude' ? h('b', {}, ' ✦ Claude: ') : ' ', a.label));
  }
  d.refresh = () => render(d.body);
  app.onStateDialogs.add(d);
}

// ---------------------------------------------------------------- edição avançada (JSON)
export function jsonEditDialog(name) {
  const f = app.state.features.find((x) => x.name === name);
  dialog({
    id: `json-${name}`, title: `Editar ${name} (${f.type})`, iconName: 'edit', width: 560,
    body: (b) => { const ta = h('textarea', { class: 'code', rows: 16, spellcheck: 'false' }); ta.value = JSON.stringify(f, null, 2); b.append(ta); b.ta = ta; },
    buttons: [{ label: 'Aplicar', primary: true, action: async ({ body, close }) => {
      let next;
      try { next = JSON.parse(body.ta.value); } catch (e) { toast(`JSON inválido: ${e.message}`, 'err'); return; }
      const patch = { ...next }; delete patch.name; delete patch.type;
      for (const k of Object.keys(f)) if (!(k in next) && k !== 'name' && k !== 'type') patch[k] = null;
      await rpc('update_feature', { name, patch });
      close();
    } }, { label: 'Cancelar', action: ({ close }) => close() }],
  });
}
