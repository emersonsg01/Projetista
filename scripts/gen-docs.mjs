// Gera a documentação de referência a partir do código (npm run docs):
//   docs/referencia-mcp.md          ferramentas, parâmetros, prompts e recursos do servidor MCP
//   docs/referencia-de-modelagem.md manual de modelagem entregue ao Claude
//   docs/catalogos.md               features, materiais e roscas ISO
//   THIRD_PARTY_NOTICES.md          dependências distribuídas com o app e suas licenças
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { REFERENCE } from '../src/mcp/reference.js';
import { FEATURES, FEATURE_PREFIX, ISO_THREADS } from '../src/core/features.js';
import { MATERIALS } from '../src/core/materials.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
fs.mkdirSync(DOCS, { recursive: true });
const AUTO = (src) => `<!-- Gerado automaticamente por \`npm run docs\` a partir de ${src}. Não edite à mão. -->\n\n`;
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');

// ---------------------------------------------------------------- MCP: lido do servidor real
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'projetista-docs-'));
const client = new Client({ name: 'gerador-de-docs', version: pkg.version });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [path.join(ROOT, 'src', 'cli.js'), 'mcp'],
  env: { ...process.env, PROJETISTA_NO_UI: '1', PROJETISTA_HOME: home, PROJETISTA_PORT: '7798' }, stderr: 'ignore',
}));
const { tools } = await client.listTools();
const { prompts } = await client.listPrompts().catch(() => ({ prompts: [] }));
const { resources } = await client.listResources().catch(() => ({ resources: [] }));
await client.close();
fs.rmSync(home, { recursive: true, force: true });

function typeOf(s) {
  if (!s) return 'qualquer';
  if (s.enum) return s.enum.map((v) => `\`${v}\``).join(' | ');
  if (s.anyOf) return s.anyOf.map(typeOf).join(' | ');
  if (s.type === 'array') return `lista de ${typeOf(s.items)}${s.minItems ? ` (mín. ${s.minItems})` : ''}${s.maxItems ? ` (máx. ${s.maxItems})` : ''}`;
  if (s.type === 'object') {
    if (s.properties) return `objeto { ${Object.keys(s.properties).join(', ')} }`;
    if (s.additionalProperties) return `mapa de ${typeOf(s.additionalProperties)}`;
    return 'objeto';
  }
  const t = { string: 'texto', number: 'número', integer: 'inteiro', boolean: 'sim/não' }[s.type] || s.type || 'qualquer';
  const lim = [s.minimum !== undefined ? `≥ ${s.minimum}` : '', s.maximum !== undefined ? `≤ ${s.maximum}` : ''].filter(Boolean).join(', ');
  return lim ? `${t} (${lim})` : t;
}

let md = `${AUTO('src/mcp/server.js (lista obtida do servidor em execução)')}# Referência do servidor MCP\n\n`;
md += `Servidor \`projetista\` versão ${pkg.version}. Transporte: stdio. ${tools.length} ferramentas, ${prompts.length} prompt(s), ${resources.length} recurso(s).\n\n`;
md += 'Como configurar o Claude: veja [manual-do-usuario.md](manual-do-usuario.md#13-claude-e-o-servidor-mcp).\n\n';
md += '## Índice\n\n' + tools.map((t) => `- [\`${t.name}\`](#${t.name})${t.annotations?.readOnlyHint ? ' · somente leitura' : ''}`).join('\n') + '\n\n';
for (const t of tools) {
  md += `## ${t.name}\n\n${t.description}\n\n`;
  if (t.annotations?.readOnlyHint) md += '_Somente leitura: não altera o documento._\n\n';
  const props = t.inputSchema?.properties || {};
  const req = new Set(t.inputSchema?.required || []);
  if (!Object.keys(props).length) { md += 'Sem parâmetros.\n\n'; continue; }
  md += '| Parâmetro | Tipo | Obrigatório | Descrição |\n|---|---|---|---|\n';
  for (const [k, s] of Object.entries(props)) md += `| \`${k}\` | ${esc(typeOf(s))} | ${req.has(k) ? 'sim' : 'não'} | ${esc(s.description || '')} |\n`;
  md += '\n';
}
if (prompts.length) {
  md += '## Prompts\n\n';
  for (const p of prompts) md += `### ${p.name}\n\n${p.description || ''}\n\nArgumentos: ${(p.arguments || []).map((a) => `\`${a.name}\`${a.required ? ' (obrigatório)' : ''} — ${a.description || ''}`).join('; ') || 'nenhum'}\n\n`;
}
if (resources.length) {
  md += '## Recursos\n\n| URI | Nome | Tipo |\n|---|---|---|\n';
  for (const r of resources) md += `| \`${r.uri}\` | ${esc(r.title || r.name)} | ${r.mimeType || ''} |\n`;
  md += '\n';
}
fs.writeFileSync(path.join(DOCS, 'referencia-mcp.md'), md);

