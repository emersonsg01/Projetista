// Cotas da feature selecionada no modelo 3D (como as cotas de feature do Inventor):
// mostra as medidas paramétricas (mm / °) junto do corpo e, com um clique, deixa
// digitar outro valor ou expressão — o modelo é regenerado e se ajusta sozinho.
import * as THREE from 'three';
import { rpc } from './rpc.js';
import { app } from './store.js';
import { h, toast } from './ui.js';
import { PANELS } from './commands.js';
import { fmtNum, parseDim } from './sketcher.js';

let root = null, chips = [], key = '', anchor = null, editing = null;

/** Liga as cotas de feature ao viewport (chamado uma vez na inicialização). */
export function initFeatureDims(vp) {
  root = h('div', { class: 'fdims', style: 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3' });
  vp.el.append(root);
  vp.onFrameDims = () => frame(vp);
}

function frame(vp) {
  const name = app.sketching ? null : app.selectedFeature;
  const k = `${name}|${app.scene?.version}|${app.state?.version ?? ''}|${JSON.stringify(app.state?.parameters || {})}`;
  if (k !== key && !editing) { key = k; build(vp, name); }
  place(vp);
}

/** Corpo produzido/alterado pela feature, segundo o estado da regeneração. */
function bodyOf(name) {
  const st = (app.state?.status || []).find((s) => s.name === name);
  const out = st?.output;
  return typeof out === 'string' ? out : out?.body || null;
}

/** Campos numéricos (mm/°) do painel da feature que existem na própria feature. */
function dimFields(f) {
  const P = PANELS[f.type];
  if (!P) return [];
  const out = [];
  for (const sec of P.sections || []) {
    for (const fd of sec.fields || []) {
      if (fd.type !== 'expr' || !['mm', '°'].includes(fd.unit)) continue;
      const v = f[fd.key];
      if (v === undefined || v === null || v === '' || (typeof v !== 'number' && typeof v !== 'string')) continue;
      if (typeof v === 'string' && v === 'through') continue;
      out.push({ key: fd.key, label: fd.label, unit: fd.unit, value: v });
    }
  }
  return out;
}

/** Valor de uma expressão com os parâmetros atuais (só para exibir ao lado dela). */
function evalExpr(expr) {
  const vals = app.state?.parameters || {};
  if (typeof expr === 'number') return expr;
  if (vals[expr] !== undefined) return +vals[expr];
  const js = String(expr).replace(/[A-Za-z_]\w*/g, (id) => (vals[id] !== undefined ? `(${+vals[id]})` : Math[id] !== undefined ? `Math.${id}` : '#'));
  if (js.includes('#') || !/^[\d\s.+\-*/()eMath.a-z,]*$/i.test(js)) return null;
  try { const r = Function(`"use strict";return (${js});`)(); return Number.isFinite(r) ? r : null; } catch { return null; }
}

function build(vp, name) {
  root.innerHTML = '';
  chips = [];
  anchor = null;
  const f = name && (app.state?.features || []).find((x) => x.name === name);
  if (!f || f.suppressed) return;
  const body = bodyOf(name), b = body && vp.bodies.get(body);
  if (!b || !b.group.visible) return;
  const fields = dimFields(f);
  if (!fields.length) return;
  const box = new THREE.Box3().setFromObject(b.mesh);
  anchor = new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z);
  for (const fd of fields) {
    const isExpr = typeof fd.value === 'string';
    const v = isExpr ? evalExpr(fd.value) : fd.value;
    const unit = fd.unit === '°' ? '°' : ' mm';
    const txt = isExpr ? `${fd.value}${v !== null ? ` = ${fmtNum(v, 2)}${unit}` : ''}` : `${fmtNum(v)}${unit}`;
    const el = h('div', { class: `fdim${isExpr ? ' fx' : ''}`, title: `${fd.label} de ${name} — clique para digitar outro valor (aceita parâmetros e expressões)` }, h('i', {}, fd.label), txt);
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => { e.stopPropagation(); edit(vp, f, fd, el); });
    root.append(el);
    chips.push(el);
  }
}

function place(vp) {
  if (!anchor || !chips.length) return;
  const s = vp.toScreen(anchor);
  const vis = !s.behind;
  chips.forEach((el, i) => {
    el.style.display = vis ? '' : 'none';
    el.style.transform = `translate(${s.x}px, ${s.y - 14 - (chips.length - i) * 24}px) translate(-50%, 0)`;
  });
}

function edit(vp, f, fd, chip) {
  editing?.close(false);
  const r = chip.getBoundingClientRect(), vr = vp.el.getBoundingClientRect();
  const inp = h('input', { class: 'dimedit-in', value: typeof fd.value === 'number' ? fmtNum(fd.value, 6) : fd.value, spellcheck: false });
  const boxEl = h('div', { class: 'dimedit' }, inp, h('span', { class: 'dimunit' }, fd.unit));
  boxEl.style.left = `${r.left - vr.left}px`;
  boxEl.style.top = `${r.top - vr.top - 2}px`;
  vp.el.append(boxEl);
  let closed = false;
  const close = async (apply) => {
    if (closed) return;
    closed = true;
    editing = null;
    boxEl.remove();
    const v = apply ? parseDim(inp.value) : null;
    if (v === null || v === fd.value) return;
    try {
      await rpc('update_feature', { name: f.name, patch: { [fd.key]: v } });
      const st = (app.state?.status || []).find((s) => s.name === f.name);
      if (st?.state === 'error') toast(`${f.name}: ${st.error}`, 'warn');
    } catch (e) { toast(e.message, 'err'); }
    key = '';
  };
  editing = { close };
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') close(true); if (e.key === 'Escape') close(false); });
  inp.addEventListener('blur', () => close(true));
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}
