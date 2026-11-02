// Verifica o app desktop em execução: comandos pela ponte e render feito pela janela Electron (GPU).
import fs from 'node:fs';
import { RemoteStudio, findRunningApp } from '../src/mcp/bridge.js';
const app = await findRunningApp(7777);
if (!app) { console.log('app não está rodando'); process.exit(1); }
const s = await RemoteStudio.connect(app.url);
await s.run('new_document', { name: 'Flange DN50' });
await s.run('set_parameters', { parameters: { D: 165, esp: 18, furos: 4, PCD: 125, d_furo: 18, DN: 60.3 } });
const r = await s.run('add_features', { features: [
  { type: 'cylinder', diameter: 'D', height: 'esp', body: 'Flange', material: 'Aço Inox 304' },
  { type: 'cylinder', diameter: 'DN+20', height: 50, at: [0, 0, 'esp'], operation: 'join', target: 'Flange' },
  { type: 'hole', target: 'Flange', diameter: 'DN', at: [0, 0, 'esp+50'] },
  { type: 'hole', target: 'Flange', diameter: 'd_furo', at: ['PCD/2', 0, 'esp'] },
  { type: 'fillet', body: 'Flange', edges: { type: 'circle', radius: '(DN+20)/2', near: [0, 40, 'esp'] }, radius: 6 },
  { type: 'chamfer', body: 'Flange', edges: { type: 'circle', radius: 'DN/2', onFace: { normal: '+z' } }, distance: 1.5 },
] }, 'claude');
console.log('erros:', r.errors);
const pat = await s.run('add_feature', { feature: { type: 'sketch', name: 'tmp', plane: 'XY', shapes: [] } }, 'claude');
void pat;
await s.run('delete_feature', { name: 'tmp' }, 'claude');
const img = await s.run('render', { sheet: true, width: 1000, height: 800 });
fs.writeFileSync('tests/out/desktop-render.png', img.png);
console.log('motor de render:', img.engine);
const mp = await s.run('mass_properties', { body: 'Flange' });
console.log('massa', mp.mass_g, 'g · volume', mp.volume_mm3, 'mm³ · faces', mp.faces, '· B-rep válido', mp.validBRep);
const res = await s.run('resources');
console.log('GPU', JSON.stringify(res.gpu), '· kernel threads', res.kernelThreads);
process.exit(0);
