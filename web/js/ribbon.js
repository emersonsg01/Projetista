// Faixa de opções (ribbon): abas por tarefa, painéis com botões grandes/pequenos, aba
// contextual de Esboço, dicas ricas (o que faz + atalho) e minimizar com duplo clique.
import { COMMANDS, runCommand } from './commands.js';
import { app } from './store.js';
import { h, $, $$ } from './ui.js';
import { icon } from './icons.js';
import { backstage } from './dialogs.js';

const big = (id) => ({ kind: 'big', id });
const col = (...ids) => ({ kind: 'col', ids });

export const TABS = [
  { id: 'sketch', label: 'Esboço', contextual: true, panels: [
    { title: 'Desenhar', items: [big('sk_line'), col('sk_circle', 'sk_arc', 'sk_rect'), col('sk_rectCenter', 'sk_polygon', 'sk_slot'), col('sk_sketchPoint', 'sk_construction', 'sk_delete')] },
    { title: 'Cotar', items: [big('sk_dimension')] },
    { title: 'Restringir', items: [col('sk_coincident', 'sk_horizontal', 'sk_vertical'), col('sk_parallel', 'sk_perpendicular', 'sk_tangent'), col('sk_equal', 'sk_concentric', 'sk_fix'), col('sk_symmetric', 'sk_midpoint', 'sk_showConstraints')] },
    { title: 'Concluir', items: [big('finishSketch'), big('cancelSketch')] },
  ] },
  { id: 'model', label: 'Modelo 3D', panels: [
    { title: 'Esboço', items: [big('sketch2d')] },
    { title: 'Criar', items: [big('extrude'), big('revolve'), col('loft', 'sweep', 'pipe')] },
    { title: 'Modificar', items: [big('hole'), big('fillet'), col('chamfer', 'shell', 'draft'), col('push_pull', 'offset_body')] },
    { title: 'Corpos', items: [col('boolean', 'transform', 'split'), col('mirror', 'pattern_linear', 'pattern_circular')] },
    { title: 'Primitivas', items: [col('box', 'cylinder', 'sphere'), col('torus', 'cone')] },
    { title: 'Montagem', items: [big('mate')] },
    { title: 'Medir', items: [big('measure')] },
  ] },
  { id: 'inspect', label: 'Inspecionar', panels: [
    { title: 'Medir', items: [big('measure')] },
    { title: 'Propriedades', items: [big('iprops'), big('bom')] },
    { title: 'Verificar', items: [big('interference'), big('printCheck')] },
    { title: 'Visualizar', items: [big('section'), col('zebra', 'draftAnalysis', 'curvature')] },
  ] },
  { id: 'output', label: 'Exportar', panels: [
    { title: 'Exportar', items: [big('exportDialog'), col('exportStep', 'exportStl', 'export3mf'), col('exportObj', 'exportGlb')] },
    { title: 'Desenho', items: [big('drawing')] },
    { title: 'Importar', items: [big('import_step'), col('importMesh')] },
  ] },
  { id: 'manage', label: 'Gerenciar', panels: [
    { title: 'Parâmetros', items: [big('params'), big('configs')] },
    { title: 'Projeto', items: [big('study'), big('optimize')] },
    { title: 'Versões', items: [big('saveVersion'), big('versions')] },
    { title: 'Automação', items: [big('macro')] },
    { title: 'Atualizar', items: [big('rebuild')] },
    { title: 'Aplicativo', items: [big('options'), big('resources')] },
  ] },
  { id: 'view', label: 'Vista', panels: [
    { title: 'Estilo visual', items: [col('shadedEdges', 'shaded', 'wire'), col('xray', 'zebra', 'curvature')] },
    { title: 'Mostrar', items: [col('origin', 'toggleSketches', 'toggleBrowser')] },
    { title: 'Navegar', items: [big('fit'), col('home', 'previous', 'lookAt'), col('ortho', 'persp')] },
    { title: 'Interface', items: [big('theme')] },
  ] },
  { id: 'claude', label: 'Claude ✦', panels: [
    { title: 'MCP', items: [big('claude')] },
    { title: 'Atividade', items: [big('activity')] },
  ] },
];

