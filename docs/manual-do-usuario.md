# Manual do usuário — Projetista 1.0

## Sumário

1. [Instalação e primeiro uso](#1-instalação-e-primeiro-uso)
2. [A tela](#2-a-tela)
3. [Navegação 3D](#3-navegação-3d)
4. [Primeira peça, passo a passo](#4-primeira-peça-passo-a-passo)
5. [Esboço 2D](#5-esboço-2d)
6. [Recursos 3D](#6-recursos-3d)
7. [Linha do tempo e edição](#7-linha-do-tempo-e-edição)
8. [Parâmetros, configurações e versões](#8-parâmetros-configurações-e-versões)
9. [Inspeção e análise](#9-inspeção-e-análise)
10. [Desenho técnico](#10-desenho-técnico)
11. [Importar e exportar](#11-importar-e-exportar)
12. [Estudos, otimização e macros](#12-estudos-otimização-e-macros)
13. [Claude e o servidor MCP](#13-claude-e-o-servidor-mcp)
14. [Recursos da máquina e opções](#14-recursos-da-máquina-e-opções)
15. [Atalhos de teclado](#15-atalhos-de-teclado)
16. [Solução de problemas](#16-solução-de-problemas)

---

## 1. Instalação e primeiro uso

1. Execute `Projetista-Setup-1.0.0.exe`. O instalador é por usuário: não pede administrador e instala em
   `%LOCALAPPDATA%\Programs\Projetista`. Você pode escolher outra pasta.
2. O instalador não tem assinatura digital, então o Windows SmartScreen pode mostrar "O Windows protegeu o
   computador". Clique em **Mais informações → Executar assim mesmo**.
3. Abra pelo atalho **Projetista** (Área de Trabalho ou Menu Iniciar). Arquivos `.projetista` abrem direto
   no app com duplo clique.

**Onde ficam os arquivos**

| O quê | Onde |
|---|---|
| Projetos, exportações e desenhos | `Documentos\Projetista` |
| Salvamento automático do documento aberto | `Documentos\Projetista\autosave.projetista.json` |
| Arquivos importados pelo navegador | `Documentos\Projetista\importados` |
| Registro do kernel (para diagnóstico) | `Documentos\Projetista\projetista.log` |

O documento é salvo automaticamente a cada alteração. Ao reabrir o app, você continua de onde parou.

## 2. A tela

```
┌ Barra de título: [◆] Novo Abrir Salvar Exportar │ ↶ ↷ │ ⟳ │ Material  Cor     Nome do documento   [Pesquisar comandos] ┐
├ Abas: [Arquivo] Modelo 3D  Inspecionar  Exportar  Gerenciar  Vista  Claude ✦   (Esboço aparece ao editar um esboço)     ┤
├ Faixa de opções: painéis por tarefa (Esboço · Criar · Modificar · Corpos · Primitivas · Montagem · Medir)               ┤
├──────────────┬────────────── [ ● instrução do comando atual · Esc cancela ] ─────────────────────────── [cubo]     ┤
│ Navegador    │  Janela gráfica                                                                         [barra de ┤
│ do modelo    │  (painel de propriedades flutua aqui durante um comando)                                navegação]┤
│              │                                                                                                    │
│ Fim da peça  │  [tríade XYZ]                                                                                       │
├──────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [⌂ Início] [Documento]                                                                                               │
│ Barra de status: instruções do comando atual            corpos · recursos · erros · tempo de regeneração · GPU      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Barra de título e acesso rápido.** Comandos frequentes. A lista **Material** muda o material do corpo
  selecionado ou, sem seleção, o padrão do documento. O campo de cor muda a aparência do corpo selecionado.
  **Pesquisar comandos** (Ctrl+F) encontra qualquer comando pelo nome.
- **Faixa de opções.** As abas seguem as etapas do trabalho: **Modelo 3D** (criar e modificar),
  **Inspecionar** (medir e verificar), **Exportar** (arquivos, desenho e importação), **Gerenciar**
  (parâmetros, versões, estudos), **Vista** e **Claude**. Pare o mouse sobre um botão por meio segundo para
  ver o que ele faz e o atalho. Duplo clique numa aba recolhe ou expande a faixa. A aba **Arquivo** abre o
  menu de arquivo em tela cheia, com documentos recentes.
- **Instrução do comando.** Enquanto um comando ou esboço está ativo, um aviso no topo da área 3D diz o que
  fazer em seguida (por exemplo, "Selecione as arestas") e o que a tecla Esc faz.
- **Documento vazio.** Um cartão "Comece seu modelo" oferece os pontos de partida: desenhar um esboço, criar
  uma caixa, importar STEP ou abrir um exemplo.
- **Navegador do modelo.** Árvore do documento: corpos sólidos, origem (planos e eixos), recursos na ordem da
  linha do tempo e o marcador **Fim da peça**.
- **Janela gráfica.** Modelo 3D, cubo de navegação (canto superior direito), barra de navegação (abaixo do
  cubo) e tríade de eixos (canto inferior esquerdo: X vermelho, Y verde, Z azul).
- **Abas de documento.** **Início** mostra a página inicial, com nova peça, exemplos e recentes.
- **Barra de status.** À esquerda, a instrução do comando atual. À direita, o resumo do modelo e a GPU em uso.

## 3. Navegação 3D

| Ação | Mouse / teclado |
|---|---|
| Girar (órbita) | Arrastar com o botão esquerdo · F4 |
| Deslocar (pan) | Arrastar com o botão do meio · F2 alterna |
| Zoom | Roda do mouse, centrada no cursor · F3 alterna |
| Menu radial | Botão direito |
| Zoom tudo | Home · botão ⤢ da barra de navegação |
| Vista inicial (isométrica) | F6 · botão ⌂ ao lado do cubo |
| Vista anterior | F5 |
| Orientar por uma face | **Olhar para** na barra de navegação, depois clique na face |
| Orientação padrão | Clique numa face, aresta ou canto do **cubo de navegação** |
| Perspectiva / ortográfica | Aba **Vista** › Navegar |

## 4. Primeira peça, passo a passo

Exemplo: uma placa de 80 × 40 × 10 mm com quatro furos M5 escareados e cantos arredondados.

1. **Parâmetros.** Abra **Gerenciar › Parâmetros** (Ctrl+Shift+P) e crie `L = 80`, `W = L/2` e `esp = 10`.
2. **Esboço.** Clique em **Iniciar esboço 2D** (S) e escolha o plano **XY**.
3. **Retângulo.** Use a ferramenta **Retângulo** (T): clique num canto e depois no canto oposto.
4. **Cotas.** Ative **Cota** (D), clique na aresta horizontal e digite `L`. Clique na aresta vertical e
   digite `W`.
5. **Posição.** Com a cota ainda ativa, clique no canto inferior esquerdo do retângulo e depois no ponto
   amarelo de origem. Digite `0` nas cotas criadas, ou use a restrição **Coincidente**. O status mostra
   **Esboço totalmente restrito**.
6. **Concluir.** Clique em **Concluir esboço** (Ctrl+Enter).
7. **Extrusão.** Clique em **Extrusão** (E). O perfil já vem selecionado. Em **Distância A**, digite `esp`
   e clique em **OK**.
8. **Furos.** Clique em **Furo** (H) e depois quatro vezes na face superior. Ajuste as coordenadas exatas
   em **Centros**. Em **Tipo**, escolha **Escareado**; em **Rosca ISO**, **M5**. Clique em **OK**.
9. **Arredondar.** Clique em **Filete** (F), clique nas quatro arestas verticais, defina o raio `4` e clique
   em **OK**.
10. **Conferir.** Use **Inspecionar › Propriedades físicas** para massa e centro de gravidade, e **Medir**
    (M) para distâncias exatas.
11. **Desenho e exportação.** Use **Anotar › Desenho técnico**, e depois **Arquivo › Exportar STEP** ou
    **STL**.

Mudou de ideia? Altere `L` no diálogo de Parâmetros: tudo regenera, incluindo o desenho e a massa.

## 5. Esboço 2D

### Criar e editar

- **Iniciar esboço 2D** (S): clique num **plano de origem** (XY, XZ, YZ) ou numa **face plana** de um corpo.
  A câmera se alinha ao plano, a grade aparece e a aba **Esboço** fica ativa.
- **Editar esboço**: duplo clique no esboço no navegador do modelo. Esboços usados por um recurso ficam
  aninhados sob ele.
- **Concluir esboço** (Ctrl+Enter ou Esc) salva. **Cancelar esboço** descarta tudo o que foi feito na sessão.

### Ferramentas de desenho

| Ferramenta | Como usar |
|---|---|
| **Linha** (L) | Clique em pontos sucessivos (cadeia). Clicar num ponto existente fecha o contorno. Esc ou botão direito termina a cadeia |
| **Círculo** (C) | Centro, depois um ponto do raio |
| **Arco** (A) | Início, fim e um ponto por onde o arco passa |
| **Retângulo** (T) | Dois cantos opostos (cria horizontais e verticais automaticamente) |
| **Retângulo pelo centro** | Centro, depois um canto |
| **Polígono** | Pergunta o número de lados; depois centro e um vértice (lados iguais, inscrito em círculo de construção) |
| **Rasgo** | Centro 1, centro 2 e a largura (arcos tangentes às retas) |
| **Ponto** | Ponto solto (referência para cotas e furos) |
| **Construção** | Alterna geometria de construção (tracejada, não forma perfil). Também converte a seleção |
| **Excluir** (Delete) | Exclui a geometria selecionada, as restrições ligadas a ela e os pontos órfãos |

**Ajustes automáticos.** O cursor encaixa em pontos existentes (marcador laranja) e na grade (Opções ›
Ajustar à grade). Ao desenhar linhas quase horizontais ou verticais, a restrição correspondente é aplicada
sozinha e aparece o símbolo **H** ou **V**.

**Seleção e arraste.** Clique numa geometria para selecioná-la (Ctrl ou Shift adiciona). Arraste um ponto
para ver o que ainda está livre: o solver recalcula ao soltar.

### Cotas

Ative **Cota** (D) e clique:

| Clique em… | Cria |
|---|---|
| uma linha, depois em área vazia | comprimento |
| duas linhas | ângulo |
| dois pontos | distância horizontal, vertical ou alinhada (conforme a direção) |
| um círculo | diâmetro (Ø) |
| um arco | raio (R) |

Depois de criar a cota, digite o valor na caixa e pressione Enter. Aceita números (`25`, `2,5`) e
**expressões com parâmetros** (`L/2`, `esp*3`, `sqrt(A^2+B^2)`). Para mudar depois, dê duplo clique no rótulo
da cota.

### Restrições geométricas

| Restrição | Seleção |
|---|---|
| Coincidente | ponto + ponto, ponto + linha ou ponto + círculo |
| Horizontal / Vertical | linha, ou dois pontos |
| Paralela / Perpendicular | duas linhas |
| Tangente | linha + círculo/arco |
| Igual | duas linhas (comprimento) ou dois círculos/arcos (raio) |
| Fixa | ponto, linha ou centro de círculo |
| Concêntrica | dois círculos/arcos |
| Simétrica | dois pontos + linha de simetria |
| Ponto médio | ponto + linha |

O status mostra os **graus de liberdade**. Com zero, o esboço está **totalmente restrito** (geometria azul
escura). Com mais, a geometria fica laranja. Se uma restrição entrar em conflito com as existentes, ela é
recusada e o aviso "sobre-restringe o esboço" aparece. Clique num símbolo de restrição para selecioná-lo e
pressione Delete para removê-lo. **Mostrar restrições** liga e desliga os símbolos.

Contornos fechados viram perfis. Contornos dentro de outros viram furos, pela regra par/ímpar.

## 6. Recursos 3D

Todo comando abre o **painel de propriedades**, que mostra o resultado ao vivo enquanto você edita.

- **OK** ou Enter confirma o comando, que vira uma única entrada no histórico de desfazer.
- **Cancelar** ou Esc volta o modelo exatamente como estava.
- **+** confirma e já inicia o mesmo comando de novo.
- Campos numéricos aceitam expressões com parâmetros.

Em **Saída**: **Unir**, **Recortar**, **Interseção** (com o corpo alvo) ou **Novo sólido** (com nome e
material).

| Comando | O que faz | Principais opções |
|---|---|---|
| **Extrusão** (E) | Extruda o perfil de um esboço | direção (padrão, invertida, simétrica, dois lados), distância ou "através de tudo", **ângulo de afunilamento**, torção, cantos arredondados do perfil, parede fina |
| **Revolução** (R) | Gira o perfil em torno do eixo X ou Y do esboço | ângulo |
| **Loft** | Transição entre dois ou mais esboços (inclusive perfis côncavos) | ordem das seções, superfícies regradas |
| **Varredura** | Varre um perfil ao longo de um caminho 3D | pontos do caminho, raio de dobra |
| **Tubo** | Tubulação ao longo de pontos, com curvas reais | diâmetro, oco/parede, raio de curvatura |
| **Furo** (H) | Assistente de furos: clique em faces planas para posicionar | simples, rebaixo (ISO 4762) ou escareado; rosca ISO M2–M24 (passagem/rosca) ou diâmetro; passante ou profundidade (ponta 118°) |
| **Filete** (F) | Arredonda arestas | clique nas arestas, ou "todas as arestas"; raio |
| **Chanfro** | Chanfra arestas | distância ou duas distâncias |
| **Casca** | Esvazia o corpo | espessura; clique nas faces que ficarão abertas |
| **Saída** | Ângulo de saída para moldes | direção de extração, ângulo, faces (padrão: laterais) |
| **Pressionar/Puxar** (Q) | Desloca uma face plana (estilo SketchUp) | distância (+ adiciona, − remove) |
| **Combinar** | Booleana entre corpos | base, ferramentas, operação, manter ferramentas |
| **Mover corpo** | Translação e rotação | deslocamento, rotação XYZ, centro, criar cópia |
| **Espelhar** | Espelha por YZ, XZ ou XY | deslocamento do plano; unir ou novo corpo |
| **Retangular / Circular** | Padrões de um corpo | direções, quantidades, espaçamentos; eixo, centro, ângulo |
| **Dividir** | Corta o corpo por um plano | normal, posição; manter um ou os dois lados |
| **Espessar** | Offset 3D exato | distância (±), novo corpo |
| **Junta** (J) | Encosta uma face de um corpo na face de outro | folga, ângulo, alinhar centros ou só o plano |
| **Primitivas** | Caixa, Cilindro, Esfera, Toro, Cone | dimensões e posição |
| **Importar STEP** | Traz geometria exata de outro CAD | posição, escala |

**Seleção na tela.** Durante comandos que pedem faces ou arestas, o item sob o cursor acende em azul. Clique
para selecionar e clique de novo para remover. Os itens escolhidos ganham um marcador laranja. A seleção é
gravada pela posição (intenção), não por um número interno, e continua válida quando o modelo é editado.

## 7. Linha do tempo e edição

- **Navegador do modelo.** Clique seleciona e duplo clique edita (abre o painel ou o esboço). O botão direito
  oferece **Editar**, **Suprimir/Reativar**, **Mover o fim da peça para cá**, **Renomear**, **Editar definição
  (JSON)** e **Excluir**.
- **Fim da peça.** Arraste o marcador para cima para ver o modelo como era naquele ponto. Novos recursos são
  inseridos ali. Arraste até o fim, ou use o menu, para voltar.
- **Erros.** Um recurso que falha fica vermelho com ⚠. Passe o mouse para ler a causa. Os recursos seguintes
  continuam sendo avaliados.
- **Desfazer/Refazer** (Ctrl+Z / Ctrl+Y). As dicas dos botões mostram o nome da ação.
- **Regeneração incremental.** Só os recursos a partir do que mudou são recalculados; o resto vem do cache.
  A barra de status mostra quantos vieram do cache.
- **Corpos.** No navegador, clique com o botão direito num corpo para mostrar/ocultar, mudar material e
  aparência, renomear ou excluir.

## 8. Parâmetros, configurações e versões

**Parâmetros (fx)** (Ctrl+Shift+P):

- **Parâmetros do usuário**: nome, equação, valor calculado e comentário. **+ Adicionar numérico** cria um
  novo parâmetro.
- **Parâmetros do modelo**: todos os valores numéricos dos recursos (por exemplo `Extrusão1.distance`),
  editáveis ali mesmo.

**Expressões** aceitam:

- operadores `+ − * / ^ %` e comparações;
- unidades `mm cm m in ft deg rad`;
- funções `sin cos tan` (em graus), `asin acos atan atan2 sqrt abs min max floor ceil round pow log exp
  hypot clamp if(cond, a, b)` e as constantes `pi`, `e`, `tau`.

Referências circulares são detectadas e recusadas.

**Configurações** (Gerenciar › Configurações): uma tabela de variantes (por exemplo P, M e G) com valores
próprios para alguns parâmetros. **Ativar** troca a variante, e o modelo inteiro regenera.

**Versões** (Gerenciar): **Salvar versão** guarda um instantâneo nomeado dentro do arquivo. **Histórico de
versões** restaura qualquer um deles, e a restauração também pode ser desfeita.

## 9. Inspeção e análise

Todas as medidas são calculadas na **geometria exata** (B-rep), não na malha da tela.

| Comando | Resultado |
|---|---|
| **Clique numa face** | Tipo (plano, cilindro, cone…), área, raio/diâmetro, normal e centróide na barra de status |
| **Medir** (M) | Uma face: propriedades. Duas faces: distância mínima com os pontos, ângulo, distância entre planos paralelos e entre eixos de cilindros |
| **Propriedades físicas** | Massa, área, volume, densidade, centro de gravidade, tensor de inércia no CG, momentos principais, raios de giração, caixa delimitadora, validade do B-rep e custo estimado. A lista **Material** muda o material |
| **Interferência** | Pares de corpos que se interpenetram, com volume exato, ou que se tocam. Clique numa linha para destacar |
| **Vista de corte** | Plano X/Y/Z, posição e lado. O interior aparece em vermelho. **Remover corte** desfaz |
| **Zebra / Saída / Curvatura** | Análises visuais na GPU: continuidade de superfícies, faces com e sem ângulo de saída em Z, regiões curvas |
| **Verificar impressão 3D** | Balanços acima do ângulo máximo, paredes finas (offset exato), número de camadas, tempo e filamento estimados |
| **Lista de materiais** | Itens, materiais, massa, dimensões e custo, com totais |

## 10. Desenho técnico

**Anotar › Desenho técnico** gera uma folha A3 ou A4:

- vistas **frontal**, **superior** e **lateral** com linhas ocultas tracejadas, calculadas por remoção exata
  de linhas ocultas;
- vista **isométrica**;
- **cotas gerais** de cada vista e **chamadas de furos** agrupadas (por exemplo `4× Ø5,5`);
- **carimbo** com título, material, massa, escala normalizada, folha, data e símbolo de diedro.

Escolha **1º diedro (ABNT/ISO)** ou **3º diedro (ANSI)**. Use a roda do mouse para dar zoom no visualizador.
**Salvar SVG como…** grava o arquivo, que abre em navegadores, Inkscape, LibreOffice e softwares de corte.

## 11. Importar e exportar

| Formato | Importar | Exportar | Observações |
|---|---|---|---|
| **STEP** (.step/.stp) | ✔ (exato) | ✔ (exato) | Para outros CADs (SolidWorks, Inventor, Fusion, FreeCAD) e CAM |
| **STL** | ✔ (convertido em sólido, até 60 mil triângulos) | ✔ | Impressão 3D |
| **OBJ** | ✔ | ✔ | — |
| **3MF** | — | ✔ (com cores e materiais) | Impressão 3D (Orca, Bambu, Prusa) |
| **GLB** | — | ✔ | Web, AR, Blender |
| **SVG** | — | ✔ (desenho técnico) | — |
| **.projetista** | ✔ | ✔ | Documento nativo (JSON com parâmetros, linha do tempo e versões) |

### Exportar (Ctrl+E)

Abra pelo botão **Exportar** da barra de acesso rápido, pela aba **Exportar** ou por **Arquivo › Exportar…**.
O diálogo tem três passos:

1. **Formato.** Cada cartão explica para que serve: STEP (outros CADs e usinagem), STL e 3MF (impressão 3D),
   OBJ, GLB (web/AR) ou desenho SVG. Os botões pequenos da aba Exportar abrem o diálogo já no formato.
2. **Conteúdo e precisão.** Todos os corpos ou só os escolhidos. Para malhas, a precisão: normal 0,02 mm,
   fina 0,005 mm ou ultra 0,001 mm de erro cordal. O STEP é sempre exato. Para o SVG, diedro e folha.
3. **Destino.** Pasta (padrão `Documentos\Projetista\Exportações`, lembrada para a próxima vez), nome do
   arquivo e **Arquivo final**, que mostra o caminho completo antes de gravar.

Detalhes que evitam erros:

- A extensão sempre combina com o formato. Digitar `peca.3mf` no nome troca o formato para 3MF.
- Caracteres que o Windows não aceita (`< > : " / \ | ? *`) viram `_`.
- A pasta é criada se não existir.
- Ao concluir aparece "✔ Exportado", com tamanho, tempo e os botões **Mostrar na pasta** e **Abrir arquivo**.
  No navegador, o arquivo é baixado.
- Se algo falhar (arquivo aberto em outro programa, pasta sem permissão, modelo sem corpos), a causa aparece
  em vermelho no próprio diálogo.

## 12. Estudos, otimização e macros

- **Estudo paramétrico** (Gerenciar): varre um parâmetro (de, até, número de variantes) e mostra massa e
  volume de cada variante. Roda **em paralelo** em todos os núcleos (um kernel por núcleo). O documento atual
  não é alterado.
- **Otimizar** (Gerenciar): escolha as variáveis com faixas, um **objetivo** (por exemplo `mass`, `volume`, `sz`, ou uma
  expressão) e **restrições** (uma por linha, como `sz <= 50` ou `esp >= 2`). O resultado traz o melhor
  conjunto e o botão **Aplicar ao modelo**.
- **Macros** (Gerenciar): JavaScript com a API `cad`, executado como uma única operação desfazível.
  - `cad.<tipo>({...})` cria um recurso de qualquer tipo (`cad.box`, `cad.sketch`, `cad.extrude`, `cad.hole`,
    `cad.fillet`…);
  - `cad.param(nome, expr)` cria ou altera um parâmetro;
  - `cad.update(nome, patch)` altera um recurso existente;
  - `console.log(...)` escreve na saída.

  Os tipos e campos estão em [referencia-de-modelagem.md](referencia-de-modelagem.md).

## 13. Claude e o servidor MCP

O Projetista é um **servidor MCP** completo: o Claude modela, mede, analisa, renderiza imagens e exporta.

**Configuração.** Use **Claude › Conectar o Claude** no app: ele mostra o comando e o JSON com os caminhos da
sua instalação, com botões de copiar.

- **Claude Desktop**: cole o JSON em `%APPDATA%\Claude\claude_desktop_config.json` e reinicie o Claude.
- **Claude Code**: rode o comando `claude mcp add projetista …` mostrado no diálogo.

**Como funciona.**

- **Com o app aberto**, o servidor vira uma **ponte**: o Claude trabalha no documento da tela, cada ação dele
  aparece num aviso "✦ Claude: …" e as imagens que ele pede são renderizadas pela sua GPU.
- **Com o app fechado**, o servidor sobe o kernel sozinho e renderiza por software. Se você abrir o app
  depois, ele se conecta à mesma sessão.
- O histórico do que o Claude fez está em **Claude › Atividade**. Tudo pode ser desfeito com Ctrl+Z.
- Se o Claude iniciar o kernel antes de você abrir o app, o app **assume o kernel** ao abrir, com o documento
  que o Claude estava editando, e o Claude passa a trabalhar pela ponte. Se você fechar o app, o Claude
  retoma o kernel com o documento salvo, sem perder nada.

**Pedidos que funcionam bem:**

> Projete um suporte de parede para um roteador de 120×30×160 mm, imprimível em PETG, com furos M4 escareados.
> Mostre as quatro vistas e verifique se imprime sem suporte.

> Otimize a espessura e o raio do suporte para a menor massa com altura total abaixo de 50 mm.

> Faça o desenho técnico em 1º diedro e exporte STEP e 3MF.

Referência completa das ferramentas: [referencia-mcp.md](referencia-mcp.md).

## 14. Recursos da máquina e opções

- **Gerenciar › Recursos do sistema**: carga de cada núcleo da CPU, memória do sistema e do kernel,
  workers ocupados e GPU (VRAM, uso e temperatura, via `nvidia-smi`).
- O app desktop força a **GPU dedicada**. O backend usa até ¼ da RAM. Os workers usam até 4 GB cada e são
  encerrados após 60 s ociosos.
- **Opções** (Gerenciar ou Arquivo):
  - tema claro ou escuro;
  - estilo visual: sombreado com arestas, sombreado, aramado ou raio X;
  - qualidade de exibição;
  - ajuste à grade e símbolos de restrição no esboço;
  - tesselagem de exportação.

## 15. Atalhos de teclado

| Contexto | Teclas |
|---|---|
| Geral | Ctrl+N novo · Ctrl+O abrir · Ctrl+S salvar · Ctrl+E exportar · Ctrl+Z desfazer · Ctrl+Y refazer · Ctrl+F pesquisar comandos · Ctrl+Shift+P parâmetros · Esc cancelar · Enter OK |
| Modelo | S esboço · E extrusão · R revolução · H furo · F filete · Shift+K chanfro · Q pressionar/puxar · Shift+M mover corpo · J junta · M medir |
| Esboço | L linha · C círculo · A arco · T retângulo · D cota · Delete excluir · Ctrl+Enter concluir · Esc sai da ferramenta e depois conclui |
| Vista | Home zoom tudo · F2 pan · F3 zoom · F4 órbita · F5 vista anterior · F6 vista inicial |
| App desktop | F12 ferramentas de desenvolvedor · Ctrl+Shift+R recarregar a interface |

## 16. Solução de problemas

| Sintoma | Causa provável e solução |
|---|---|
| "Filete de raio X falhou" | O raio é maior do que a geometria vizinha permite (por exemplo, dois filetes de 3 mm numa parede de 5 mm). Reduza o raio ou selecione menos arestas |
| "Casca gerou sólido inválido" | A casca encontrou filetes ou furos nas faces abertas. Mova a casca para antes dos filetes (arraste no navegador) |
| "Essa restrição sobre-restringe o esboço" | A restrição duplica outra existente. Remova a anterior ou use uma cota |
| Esboço sem "perfil fechado" | Há pontas soltas. Feche o contorno clicando no ponto inicial ou use **Coincidente** |
| A extrusão não aparece | O perfil precisa de contorno fechado. Confira o status do esboço ("N perfis fechados") |
| A interface diz "Desconectado do kernel" | O processo do kernel encerrou (o app mostra o código de saída). Feche e reabra o Projetista e veja a causa em `Documentos\Projetista\projetista.log`. O documento está no salvamento automático |
| Porta 7777 ocupada | Outro programa usa a porta. Feche-o, ou defina a variável `PROJETISTA_PORT` |
| A GPU dedicada não é usada | Abra as ferramentas (F12), digite `chrome://gpu` na barra do DevTools, ou confira **Recursos do sistema**. Atualize o driver da placa |
| A exportação mostra um erro em vermelho | Leia a causa no diálogo. "Arquivo aberto em outro programa": feche o arquivo no fatiador ou visualizador e exporte de novo. "Sem permissão": escolha outra pasta |
| O Claude não vê o app | Confira se o caminho no JSON de configuração é o da instalação e se `ELECTRON_RUN_AS_NODE` está definido como `"1"` |
