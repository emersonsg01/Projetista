// Inicialização da interface no estilo Inventor e ligação entre os módulos.
import * as rpc from './rpc.js';
import { app, saveSettings } from './store.js';
import { Viewport } from './viewport.js';
import { renderRibbon, refreshRibbon, setTab } from './ribbon.js';
import { renderBrowser, toggleBody } from './browser.js';
import { COMMANDS, runCommand, editFeature } from './commands.js';
import { activePanel } from './panel.js';
import * as SK from './sketcher.js';
import * as D from './dialogs.js';
import { EXAMPLES } from './examples.js';
import { h, ico, $, $$, toast, setPrompt, setStatusRight, contextMenu, closeContextMenu, norm, fmt } from './ui.js';
import { icon } from './icons.js';

app.onStateDialogs = new Set();
app.activities = [];
if (window.projetista?.desktop) document.body.classList.add('desktop');

// ---------------------------------------------------------------- viewport
const vp = (app.vp = new Viewport($('#viewport')));
vp.idleFilter = { faces: true };
D.applyTheme(app.settings.theme);
vp.setStyle(app.settings.style);
vp.setProjection(app.settings.projection);

COMMANDS.toggleSketches = { id: 'toggleSketches', label: 'Mostrar esboços', icon: 'sketch2d', run: () => { app.settings.showSketches = !app.settings.showSketches; saveSettings(); vp.setSketchesVisible(app.settings.showSketches); refreshRibbon(); } };
COMMANDS.toggleBrowser = { id: 'toggleBrowser', label: 'Navegador do modelo', icon: 'menu', run: () => { document.body.classList.toggle('no-browser'); refreshRibbon(); } };
COMMANDS.repeat = { id: 'repeat', label: 'Repetir último comando', icon: 'rebuild', run: () => app.lastCommand && runCommand(app.lastCommand) };

// ---------------------------------------------------------------- eventos do kernel
rpc.on('open', () => setPrompt('Conectado ao kernel'));
rpc.on('close', () => setPrompt('Desconectado do kernel — reconectando…'));
rpc.on('scene', (m) => {
  app.scene = m;
  vp.setScene(m, { hidden: app.hidden, showSketches: app.settings.showSketches && !app.sketching });
  if (!app.fitted && m.bodies.length) { app.fitted = true; vp.fit([1, -1, 0.8], { instant: true }); }
});
rpc.on('state', (m) => {
  const first = !app.state;
  app.state = m.state;
  app.materials = m.state.materials;
  renderBrowser();
  updateChrome();
  activePanel()?.updateStatus();
  for (const d of [...app.onStateDialogs]) { if (!d.el.isConnected) app.onStateDialogs.delete(d); else d.refresh?.(); }
  if (first && !m.state.features.length) showHome(true);
});
rpc.on('activities', (m) => { app.activities = m.activities || []; });
rpc.on('activity', (m) => {
  app.activities.push(m.activity);
  if (m.activity.source === 'claude') toast(m.activity.label, 'claude');
});
rpc.on('render-request', async (m) => {
  try { rpc.send({ type: 'render-result', id: m.id, ok: true, ...(await vp.renderForClaude(m.opts || {})) }); }
  catch (e) { rpc.send({ type: 'render-result', id: m.id, ok: false, error: e.message }); }
});
rpc.connect();

// ---------------------------------------------------------------- cliques na janela gráfica
vp.onClick = async (e) => {
  if (app.planePick) return app.planePick(e);
  if (app.oneShotPick) return app.oneShotPick(e);
  const p = activePanel();
  if (p && (await p.handleClick(e))) return;
  if (app.sketching) return;
  const hit = vp.pick(e, { faces: true });
  if (!hit) { app.selectedBody = null; app.selectedFace = null; vp.setSelection([]); setPrompt(''); renderBrowser(); return; }
  app.selectedBody = hit.body;
  app.selectedFace = hit;
  vp.setSelection([{ kind: 'face', body: hit.body, index: hit.index }]);
  renderBrowser();
  const f = await rpc.rpc('face_info', { body: hit.body, face: hit.index }).catch(() => null);
  if (f) setPrompt(`${hit.body} · face ${hit.index}: ${f.type} · área ${fmt(f.area, 4)} mm²${f.radius !== undefined ? ` · raio ${fmt(f.radius, 6)} (Ø ${fmt(2 * f.radius, 6)})` : ''}${f.normal ? ` · normal (${f.normal.map((x) => fmt(x, 4)).join('; ')})` : ''}`);
};
vp.onDoubleClick = (e) => {
  if (app.sketching) return;
  const hit = vp.pick(e, { faces: true });
  const feat = hit && app.scene?.bodies.find((b) => b.name === hit.body)?.feature;
  if (feat) editFeature(feat);
};
vp.onContextMenu = (e) => markingMenu(e);
window.addEventListener('sketchmode', (e) => { vp.idleFilter = e.detail ? null : { faces: true }; vp.setSketchesVisible(!e.detail && app.settings.showSketches); });

