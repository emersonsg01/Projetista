// Servidor MCP do Projetista: dá ao Claude modelagem paramétrica, visão (renderização),
// análise de engenharia, desenho técnico e exportação — sobre o MESMO documento que
// aparece ao vivo na interface web (http://localhost:7777).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Studio } from '../studio.js';
import { startHub } from '../server/hub.js';
import fs from 'node:fs';
import path from 'node:path';
import { RemoteStudio, findRunningApp } from './bridge.js';
import { REFERENCE } from './reference.js';

const J = (x) => JSON.stringify(x, null, 1);
const text = (x) => ({ content: [{ type: 'text', text: typeof x === 'string' ? x : J(x) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `Erro: ${e.message}` }] });

export async function createMcpServer(studio, hubUrl) {
  const server = new McpServer(
    { name: 'projetista', version: '0.1.0' },
    {
      instructions: `Projetista é um CAD paramétrico (estilo Fusion 360 / SolidWorks / FreeCAD) controlado por você.
Fluxo ideal: (1) feature_reference uma vez; (2) set_parameters; (3) add_features em lote; (4) render_view para VER o resultado;
(5) analyze para validar; (6) export_model / technical_drawing. Unidades mm. Z para cima.
${hubUrl ? `O usuário acompanha tudo ao vivo em ${hubUrl}.` : ''}`,
    },
  );

  const tool = (name, description, schema, fn, annotations = {}) =>
    server.registerTool(name, { description, inputSchema: schema, annotations }, async (args) => {
      try { return await fn(args || {}); } catch (e) { return fail(e); }
    });

  tool('feature_reference', 'Manual completo de modelagem: tipos de feature, parâmetros, esboços e restrições, seleção de faces. Leia antes de modelar.', {}, async () => text(REFERENCE), { readOnlyHint: true });

  tool('get_state', 'Estado do documento: parâmetros (valores avaliados), linha do tempo com status de cada feature (ok/erro), corpos com volume e caixa delimitadora.', {
    verbose: z.boolean().optional().describe('Inclui a definição completa de cada feature'),
  }, async ({ verbose }) => {
    const s = await studio.run('state');
    return text({
      name: s.name, parameters: s.parameters, configurations: s.configurations, activeConfiguration: s.activeConfiguration,
      timeline: s.status.map((st, i) => ({ i, ...st, ...(verbose ? { def: s.features[i] } : {}) })),
      rollback: s.rollback, bodies: s.summary.bodies, errors: s.summary.errors, warnings: s.summary.warnings, versions: s.versions,
      viewer: hubUrl || null,
    });
  }, { readOnlyHint: true });

  tool('set_parameters', 'Cria/atualiza parâmetros do usuário (valores ou expressões, ex.: {"L": 80, "W": "L/2", "folga": "0.2mm"}). Tudo que depende deles regenera.', {
    parameters: z.record(z.string(), z.union([z.number(), z.string()])),
  }, async ({ parameters }) => text(await studio.run('set_parameters', { parameters }, 'claude')));

  tool('add_features', 'Adiciona uma ou mais features à linha do tempo (operação única desfazível). Veja feature_reference para tipos e campos. Ex.: [{"type":"sketch","name":"S1","plane":"XY","shapes":[{"type":"rect","center":[0,0],"width":"L","height":"W"}]},{"type":"extrude","sketch":"S1","distance":10,"body":"Base"}]', {
    features: z.array(z.record(z.string(), z.any())).min(1),
  }, async ({ features }) => text(await studio.run('add_features', { features }, 'claude')));

  tool('update_feature', 'Altera campos de uma feature existente (patch parcial; null remove o campo). Ex.: {"name":"Extrusão1","patch":{"distance":"H*2"}}', {
    name: z.string(), patch: z.record(z.string(), z.any()),
  }, async (a) => text(await studio.run('update_feature', a, 'claude')));

  tool('edit_timeline', 'Gerencia a linha do tempo: delete, suppress, unsuppress, move (para index), rollback (marcador em index; null = fim).', {
    action: z.enum(['delete', 'suppress', 'unsuppress', 'move', 'rollback']),
    name: z.string().optional(), index: z.number().int().nullable().optional(),
  }, async ({ action, name, index }) => {
    const map = {
      delete: ['delete_feature', { name }], suppress: ['suppress_feature', { name, suppressed: true }],
      unsuppress: ['suppress_feature', { name, suppressed: false }], move: ['move_feature', { name, index }], rollback: ['set_rollback', { index }],
    };
    const [cmd, args] = map[action];
    return text(await studio.run(cmd, args, 'claude'));
  });

  tool('render_view', 'Renderiza o modelo e devolve uma IMAGEM para você inspecionar. Use após cada mudança relevante. sheet:true = folha com 4 vistas (iso, frente, topo, direita). Vermelho = interior exposto por corte.', {
    view: z.union([z.enum(['iso', 'front', 'back', 'top', 'bottom', 'left', 'right', 'iso-back', 'iso-below']), z.object({ azimuth: z.number(), elevation: z.number() })]).optional(),
    sheet: z.boolean().optional(),
    width: z.number().int().min(100).max(1600).optional(), height: z.number().int().min(100).max(1200).optional(),
    bodies: z.array(z.string()).optional().describe('Só estes corpos'),
    highlight: z.string().optional().describe('Destaca um corpo e esmaece os demais'),
    section: z.object({ normal: z.array(z.number()).length(3), offset: z.number() }).optional().describe('Corte: remove o que está além do plano normal·p > offset'),
    showSketches: z.boolean().optional(),
    engine: z.enum(['auto', 'software']).optional().describe('auto = GPU do app desktop quando aberto; software = CPU'),
  }, async (a) => {
    const r = await studio.run('render', { width: a.sheet ? 1000 : 800, height: a.sheet ? 800 : 600, ...a });
    const s = (await studio.run('state')).summary;
    return {
      content: [
        { type: 'image', data: r.png.toString('base64'), mimeType: 'image/png' },
        { type: 'text', text: `Motor: ${r.engine} · ${a.sheet ? `Vistas: ${(r.views || []).join(', ')}` : `Vista: ${JSON.stringify(a.view || 'iso')}`} · eixos: X vermelho, Y verde, Z azul · corpos: ${s.bodies.map((b) => `${b.name} [${b.bbox.min.join(',')}]→[${b.bbox.max.join(',')}]`).join('; ') || 'nenhum'}${s.errors.length ? ` · ERROS: ${s.errors.join(' | ')}` : ''}` },
      ],
    };
  }, { readOnlyHint: true });

  tool('analyze', 'Análises de engenharia sobre a geometria EXATA (B-rep). kind: mass (massa, volume, CG, tensor e momentos principais de inércia, custo), interference (colisões entre corpos), clearance (folga mínima a-b), section (área/contornos num plano), print (checagem de impressão 3D: balanços, paredes finas, tempo), bom (lista de materiais), faces (todas as faces com tipo/normal/raio/área, p/ seleção), edges (arestas com tipo/comprimento/raio, p/ filete e chanfro), sketch (DOF/estado de um esboço), dependencies (quais features dependem de cada parâmetro).', {
    kind: z.enum(['mass', 'interference', 'clearance', 'section', 'print', 'bom', 'faces', 'edges', 'sketch', 'dependencies']),
    body: z.string().optional(), a: z.string().optional(), b: z.string().optional(), name: z.string().optional(),
    normal: z.array(z.number()).length(3).optional(), offset: z.number().optional(),
    overhangAngle: z.number().optional(), minWall: z.number().optional(), search: z.number().optional(),
  }, async (x) => {
    const map = {
      mass: ['mass_properties', { body: x.body }], interference: ['interference', {}], clearance: ['clearance', { a: x.a, b: x.b, search: x.search }],
      section: ['section', { body: x.body, normal: x.normal, offset: x.offset }], print: ['print_check', { body: x.body, overhangAngle: x.overhangAngle, minWall: x.minWall }],
      bom: ['bom', {}], faces: ['list_faces', { body: x.body }], edges: ['list_edges', { body: x.body }], sketch: ['sketch_info', { name: x.name }], dependencies: ['dependencies', {}],
    };
    const [cmd, args] = map[x.kind];
    const r = await studio.run(cmd, args);
    if (x.kind === 'section' && r.polygons?.length > 6) r.polygons = `${r.polygons.length} contornos (omitidos)`;
    return text(r);
  }, { readOnlyHint: true });

  tool('parameter_study', 'Estudo paramétrico EM PARALELO (um worker por núcleo da CPU): avalia o modelo para vários valores de um parâmetro e devolve massa, volume, dimensões e erros de cada variante. O documento atual não é alterado.', {
    parameter: z.string(), values: z.array(z.union([z.number(), z.string()])).min(1).max(500), checkInterference: z.boolean().optional(),
  }, async (a) => text(await studio.run('parameter_study', a)), { readOnlyHint: true });

  tool('optimize', 'Otimização paramétrica paralela (busca em grade/aleatória + refinamento local, usando todos os núcleos). objective é uma expressão sobre mass, volume, area, sx, sy, sz e parâmetros; constraints são expressões booleanas (ex.: "sz <= 50", "esp >= 2"). Devolve os melhores valores — aplique com set_parameters.', {
    variables: z.record(z.string(), z.object({ min: z.number(), max: z.number(), steps: z.number().int().optional() })),
    objective: z.string().optional(), minimize: z.boolean().optional(), constraints: z.array(z.string()).optional(), maxEvaluations: z.number().int().min(4).max(2000).optional(),
  }, async (a) => text(await studio.run('optimize', a)), { readOnlyHint: true });

  tool('measure', 'Medição EXATA no B-rep. Sem b: propriedades de uma face (tipo, área, normal, raio, eixo, centróide). Com b: distância mínima entre duas faces, ângulo, distância entre planos paralelos e entre eixos de cilindros. Índices de face vêm de analyze kind="faces".', {
    a: z.object({ body: z.string(), face: z.number().int() }), b: z.object({ body: z.string(), face: z.number().int() }).optional(),
  }, async ({ a, b }) => text(b ? await studio.run('measure', { a, b }) : await studio.run('face_info', { body: a.body, face: a.face })), { readOnlyHint: true });

  tool('system_resources', 'Uso de CPU por núcleo, RAM, workers do kernel e GPU/VRAM da máquina.', {}, async () => text(await studio.run('resources')), { readOnlyHint: true });

  tool('run_script', 'Executa JavaScript de modelagem (laços, matemática, lógica) com a API `cad`: cad.<tipo>({...}) adiciona uma feature (ex.: cad.box, cad.sketch, cad.extrude, cad.hole), cad.param(nome, expr), cad.update(nome, patch), console.log(). Tudo vira UMA operação desfazível. Ideal para padrões complexos e geração procedural.', {
    code: z.string(), timeoutMs: z.number().int().max(30000).optional(),
  }, async (a) => text(await studio.run('run_script', a, 'claude')));

  tool('history', 'Desfazer/refazer e versões nomeadas (como o histórico de versões do Fusion).', {
    action: z.enum(['undo', 'redo', 'save_version', 'restore_version']), label: z.string().optional(), id: z.number().int().optional(),
  }, async ({ action, label, id }) => {
    const r = await studio.run(action, { label, id }, 'claude');
    return text({ done: action, result: r ?? null, summary: (await studio.run('state')).summary });
  });

  tool('document', 'Gerencia o documento/arquivos: new, save, open, list (arquivos no workspace), rename, resolution (segmentos de círculo 8–256), material (material padrão), configuration (salva conjunto de valores de parâmetros, ex. tamanhos P/M/G), activate (ativa configuração; sem name = padrão).', {
    action: z.enum(['new', 'save', 'open', 'list', 'rename', 'resolution', 'material', 'configuration', 'activate']),
    name: z.string().optional(), file: z.string().optional(), segments: z.number().int().optional(),
    material: z.string().optional(), values: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  }, async (a) => {
    const map = {
      new: ['new_document', { name: a.name }], save: ['save', { file: a.file }], open: ['open', { file: a.file }], list: ['list_files', {}],
      rename: ['rename_document', { name: a.name }], resolution: ['set_resolution', { segments: a.segments }],
      material: ['set_default_material', { material: a.material }], configuration: ['set_configuration', { name: a.name, values: a.values }],
      activate: ['activate_configuration', { name: a.name }],
    };
    const [cmd, args] = map[a.action];
    return text((await studio.run(cmd, args, 'claude')) ?? 'ok');
  });

  tool('export_model', 'Exporta corpos: step (B-rep exato — para usinagem/CAM e outros CADs: SolidWorks, Fusion, Inventor, FreeCAD), stl / 3mf (impressão 3D), obj, glb (web/AR). quality controla a tesselagem das malhas (draft 0.1 mm, normal 0.02, fine 0.005, ultra 0.001 mm de erro cordal).', {
    format: z.enum(['step', 'stl', '3mf', 'obj', 'glb']), bodies: z.array(z.string()).optional(), file: z.string().optional(), quality: z.enum(['draft', 'normal', 'fine', 'ultra']).optional(),
  }, async (a) => text({ ...(await studio.run('export', a)), ...(hubUrl ? { download: `${hubUrl}/files/` } : {}) }));

  tool('technical_drawing', 'Gera desenho técnico SVG por remoção EXATA de linhas ocultas (HLR): vistas frontal/superior/lateral, linhas ocultas tracejadas, cotas gerais, chamadas de furos (n× Ø), isométrica, carimbo e símbolo de diedro. 1º diedro (ABNT) por padrão.', {
    bodies: z.array(z.string()).optional(), projection: z.enum(['first', 'third']).optional(), hiddenLines: z.boolean().optional(), sheet: z.enum(['A3', 'A4']).optional(),
    title: z.string().optional(), file: z.string().optional(),
  }, async (a) => text(await studio.run('drawing', a)));

  tool('catalog', 'Lista tipos de feature, materiais (densidade/preço) e roscas ISO disponíveis.', {}, async () => text(await studio.run('catalog')), { readOnlyHint: true });

  tool('open_viewer', 'Retorna o endereço da interface web 3D ao vivo para o usuário abrir no navegador.', {}, async () =>
    text(hubUrl ? `Abra ${hubUrl} — a cena atualiza ao vivo a cada mudança, com árvore de features, parâmetros editáveis e feed das suas ações.` : 'A interface web não está ativa neste processo (porta ocupada por outra instância?).'), { readOnlyHint: true });

  server.registerResource('referencia', 'projetista://referencia', { title: 'Referência de modelagem', mimeType: 'text/markdown' }, async (uri) => ({ contents: [{ uri: uri.href, text: REFERENCE }] }));

  server.registerPrompt('projetar-peca', {
    title: 'Projetar uma peça',
    description: 'Fluxo guiado: requisitos → parâmetros → modelo → verificação visual → análise → exportação',
    argsSchema: { descricao: z.string().describe('O que deve ser projetado') },
  }, ({ descricao }) => ({
    messages: [{
      role: 'user',
      content: { type: 'text', text: `Projete no Projetista: ${descricao}\n\n1. Leia feature_reference.\n2. Liste requisitos e premissas (dimensões, material, processo de fabricação).\n3. Defina parâmetros nomeados.\n4. Modele com add_features em poucas chamadas.\n5. Use render_view (sheet:true) e corrija o que estiver errado.\n6. Rode analyze (mass, interference, print se for impresso).\n7. Salve uma versão e ofereça exportar STL/3MF e o desenho técnico.` },
    }],
  }));

  return server;
}

