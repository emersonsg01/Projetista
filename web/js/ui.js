// Utilidades de interface: construção de elementos, avisos, barra de status,
// menus de contexto e janelas de diálogo flutuantes (arrastáveis).
import { icon } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
export const ico = (name, cls = 'ico') => h('span', { class: cls, html: icon(name) });

// ---------------------------------------------------------------- avisos e status
export function toast(text, kind = '') {
  const box = $('#toasts');
  const t = h('div', { class: `toast ${kind}` }, kind === 'claude' ? '✦ Claude: ' : '', text);
  box.prepend(t);
  setTimeout(() => t.remove(), 6500);
  while (box.children.length > 5) box.lastChild.remove();
}
let basePrompt = 'Pronto';
export function setPrompt(text) { $('#prompt').textContent = text || basePrompt; }
export function setStatusRight(html) { $('#statusRight').innerHTML = html; }

// ---------------------------------------------------------------- menu de contexto
let ctxEl = null;
export function closeContextMenu() { ctxEl?.remove(); ctxEl = null; }
export function contextMenu(x, y, items) {
  closeContextMenu();
  ctxEl = h('div', { class: 'ctxmenu' });
  for (const it of items) {
    if (it === '-' || it.sep) { ctxEl.append(h('div', { class: 'sep' })); continue; }
    const row = h('div', { class: `item ${it.disabled ? 'disabled' : ''}` }, it.icon ? ico(it.icon) : h('span', { class: 'ico' }), h('span', {}, it.label), it.hint ? h('span', { class: 'hint' }, it.hint) : '');
    if (!it.disabled) row.addEventListener('click', () => { closeContextMenu(); it.action(); });
    ctxEl.append(row);
  }
  document.body.append(ctxEl);
  const r = ctxEl.getBoundingClientRect();
  ctxEl.style.left = `${Math.min(x, innerWidth - r.width - 4)}px`;
  ctxEl.style.top = `${Math.min(y, innerHeight - r.height - 4)}px`;
}
addEventListener('pointerdown', (e) => { if (ctxEl && !ctxEl.contains(e.target)) closeContextMenu(); }, true);

// ---------------------------------------------------------------- diálogos
const dialogs = new Map();
let zTop = 50;
export function dialog({ id, title, iconName, width = 520, height, body, buttons = [], onClose, modal = false, x, y }) {
  if (id && dialogs.has(id)) { const d = dialogs.get(id); d.el.style.zIndex = ++zTop; return d; }
  const close = () => { dialogs.delete(id); el.remove(); veil?.remove(); onClose?.(); };
  const veil = modal ? h('div', { class: 'veil' }) : null;
  const head = h('div', { class: 'dlg-head' }, iconName ? ico(iconName) : '', h('span', { class: 'dlg-title' }, title), h('button', { class: 'dlg-x', title: 'Fechar', onclick: close, html: icon('close') }));
  const content = h('div', { class: 'dlg-body' });
  const foot = h('div', { class: 'dlg-foot' }, ...buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', onclick: () => b.action({ close, body: content }) }, b.label)));
  const el = h('div', { class: 'dialog', style: { width: `${width}px`, ...(height ? { height: `${height}px` } : {}), zIndex: ++zTop } }, head, content, buttons.length ? foot : '');
  if (veil) document.body.append(veil);
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = `${x ?? Math.max(10, (innerWidth - r.width) / 2)}px`;
  el.style.top = `${y ?? Math.max(60, (innerHeight - r.height) / 3)}px`;
  draggable(el, head);
  el.addEventListener('pointerdown', () => { el.style.zIndex = ++zTop; });
  const d = { el, body: content, close, setTitle: (t) => { head.querySelector('.dlg-title').textContent = t; } };
  if (id) dialogs.set(id, d);
  if (typeof body === 'function') body(content, d); else if (body) content.append(body);
  return d;
}
export function draggable(el, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button,input,select')) return;
    const r = el.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => { el.style.left = `${Math.max(0, Math.min(innerWidth - 60, ev.clientX - ox))}px`; el.style.top = `${Math.max(0, Math.min(innerHeight - 30, ev.clientY - oy))}px`; };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
}

/** Caixa de entrada simples; resolve com o texto ou null. */
export function ask({ title, label, value = '', placeholder = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const inp = h('input', { value, placeholder, style: { width: '100%' } });
    const d = dialog({
      title, width: 360, modal: true,
      body: h('label', { class: 'field' }, h('span', {}, label), inp),
      buttons: [
        { label: 'Cancelar', action: ({ close }) => { done = true; close(); resolve(null); } },
        { label: 'OK', primary: true, action: ({ close }) => { done = true; close(); resolve(inp.value); } },
      ],
      onClose: () => { if (!done) resolve(null); },
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; d.close(); resolve(inp.value); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 20);
  });
}

export const fmt = (x, d = 3) => (typeof x === 'number' ? (+x.toFixed(d)).toLocaleString('pt-BR', { maximumFractionDigits: d }) : x);
export const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
