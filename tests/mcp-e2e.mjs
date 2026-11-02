// Teste ponta a ponta do MCP. Se o app estiver aberto em PROJETISTA_PORT (7777), roda em modo ponte.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('tests/out');
fs.mkdirSync(out, { recursive: true });
const port = process.env.PROJETISTA_PORT || '7799';
const transport = new StdioClientTransport({ command: process.execPath, args: ['src/cli.js', 'mcp'], env: { ...process.env, PROJETISTA_HOME: process.env.PROJETISTA_HOME || out, PROJETISTA_PORT: port }, stderr: 'inherit' });
const client = new Client({ name: 'teste', version: '1' });
await client.connect(transport);
let n = 0;
const call = async (name, args = {}) => {
  const t = performance.now();
  const r = await client.callTool({ name, arguments: args });
  const ms = (performance.now() - t).toFixed(0);
  for (const c of r.content) {
    if (c.type === 'image') { const f = path.join(out, `${String(++n).padStart(2, '0')}-${name}.png`); fs.writeFileSync(f, Buffer.from(c.data, 'base64')); console.log(`[${name}] ${ms}ms imagem -> ${f}`); }
    else console.log(`[${name}] ${ms}ms${r.isError ? ' ERRO' : ''}`, c.text.length > 500 ? c.text.slice(0, 500) + '…' : c.text);
  }
  return r;
};
console.log((await client.listTools()).tools.map((t) => t.name).join(', '));
await call('document', { action: 'new', name: 'Suporte de motor NEMA17' });
await call('set_parameters', { parameters: { L: 70, W: 42.3, esp: 5, aba: 45, r: 4 } });
await call('add_features', { features: [
  { type: 'sketch', name: 'Perfil', plane: 'XZ', shapes: [{ type: 'polygon', points: [[0, 0], ['L', 0], ['L', 'esp'], ['esp', 'esp'], ['esp', 'aba'], [0, 'aba']] }] },
  { type: 'extrude', sketch: 'Perfil', distance: 'W', direction: 'symmetric', body: 'Suporte', material: 'Alumínio 6061' },
  { type: 'fillet', body: 'Suporte', edges: { type: 'line', parallel: 'y', near: ['esp', 0, 'esp'] }, radius: 'r' },
  { type: 'hole', target: 'Suporte', diameter: 22.5, direction: '+x', at: [0, 0, 'aba/2+esp/2'] },
  { type: 'hole', target: 'Suporte', size: 'M3', direction: '+x', positions: [[0, 15.5, 'aba/2+esp/2+15.5'], [0, -15.5, 'aba/2+esp/2+15.5'], [0, 15.5, 'aba/2+esp/2-15.5'], [0, -15.5, 'aba/2+esp/2-15.5']] },
  { type: 'hole', target: 'Suporte', size: 'M5', holeType: 'counterbore', positions: [['L-12', 12, 'esp'], ['L-12', -12, 'esp']] },
  { type: 'fillet', body: 'Suporte', edges: { type: 'line', parallel: 'z', minLength: 1 }, radius: 3 },
]});
await call('render_view', { sheet: true });
await call('analyze', { kind: 'mass', body: 'Suporte' });
await call('analyze', { kind: 'faces', body: 'Suporte' });
await call('measure', { a: { body: 'Suporte', face: 0 }, b: { body: 'Suporte', face: 1 } });
await call('optimize', { variables: { esp: { min: 2, max: 8 }, r: { min: 1, max: 6 } }, objective: 'mass', minimize: true, constraints: ['esp >= 3'], maxEvaluations: 40 });
await call('technical_drawing', { title: 'Suporte NEMA17' });
await call('export_model', { format: 'step' });
await call('export_model', { format: '3mf', quality: 'fine' });
await call('system_resources', {});
await client.close();
