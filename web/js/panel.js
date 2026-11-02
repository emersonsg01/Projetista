// Painel de propriedades flutuante (estilo Inventor): formulário por seções, pré-visualização
// ao vivo dentro de uma transação, seleção de faces/arestas/pontos na tela, OK / Cancelar / Aplicar(+).
import { rpc } from './rpc.js';
import { h, ico, $, toast, setPrompt, draggable } from './ui.js';
import { icon } from './icons.js';
import { app } from './store.js';

let current = null;
export const activePanel = () => current;

const clone = (x) => JSON.parse(JSON.stringify(x ?? null));
const asValue = (s) => { const t = String(s).trim().replace(',', '.'); return t !== '' && !isNaN(+t) ? +t : String(s).trim(); };

export async function openPanel(cmd, opts = {}) {
  if (current) await current.cancel();
  current = new Panel(cmd, opts);
  await current.start();
  return current;
}

class Panel {
  constructor(cmd, opts) {
    this.cmd = cmd;
    this.opts = opts;
    this.featureName = opts.edit || null;
    this.lastFeature = null;
    this.chain = Promise.resolve();
    this.picks = [];
    this.collapsed = new Set(cmd.collapsed || ['Configurações avançadas']);
  }

  async start() {
    const c = this.cmd;
    if (!c.noTransaction) await rpc('tx_begin', { label: c.label });
    if (this.featureName) {
      const f = app.state.features.find((x) => x.name === this.featureName);
      this.spec = c.fromFeature ? c.fromFeature(clone(f), app) : clone(f);
      this.lastFeature = clone(f);
      delete this.lastFeature.name;
    } else this.spec = c.defaults ? c.defaults(app) : {};
    this.render();
    this.armPicking();
    if (!this.featureName && !c.noFeature) this.apply();
    c.onOpen?.(this);
  }

