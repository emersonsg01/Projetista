// Navegador do modelo (árvore): documento, corpos sólidos, origem, recursos na ordem da linha do
// tempo (esboços aninhados sob o recurso que os consome) e o marcador "Fim da peça" arrastável.
import { rpc } from './rpc.js';
import { app } from './store.js';
import { h, ico, $, contextMenu, toast, ask } from './ui.js';
import { icon } from './icons.js';
import { editFeature } from './commands.js';
import { appearanceDialog, ipropsDialog, jsonEditDialog } from './dialogs.js';

const ICON = {
  box: 'box', cylinder: 'cylinder', cone: 'cone', sphere: 'sphere', torus: 'torus', sketch: 'sketch2d', extrude: 'extrude', revolve: 'revolve', loft: 'loft',
  sweep: 'sweep', pipe: 'pipe', hole: 'hole', fillet: 'fillet', round_edges: 'fillet', chamfer: 'chamfer', draft: 'draft', shell: 'shell', offset_body: 'offset',
  push_pull: 'pushpull', boolean: 'combine', transform: 'move', mirror: 'mirror', pattern_linear: 'patternRect', pattern_circular: 'patternCirc', split: 'split',
  mate: 'mate', import_step: 'importStep', import_mesh: 'import', appearance: 'appearance', delete_body: 'delete', rename_body: 'edit',
};
const open = new Set(['bodies', 'root']);