// descrições das dicas
export const DESC = {
  sketch2d: 'Desenha um perfil 2D num plano ou numa face plana. É o ponto de partida de extrusões e revoluções.',
  extrude: 'Puxa um perfil do esboço para criar volume (ou recortar). Aceita distância, afunilamento e torção.',
  revolve: 'Gira um perfil em torno de um eixo do esboço — eixos, polias, flanges.',
  loft: 'Cria uma transição suave entre dois ou mais perfis.',
  sweep: 'Varre um perfil ao longo de um caminho 3D.',
  pipe: 'Cria um tubo maciço ou oco ao longo de pontos, com curvas reais.',
  hole: 'Furos simples, com rebaixo ou escareados, em tamanhos ISO. Clique na face para posicionar.',
  fillet: 'Arredonda as arestas escolhidas com um raio.',
  chamfer: 'Corta as arestas escolhidas em ângulo.',
  shell: 'Esvazia o corpo deixando paredes com a espessura indicada.',
  draft: 'Inclina faces para facilitar a desmoldagem (injeção, fundição).',
  push_pull: 'Empurra ou puxa uma face plana para adicionar ou remover material.',
  offset_body: 'Engrossa ou afina o corpo inteiro (offset 3D).',
  boolean: 'Une, subtrai ou intersecta corpos.',
  transform: 'Move ou gira um corpo, opcionalmente criando uma cópia.',
  split: 'Divide um corpo em dois com um plano.',
  mirror: 'Espelha um corpo por um plano de origem.',
  pattern_linear: 'Repete um corpo em linhas e colunas.',
  pattern_circular: 'Repete um corpo em volta de um eixo.',
  mate: 'Encosta a face de um corpo na face de outro (montagem).',
  measure: 'Mede faces e distâncias exatas entre faces.',
  iprops: 'Massa, volume, centro de gravidade e inércia do corpo.',
  bom: 'Lista de materiais com massa e custo estimado.',
  interference: 'Encontra corpos que se sobrepõem ou se tocam.',
  printCheck: 'Verifica balanços, paredes finas e estima tempo e filamento.',
  section: 'Corta a vista com um plano para ver o interior.',
  zebra: 'Listras para avaliar a continuidade das superfícies.',
  draftAnalysis: 'Colore as faces conforme o ângulo de saída em Z.',
  curvature: 'Destaca as regiões curvas do modelo.',
  exportDialog: 'Exporta para STEP, STL, 3MF, OBJ, GLB ou desenho SVG, escolhendo corpos, precisão e pasta.',
  exportStep: 'Exporta em STEP (geometria exata) para outros CADs e usinagem.',
  exportStl: 'Exporta em STL para impressão 3D.',
  export3mf: 'Exporta em 3MF (com cores) para fatiadores.',
  exportObj: 'Exporta em OBJ.',
  exportGlb: 'Exporta em GLB para web, AR e Blender.',
  drawing: 'Gera a folha de desenho técnico com vistas, cotas e carimbo.',
  import_step: 'Traz uma peça STEP de outro CAD como corpo sólido.',
  importMesh: 'Traz uma malha STL/OBJ e converte em sólido.',
  params: 'Tabela de parâmetros e equações que dirigem as medidas do modelo.',
  configs: 'Variantes do modelo (ex.: P, M, G) com valores próprios.',
  study: 'Calcula o modelo para vários valores de um parâmetro, em paralelo.',
  optimize: 'Procura os valores de parâmetros que minimizam ou maximizam um objetivo.',
  saveVersion: 'Guarda um instantâneo nomeado do modelo.',
  versions: 'Lista e restaura versões salvas.',
  macro: 'Automatiza a modelagem com JavaScript.',
  rebuild: 'Recalcula todo o modelo do zero.',
  options: 'Tema, qualidade de exibição, grade do esboço e exportação.',
  resources: 'Uso de CPU, RAM, workers e GPU.',
  sk_line: 'Linhas em sequência. Clique no ponto inicial para fechar o contorno.',
  sk_dimension: 'Cota comprimentos, distâncias, diâmetros, raios e ângulos. Aceita expressões.',
  finishSketch: 'Sai do esboço mantendo o que foi desenhado.',
  cancelSketch: 'Sai do esboço descartando as alterações desta sessão.',
  claude: 'Mostra como ligar o Claude a este app pelo MCP.',
};

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
      else body.append(h('div', { class: 'rp-col' }, ...it.ids.map((id) => button(id, 'small'))));
    }
    rb.append(h('div', { class: 'rpanel' }, body, h('div', { class: 'rp-title' }, p.title)));
  }
}
function button(id, size) {
  const c = COMMANDS[id];
  if (!c) return h('span');
  const on = ACTIVE[id]?.();
  const b = h('button', { class: `rb ${size} ${on ? 'on' : ''}`, 'data-cmd': id, 'aria-label': c.label, onclick: () => { hideTip(); runCommand(id); } },
    h('span', { class: 'ico', html: icon(c.icon) }), h('span', { class: 'lbl' }, c.label));
  b.addEventListener('mouseenter', () => scheduleTip(b, c));
  b.addEventListener('mouseleave', hideTip);
  return b;
}

// ---------------------------------------------------------------- dicas ricas
let tipTimer = null, tipEl = null;
function scheduleTip(btn, c) {
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    hideTip();
    const r = btn.getBoundingClientRect();
    tipEl = h('div', { class: 'tip' }, h('div', { class: 'tip-head' }, h('span', { class: 'ico', html: icon(c.icon) }), h('b', {}, c.label), c.key ? h('kbd', {}, c.key) : ''), DESC[c.id] ? h('div', { class: 'tip-body' }, DESC[c.id]) : '');
    document.body.append(tipEl);
    const w = tipEl.getBoundingClientRect().width;
    tipEl.style.left = `${Math.max(6, Math.min(innerWidth - w - 6, r.left))}px`;
    tipEl.style.top = `${r.bottom + 6}px`;
  }, 450);
}
export function hideTip() { clearTimeout(tipTimer); tipEl?.remove(); tipEl = null; }

export function setTab(id) { activeTab = id; renderRibbon(); }
export function refreshRibbon() { $$('#ribbon .rb').forEach((b) => b.classList.toggle('on', !!ACTIVE[b.dataset.cmd]?.())); }

window.addEventListener('sketchmode', (e) => { activeTab = e.detail ? 'sketch' : 'model'; renderRibbon(); });
window.addEventListener('ribbon-refresh', refreshRibbon);
