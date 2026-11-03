# ◆ Projetista 1.0

**CAD paramétrico para Windows com kernel B-rep exato (OpenCascade), aceleração por GPU,
processamento paralelo em todos os núcleos e servidor MCP nativo para o Claude.**

O Projetista junta o fluxo dos CADs profissionais: linha do tempo paramétrica (Fusion 360),
esboços com restrições (FreeCAD Sketcher), assistente de furos e tabelas de configuração
(SolidWorks/Inventor), empurrar/puxar (SketchUp) e desenho técnico (TechDraw/Inventor Drawing).
Por cima disso, o **Claude modela, enxerga e valida** a peça pelo MCP, e você acompanha cada passo
ao vivo na janela do app.

📖 **Documentação completa:** [docs/](docs/README.md) — manual do usuário, referência MCP, arquitetura e guia de desenvolvimento.

## Instalação

Rode `dist\Projetista-Setup-1.0.0.exe` (instalador NSIS, ~137 MB). Ele cria atalhos no Menu
Iniciar e na Área de Trabalho e associa arquivos `.projetista`. Os projetos ficam em
`Documentos\Projetista`.

> O instalador não tem assinatura digital, então o Windows SmartScreen pode avisar
> "aplicativo não reconhecido". Clique em **Mais informações → Executar assim mesmo**.

Para gerar o instalador de novo:

```bash
npm install
npm run dist
```

Para desenvolver sem instalar:

```bash
npm run desktop      # app desktop (Electron)
npm start            # só o backend + interface em http://localhost:7777
```

## Conectar o Claude

No app, **Ajuda → Conectar o Claude (MCP)** mostra a configuração pronta com os caminhos da sua
instalação. Com o app instalado no local padrão, fica assim:

**Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "projetista": {
      "command": "C:/Users/<você>/AppData/Local/Programs/Projetista/Projetista.exe",
      "args": ["C:/Users/<você>/AppData/Local/Programs/Projetista/resources/app/src/cli.js", "mcp"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

**Claude Code**: dentro desta pasta o `.mcp.json` já registra o servidor de desenvolvimento.

Como funciona:

- **Com o app aberto**, o MCP vira uma *ponte*: o Claude trabalha no documento que está na sua
  tela, e as imagens que ele pede são renderizadas pela sua GPU.
- **Com o app fechado**, o MCP sobe o kernel sozinho e renderiza por software. Se você abrir o app
  depois, ele se conecta à mesma sessão.

## Precisão

| Item | Como é calculado |
|---|---|
| Geometria | B-rep exato do OpenCascade em dupla precisão: planos, cilindros, cones, esferas, toros, NURBS. Tolerância 1e-7 mm |
| Volume, área, CG, inércia | Integração de Gauss sobre as superfícies exatas (tolerância 1e-9) |
| Distâncias e medições | Extremos exatos entre faces e arestas (BRepExtrema) |
| Seção transversal | Corte booleano real por meio-espaço |
| Desenho técnico | Remoção exata de linhas ocultas (HLR) sobre as curvas do B-rep |
| Exportação STEP | B-rep exato, abre em SolidWorks, Fusion, Inventor, FreeCAD e softwares de CAM |
| Malhas (STL/3MF) | Erro cordal configurável: 0,1 / 0,02 / 0,005 / 0,001 mm |

Verificações automáticas nos testes (`npm test`): volume de placa furada, placa com filetes R5,
peça de revolução e casca batem com a fórmula analítica com erro relativo ≤ 1e-9. O cone confere
em todas as casas decimais e a esfera tem erro de 2e-12 mm³.

## Uso da máquina

| Recurso | Como o Projetista usa |
|---|---|
| **CPU** | O kernel principal usa a build multithread do OpenCascade (pthreads): a tesselagem roda em paralelo (medido ~2× mais rápida que com 1 thread). Booleanas são chamadas com `SetRunParallel`. Estudos paramétricos e otimização usam um **pool de workers**, um kernel por núcleo (núcleos − 2) |
| **RAM** | O heap do backend é ¼ da RAM (até 16 GB). Cada worker recebe uma cota proporcional, até 4 GB (limite do WASM 32 bits). Workers ociosos são encerrados após 60 s e a memória volta ao sistema |
| **GPU / VRAM** | O Electron força a GPU dedicada (`force_high_performance_gpu`, `ignore-gpu-blocklist`, rasterização por GPU). A viewport WebGL usa materiais PBR, mapa de ambiente e depth buffer logarítmico. Análises em shader: **zebra** (continuidade), **ângulo de saída** e **curvatura**. Os renders pedidos pelo Claude também saem da GPU |
| **Monitor** | A aba *Sistema* mostra carga por núcleo, RAM, workers e GPU/VRAM/temperatura (via `nvidia-smi`) |

Medido nesta máquina (Ryzen 9 5900XT, 32 threads, 64 GB, RTX 3060 12 GB): 30 variantes de uma peça
regeneradas em 2,5 s com 30 workers, contra 30,8 s em série (~12×). Otimização de 2 variáveis com
52 avaliações em ~1 s.

## Interface (no estilo do Autodesk Inventor)

O layout segue as convenções do Inventor. Ícones, cores e marca são próprios; nada da arte da Autodesk
foi copiado.

| Elemento | Como funciona |
|---|---|
| **Barra de título + acesso rápido** | Novo, Abrir, Salvar, **Exportar (Ctrl+E)**, Desfazer/Refazer com o nome da ação, Reconstruir, material e cor do corpo selecionado e busca de comandos (Ctrl+F). No app desktop fica dentro da própria barra da janela |
| **Faixa de opções** | Abas por tarefa — Modelo 3D, Inspecionar, **Exportar**, Gerenciar, Vista e Claude — com botões grandes e pequenos e dicas que explicam cada comando. Duplo clique numa aba recolhe a faixa. A aba contextual **Esboço** aparece durante a edição |
| **Arquivo (backstage)** | Novo, Abrir, Salvar, Salvar como, Importar, Exportar, Desenho técnico, iPropriedades, Opções e documentos recentes |
| **Navegador do modelo** | Corpos sólidos (mostrar/ocultar, material, renomear), Origem (planos e eixos), recursos com esboços aninhados sob quem os usa, erros em vermelho e **Fim da peça** arrastável para retroceder a linha do tempo. Duplo clique edita; botão direito abre o menu de contexto |
| **Painel de propriedades** | Flutua sobre a vista, com seções recolhíveis (Entrada geométrica, Comportamento, Saída, Configurações avançadas). A pré-visualização é ao vivo e tem OK, Cancelar e **+** (aplicar e continuar). Cancelar desfaz tudo; OK vira uma única entrada no histórico |
| **Seleção na tela** | Pré-destaque de faces e arestas sob o cursor. Clique numa face para ver tipo, área, raio e normal exatos |
| **Ambiente de Esboço 2D** | Escolha um plano de origem ou uma face plana e a câmera se alinha ao plano. Ferramentas: linha (em cadeia), círculo, arco por 3 pontos, retângulo (2 pontos ou pelo centro), polígono, rasgo e ponto. Ajuste à grade e aos pontos, com restrição horizontal/vertical automática. **Cota** com edição em linha (aceita expressões como `L/2`). 11 restrições geométricas. Pontos arrastáveis e indicação de graus de liberdade. Restrições que sobre-restringem o esboço são recusadas |
| **Menu radial (botão direito)** | Repetir último comando, Iniciar esboço, Extrusão, Furo, Vista inicial, Medir, Filete, Desfazer. Muda dentro do esboço e durante um comando |
| **Cubo de navegação** | Clique em face, aresta ou canto para orientar a vista, com botão de vista inicial. Barra de navegação: zoom tudo, pan, zoom, órbita, olhar para e vista anterior |
| **Diálogos** | Parâmetros (fx) com parâmetros do usuário e do modelo, iPropriedades físicas, Desenho técnico com visualizador, Interferência, Lista de materiais, Impressão 3D, Estudo paramétrico, Otimização, Macros, Configurações (tabela tipo iPart), Versões, Recursos do sistema e Opções (tema claro/escuro, qualidade, grade) |
| **Aba Início** | Nova peça, abrir, importar STEP, exemplos prontos (suporte NEMA 17, flange DN50, caixa com tampa) e recentes |

**Atalhos:** S esboço · E extrusão · R revolução · H furo · F filete · Q pressionar/puxar · M medir ·
J junta · no esboço: L linha, C círculo, A arco, T retângulo, D cota, Delete excluir, Ctrl+Enter concluir ·
F2 pan · F3 zoom · F4 órbita · F5 vista anterior · F6 vista inicial · Home zoom tudo · Esc cancela ·
Enter confirma · Ctrl+Z/Y · Ctrl+Shift+P parâmetros · F12 ferramentas de desenvolvedor (app desktop).

## Ferramentas MCP

| Ferramenta | Para quê |
|---|---|
| `feature_reference` | Manual de modelagem (o Claude lê antes de começar) |
| `set_parameters` | Parâmetros com expressões e unidades (`"L/2 + 3"`, `"1in"`) |
| `add_features` / `update_feature` / `edit_timeline` | Linha do tempo: adicionar, editar, suprimir, reordenar, rollback |
| `render_view` | **Visão**: PNG pela GPU do app (ou CPU): vista única, folha 4 vistas, corte, destaque |
| `analyze` | Massa, CG, tensor e momentos principais de inércia, custo, interferências, folga, seção, impressão 3D, BOM, faces, arestas, DOF de esboço, dependências |
| `measure` | Medição exata de face ou entre faces: distância, ângulo, distância entre planos e entre eixos |
| `parameter_study` | Varredura de um parâmetro em paralelo |
| `optimize` | Otimização paralela com objetivo e restrições (ex.: minimizar massa com `sz <= 50`) |
| `run_script` | Modelagem por código JS como uma única operação desfazível |
| `history` / `document` | Desfazer/refazer, versões, configurações (P/M/G), arquivos |
| `export_model` | STEP (exato), STL, 3MF, OBJ, GLB, com qualidade de tesselagem |
| `technical_drawing` | Desenho SVG A3/A4 com HLR, cotas, chamadas de furos (n× Ø), carimbo, 1º/3º diedro |
| `system_resources` | CPU, RAM, workers, GPU/VRAM |

## Recursos de modelagem

| Recurso | Inspirado em |
|---|---|
| Linha do tempo com rollback, supressão e **regeneração incremental** (só a partir da feature alterada) | Fusion 360, SolidWorks |
| Parâmetros com expressões, configurações nomeadas | Fusion, SolidWorks Design Tables, Inventor iParts |
| Esboço com solver de restrições (17 tipos, DOF, redundância), arcos e círculos exatos | FreeCAD Sketcher, Fusion |
| Extrusão (simétrica, dois lados, **ângulo de saída exato**, torção, parede fina, cantos arredondados) | Fusion, Inventor |
| Revolução, **loft real** (perfis côncavos inclusive), **varredura** com dobras, tubos com raio de curvatura | Fusion, Inventor Tube & Pipe |
| **Filete e chanfro por aresta** com seletores por intenção | todos |
| Casca, offset 3D, **ângulo de saída em faces** (moldes), empurrar/puxar exato | Fusion, SolidWorks, SketchUp |
| Assistente de furos ISO M2–M24 (passante, cego com ponta 118°, rebaixo ISO 4762, escareado) | SolidWorks Hole Wizard |
| Booleanas, mover/girar, espelhar, padrões, dividir por plano | todos |
| Junta face-com-face com folga e ângulo | Inventor, SolidWorks, Fusion |
| Importar STEP e STL/OBJ (convertido em B-rep) | todos |
| Materiais com densidade e preço, BOM com custo | Inventor iProperties |
| Checagem de impressão 3D (balanços, paredes finas por offset exato, tempo, filamento) | Fusion 3D Print |

**Seleção por intenção.** Faces e arestas são escolhidas pelo que significam, não por um número
interno. Por exemplo, `{normal:"+z", pick:"max"}` é a face de cima e `{type:"line", parallel:"z"}`
são as arestas verticais. A referência continua válida quando o modelo é editado, o que evita o
"problema de nomeação topológica" do Fusion e do FreeCAD.

## Arquitetura

```
electron/   main.cjs (janela, GPU, menus, backend com heap ∝ RAM) · preload.cjs · splash.html
src/
  occ/      occ.js (kernel exato OpenCascade WASM) · body.js (sólido + tesselagem) · select.js (seletores)
  core/     expr.js · sketch.js (solver LM) · features.js (31 features) · document.js (linha do tempo,
            cache incremental, undo, versões) · analysis.js · io.js · materials.js · kernel.js (vetores)
  parallel/ pool.js (workers por núcleo) · worker.js · resources.js (CPU/RAM/GPU)
  render/   raster.js (render por software) · drawing.js (desenho técnico HLR)
  server/   hub.js (HTTP + WebSocket, cena ao vivo, render GPU sob demanda)
  mcp/      server.js · bridge.js (ponte para o app aberto) · reference.js
web/        index.html · css/app.css · js/ (main, ribbon, browser, panel, commands, sketcher, viewport, dialogs, icons…)
```

## Sobre a engenharia reversa

O REA foi usado para inventariar as instalações do Fusion 360 e do FreeCAD 1.0, sem descompilar
nada. No Fusion: kernel ASM/ShapeManager, T-Splines, CAM, simulação, desenho, MaterialX e chapas.
No FreeCAD: Part, PartDesign, Sketcher, TechDraw, Assembly e FEM. Esse mapa definiu quais recursos
reproduzir. O código do Projetista é original. O Fusion não foi descompilado (a licença da Autodesk
proíbe), e o OpenCascade é uma biblioteca LGPL usada como dependência.

## Limitações

- O kernel roda em WebAssembly, que é mais lento que o OpenCascade nativo. Estudos e otimizações
  compensam isso distribuindo o trabalho pelo pool de workers.
- Booleanas grandes não escalam com threads dentro de um único kernel. Só a tesselagem escala.
- Escala não uniforme não é suportada no B-rep exato.
- Sem simulação por elementos finitos e sem CAM.
- Sem exportação IGES (o build do OpenCascade não inclui).
- Casca sobre faces que já têm filetes e furos pode falhar. Nesse caso, aplique a casca antes dos
  filetes.
- Instalador sem assinatura de código.

## Testes

```bash
npm test                                          # núcleo (verificações analíticas) + kernel exato + API da interface
node tests/ui-api.mjs                             # transações, edição de esboço, renomear
node tests/pool-test.mjs                          # pool paralelo e otimização
node tests/mcp-e2e.mjs                            # MCP ponta a ponta (imagens em tests/out/)
node tests/mcp-exe.mjs dist/win-unpacked/Projetista.exe   # MCP pelo executável empacotado
```
