// Documento paramétrico: parâmetros, linha do tempo de features, regeneração,
// desfazer/refazer, versões nomeadas e configurações (tabelas de projeto).
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Arena } from './kernel.js';
import { withArena } from '../occ/occ.js';
import { evaluate, ParameterTable, references } from './expr.js';
import { FEATURES, FEATURE_PREFIX } from './features.js';
import { paletteColor, DEFAULT_MATERIAL } from './materials.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const hash = (s) => createHash('sha1').update(s).digest('hex');

export class Document extends EventEmitter {
  constructor(data = {}) {
    super();
    this.load(data, { silent: true });
    this.undoStack = [];
    this.redoStack = [];
  }

  load(data, { silent } = {}) {
    this.name = data.name || 'Sem título';
    this.parameters = data.parameters || {};
    this.features = data.features || [];
    this.rollback = data.rollback ?? null; // índice do marcador da linha do tempo
    this.resolution = data.resolution || 64;
    this.defaultMaterial = data.defaultMaterial || DEFAULT_MATERIAL;
    this.versions = data.versions || [];
    this.configurations = data.configurations || {};
    this.activeConfiguration = data.activeConfiguration || null;
    this.notes = data.notes || '';
    if (!silent) this.regenerate();
  }

  toJSON() {
    return {
      format: 'projetista/1', name: this.name, parameters: this.parameters, features: this.features, rollback: this.rollback,
      resolution: this.resolution, defaultMaterial: this.defaultMaterial, versions: this.versions,
      configurations: this.configurations, activeConfiguration: this.activeConfiguration, notes: this.notes,
    };
  }

  snapshot() { return clone({ ...this.toJSON(), versions: undefined }); }

  /** Executa uma mutação com suporte a desfazer e regeneração. */
  mutate(label, fn, source = 'api') {
    const before = this.snapshot();
    try {
      const out = fn();
      this.undoStack.push({ label, state: before });
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
      const result = this.regenerate();
      this.emit('activity', { label, source, time: Date.now() });
      return { out, result };
    } catch (e) {
      this.restore(before);
      throw e;
    }
  }

  restore(state) {
    const versions = this.versions;
    this.load({ ...state, versions }, { silent: true });
  }

  // ---------------------------------------------------------------- transações
  // Um comando interativo (painel de propriedades, esboço) faz várias mutações de
  // pré-visualização; ao confirmar, elas viram UMA entrada no histórico; ao cancelar,
  // o documento volta exatamente ao estado anterior.
  beginTransaction(label) {
    if (this.tx) this.commitTransaction();
    this.tx = { label, mark: this.undoStack.length, state: this.snapshot() };
    return true;
  }

  commitTransaction(label) {
    const tx = this.tx;
    this.tx = null;
    if (!tx) return false;
    if (this.undoStack.length > tx.mark) {
      this.undoStack.splice(tx.mark);
      this.undoStack.push({ label: label || tx.label, state: tx.state });
      this.redoStack = [];
    }
    this.emit('activity', { label: label || tx.label, source: 'ui', time: Date.now() });
    this.emit('change');
    return true;
  }

  cancelTransaction() {
    const tx = this.tx;
    this.tx = null;
    if (!tx) return false;
    this.undoStack.splice(tx.mark);
    this.restore(tx.state);
    this.regenerate();
    return true;
  }

  undo() {
    const u = this.undoStack.pop();
    if (!u) throw new Error('Nada para desfazer');
    this.redoStack.push({ label: u.label, state: this.snapshot() });
    this.restore(u.state);
    this.regenerate();
    this.emit('activity', { label: `Desfazer: ${u.label}`, source: 'api', time: Date.now() });
    return u.label;
  }

  redo() {
    const r = this.redoStack.pop();
    if (!r) throw new Error('Nada para refazer');
    this.undoStack.push({ label: r.label, state: this.snapshot() });
    this.restore(r.state);
    this.regenerate();
    this.emit('activity', { label: `Refazer: ${r.label}`, source: 'api', time: Date.now() });
    return r.label;
  }

  // ---------------------------------------------------------------- parâmetros
  paramTable() {
    const defs = { ...this.parameters };
    const cfg = this.activeConfiguration && this.configurations[this.activeConfiguration];
    if (cfg) for (const [k, v] of Object.entries(cfg)) defs[k] = { ...(defs[k] || {}), expr: v };
    return new ParameterTable(defs);
  }