// ---------------------------------------------------------------- manual de modelagem (o mesmo que o Claude lê)
fs.writeFileSync(path.join(DOCS, 'referencia-de-modelagem.md'), `${AUTO('src/mcp/reference.js')}${REFERENCE.trim()}\n`);

// ---------------------------------------------------------------- catálogos
let cat = `${AUTO('src/core/features.js e src/core/materials.js')}# Catálogos\n\n`;
cat += '## Tipos de feature\n\n| Tipo (JSON) | Nome na interface | Prefixo do nome automático |\n|---|---|---|\n';
for (const [k, v] of Object.entries(FEATURES)) cat += `| \`${k}\` | ${v.label} | ${FEATURE_PREFIX[k] || k} |\n`;
cat += '\nDetalhes de cada campo: [referencia-de-modelagem.md](referencia-de-modelagem.md).\n\n';
cat += '## Materiais\n\n| Material | Densidade (g/cm³) | Preço aprox. (R$/kg) | Classe | Cor padrão |\n|---|---|---|---|---|\n';
for (const [k, m] of Object.entries(MATERIALS)) cat += `| ${k} | ${m.density} | ${m.pricePerKg} | ${m.kind} | \`${m.color}\` |\n`;
cat += '\nPreços são referências para estimativa de custo; ajuste em `src/core/materials.js`.\n\n';
cat += '## Roscas métricas ISO (assistente de furos)\n\n| Rosca | Ø broca p/ rosca (mm) | Ø passagem ISO 273 média (mm) | Ø rebaixo ISO 4762 (mm) | Prof. rebaixo (mm) | Passo grosso (mm) |\n|---|---|---|---|---|---|\n';
for (const [k, v] of Object.entries(ISO_THREADS)) cat += `| ${k} | ${v[0]} | ${v[1]} | ${v[2]} | ${v[3]} | ${v[4]} |\n`;
fs.writeFileSync(path.join(DOCS, 'catalogos.md'), cat);

// ---------------------------------------------------------------- avisos de terceiros (dependências de produção)
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const deps = Object.entries(lock.packages || {})
  .filter(([p, info]) => p.startsWith('node_modules/') && !info.dev && !info.devOptional)
  .map(([p, info]) => {
    const name = p.split('node_modules/').pop();
    let license = info.license;
    let homepage = '';
    try { const pj = JSON.parse(fs.readFileSync(path.join(ROOT, p, 'package.json'), 'utf8')); license ||= pj.license; homepage = pj.homepage || (typeof pj.repository === 'string' ? pj.repository : pj.repository?.url) || ''; } catch { /* pacote opcional ausente */ }
    return { name, version: info.version, license: typeof license === 'object' ? license.type : license || 'não informado', homepage: String(homepage).replace(/^git\+/, '').replace(/\.git$/, '') };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
const uniq = [...new Map(deps.map((d) => [`${d.name}@${d.version}`, d])).values()];
let notice = `${AUTO('package-lock.json')}# Avisos de terceiros\n\n`;
notice += 'O instalador do Projetista distribui o runtime do Electron e as dependências de produção abaixo. ';
notice += 'Cada pacote mantém o seu arquivo de licença dentro de `resources/app/node_modules/<pacote>/` na instalação.\n\n';
notice += '**OpenCascade** (via `replicad-opencascadejs`) é distribuído sob **LGPL 2.1**: o módulo WebAssembly é carregado dinamicamente e pode ser substituído por outra build compatível colocando-a em `resources/app/node_modules/replicad-opencascadejs/dist/`. O código-fonte do OpenCascade está em https://dev.opencascade.org e o da build em https://github.com/sgenoud/replicad.\n\n';
notice += '**Electron** (MIT) inclui o Chromium e outros componentes; os avisos completos acompanham a instalação em `LICENSES.chromium.html`.\n\n';
notice += `| Pacote | Versão | Licença | Projeto |\n|---|---|---|---|\n`;
for (const d of uniq) notice += `| ${d.name} | ${d.version} | ${d.license} | ${d.homepage} |\n`;
fs.writeFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), notice);

console.log(`docs gerados: ${tools.length} ferramentas MCP, ${Object.keys(FEATURES).length} features, ${Object.keys(MATERIALS).length} materiais, ${uniq.length} dependências`);
process.exit(0);
