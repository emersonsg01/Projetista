// Faixa de opções (ribbon): abas, painéis, botões grandes/pequenos/grade, aba contextual de
// Esboço, minimizar com duplo clique e dicas com atalhos.
import { COMMANDS, runCommand } from './commands.js';
import { app } from './store.js';
import { h, $, $$ } from './ui.js';
import { icon } from './icons.js';
import { backstage } from './dialogs.js';

const big = (id) => ({ kind: 'big', id });
const col = (...ids) => ({ kind: 'col', ids });
const grid = (...ids) => ({ kind: 'grid', ids });

export const TABS = [
  { id: 'sketch', label: 'Esboço', contextual: true, panels: [
    { title: 'Criar', items: [big('sk_line'), col('sk_circle', 'sk_arc', 'sk_rect'), col('sk_rectCenter', 'sk_polygon', 'sk_slot'), col('sk_sketchPoint')] },
    { title: 'Modificar', items: [col('sk_delete', 'sk_construction')] },
    { title: 'Restringir', items: [big('sk_dimension'), grid('sk_coincident', 'sk_horizontal', 'sk_vertical', 'sk_parallel', 'sk_perpendicular', 'sk_tangent', 'sk_equal', 'sk_fix', 'sk_concentric', 'sk_symmetric', 'sk_midpoint', 'sk_showConstraints')] },
    { title: 'Sair', items: [big('finishSketch'), big('cancelSketch')] },
  ] },
  { id: 'model', label: 'Modelo 3D', panels: [
    { title: 'Esboço', items: [big('sketch2d')] },
    { title: 'Criar', items: [big('extrude'), big('revolve'), col('loft', 'sweep', 'pipe'), col('import_step', 'importMesh')] },
    { title: 'Modificar', items: [big('hole'), big('fillet'), col('chamfer', 'shell', 'draft'), col('push_pull', 'boolean', 'split'), col('offset_body', 'transform')] },
    { title: 'Padrão', items: [col('pattern_linear', 'pattern_circular', 'mirror')] },
    { title: 'Primitivas', items: [col('box', 'cylinder', 'sphere'), col('torus', 'cone')] },
    { title: 'Montagem', items: [big('mate')] },
    { title: 'Inspecionar', items: [big('measure')] },
  ] },
  { id: 'annotate', label: 'Anotar', panels: [
    { title: 'Desenho', items: [big('drawing')] },
    { title: 'Exportar', items: [big('exportStep'), col('exportStl', 'export3mf', 'exportGlb'), col('exportObj')] },
  ] },
  { id: 'inspect', label: 'Inspecionar', panels: [
    { title: 'Medir', items: [big('measure')] },
    { title: 'Propriedades', items: [big('iprops'), col('bom')] },
    { title: 'Análise', items: [big('interference'), big('section'), col('zebra', 'draftAnalysis', 'curvature'), col('printCheck')] },
  ] },
  { id: 'tools', label: 'Ferramentas', panels: [
    { title: 'Parâmetros', items: [big('params')] },
    { title: 'Projeto', items: [big('study'), big('optimize')] },
    { title: 'Automação', items: [big('macro')] },
    { title: 'Opções', items: [big('resources'), big('options')] },
  ] },
  { id: 'manage', label: 'Gerenciar', panels: [
    { title: 'Parâmetros', items: [big('params'), big('configs')] },
    { title: 'Versões', items: [big('saveVersion'), big('versions')] },
    { title: 'Atualizar', items: [big('rebuild')] },
    { title: 'Aparência', items: [big('appearance')] },
  ] },
  { id: 'view', label: 'Vista', panels: [
    { title: 'Aparência', items: [col('shadedEdges', 'shaded', 'wire'), col('xray', 'zebra', 'curvature')] },
    { title: 'Visibilidade', items: [col('origin', 'toggleSketches', 'toggleBrowser')] },
    { title: 'Navegar', items: [big('fit'), col('home', 'previous', 'lookAt'), col('ortho', 'persp')] },
    { title: 'Interface', items: [big('theme'), big('resources')] },
  ] },
  { id: 'claude', label: 'Claude ✦', panels: [
    { title: 'MCP', items: [big('claude')] },
    { title: 'Atividade', items: [big('activity')] },
  ] },
];

// estados "ligados" exibidos nos botões
const ACTIVE = {
  shadedEdges: () => app.vp.style === 'shadedEdges', shaded: () => app.vp.style === 'shaded', wire: () => app.vp.style === 'wire', xray: () => app.vp.style === 'xray',
  zebra: () => app.vp.style === 'zebra', curvature: () => app.vp.style === 'curvature', draftAnalysis: () => app.vp.style === 'draft',
  ortho: () => app.settings.projection === 'ortho', persp: () => app.settings.projection !== 'ortho', origin: () => app.originPinned,
  toggleSketches: () => app.settings.showSketches, toggleBrowser: () => !document.body.classList.contains('no-browser'),
  sk_construction: () => !!app.sketching?.construction, sk_showConstraints: () => app.settings.showConstraints,
};

let activeTab = 'model';
export function renderRibbon() {
  const tabs = $('#ribbonTabs');
  tabs.innerHTML = '';
  tabs.append(h('button', { class: 'tab file', onclick: () => backstage() }, 'Arquivo'));
  for (const t of TABS) {
    if (t.contextual && !app.sketching) continue;
    if (!t.contextual && app.sketching && t.id !== 'view' && t.id !== 'inspect') continue;
    tabs.append(h('button', {
      class: `tab ${t.id === activeTab ? 'on' : ''} ${t.contextual ? 'ctx' : ''}`,
      onclick: () => { activeTab = t.id; document.body.classList.remove('ribbon-min'); renderRibbon(); },
      ondblclick: () => document.body.classList.toggle('ribbon-min'),
    }, t.label));
  }
  const tab = TABS.find((t) => t.id === activeTab) || TABS[1];
  const rb = $('#ribbon');
  rb.innerHTML = '';
  for (const p of tab.panels) {
    const body = h('div', { class: 'rp-body' });
    for (const it of p.items) {
      if (it.kind === 'big') body.append(button(it.id, 'big'));
      else if (it.kind === 'col') body.append(h('div', { class: 'rp-col' }, ...it.ids.map((id) => button(id, 'small'))));
      else if (it.kind === 'grid') body.append(h('div', { class: 'rp-grid' }, ...it.ids.map((id) => button(id, 'tiny'))));
    }
    rb.append(h('div', { class: 'rpanel' }, body, h('div', { class: 'rp-title' }, p.title)));
  }
}
function button(id, size) {
  const c = COMMANDS[id];
  if (!c) return h('span');
  const on = ACTIVE[id]?.();
  const tip = `${c.label}${c.key ? `  (${c.key})` : ''}`;
  return h('button', { class: `rb ${size} ${on ? 'on' : ''}`, title: tip, 'data-cmd': id, onclick: () => runCommand(id) },
    h('span', { class: 'ico', html: icon(c.icon) }), size === 'tiny' ? '' : h('span', { class: 'lbl' }, c.label));
}
export function setTab(id) { activeTab = id; renderRibbon(); }
export function refreshRibbon() { $$('#ribbon .rb').forEach((b) => b.classList.toggle('on', !!ACTIVE[b.dataset.cmd]?.())); }

window.addEventListener('sketchmode', (e) => { activeTab = e.detail ? 'sketch' : 'model'; renderRibbon(); });
window.addEventListener('ribbon-refresh', refreshRibbon);