// ---------------------------------------------------------------- menu radial (botão direito)
function markingMenu(e) {
  closeMarking();
  const sel = app.selectedBody;
  let ring, list;
  if (app.sketching) {
    ring = ['finishSketch', 'sk_line', 'sk_dimension', 'sk_circle', 'cancelSketch', 'sk_rect', 'sk_delete', 'sk_coincident'];
    list = [['sk_arc'], ['sk_polygon'], ['sk_construction'], ['fit']];
  } else if (activePanel()) {
    const p = activePanel();
    ring = [{ label: 'OK', icon: 'ok', run: () => p.ok() }, null, { label: 'Aplicar (+)', icon: 'plus', run: () => p.ok(true) }, null, { label: 'Cancelar', icon: 'cancel', run: () => p.cancel() }, null, null, null];
    list = [['fit'], ['home']];
  } else {
    ring = [app.lastCommand ? { label: `Repetir ${COMMANDS[app.lastCommand]?.label}`, icon: COMMANDS[app.lastCommand]?.icon, run: () => runCommand(app.lastCommand) } : 'fit', 'sketch2d', 'extrude', 'hole', 'home', 'measure', 'fillet', 'undo'];
    list = [['iprops'], ['section'], ['previous'], ...(sel ? [[{ label: app.hidden.has(sel) ? `Mostrar ${sel}` : `Ocultar ${sel}`, icon: 'eyeOff', run: () => toggleBody(sel) }]] : [])];
  }
  const root = h('div', { class: 'marking', style: { left: `${e.clientX}px`, top: `${e.clientY}px` } }, h('div', { class: 'mk-center' }));
  ring.forEach((it, i) => {
    if (!it) return;
    const c = typeof it === 'string' ? { label: COMMANDS[it]?.label, icon: COMMANDS[it]?.icon, run: () => runCommand(it) } : it;
    if (!c.label) return;
    const ang = -Math.PI / 2 + (i * Math.PI) / 4, R = 96;
    const b = h('button', { class: `mk-item ${Math.cos(ang) < -0.2 ? 'left' : Math.cos(ang) > 0.2 ? 'right' : 'mid'}`, style: { left: `${Math.cos(ang) * R}px`, top: `${Math.sin(ang) * R * 0.82}px` }, onclick: () => { closeMarking(); c.run(); } }, h('span', { class: 'ico', html: icon(c.icon) }), c.label);
    root.append(b);
  });
  const ov = h('div', { class: 'mk-list', style: { top: `${96 * 0.82 + 28}px` } });
  for (const [it] of list) {
    const c = typeof it === 'string' ? { label: COMMANDS[it]?.label, icon: COMMANDS[it]?.icon, run: () => runCommand(it) } : it;
    ov.append(h('button', { onclick: () => { closeMarking(); c.run(); } }, h('span', { class: 'ico', html: icon(c.icon) }), c.label));
  }
  root.append(ov);
  document.body.append(root);
  app.marking = root;
  setTimeout(() => addEventListener('pointerdown', outside, true), 0);
  function outside(ev) { if (!root.contains(ev.target)) closeMarking(); removeEventListener('pointerdown', outside, true); }
}
function closeMarking() { app.marking?.remove(); app.marking = null; }

