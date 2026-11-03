// Reproduz a exportação como a interface faz e verifica formatos, extensões e mensagens de erro.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RemoteStudio, findRunningApp } from '../src/mcp/bridge.js';
import { EXAMPLES } from '../web/js/examples.js';
const port = Number(process.env.PROJETISTA_PORT) || 7777;
const app = await findRunningApp(port);
if (!app) { console.log('app não está rodando'); process.exit(1); }
const s = await RemoteStudio.connect(app.url);
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'ok  ' : 'FALHA', m); };
if (process.env.LOAD_EXAMPLE) await s.run('load_document', { data: EXAMPLES[0].data });
const dir = process.argv[2] || path.join(os.tmpdir(), 'Área de Trabalho', 'export');
fs.rmSync(dir, { recursive: true, force: true });
for (const fmt of ['step', 'stl', '3mf', 'obj', 'glb']) {
  const r = await s.run('export', { format: fmt, file: path.join(dir, 'sub pasta', `peça.${fmt}`) }).catch((e) => ({ error: e.message }));
  ok(!r.error && fs.existsSync(r.file) && r.file.endsWith(`.${fmt}`), `${fmt}: ${r.error || `${r.bytes} bytes em ${r.ms} ms`}`);
}
const a = await s.run('export', { file: path.join(dir, 'por-extensao.3mf') });
ok(a.format === '3mf', `formato deduzido da extensão → ${a.format}`);
const b = await s.run('export', { format: 'step', file: path.join(dir, 'errado.stl') });
ok(b.file.endsWith('errado.step'), `extensão corrigida para o formato → ${path.basename(b.file)}`);
const c = await s.run('export', { format: 'stl', file: path.join(dir, 'sem-extensao') });
ok(c.file.endsWith('sem-extensao.stl'), `extensão adicionada → ${path.basename(c.file)}`);
const e1 = await s.run('export', { format: 'stl', bodies: ['NaoExiste'], file: path.join(dir, 'x.stl') }).catch((e) => e.message);
ok(/Nenhum dos corpos/.test(e1), `erro claro para corpo inexistente → ${e1}`);
const e2 = await s.run('export', { format: 'dwg', file: path.join(dir, 'x.dwg') }).catch((e) => e.message);
ok(/não suportado/.test(e2), `erro claro para formato inválido → ${e2}`);
const d = await s.run('drawing', { file: path.join(dir, 'desenho') });
ok(d.file.endsWith('desenho.svg'), `desenho SVG → ${path.basename(d.file)}`);
const rel = await s.run('export', { format: 'stl' });
ok(rel.download?.startsWith('/files/'), `sem caminho: grava na pasta de projetos com link de download ${rel.download}`);
console.log(fails ? `${fails} FALHA(S)` : 'TUDO OK');
process.exit(fails ? 1 : 0);
