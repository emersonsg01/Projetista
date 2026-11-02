// "Studio": o serviço central. Um único documento compartilhado entre a interface web
// (WebSocket) e o Claude (MCP). Toda ação passa por aqui, então o que o Claude faz
// aparece ao vivo na tela, e o que você faz na tela o Claude enxerga.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { applyMat } from './core/kernel.js';
import { initOCC, writeSTEP, OC } from './occ/occ.js';
import { KernelPool } from './parallel/pool.js';
import { resources } from './parallel/resources.js';
import { summarizeFaces, summarizeEdges } from './occ/select.js';
import { Document } from './core/document.js';
import { FEATURES, ISO_THREADS } from './core/features.js';
import { MATERIALS } from './core/materials.js';
import { massProperties, interference, clearance, section, printCheck, faceInfo, measureFaces } from './core/analysis.js';
import { toSTL, toOBJ, to3MF, toGLB, setExportQuality } from './core/io.js';
import { renderView, renderSheet } from './render/raster.js';
import { technicalDrawing } from './render/drawing.js';
const CLI = fileURLToPath(new URL('./cli.js', import.meta.url));

export const WORKSPACE = path.resolve(process.env.PROJETISTA_HOME || fileURLToPath(new URL('../workspace', import.meta.url)));

export class Studio {
  static async create() {
    await initOCC({ threads: process.env.PROJETISTA_THREADS !== '0' });
    const s = new Studio();
    fs.mkdirSync(WORKSPACE, { recursive: true });
    const auto = path.join(WORKSPACE, 'autosave.projetista.json');
    if (fs.existsSync(auto)) {
      try { s.doc.load(JSON.parse(fs.readFileSync(auto, 'utf8'))); } catch { s.doc.regenerate(); }
    } else s.doc.regenerate();
    s.doc.on('change', () => { clearTimeout(s._t); s._t = setTimeout(() => { try { s.doc.saveFile(auto); } catch { /* ignora */ } }, 400); });
    return s;
  }

  constructor() {
    this.doc = new Document();
    this.pool = new KernelPool();
    this.activity = [];
    this.doc.on('activity', (a) => { this.activity.push(a); if (this.activity.length > 100) this.activity.shift(); });
  }

  bodyList(names) {
    const all = [...this.doc.bodies.entries()].map(([name, b]) => ({ name, ...b }));
    return names && names.length ? all.filter((b) => names.includes(b.name)) : all;
  }

  sketchPolylines() {
    // como no Inventor, esboços já consumidos por um recurso ficam ocultos
    const consumed = new Set(this.doc.features.flatMap((f) => [f.sketch, f.profile, ...(f.sections || [])].filter(Boolean)));
    const lines = [];
    for (const [name, s] of this.doc.sketches) {
      if (consumed.has(name)) continue;
      for (const loop of [...s.solved.loops.map((l) => [...l, l[0]]), ...s.solved.openChains]) {
        lines.push(loop.map(([x, y]) => applyMat(s.matrix, [x, y, 0])));
      }
    }
    return lines;
  }