  setParameter(name, expr, comment) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Nome de parâmetro inválido: ${name}`);
    // valida antes de aceitar
    const t = new ParameterTable({ ...this.parameters, [name]: { expr } });
    t.resolver()(name);
    this.parameters[name] = { expr: typeof expr === 'number' ? expr : String(expr), ...(comment ? { comment } : this.parameters[name]?.comment ? { comment: this.parameters[name].comment } : {}) };
  }

  // ---------------------------------------------------------------- features
  uniqueFeatureName(type) {
    const prefix = FEATURE_PREFIX[type] || type;
    let i = 1;
    while (this.features.some((f) => f.name === `${prefix}${i}`)) i++;
    return `${prefix}${i}`;
  }

  addFeature(spec, index) {
    if (!FEATURES[spec.type]) throw new Error(`Tipo de feature desconhecido: ${spec.type}. Tipos: ${Object.keys(FEATURES).join(', ')}`);
    const f = clone(spec);
    f.name = f.name || this.uniqueFeatureName(f.type);
    if (this.features.some((x) => x.name === f.name)) throw new Error(`Já existe uma feature chamada '${f.name}'`);
    if (index === undefined || index === null) {
      const at = this.rollback === null ? this.features.length : this.rollback;
      this.features.splice(at, 0, f);
      if (this.rollback !== null) this.rollback++;
    } else this.features.splice(index, 0, f);
    return f.name;
  }

  findFeature(name) {
    const i = this.features.findIndex((f) => f.name === name);
    if (i < 0) throw new Error(`Feature '${name}' não encontrada`);
    return i;
  }

  updateFeature(name, patch) {
    const i = this.findFeature(name);
    const f = this.features[i];
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'name' || k === 'type') continue;
      if (v === null) delete f[k]; else f[k] = clone(v);
    }
  }

  deleteFeature(name) { this.features.splice(this.findFeature(name), 1); }

  /** Renomeia uma feature e atualiza as referências (esboços usados por extrusões, lofts…). */
  renameFeature(name, to) {
    if (!/^[\p{L}_][\p{L}\p{N}_ -]*$/u.test(to)) throw new Error(`Nome inválido: ${to}`);
    if (this.features.some((f) => f.name === to)) throw new Error(`Já existe uma feature chamada '${to}'`);
    this.features[this.findFeature(name)].name = to;
    for (const f of this.features) {
      for (const k of ['sketch', 'profile']) if (f[k] === name) f[k] = to;
      if (Array.isArray(f.sections)) f.sections = f.sections.map((x) => (x === name ? to : x));
    }
  }

  moveFeature(name, toIndex) {
    const i = this.findFeature(name);
    const [f] = this.features.splice(i, 1);
    this.features.splice(Math.max(0, Math.min(toIndex, this.features.length)), 0, f);
  }

  // ---------------------------------------------------------------- regeneração
  regenerate() {
    const t0 = performance.now();
    const table = this.paramTable();
    const resolve = table.resolver();
    const ev = (v) => evaluate(v, resolve);
    const cloneMap = (m) => new Map([...m].map(([k, v]) => [k, { ...v }]));
    // Regeneração incremental: o estado após a feature i é reaproveitado enquanto a
    // cadeia (parâmetros + definições das features 0..i) não muda.
    const cache = (this.cache ||= []);
    let key = hash(JSON.stringify([table.values(), this.resolution, this.defaultMaterial]));
    let st = { bodies: new Map(), sketches: new Map(), colorIdx: 0, autoIdx: 0 };
    const ctx = {
      A: null, doc: this, ev,
      num: (v) => { if (v === undefined) throw new Error('Valor obrigatório ausente'); return ev(v); },
      vec: (v) => v.map((x) => ev(x)),
      seg: this.resolution,
      nextColor: () => paletteColor(st.colorIdx++),
      autoName: (p) => { let n; do n = `${p}${++st.autoIdx}`; while (ctx.bodies.has(n)); return n; },
      warnings: [],
      warn: (m) => ctx.warnings.push(m),
    };
    const status = [];
    const end = this.rollback === null ? this.features.length : this.rollback;
    let reused = 0;
    for (let i = 0; i < this.features.length; i++) {
      const f = this.features[i];
      if (i >= end) { status.push({ name: f.name, type: f.type, state: 'rolled-back' }); continue; }
      key = hash(key + JSON.stringify(f));
      const c = cache[i];
      if (c && c.key === key) {
        st = { ...c.state, bodies: c.state.bodies, sketches: c.state.sketches };
        status.push(c.status);
        reused++;
        continue;
      }
      // invalida este passo e os seguintes
      for (let j = i; j < cache.length; j++) cache[j]?.arena?.dispose();
      cache.length = i;
      const arena = new Arena();
      ctx.A = arena;
      ctx.bodies = cloneMap(st.bodies);
      ctx.sketches = new Map(st.sketches);
      st = { ...st, bodies: ctx.bodies, sketches: ctx.sketches };
      let s;
      if (f.suppressed) s = { name: f.name, type: f.type, state: 'suppressed' };
      else {
        const w0 = ctx.warnings.length;
        const ft = performance.now();
        try {
          const out = withArena(arena, () => FEATURES[f.type].apply(f, ctx));
          s = { name: f.name, type: f.type, state: 'ok', output: out, ms: +(performance.now() - ft).toFixed(1), warnings: ctx.warnings.slice(w0) };
        } catch (e) {
          const msg = e?.message || (typeof e === 'object' ? `falha interna do kernel (${e?.constructor?.name || 'exceção'})` : String(e));
          s = { name: f.name, type: f.type, state: 'error', error: msg, warnings: ctx.warnings.slice(w0) };
        }
      }
      status.push(s);
      cache[i] = { key, arena, status: s, state: { ...st, bodies: cloneMap(ctx.bodies), sketches: new Map(ctx.sketches) } };
    }
    for (let j = this.features.length; j < cache.length; j++) cache[j]?.arena?.dispose();
    if (cache.length > this.features.length) cache.length = this.features.length;
    this.bodies = cloneMap(st.bodies);
    this.sketches = st.sketches;
    this.status = status;
    this.reusedFeatures = reused;
    this.lastRegenMs = +(performance.now() - t0).toFixed(1);
    this.version = (this.version || 0) + 1;
    this.emit('change');
    return this.summary();
  }

  summary() {
    const errors = this.status.filter((s) => s.state === 'error');
    return {
      bodies: [...this.bodies.entries()].map(([name, b]) => {
        const bb = b.m.boundingBox();
        return { name, material: b.material, color: b.color, volume_mm3: +b.m.volume().toFixed(3), triangles: b.m.numTri(), bbox: { min: bb.min.map((x) => +x.toFixed(3)), max: bb.max.map((x) => +x.toFixed(3)) } };
      }),
      features: this.status.length,
      errors: errors.map((e) => `${e.name}: ${e.error}`),
      warnings: this.status.flatMap((s) => (s.warnings || []).map((w) => `${s.name}: ${w}`)),
      regenMs: this.lastRegenMs,
      reusedFeatures: this.reusedFeatures,
    };
  }

  /** Grafo de dependências parâmetro -> features (para "o que muda se eu alterar X?"). */
  dependencies() {
    const deps = {};
    const walk = (v, out) => {
      if (typeof v === 'string') references(v).forEach((r) => out.add(r));
      else if (Array.isArray(v)) v.forEach((x) => walk(x, out));
      else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, out));
    };
    for (const f of this.features) {
      const s = new Set();
      walk(f, s);
      for (const p of s) if (this.parameters[p]) (deps[p] ||= []).push(f.name);
    }
    for (const [p, d] of Object.entries(this.parameters)) {
      references(String(d.expr)).forEach((r) => { if (this.parameters[r]) (deps[r] ||= []).push(`param:${p}`); });
    }
    return deps;
  }

  // ---------------------------------------------------------------- persistência
  saveVersion(label) {
    this.versions.push({ id: this.versions.length + 1, label: label || `Versão ${this.versions.length + 1}`, time: new Date().toISOString(), state: this.snapshot() });
    return this.versions.at(-1).id;
  }

  restoreVersion(id) {
    const v = this.versions.find((x) => x.id === id);
    if (!v) throw new Error(`Versão ${id} não encontrada`);
    this.mutate(`Restaurar versão ${id}`, () => this.restore(v.state));
  }

  saveFile(file) { fs.writeFileSync(file, JSON.stringify(this.toJSON(), null, 2)); return file; }

  openFile(file) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.mutate(`Abrir ${file}`, () => this.load(data, { silent: true }));
  }
}