// ---------------------------------------------------------------- barra de título, QAT e busca
function buildChrome() {
  const qat = $('#qat');
  const q = (id) => h('button', { class: 'qbtn', 'data-cmd': id, title: COMMANDS[id].label + (COMMANDS[id].key ? ` (${COMMANDS[id].key})` : ''), onclick: () => runCommand(id), html: icon(COMMANDS[id].icon) });
  const mat = h('select', { id: 'qatMaterial', title: 'Material (corpo selecionado ou padrão do documento)' });
  mat.addEventListener('change', async () => {
    if (app.selectedBody) await rpc.rpc('add_feature', { feature: { type: 'appearance', body: app.selectedBody, material: mat.value } });
    else await rpc.rpc('set_default_material', { material: mat.value });
  });
  const col = h('input', { type: 'color', id: 'qatColor', title: 'Aparência (cor do corpo selecionado)' });
  col.addEventListener('change', () => { if (!app.selectedBody) { toast('Selecione um corpo para mudar a aparência.', 'warn'); return; } rpc.rpc('add_feature', { feature: { type: 'appearance', body: app.selectedBody, color: col.value } }); });
  qat.append(q('new'), q('open'), q('save'), h('span', { class: 'qsep' }), q('undo'), q('redo'), h('span', { class: 'qsep' }), q('rebuild'), h('span', { class: 'qsep' }), mat, col);
  $('#appBtn').innerHTML = icon('app');
  $('#appBtn').onclick = () => D.backstage();

  const search = $('#cmdSearch'), results = $('#searchResults');
  const show = () => {
    const t = norm(search.value.trim());
    results.innerHTML = '';
    if (!t) { results.classList.add('hidden'); return; }
    const hits = Object.values(COMMANDS).filter((c) => c.label && (norm(c.label).includes(t) || norm(c.id).includes(t))).slice(0, 12);
    for (const c of hits) results.append(h('div', { class: 'sr', onclick: () => { results.classList.add('hidden'); search.value = ''; runCommand(c.id); } }, h('span', { class: 'ico', html: icon(c.icon) }), h('span', {}, c.label), c.key ? h('kbd', {}, c.key) : ''));
    results.classList.toggle('hidden', !hits.length);
  };
  search.addEventListener('input', show);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') results.firstChild?.click(); if (e.key === 'Escape') { search.value = ''; show(); search.blur(); } });
  search.addEventListener('blur', () => setTimeout(() => results.classList.add('hidden'), 150));

  // barra de navegação (à direita, sob o cubo)
  const nav = $('#navbar');
  const nb = (id, title, ic, fn, mode) => h('button', { class: `nb ${mode && vp.navMode === mode ? 'on' : ''}`, title, 'data-mode': mode || '', onclick: fn, html: icon(ic) });
  const setMode = (m) => { vp.setNavMode(vp.navMode === m ? 'orbit' : m); $$('#navbar .nb').forEach((b) => b.classList.toggle('on', b.dataset.mode === vp.navMode && vp.navMode !== 'orbit')); };
  nav.append(nb('fit', 'Zoom tudo (Home)', 'fit', () => vp.fit()), nb('pan', 'Pan (F2) — também com o botão do meio', 'pan', () => setMode('pan'), 'pan'), nb('zoom', 'Zoom (F3) — também com a roda', 'zoom', () => setMode('zoom'), 'zoom'), nb('orbit', 'Órbita livre (F4)', 'orbit', () => setMode('orbit'), 'orbit'), nb('look', 'Olhar para uma face', 'lookAt', () => runCommand('lookAt')), nb('prev', 'Vista anterior (F5)', 'previous', () => vp.previousView()));
  $('#navHome').onclick = () => vp.setView('home');
  $('#navHome').innerHTML = icon('home');

  // abas de documento
  $('#tabHome').onclick = () => showHome(true);
  $('#tabDoc').onclick = () => showHome(false);
  window.addEventListener('doc-tab', (e) => showHome(e.detail === 'home'));

  // divisor do navegador
  const split = $('#splitter');
  split.addEventListener('pointerdown', (e) => {
    const move = (ev) => { document.documentElement.style.setProperty('--browser-w', `${Math.max(180, Math.min(520, ev.clientX))}px`); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
    e.preventDefault();
  });
}

function updateChrome() {
  const s = app.state;
  $('#docTitle').textContent = `${s.name}${s.tx ? ' — editando' : ''}`;
  $('#tabDoc').querySelector('.nm').textContent = s.name;
  document.title = `Projetista — ${s.name}`;
  const u = $('[data-cmd=undo]'), r = $('[data-cmd=redo]');
  if (u) { u.disabled = !s.canUndo; u.title = s.undoLabel ? `Desfazer: ${s.undoLabel} (Ctrl+Z)` : 'Desfazer'; }
  if (r) { r.disabled = !s.canRedo; r.title = s.redoLabel ? `Refazer: ${s.redoLabel} (Ctrl+Y)` : 'Refazer'; }
  const mat = $('#qatMaterial');
  if (mat && mat.options.length !== s.materials.length) { mat.innerHTML = ''; for (const m of s.materials) mat.append(h('option', {}, m)); }
  if (mat && document.activeElement !== mat) mat.value = app.selectedBody ? (s.summary.bodies.find((b) => b.name === app.selectedBody)?.material || s.defaultMaterial) : s.defaultMaterial;
  const col = $('#qatColor');
  const sb = s.summary.bodies.find((b) => b.name === app.selectedBody);
  if (col && sb) col.value = sb.color;
  const err = s.summary.errors.length;
  const gpu = vp.gpuName.replace(/^ANGLE \(/, '').replace(/\(0x[0-9a-f]+\)|Direct3D.*$/gi, '').replace(/,\s*$/, '').trim();
  setStatusRight(`${s.summary.bodies.length} corpo(s) · ${s.features.length} recurso(s) · ${err ? `<b class="err">⚠ ${err} erro(s)</b>` : 'sem erros'} · regeneração ${s.summary.regenMs} ms${s.summary.reusedFeatures ? ` (${s.summary.reusedFeatures} do cache)` : ''} · B-rep exato · ${gpu}`);
}

// ---------------------------------------------------------------- tela inicial (aba Início)
async function showHome(on) {
  $('#tabHome').classList.toggle('on', on);
  $('#tabDoc').classList.toggle('on', !on);
  const home = $('#home');
  home.classList.toggle('hidden', !on);
  if (!on) return;
  home.innerHTML = '';
  const card = (ic, title, desc, fn) => h('button', { class: 'card', onclick: fn }, h('span', { class: 'ico big', html: icon(ic) }), h('b', {}, title), h('span', { class: 'muted' }, desc));
  const recent = h('div', { class: 'recent' }, h('span', { class: 'muted' }, 'carregando…'));
  home.append(
    h('div', { class: 'home-head' }, h('span', { class: 'ico logo', html: icon('app') }), h('div', {}, h('h1', {}, 'Projetista'), h('div', { class: 'muted' }, 'CAD paramétrico · kernel B-rep exato · GPU · MCP para o Claude'))),
    h('h3', {}, 'Novo'),
    h('div', { class: 'cards' },
      card('part', 'Peça (mm)', 'Documento de peça vazio', async () => { await D.newDocument(); showHome(false); }),
      card('open', 'Abrir…', 'Projetos .projetista', () => D.openDocument()),
      card('importStep', 'Importar STEP', 'Geometria B-rep de outro CAD', async () => { showHome(false); runCommand('import_step'); }),
      card('claude', 'Conectar o Claude', 'Servidor MCP deste app', () => D.claudeDialog())),
    h('h3', {}, 'Exemplos'),
    h('div', { class: 'cards' }, ...EXAMPLES.map((ex) => card(ex.icon, ex.title, ex.desc, async () => { await rpc.rpc('load_document', { data: ex.data }); app.fitted = false; showHome(false); setTimeout(() => vp.fit([1, -1, 0.8]), 300); }))),
    h('h3', {}, 'Recentes'), recent);
  const files = (await rpc.rpc('list_files').catch(() => [])).filter((f) => /\.projetista(\.json)?$/.test(f.file)).slice(0, 12);
  recent.innerHTML = '';
  if (!files.length) recent.append(h('span', { class: 'muted' }, 'Nenhum projeto salvo ainda.'));
  for (const f of files) recent.append(h('button', { class: 'recent-item', onclick: async () => { await rpc.rpc('open', { file: f.path }); app.docFile = f.path; app.fitted = false; showHome(false); } }, ico('part'), h('span', {}, f.file), h('span', { class: 'muted' }, new Date(f.modified).toLocaleDateString('pt-BR'))));
}

// ---------------------------------------------------------------- teclado
const KEYMAP = new Map();
for (const c of Object.values(COMMANDS)) if (c.key) KEYMAP.set(`${c.sketch ? 's:' : 'm:'}${c.key.toLowerCase()}`, c.id);
addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (e.key === 'Escape') {
    closeMarking(); closeContextMenu();
    if (app.planePick) return SK.endPlanePick();
    if (app.oneShotPick) { app.oneShotPick = null; vp.hoverFilter = null; setPrompt(''); return; }
    if (app.sketching?.toolState) return app.sketching.cancelTool();
    if (activePanel()) return activePanel().cancel();
    if (!$('#backstage').classList.contains('hidden')) return $('#backstage').classList.add('hidden');
    if (app.sketching) return SK.finish();
    app.selectedBody = null; vp.setSelection([]); renderBrowser(); setPrompt('');
    return;
  }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
  if (e.key === 'Enter' && activePanel()) { e.preventDefault(); activePanel().ok(); return; }
  if (e.key === 'F2') { vp.setNavMode(vp.navMode === 'pan' ? 'orbit' : 'pan'); return; }
  if (e.key === 'F3') { vp.setNavMode(vp.navMode === 'zoom' ? 'orbit' : 'zoom'); return; }
  if (e.key === 'F4') { vp.setNavMode('orbit'); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#cmdSearch').focus(); return; }
  const combo = `${e.ctrlKey ? 'ctrl+' : ''}${e.shiftKey && e.key.length > 1 ? 'shift+' : e.shiftKey ? 'shift+' : ''}${e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()}`;
  const id = (app.sketching && KEYMAP.get(`s:${combo}`)) || KEYMAP.get(`m:${combo}`);
  if (id) { e.preventDefault(); runCommand(id); }
});

// ---------------------------------------------------------------- app desktop (menus nativos antigos ainda suportados)
window.projetista?.onMenu?.((m) => {
  const map = { new: 'new', 'open-path': null, undo: 'undo', redo: 'redo', claude: 'claude' };
  if (m.action === 'open-path') rpc.rpc('open', { file: m.file }).then(() => { app.docFile = m.file; });
  else if (map[m.action]) runCommand(map[m.action]);
});

buildChrome();
renderRibbon();
setTab('model');