export async function main() {
  // O MCP fala com um "alvo": o próprio kernel (sem app aberto) ou o app desktop (ponte).
  // Quando o app abre, ele assume o kernel (handover) e o MCP passa a ser ponte; se o app
  // fechar, o MCP volta a ter kernel próprio com o documento salvo pelo app.
  let target = null;
  let switching = null;
  let local = null;
  const proxy = { run: async (cmd, args, source) => { if (switching) await switching; return target.run(cmd, args, source); } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const bridgeTo = async (info) => {
    const rs = await RemoteStudio.connect(info.url);
    rs.ws.on('close', () => { if (target === rs) switching = startLocal(info.workspace).finally(() => { switching = null; }); });
    target = rs;
    console.error(`[projetista] conectado ao app em ${info.url} (modo ponte)`);
    return info.url;
  };
  const startLocal = async (appWorkspace) => {
    if (!local) local = await Studio.create();
    if (appWorkspace) {
      // o app fechou: retoma o documento que ele salvou automaticamente
      try { local.doc.load(JSON.parse(fs.readFileSync(path.join(appWorkspace, 'autosave.projetista.json'), 'utf8'))); } catch { /* sem salvamento */ }
    }
    target = local;
    if (!process.env.PROJETISTA_NO_UI) {
      await startHub(local, {
        quiet: false, owner: 'mcp',
        onHandover: () => {
          switching = (async () => {
            console.error('[projetista] o app desktop assumiu o kernel; passando para modo ponte');
            for (let i = 0; i < 200; i++) {
              const app = await findRunningApp();
              if (app?.owner === 'app') { await bridgeTo(app); return; }
              await sleep(150);
            }
            console.error('[projetista] o app não respondeu; mantendo o kernel próprio');
            await startLocal();
          })().finally(() => { switching = null; });
        },
      });
    }
    return `http://localhost:${Number(process.env.PROJETISTA_PORT) || 7777}`;
  };

  const running = await findRunningApp();
  const url = running ? await bridgeTo(running) : await startLocal();
  const server = await createMcpServer(proxy, url);
  await server.connect(new StdioServerTransport());
  console.error('[projetista] servidor MCP pronto (stdio)');
}
