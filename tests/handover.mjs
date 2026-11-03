// Testa a passagem de controle do kernel: MCP sozinho → app assume (MCP vira ponte) → app fecha (MCP retoma).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PORT = 7797;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'projetista-handover-'));
const homeMcp = path.join(tmp, 'mcp'), homeApp = path.join(tmp, 'app');
fs.mkdirSync(homeApp, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const req = (method, p) => new Promise((res) => { const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method }, (x) => { let b = ''; x.on('data', (c) => (b += c)); x.on('end', () => { try { res(JSON.parse(b)); } catch { res(null); } }); }); r.on('error', () => res(null)); r.end(); });
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'ok  ' : 'FALHA', m); };

const client = new Client({ name: 'teste-handover', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/cli.js', 'mcp'], env: { ...process.env, PROJETISTA_PORT: String(PORT), PROJETISTA_HOME: homeMcp }, stderr: 'ignore' }));
const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
await call('document', { action: 'new', name: 'Passagem' });
await call('add_features', { features: [{ type: 'box', width: 20, body: 'Caixa' }] });
ok((await req('GET', '/api/info'))?.owner === 'mcp', 'kernel inicial pertence ao MCP');

// o "app" assume
const h = await req('POST', '/api/handover');
ok(h?.document?.features?.length === 1, 'handover entregou o documento');
fs.writeFileSync(path.join(homeApp, 'autosave.projetista.json'), JSON.stringify(h.document));
for (let i = 0; i < 50 && (await req('GET', '/api/info')); i++) await sleep(100);
const appProc = spawn(process.execPath, ['src/cli.js', 'app', `--port=${PORT}`, `--home=${homeApp}`], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) { if ((await req('GET', '/api/info'))?.owner === 'app') break; await sleep(150); }
ok((await req('GET', '/api/info'))?.owner === 'app', 'app assumiu a porta');
await sleep(1500);
const st = await call('get_state');
ok(st.bodies.some((b) => b.name === 'Caixa'), 'MCP em modo ponte enxerga o documento no app');
await call('add_features', { features: [{ type: 'cylinder', diameter: 10, height: 30, body: 'Pino', at: [40, 0, 0] }] });

// o app fecha: o MCP retoma o kernel com o documento salvo pelo app
await sleep(800); // espera o salvamento automático
appProc.kill();
await sleep(2500);
const st2 = await call('get_state');
ok(st2.bodies.some((b) => b.name === 'Pino'), 'após o app fechar, o MCP retomou com o documento do app');
ok((await req('GET', '/api/info'))?.owner === 'mcp', 'MCP voltou a servir a interface');
await client.close();
console.log(fails ? `${fails} FALHA(S)` : 'TUDO OK');
process.exit(fails ? 1 : 0);
