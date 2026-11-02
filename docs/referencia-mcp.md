<!-- Gerado automaticamente por `npm run docs` a partir de src/mcp/server.js (lista obtida do servidor em execução). Não edite à mão. -->

# Referência do servidor MCP

Servidor `projetista` versão 1.0.0. Transporte: stdio. 19 ferramentas, 1 prompt(s), 1 recurso(s).

Como configurar o Claude: veja [manual-do-usuario.md](manual-do-usuario.md#13-claude-e-o-servidor-mcp).

## Índice

- [`feature_reference`](#feature_reference) · somente leitura
- [`get_state`](#get_state) · somente leitura
- [`set_parameters`](#set_parameters)
- [`add_features`](#add_features)
- [`update_feature`](#update_feature)
- [`edit_timeline`](#edit_timeline)
- [`render_view`](#render_view) · somente leitura
- [`analyze`](#analyze) · somente leitura
- [`parameter_study`](#parameter_study) · somente leitura
- [`optimize`](#optimize) · somente leitura
- [`measure`](#measure) · somente leitura
- [`system_resources`](#system_resources) · somente leitura
- [`run_script`](#run_script)
- [`history`](#history)
- [`document`](#document)
- [`export_model`](#export_model)
- [`technical_drawing`](#technical_drawing)
- [`catalog`](#catalog) · somente leitura
- [`open_viewer`](#open_viewer) · somente leitura

## feature_reference

Manual completo de modelagem: tipos de feature, parâmetros, esboços e restrições, seleção de faces. Leia antes de modelar.

_Somente leitura: não altera o documento._

Sem parâmetros.

## get_state

Estado do documento: parâmetros (valores avaliados), linha do tempo com status de cada feature (ok/erro), corpos com volume e caixa delimitadora.

_Somente leitura: não altera o documento._

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `verbose` | sim/não | não | Inclui a definição completa de cada feature |

## set_parameters

Cria/atualiza parâmetros do usuário (valores ou expressões, ex.: {"L": 80, "W": "L/2", "folga": "0.2mm"}). Tudo que depende deles regenera.

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `parameters` | mapa de number,string | sim |  |

## add_features

Adiciona uma ou mais features à linha do tempo (operação única desfazível). Veja feature_reference para tipos e campos. Ex.: [{"type":"sketch","name":"S1","plane":"XY","shapes":[{"type":"rect","center":[0,0],"width":"L","height":"W"}]},{"type":"extrude","sketch":"S1","distance":10,"body":"Base"}]

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `features` | lista de mapa de qualquer (mín. 1) | sim |  |

## update_feature

Altera campos de uma feature existente (patch parcial; null remove o campo). Ex.: {"name":"Extrusão1","patch":{"distance":"H*2"}}

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `name` | texto | sim |  |
| `patch` | mapa de qualquer | sim |  |

## edit_timeline

Gerencia a linha do tempo: delete, suppress, unsuppress, move (para index), rollback (marcador em index; null = fim).

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `action` | `delete` \| `suppress` \| `unsuppress` \| `move` \| `rollback` | sim |  |
| `name` | texto | não |  |
| `index` | inteiro (≥ -9007199254740991, ≤ 9007199254740991) \| null | não |  |

## render_view

Renderiza o modelo e devolve uma IMAGEM para você inspecionar. Use após cada mudança relevante. sheet:true = folha com 4 vistas (iso, frente, topo, direita). Vermelho = interior exposto por corte.

_Somente leitura: não altera o documento._

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `view` | `iso` \| `front` \| `back` \| `top` \| `bottom` \| `left` \| `right` \| `iso-back` \| `iso-below` \| objeto { azimuth, elevation } | não |  |
| `sheet` | sim/não | não |  |
| `width` | inteiro (≥ 100, ≤ 1600) | não |  |
| `height` | inteiro (≥ 100, ≤ 1200) | não |  |
| `bodies` | lista de texto | não | Só estes corpos |
| `highlight` | texto | não | Destaca um corpo e esmaece os demais |
| `section` | objeto { normal, offset } | não | Corte: remove o que está além do plano normal·p > offset |
| `showSketches` | sim/não | não |  |
| `engine` | `auto` \| `software` | não | auto = GPU do app desktop quando aberto; software = CPU |

## analyze

Análises de engenharia sobre a geometria EXATA (B-rep). kind: mass (massa, volume, CG, tensor e momentos principais de inércia, custo), interference (colisões entre corpos), clearance (folga mínima a-b), section (área/contornos num plano), print (checagem de impressão 3D: balanços, paredes finas, tempo), bom (lista de materiais), faces (todas as faces com tipo/normal/raio/área, p/ seleção), edges (arestas com tipo/comprimento/raio, p/ filete e chanfro), sketch (DOF/estado de um esboço), dependencies (quais features dependem de cada parâmetro).

_Somente leitura: não altera o documento._

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `kind` | `mass` \| `interference` \| `clearance` \| `section` \| `print` \| `bom` \| `faces` \| `edges` \| `sketch` \| `dependencies` | sim |  |
| `body` | texto | não |  |
| `a` | texto | não |  |
| `b` | texto | não |  |
| `name` | texto | não |  |
| `normal` | lista de número (mín. 3) (máx. 3) | não |  |
| `offset` | número | não |  |
| `overhangAngle` | número | não |  |
| `minWall` | número | não |  |
| `search` | número | não |  |

## parameter_study

Estudo paramétrico EM PARALELO (um worker por núcleo da CPU): avalia o modelo para vários valores de um parâmetro e devolve massa, volume, dimensões e erros de cada variante. O documento atual não é alterado.

_Somente leitura: não altera o documento._

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `parameter` | texto | sim |  |
| `values` | lista de number,string (mín. 1) (máx. 500) | sim |  |
| `checkInterference` | sim/não | não |  |

## optimize

Otimização paramétrica paralela (busca em grade/aleatória + refinamento local, usando todos os núcleos). objective é uma expressão sobre mass, volume, area, sx, sy, sz e parâmetros; constraints são expressões booleanas (ex.: "sz <= 50", "esp >= 2"). Devolve os melhores valores — aplique com set_parameters.

_Somente leitura: não altera o documento._

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `variables` | mapa de objeto { min, max, steps } | sim |  |
| `objective` | texto | não |  |
| `minimize` | sim/não | não |  |
| `constraints` | lista de texto | não |  |
| `maxEvaluations` | inteiro (≥ 4, ≤ 2000) | não |  |

## measure

Medição EXATA no B-rep. Sem b: propriedades de uma face (tipo, área, normal, raio, eixo, centróide). Com b: distância mínima entre duas faces, ângulo, distância entre planos paralelos e entre eixos de cilindros. Índices de face vêm de analyze kind="faces".

_Somente leitura: não altera o documento._

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `a` | objeto { body, face } | sim |  |
| `b` | objeto { body, face } | não |  |

## system_resources

Uso de CPU por núcleo, RAM, workers do kernel e GPU/VRAM da máquina.

_Somente leitura: não altera o documento._

Sem parâmetros.

## run_script

Executa JavaScript de modelagem (laços, matemática, lógica) com a API `cad`: cad.<tipo>({...}) adiciona uma feature (ex.: cad.box, cad.sketch, cad.extrude, cad.hole), cad.param(nome, expr), cad.update(nome, patch), console.log(). Tudo vira UMA operação desfazível. Ideal para padrões complexos e geração procedural.

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `code` | texto | sim |  |
| `timeoutMs` | inteiro (≥ -9007199254740991, ≤ 30000) | não |  |

## history

Desfazer/refazer e versões nomeadas (como o histórico de versões do Fusion).

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `action` | `undo` \| `redo` \| `save_version` \| `restore_version` | sim |  |
| `label` | texto | não |  |
| `id` | inteiro (≥ -9007199254740991, ≤ 9007199254740991) | não |  |

## document

Gerencia o documento/arquivos: new, save, open, list (arquivos no workspace), rename, resolution (segmentos de círculo 8–256), material (material padrão), configuration (salva conjunto de valores de parâmetros, ex. tamanhos P/M/G), activate (ativa configuração; sem name = padrão).

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `action` | `new` \| `save` \| `open` \| `list` \| `rename` \| `resolution` \| `material` \| `configuration` \| `activate` | sim |  |
| `name` | texto | não |  |
| `file` | texto | não |  |
| `segments` | inteiro (≥ -9007199254740991, ≤ 9007199254740991) | não |  |
| `material` | texto | não |  |
| `values` | mapa de number,string | não |  |

## export_model

Exporta corpos: step (B-rep exato — para usinagem/CAM e outros CADs: SolidWorks, Fusion, Inventor, FreeCAD), stl / 3mf (impressão 3D), obj, glb (web/AR). quality controla a tesselagem das malhas (draft 0.1 mm, normal 0.02, fine 0.005, ultra 0.001 mm de erro cordal).

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `format` | `step` \| `stl` \| `3mf` \| `obj` \| `glb` | sim |  |
| `bodies` | lista de texto | não |  |
| `file` | texto | não |  |
| `quality` | `draft` \| `normal` \| `fine` \| `ultra` | não |  |

## technical_drawing

Gera desenho técnico SVG por remoção EXATA de linhas ocultas (HLR): vistas frontal/superior/lateral, linhas ocultas tracejadas, cotas gerais, chamadas de furos (n× Ø), isométrica, carimbo e símbolo de diedro. 1º diedro (ABNT) por padrão.

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `bodies` | lista de texto | não |  |
| `projection` | `first` \| `third` | não |  |
| `hiddenLines` | sim/não | não |  |
| `sheet` | `A3` \| `A4` | não |  |
| `title` | texto | não |  |
| `file` | texto | não |  |

## catalog

Lista tipos de feature, materiais (densidade/preço) e roscas ISO disponíveis.

_Somente leitura: não altera o documento._

Sem parâmetros.

## open_viewer

Retorna o endereço da interface web 3D ao vivo para o usuário abrir no navegador.

_Somente leitura: não altera o documento._

Sem parâmetros.

## Prompts

### projetar-peca

Fluxo guiado: requisitos → parâmetros → modelo → verificação visual → análise → exportação

Argumentos: `descricao` (obrigatório) — O que deve ser projetado

## Recursos

| URI | Nome | Tipo |
|---|---|---|
| `projetista://referencia` | Referência de modelagem | text/markdown |

