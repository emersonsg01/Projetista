// Worker de kernel: regenera uma variante do documento e devolve métricas.
import { parentPort } from 'node:worker_threads';
import { initOCC } from '../occ/occ.js';
import { Document } from '../core/document.js';
import { massProperties, interference } from '../core/analysis.js';
import { evaluate } from '../core/expr.js';

await initOCC({ threads: false }); // um thread por worker: o paralelismo vem do pool

parentPort.on('message', ({ id, task }) => {
  try {
    parentPort.postMessage({ id, ok: true, result: execute(task) });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: e?.message || String(e) });
  }
});
parentPort.postMessage({ type: 'ready' });

function execute(task) {
  if (task.kind === 'variant') {
    const t0 = performance.now();
    const doc = new Document();
    const data = structuredClone(task.doc);
    for (const [k, v] of Object.entries(task.overrides || {})) data.parameters[k] = { ...(data.parameters[k] || {}), expr: v };
    doc.load(data);
    const sum = doc.summary();
    const bodies = [...doc.bodies.entries()].map(([name, b]) => ({ name, ...b }));
    const mp = bodies.map((b) => massProperties(b));
    const out = {
      overrides: task.overrides, ok: !sum.errors.length, errors: sum.errors,
      mass_g: +mp.reduce((s, m) => s + m.mass_g, 0).toFixed(6),
      volume_mm3: +mp.reduce((s, m) => s + m.volume_mm3, 0).toFixed(6),
      area_mm2: +mp.reduce((s, m) => s + m.surfaceArea_mm2, 0).toFixed(6),
      bodies: bodies.map((b, i) => ({ name: b.name, mass_g: mp[i].mass_g, size_mm: mp[i].boundingBox.size, com_mm: mp[i].centerOfMass_mm })),
      ms: +(performance.now() - t0).toFixed(1),
    };
    if (task.checkInterference) out.interference = interference(doc.bodies);
    if (task.objective) {
      // objetivo: expressão sobre métricas (mass, volume, area, sx, sy, sz) + parâmetros
      const env = { mass: out.mass_g, volume: out.volume_mm3, area: out.area_mm2 };
      const all = bodies.length ? mp[0].boundingBox.size : [0, 0, 0];
      Object.assign(env, { sx: all[0], sy: all[1], sz: all[2] });
      const pv = doc.paramTable().values();
      out.objective = evaluate(task.objective, (n) => env[n] ?? (typeof pv[n] === 'number' ? pv[n] : undefined));
      if (task.constraints) out.feasible = task.constraints.every((c) => evaluate(c, (n) => env[n] ?? (typeof pv[n] === 'number' ? pv[n] : undefined)) !== 0);
    }
    return out;
  }
  throw new Error(`Tarefa desconhecida: ${task.kind}`);
}