export function renderBrowser() {
  const s = app.state;
  const tree = $('#tree');
  if (!s) return;
  tree.innerHTML = '';
  const node = (opts) => {
    const row = h('div', {
      class: `node ${opts.cls || ''} ${opts.selected ? 'sel' : ''}`, style: { paddingLeft: `${6 + (opts.depth || 0) * 16}px` }, title: opts.title || '',
      onclick: (e) => { e.stopPropagation(); opts.onclick?.(e); }, ondblclick: (e) => { e.stopPropagation(); opts.ondblclick?.(e); },
      oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); if (opts.menu) contextMenu(e.clientX, e.clientY, opts.menu()); },
    },
    opts.toggle !== undefined ? h('span', { class: 'tw', onclick: (e) => { e.stopPropagation(); open.has(opts.toggle) ? open.delete(opts.toggle) : open.add(opts.toggle); renderBrowser(); } }, open.has(opts.toggle) ? '▾' : '▸') : h('span', { class: 'tw' }),
    ico(opts.icon), h('span', { class: 'nm' }, opts.label), opts.badge ? h('span', { class: 'badge' }, opts.badge) : '', opts.extra || '',
    ...(opts.actions || []).map((a) => h('button', { class: 'act', title: a.title, html: icon(a.icon), onclick: (e) => { e.stopPropagation(); a.fn(); } })));
    if (opts.drop) { row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop'); }); row.addEventListener('dragleave', () => row.classList.remove('drop')); row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('drop'); opts.drop(); }); }
    tree.append(row);
    return row;
  };

  node({ icon: 'part', label: `${s.name}.projetista`, cls: 'root', toggle: 'root', menu: () => [{ label: 'Renomear documento', icon: 'edit', action: async () => { const n = await ask({ title: 'Renomear', label: 'Nome', value: s.name }); if (n) rpc('rename_document', { name: n }); } }, { label: 'iPropriedades', icon: 'iprops', action: () => ipropsDialog() }] });
  if (!open.has('root')) return;
  // corpos
  const bodies = s.summary.bodies;
  node({ icon: 'folder', label: `Corpos sólidos (${bodies.length})`, depth: 1, toggle: 'bodies' });
  if (open.has('bodies')) {
    for (const b of bodies) {
      const hidden = app.hidden.has(b.name);
      node({
        icon: 'body', label: b.name, depth: 2, cls: hidden ? 'dim' : '', selected: app.selectedBody === b.name, title: `${b.material} · ${b.volume_mm3} mm³`,
        extra: h('span', { class: 'sw', style: { background: b.color } }),
        actions: [{ icon: hidden ? 'eye' : 'eyeOff', title: hidden ? 'Mostrar' : 'Ocultar', fn: () => toggleBody(b.name) }, { icon: 'appearance', title: 'Material e aparência', fn: () => appearanceDialog(b.name) }],
        onclick: () => { app.selectedBody = b.name; app.vp.setSelection([{ kind: 'body', body: b.name }]); renderBrowser(); },
        menu: () => [
          { label: hidden ? 'Mostrar' : 'Ocultar', icon: hidden ? 'eye' : 'eyeOff', action: () => toggleBody(b.name) },
          { label: 'Material e aparência…', icon: 'appearance', action: () => appearanceDialog(b.name) },
          { label: 'Propriedades físicas', icon: 'iprops', action: () => { app.selectedBody = b.name; ipropsDialog(); } },
          { label: 'Renomear corpo', icon: 'edit', action: async () => { const n = await ask({ title: 'Renomear corpo', label: 'Novo nome', value: b.name }); if (n && n !== b.name) rpc('add_feature', { feature: { type: 'rename_body', body: b.name, to: n } }); } },
          '-',
          { label: 'Excluir corpo', icon: 'delete', action: () => rpc('add_feature', { feature: { type: 'delete_body', body: b.name } }) },
        ],
      });
    }
  }
  // origem
  node({ icon: 'folder', label: 'Origem', depth: 1, toggle: 'origin' });
  if (open.has('origin')) {
    const vis = app.originVis ||= { XY: false, XZ: false, YZ: false, axes: false };
    for (const [k, lbl, ic] of [['YZ', 'Plano YZ', 'plane'], ['XZ', 'Plano XZ', 'plane'], ['XY', 'Plano XY', 'plane'], ['axes', 'Eixos X, Y, Z', 'axis']]) {
      node({ icon: ic, label: lbl, depth: 2, cls: vis[k] ? '' : 'dim', onclick: () => { vis[k] = !vis[k]; app.originPinned = Object.values(vis).some(Boolean); app.vp.showOrigin(vis); renderBrowser(); } });
    }
    node({ icon: 'point', label: 'Ponto central', depth: 2, cls: 'dim' });
  }
  // recursos (esboços consumidos aparecem aninhados)
  const consumed = new Map();
  for (const f of s.features) for (const ref of [f.sketch, f.profile, ...(f.sections || [])].filter(Boolean)) if (!consumed.has(ref)) consumed.set(ref, f.name);
  const status = new Map(s.status.map((x) => [x.name, x]));
  const eopIndex = s.rollback === null ? s.features.length : s.rollback;
  const featureRow = (f, i, depth) => {
    const st = status.get(f.name) || {};
    const cls = [st.state === 'error' ? 'err' : '', st.state === 'suppressed' ? 'supp' : '', i >= eopIndex ? 'rolled' : '', app.selectedFeature === f.name ? '' : ''].join(' ');
    const kids = s.features.filter((x) => consumed.get(x.name) === f.name);
    const key = `f:${f.name}`;
    node({
      icon: ICON[f.type] || 'part', label: f.name, depth, cls, selected: app.selectedFeature === f.name, title: st.error || (st.warnings || []).join('\n') || `${f.type}${st.ms !== undefined ? ` · ${st.ms} ms` : ''}`,
      toggle: kids.length ? key : undefined, badge: st.state === 'error' ? '⚠' : '',
      actions: [{ icon: 'edit', title: f.type === 'sketch' ? 'Editar esboço' : 'Editar recurso', fn: () => editFeature(f.name) }, { icon: f.suppressed ? 'eye' : 'eyeOff', title: f.suppressed ? 'Reativar' : 'Suprimir', fn: () => rpc('suppress_feature', { name: f.name, suppressed: !f.suppressed }) }],
      onclick: () => { app.selectedFeature = f.name; renderBrowser(); },
      ondblclick: () => editFeature(f.name),
      drop: () => rpc('set_rollback', { index: i + 1 }),
      menu: () => [
        { label: f.type === 'sketch' ? 'Editar esboço' : 'Editar recurso', icon: 'edit', action: () => editFeature(f.name) },
        { label: f.suppressed ? 'Reativar recurso' : 'Suprimir recurso', icon: f.suppressed ? 'eye' : 'eyeOff', action: () => rpc('suppress_feature', { name: f.name, suppressed: !f.suppressed }) },
        { label: 'Mover o fim da peça para cá', icon: 'eop', action: () => rpc('set_rollback', { index: i + 1 }) },
        { label: 'Renomear', icon: 'edit', action: async () => { const n = await ask({ title: 'Renomear recurso', label: 'Novo nome', value: f.name }); if (n && n !== f.name) rpc('rename_feature', { name: f.name, to: n }).catch((e) => toast(e.message, 'err')); } },
        { label: 'Editar definição (JSON)…', icon: 'macro', action: () => jsonEditDialog(f.name) },
        '-',
        { label: 'Excluir', icon: 'delete', action: () => rpc('delete_feature', { name: f.name }) },
      ],
    });
    if (kids.length && open.has(key)) for (const k of kids) featureRow(k, s.features.indexOf(k), depth + 1);
  };
  s.features.forEach((f, i) => {
    if (i === eopIndex) eop();
    if (consumed.has(f.name) && s.features.findIndex((x) => x.name === consumed.get(f.name)) > i) return; // aparece sob o consumidor
    featureRow(f, i, 1);
  });
  if (eopIndex >= s.features.length) eop();

  function eop() {
    const row = node({ icon: 'eop', label: 'Fim da peça', depth: 1, cls: 'eop', title: 'Arraste para outra posição para retroceder a linha do tempo', menu: () => [{ label: 'Mover para o fim', icon: 'eop', action: () => rpc('set_rollback', { index: null }) }] });
    row.draggable = true;
  }
}

export function toggleBody(name) {
  app.hidden.has(name) ? app.hidden.delete(name) : app.hidden.add(name);
  app.vp.setBodyVisible(name, !app.hidden.has(name));
  renderBrowser();
}