  // ---------------------------------------------------------------- formulário
  render() {
    const c = this.cmd;
    const el = (this.el ||= h('div', { class: 'prop-panel' }));
    el.innerHTML = '';
    const head = h('div', { class: 'pp-head' },
      ico(c.icon),
      h('span', { class: 'pp-title' }, c.label, this.featureName ? h('span', { class: 'pp-sub' }, ` › ${this.featureName}`) : ''),
      c.help ? h('button', { class: 'pp-btn', title: c.help, html: icon('info') }) : '',
      h('button', { class: 'pp-btn', title: 'Cancelar (Esc)', onclick: () => this.cancel(), html: icon('close') }));
    el.append(head);
    draggable(el, head);
    const body = h('div', { class: 'pp-body' });
    for (const sec of c.sections || []) {
      const fields = sec.fields.filter((f) => !f.show || f.show(this.spec, app));
      if (!fields.length) continue;
      const open = !this.collapsed.has(sec.title);
      const title = h('div', { class: `pp-sec ${open ? 'open' : ''}`, onclick: () => { open ? this.collapsed.add(sec.title) : this.collapsed.delete(sec.title); this.render(); } }, h('span', { class: 'chev' }, open ? '▾' : '▸'), sec.title);
      body.append(title);
      if (!open) continue;
      const box = h('div', { class: 'pp-fields' });
      for (const f of fields) box.append(this.field(f));
      body.append(box);
    }
    el.append(body);
    this.statusEl = h('div', { class: 'pp-status' });
    el.append(this.statusEl);
    el.append(h('div', { class: 'pp-foot' },
      c.noFeature ? '' : h('button', { class: 'pp-plus', title: 'Aplicar e iniciar outro', onclick: () => this.ok(true), html: icon('plus') }),
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'primary', onclick: () => this.ok() }, c.okLabel || 'OK'),
      h('button', { onclick: () => this.cancel() }, 'Cancelar')));
    if (!el.parentNode) $('#viewport').append(el);
    this.updateStatus();
  }

  field(f) {
    const v = this.spec[f.key];
    const set = (val, rerender) => { this.spec[f.key] = val; f.onChange?.(this.spec, app); if (rerender || f.rerender) this.render(); this.apply(); };
    const row = (control) => h('label', { class: 'pp-row' }, h('span', { class: 'pp-label', title: f.hint || '' }, f.label), control);
    switch (f.type) {
      case 'expr': case 'number': {
        const inp = h('input', { class: 'pp-input', value: v ?? '', placeholder: f.placeholder || '', title: 'Número ou expressão com parâmetros (ex.: L/2 + 3)' });
        inp.addEventListener('input', () => set(asValue(inp.value)));
        return row(h('div', { class: 'pp-unit' }, inp, f.unit ? h('span', {}, f.unit) : ''));
      }
      case 'text': {
        const inp = h('input', { class: 'pp-input', value: v ?? '', placeholder: f.placeholder || '' });
        inp.addEventListener('change', () => set(inp.value));
        return row(inp);
      }
      case 'textarea': {
        const ta = h('textarea', { class: 'pp-input', rows: f.rows || 3, placeholder: f.placeholder || '' });
        ta.value = v ?? '';
        ta.addEventListener('change', () => set(ta.value));
        return row(ta);
      }
      case 'select': {
        const opts = typeof f.options === 'function' ? f.options(app, this.spec) : f.options;
        const sel = h('select', { class: 'pp-input' }, ...opts.map((o) => h('option', { value: o.value ?? o, selected: (o.value ?? o) === v }, o.label ?? o)));
        sel.addEventListener('change', () => set(sel.value, true));
        return row(sel);
      }
      case 'segmented': {
        const box = h('div', { class: 'pp-seg' });
        for (const o of f.options) {
          const b = h('button', { class: o.value === v ? 'on' : '', title: o.label, onclick: (e) => { e.preventDefault(); set(o.value, true); } }, o.icon ? h('span', { class: 'ico', html: icon(o.icon) }) : '', o.icon && !f.labels ? '' : o.label);
          box.append(b);
        }
        return row(box);
      }
      case 'toggle': {
        const cb = h('input', { type: 'checkbox', checked: !!v });
        cb.addEventListener('change', () => set(cb.checked, true));
        return h('label', { class: 'pp-row pp-check' }, cb, h('span', {}, f.label));
      }
      case 'vec3': {
        const vals = Array.isArray(v) ? v : [0, 0, 0];
        const inputs = [0, 1, 2].map((i) => {
          const inp = h('input', { class: 'pp-input', value: vals[i] ?? 0, title: 'XYZ'[i] });
          inp.addEventListener('input', () => { const nv = [...(this.spec[f.key] || [0, 0, 0])]; nv[i] = asValue(inp.value); set(nv); });
          return inp;
        });
        return row(h('div', { class: 'pp-vec' }, ...inputs.map((inp, i) => h('span', {}, h('i', {}, 'XYZ'[i]), inp))));
      }
      case 'checklist': {
        const opts = typeof f.options === 'function' ? f.options(app, this.spec) : f.options;
        const cur = new Set(v || []);
        const box = h('div', { class: 'pp-checklist' });
        for (const o of opts) {
          const cb = h('input', { type: 'checkbox', checked: cur.has(o) });
          cb.addEventListener('change', () => { const s = new Set(this.spec[f.key] || []); cb.checked ? s.add(o) : s.delete(o); set(opts.filter((x) => s.has(x))); });
          box.append(h('label', {}, cb, o));
        }
        return row(box);
      }
      case 'pick': {
        const items = f.items ? f.items(this.spec, this) : [];
        const box = h('div', { class: `pp-pick ${this.pickField === f.key ? 'active' : ''}`, onclick: () => { this.pickField = f.key; this.armPicking(); this.render(); } },
          h('span', { class: 'pp-arrow' }, '➤'),
          items.length ? h('span', {}, f.summary ? f.summary(items) : `${items.length} selecionado(s)`) : h('span', { class: 'muted' }, f.placeholder || 'Clique na tela para selecionar'),
          items.length ? h('button', { class: 'pp-clear', title: 'Limpar seleção', onclick: (e) => { e.stopPropagation(); f.clear(this.spec, this); this.syncSelection(); this.render(); this.apply(); } }, '×') : '');
        return row(box);
      }
      case 'info': return h('div', { class: 'pp-info' }, typeof f.text === 'function' ? f.text(this.spec, app, this) : f.text);
      case 'button': return h('button', { class: 'pp-wide', onclick: (e) => { e.preventDefault(); f.action(this.spec, this); } }, f.label);
      default: return h('div', {}, `?${f.type}`);
    }
  }

  // ---------------------------------------------------------------- seleção na tela
  armPicking() {
    const c = this.cmd;
    const pickFields = (c.sections || []).flatMap((s) => s.fields).filter((f) => f.type === 'pick');
    if (!this.pickField) this.pickField = pickFields[0]?.key;
    const f = pickFields.find((x) => x.key === this.pickField);
    app.vp.hoverFilter = f ? f.filter : null;
    if (f) app.vp.hoverFilter = { ...f.filter, accept: (hit) => !f.accept || f.accept(hit, this.spec, this) };
    if (f?.showOrigin) app.vp.showOrigin(true);
    setPrompt(f?.prompt || c.prompt || c.label);
    this.syncSelection();
  }
  async handleClick(e) {
    const f = (this.cmd.sections || []).flatMap((s) => s.fields).find((x) => x.key === this.pickField && x.type === 'pick');
    if (!f) return false;
    const hit = app.vp.pick(e, f.filter);
    if (!hit || (f.accept && !f.accept(hit, this.spec, this))) return true;
    await f.onPick(hit, this.spec, this, e);
    if (f.single) {
      // seleção única: avança automaticamente para o próximo campo de seleção vazio
      const next = (this.cmd.sections || []).flatMap((s) => s.fields).find((x) => x.type === 'pick' && x !== f && !(x.items?.(this.spec, this) || []).length);
      if (next) { this.pickField = next.key; this.armPicking(); }
    }
    this.syncSelection();
    this.render();
    this.apply();
    return true;
  }
  syncSelection() {
    const f = (this.cmd.sections || []).flatMap((s) => s.fields).filter((x) => x.type === 'pick');
    app.vp.setSelection(f.flatMap((x) => (x.highlights ? x.highlights(this.spec, this) : [])));
    const pts = [...(this.cmd.markers ? this.cmd.markers(this.spec) : []), ...f.flatMap((x) => (x.markers ? x.markers(this.spec) : []))];
    app.vp.setMarkers(pts);
  }

  // ---------------------------------------------------------------- aplicar ao modelo
  apply() {
    if (this.cmd.noFeature) { this.cmd.live?.(this.spec, app, this); return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.chain = this.chain.then(() => this.push()).catch((e) => this.showError(e.message)); }, 140);
  }
  async push() {
    const c = this.cmd;
    if (!this.featureName) {
      if (c.valid && !c.valid(this.spec, app)) return;
      const feat = c.toFeature(this.spec, app);
      const r = await rpc('add_feature', { feature: feat });
      this.featureName = r.created;
      this.lastFeature = feat;
      this.render();
      return;
    }
    if (c.valid && !c.valid(this.spec, app)) return;
    const feat = c.toFeature(this.spec, app);
    const patch = {};
    for (const [k, v] of Object.entries(feat)) if (k !== 'type' && JSON.stringify(v) !== JSON.stringify(this.lastFeature?.[k])) patch[k] = v;
    for (const k of Object.keys(this.lastFeature || {})) if (!(k in feat) && k !== 'type' && k !== 'name') patch[k] = null;
    if (!Object.keys(patch).length) return;
    await rpc('update_feature', { name: this.featureName, patch });
    this.lastFeature = feat;
  }
  updateStatus() {
    if (!this.statusEl) return;
    const st = this.featureName && app.state?.status.find((s) => s.name === this.featureName);
    this.statusEl.className = 'pp-status';
    this.statusEl.textContent = '';
    if (st?.state === 'error') { this.statusEl.classList.add('err'); this.statusEl.textContent = `⚠ ${st.error}`; }
    else if (st?.warnings?.length) { this.statusEl.classList.add('warn'); this.statusEl.textContent = st.warnings.join(' · '); }
    else if (!this.featureName && !this.cmd.noFeature) this.statusEl.textContent = this.cmd.prompt || 'Complete a entrada para visualizar.';
  }
  showError(msg) { if (this.statusEl) { this.statusEl.className = 'pp-status err'; this.statusEl.textContent = `⚠ ${msg}`; } }

  async ok(again = false) {
    clearTimeout(this.timer);
    await this.chain;
    if (!this.cmd.noFeature) await this.push().catch((e) => this.showError(e.message));
    const st = this.featureName && app.state?.status.find((s) => s.name === this.featureName);
    if (!this.cmd.noFeature && !this.featureName) { toast('Entrada incompleta — selecione a geometria necessária.', 'warn'); return; }
    if (st?.state === 'error' && !confirm(`A feature tem erro:\n${st.error}\n\nManter mesmo assim?`)) return;
    await this.cmd.onOk?.(this.spec, app, this);
    if (!this.cmd.noTransaction) await rpc('tx_commit', { label: `${this.cmd.label}${this.featureName ? ` ${this.featureName}` : ''}` });
    this.close();
    if (again) openPanel(this.cmd);
  }
  async cancel() {
    clearTimeout(this.timer);
    await this.chain.catch(() => {});
    await this.cmd.onCancel?.(this.spec, app, this);
    if (!this.cmd.noTransaction) await rpc('tx_cancel').catch(() => {});
    this.close();
  }
  close() {
    this.el?.remove();
    app.vp.hoverFilter = null;
    app.vp.hover = null;
    app.vp.setSelection([]);
    app.vp.setMarkers([]);
    if (!app.originPinned) app.vp.showOrigin(false);
    setPrompt('');
    this.cmd.onClose?.(this.spec, app, this);
    if (current === this) current = null;
  }
}