  /** Mesmo conjunto de comandos usado pelo MCP e pela interface web. */
  async run(cmd, args = {}, source = 'api') {
    const d = this.doc;
    const C = {
      state: () => ({
        name: d.name, parameters: d.paramTable().values(), parameterDefs: d.parameters, features: d.features, status: d.status,
        rollback: d.rollback, summary: d.summary(), configurations: d.configurations, activeConfiguration: d.activeConfiguration,
        versions: d.versions.map(({ id, label, time }) => ({ id, label, time })), canUndo: d.undoStack.length > 0, canRedo: d.redoStack.length > 0,
        undoLabel: d.undoStack.at(-1)?.label || null, redoLabel: d.redoStack.at(-1)?.label || null,
        tx: d.tx ? d.tx.label : null, sketches: [...d.sketches.keys()], defaultMaterial: d.defaultMaterial, materials: Object.keys(MATERIALS),
      }),
      rename_feature: ({ name, to }) => d.mutate(`Renomear ${name} → ${to}`, () => d.renameFeature(name, to), source),
      rebuild: () => { for (const c of d.cache || []) c?.arena?.dispose(); d.cache = []; return d.regenerate(); },
      set_display_quality: ({ quality }) => { this.displayQuality = ['draft', 'normal', 'fine'].includes(quality) ? quality : 'normal'; d.emit('change'); return this.displayQuality; },
      tx_begin: ({ label }) => d.beginTransaction(label || 'Comando'),
      tx_commit: ({ label }) => d.commitTransaction(label),
      tx_cancel: () => d.cancelTransaction(),
      load_document: ({ data }) => d.mutate(`Abrir ${data?.name || 'documento'}`, () => d.load(data, { silent: true }), source),
      explode_sketch: ({ name }) => {
        // converte atalhos (shapes) em geometria explícita editável, mantendo as cotas paramétricas
        const f = d.features[d.findFeature(name)];
        const s = d.sketches.get(name);
        if (!s) throw new Error(`Esboço '${name}' não foi avaliado`);
        if (!f.shapes?.length) return { exploded: false };
        const { points, entities, constraints, radii } = s.solved;
        const patch = {
          shapes: null,
          points: Object.fromEntries(Object.entries(points).map(([k, p]) => [k, p.map((x) => +x.toFixed(9))])),
          entities: entities.map((e) => (e.type === 'circle' ? { ...e, r: radii[e.id] ?? e.r } : e)),
          constraints,
        };
        return d.mutate(`Editar esboço ${name}`, () => d.updateFeature(name, patch), source);
      },
      add_feature: ({ feature, index }) => d.mutate(`Adicionar ${feature.type}`, () => d.addFeature(feature, index), source),
      add_features: ({ features }) => d.mutate(`Adicionar ${features.length} features`, () => features.map((f) => d.addFeature(f)), source),
      update_feature: ({ name, patch }) => d.mutate(`Editar ${name}`, () => d.updateFeature(name, patch), source),
      delete_feature: ({ name }) => d.mutate(`Excluir ${name}`, () => d.deleteFeature(name), source),
      suppress_feature: ({ name, suppressed = true }) => d.mutate(`${suppressed ? 'Suprimir' : 'Reativar'} ${name}`, () => d.updateFeature(name, { suppressed: suppressed || null }), source),
      move_feature: ({ name, index }) => d.mutate(`Reordenar ${name}`, () => d.moveFeature(name, index), source),
      set_rollback: ({ index }) => d.mutate('Mover marcador da linha do tempo', () => { d.rollback = index === null || index === undefined || index >= d.features.length ? null : index; }, source),
      set_parameter: ({ name, expr, comment }) => d.mutate(`Parâmetro ${name} = ${expr}`, () => d.setParameter(name, expr, comment), source),
      set_parameters: ({ parameters }) => d.mutate('Parâmetros', () => Object.entries(parameters).forEach(([k, v]) => d.setParameter(k, v)), source),
      delete_parameter: ({ name }) => d.mutate(`Excluir parâmetro ${name}`, () => { delete d.parameters[name]; }, source),
      undo: () => d.undo(),
      redo: () => d.redo(),
      new_document: ({ name }) => d.mutate('Novo documento', () => d.load({ name: name || 'Sem título' }, { silent: true }), source),
      rename_document: ({ name }) => d.mutate('Renomear documento', () => { d.name = name; }, source),
      set_resolution: ({ segments }) => d.mutate('Resolução', () => { d.resolution = Math.max(8, Math.min(256, segments | 0)); }, source),
      set_default_material: ({ material }) => d.mutate('Material padrão', () => { if (!MATERIALS[material]) throw new Error('Material desconhecido'); d.defaultMaterial = material; }, source),
      save: ({ file }) => ({ file: d.saveFile(resolveFile(file || `${slug(d.name)}.projetista.json`)) }),
      open: ({ file }) => d.openFile(resolveFile(file)),
      list_files: () => fs.readdirSync(WORKSPACE).filter((f) => !fs.statSync(path.join(WORKSPACE, f)).isDirectory()).map((f) => { const st = fs.statSync(path.join(WORKSPACE, f)); return { file: f, path: path.join(WORKSPACE, f), bytes: st.size, modified: st.mtime.toISOString() }; }).sort((a, b) => b.modified.localeCompare(a.modified)),
      save_version: ({ label }) => ({ id: d.saveVersion(label) }),
      restore_version: ({ id }) => d.restoreVersion(id),
      set_configuration: ({ name, values }) => d.mutate(`Configuração ${name}`, () => { d.configurations[name] = values; }, source),
      activate_configuration: ({ name }) => d.mutate(`Ativar configuração ${name ?? 'padrão'}`, () => { if (name && !d.configurations[name]) throw new Error('Configuração inexistente'); d.activeConfiguration = name || null; }, source),
      dependencies: () => d.dependencies(),

      // ---------- inspeção e análise
      list_faces: ({ body }) => summarizeFaces(this.need(body).m),
      list_edges: ({ body }) => summarizeEdges(this.need(body).m),
      face_info: ({ body, face }) => faceInfo(this.need(body), face),
      measure: ({ a, b }) => measureFaces(this.need(a.body), a.face, this.need(b.body), b.face),
      mass_properties: ({ body }) => (body ? massProperties({ name: body, ...this.need(body) }) : Object.fromEntries(this.bodyList().map((b) => [b.name, massProperties(b)]))),
      interference: () => interference(d.bodies),
      clearance: ({ a, b }) => clearance(this.need(a), this.need(b)),
      section: ({ body, normal, offset }) => section(this.need(body), normal || [0, 0, 1], offset || 0),
      print_check: ({ body, ...o }) => printCheck({ name: body, ...this.need(body) }, o),
      bom: () => {
        const rows = this.bodyList().map((b) => { const m = massProperties(b); return { item: b.name, material: b.material, qty: 1, mass_g: m.mass_g, size_mm: m.boundingBox.size, cost_BRL: m.costEstimate_BRL }; });
        return { rows, totalMass_g: +rows.reduce((s, r) => s + r.mass_g, 0).toFixed(2), totalCost_BRL: +rows.reduce((s, r) => s + (r.cost_BRL || 0), 0).toFixed(2) };
      },
      sketch_info: ({ name }) => {
        const s = d.sketches.get(name);
        if (!s) throw new Error(`Esboço '${name}' não existe`);
        const { status, dof, redundant, residual, points, radii, entities, constraints, loops, openChains } = s.solved;
        const def = d.features.find((f) => f.name === name);
        return {
          status, dof, redundant, residual, points, radii, entities, constraints, profiles: loops.length, openChains: openChains.length,
          plane: s.frame, matrix: s.matrix, explicit: !def?.shapes?.length, loops: loops.map((l) => l.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)])),
        };
      },
      parameter_study: async ({ parameter, values, checkInterference }) => {
        // cada valor é regenerado num worker diferente, em paralelo
        if (!d.parameters[parameter]) throw new Error(`Parâmetro '${parameter}' não existe`);
        const t0 = performance.now();
        const doc = d.toJSON();
        const rows = await Promise.all(values.map((v) => this.pool.run({ kind: 'variant', doc, overrides: { [parameter]: v }, checkInterference })));
        return { parameter, rows: rows.map(({ overrides, ...r }) => ({ value: overrides[parameter], ...r })), wallMs: +(performance.now() - t0).toFixed(0), workers: this.pool.stats().workers };
      },
      optimize: async ({ variables, objective = 'mass', minimize = true, constraints = [], maxEvaluations = 64, refine = true }) => {
        // busca em grade/aleatória paralela + refinamento local em torno do melhor
        const names = Object.keys(variables);
        for (const n of names) if (!d.parameters[n]) throw new Error(`Parâmetro '${n}' não existe`);
        const doc = d.toJSON();
        const t0 = performance.now();
        const evalSet = async (cands) => Promise.all(cands.map((o) => this.pool.run({ kind: 'variant', doc, overrides: o, objective, constraints })));
        const sample = (ranges, n) => {
          const per = Math.max(2, Math.floor(Math.pow(n, 1 / names.length)));
          let combos = [{}];
          for (const k of names) {
            const { min, max } = ranges[k];
            const steps = variables[k].steps || per;
            const vals = Array.from({ length: steps }, (_, i) => +(min + ((max - min) * i) / (steps - 1)).toFixed(6));
            combos = combos.flatMap((c) => vals.map((v) => ({ ...c, [k]: v })));
          }
          if (combos.length > n) { for (let i = combos.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [combos[i], combos[j]] = [combos[j], combos[i]]; } combos = combos.slice(0, n); }
          return combos;
        };
        const rank = (rs) => rs.filter((r) => r.ok && r.feasible !== false).sort((a, b) => (minimize ? a.objective - b.objective : b.objective - a.objective));
        const ranges = Object.fromEntries(names.map((k) => [k, { min: variables[k].min, max: variables[k].max }]));
        let all = await evalSet(sample(ranges, Math.ceil(maxEvaluations * (refine ? 0.6 : 1))));
        let best = rank(all)[0];
        if (refine && best) {
          const local = Object.fromEntries(names.map((k) => { const span = (ranges[k].max - ranges[k].min) / 4; const c = best.overrides[k]; return [k, { min: Math.max(ranges[k].min, c - span / 2), max: Math.min(ranges[k].max, c + span / 2) }]; }));
          all = all.concat(await evalSet(sample(local, Math.floor(maxEvaluations * 0.4))));
          best = rank(all)[0];
        }
        const ranked = rank(all);
        return {
          best: best ? { parameters: best.overrides, objective: best.objective, mass_g: best.mass_g, volume_mm3: best.volume_mm3 } : null,
          top5: ranked.slice(0, 5).map((r) => ({ parameters: r.overrides, objective: r.objective })),
          evaluated: all.length, feasible: ranked.length, wallMs: +(performance.now() - t0).toFixed(0), workers: this.pool.stats().workers,
          note: best ? 'Use set_parameters com os valores de best.parameters para aplicar.' : 'Nenhuma combinação viável — relaxe as restrições.',
        };
      },
      resources: () => resources(this.pool, { threads: OC().__threads, wasmBytes: OC().wasmMemory?.buffer?.byteLength || OC().HEAP8?.buffer?.byteLength || 0 }),

      // ---------- visualização e exportação
      render: async ({ view, width, height, bodies, section: sec, highlight, sheet, showSketches, engine }) => {
        if (this.gpuRender && engine !== 'software') {
          try {
            const r = await this.gpuRender({ view, width, height, bodies, section: sec, highlight, sheet, showSketches });
            return { png: Buffer.from(r.image, 'base64'), width: r.width, height: r.height, views: r.views, engine: `GPU (${r.gpu || 'WebGL'})` };
          } catch { /* cai para o renderizador por software */ }
        }
        const bl = this.bodyList(bodies);
        const o = { view, width, height, section: sec, highlight, sketchLines: showSketches ? this.sketchPolylines() : [] };
        return { ...(sheet ? renderSheet(bl, o) : renderView(bl, o)), engine: 'software (CPU)' };
      },
      drawing: ({ bodies, projection, hiddenLines, file, title, sheet }) => {
        const svg = technicalDrawing(d, { bodies, projection, hiddenLines, title, sheet });
        const f = resolveFile(file || `${slug(d.name)}-desenho.svg`);
        fs.writeFileSync(f, svg);
        return { file: f, bytes: svg.length };
      },
      export: ({ format, bodies, file, quality }) => {
        const fmt = (format || 'step').toLowerCase().replace('stp', 'step');
        const bl = this.bodyList(bodies);
        if (!bl.length) throw new Error('Nenhum corpo para exportar');
        setExportQuality(quality || 'fine');
        const data = { step: (b) => writeSTEP(b.map((x) => x.m.shape), b.map((x) => x.name)), stl: toSTL, obj: toOBJ, '3mf': to3MF, glb: toGLB }[fmt];
        if (!data) throw new Error(`Formato não suportado: ${fmt} (step, stl, obj, 3mf, glb; svg via drawing)`);
        const f = resolveFile(file || `${slug(d.name)}.${fmt}`);
        const buf = data(bl);
        fs.writeFileSync(f, buf);
        return { file: f, bytes: buf.length, bodies: bl.map((b) => b.name) };
      },
      catalog: () => ({
        features: Object.fromEntries(Object.entries(FEATURES).map(([k, v]) => [k, v.label])),
        materials: Object.fromEntries(Object.entries(MATERIALS).map(([k, v]) => [k, `${v.density} g/cm³ · ${v.kind}`])),
        isoThreads: Object.keys(ISO_THREADS),
      }),
      run_script: ({ code, timeoutMs }) => this.runScript(code, timeoutMs, source),
      info: () => ({ cli: CLI, workspace: WORKSPACE, exe: process.env.PROJETISTA_EXE || null }),
    };
    const fn = C[cmd];
    if (!fn) throw new Error(`Comando desconhecido: ${cmd}`);
    const r = await fn(args);
    if (r && typeof r === 'object' && 'result' in r && 'out' in r) return r.out === undefined ? r.result : { ...r.result, created: r.out };
    return r;
  }

  need(name) {
    const b = this.doc.bodies.get(name);
    if (!b) throw new Error(`Corpo '${name}' não existe (corpos: ${[...this.doc.bodies.keys()].join(', ') || 'nenhum'})`);
    return b;
  }

  /**
   * Modelagem por código (como macros do FreeCAD / scripts do Fusion): o script recebe
   * a API `cad` e pode usar laços, matemática e lógica para gerar features em lote.
   * A execução inteira vira UMA operação desfazível.
   */
  runScript(code, timeoutMs = 5000, source = 'script') {
    const d = this.doc;
    const logs = [];
    const created = [];
    const res = d.mutate('Script', () => {
      const add = (type) => (spec = {}) => { const n = d.addFeature({ ...spec, type }); created.push(n); return n; };
      const cad = Object.fromEntries(Object.keys(FEATURES).map((t) => [t, add(t)]));
      cad.param = (n, e, c) => d.setParameter(n, e, c);
      cad.feature = (spec) => { const n = d.addFeature(spec); created.push(n); return n; };
      cad.update = (n, p) => d.updateFeature(n, p);
      const sandbox = { cad, Math, console: { log: (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) } };
      vm.runInNewContext(code, sandbox, { timeout: timeoutMs, filename: 'script.js' });
    }, source);
    return { ...res.result, created, logs };
  }
}

function resolveFile(f) {
  return path.isAbsolute(f) ? f : path.join(WORKSPACE, f);
}
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').toLowerCase() || 'modelo';
