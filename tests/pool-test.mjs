import { Studio } from '../src/studio.js';
process.env.PROJETISTA_HOME = process.env.PROJETISTA_HOME || 'tests/out';
const s = await Studio.create();
await s.run('new_document', { name: 'teste-pool' });
await s.run('set_parameters', { parameters: { L: 60, esp: 4, r: 3 } });
await s.run('add_features', { features: [
  { type: 'box', width: 'L', depth: 40, height: 'esp', body: 'Placa' },
  { type: 'fillet', body: 'Placa', edges: { parallel: 'z' }, radius: 'r' },
  { type: 'hole', target: 'Placa', size: 'M4', holeType: 'countersink', positions: [['-L/2+6', -14, 'esp'], ['L/2-6', -14, 'esp'], ['L/2-6', 14, 'esp'], ['-L/2+6', 14, 'esp']] },
]});
const vals = Array.from({ length: 30 }, (_, i) => 40 + i * 2);
const r = await s.run('parameter_study', { parameter: 'L', values: vals });
console.log('estudo 30 variantes:', r.wallMs, 'ms com', r.workers, 'workers; soma dos tempos individuais', r.rows.reduce((a, x) => a + x.ms, 0).toFixed(0), 'ms');
console.log(r.rows.slice(0, 3).map((x) => `${x.value} → ${x.mass_g} g`).join(' | '));
const o = await s.run('optimize', { variables: { L: { min: 40, max: 120 }, esp: { min: 2, max: 8 } }, objective: 'mass', minimize: false, constraints: ['mass <= 30', 'esp >= 3'], maxEvaluations: 60 });
console.log('otimização:', JSON.stringify(o.best), o.evaluated, 'avaliações', o.wallMs, 'ms');
console.log(JSON.stringify(await s.run('resources')).slice(0, 400));
process.exit(0);
