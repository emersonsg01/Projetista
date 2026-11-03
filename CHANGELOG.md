# Histórico de versões

## 1.2.0 — 2026-11-03

### Cotas paramétricas em milímetros
- Cotas do esboço exibidas com unidade: `45 mm`, `Ø12 mm`, `R5 mm`, `30°`; cotas com expressão mostram o
  valor resultante (`largura/2 = 25 mm`) em roxo.
- Um clique no rótulo abre a edição (antes era duplo clique); aceita `40`, `40,5`, `40 mm`, parâmetros e
  expressões. A geometria se reajusta pelo solver; valores impossíveis ou expressões inválidas voltam ao
  valor anterior com aviso.
- Medidas digitadas durante o desenho: depois do primeiro clique de Linha, Retângulo, Retângulo pelo centro,
  Círculo e Polígono, a medida aparece junto do cursor e digitar um número (ou Tab) abre as caixas
  Comprimento / Largura × Altura / Diâmetro. Enter cria a geometria exata e já cotada.
- Cotas automáticas (Cotar › Cotas automáticas, ligado por padrão): geometria nova já sai cotada em mm;
  cotas que sobre-restringiriam o esboço são omitidas.
- Cotas no modelo 3D: ao selecionar um recurso no navegador, suas medidas (distância, ângulo, raio,
  espessura…) aparecem junto do corpo; clique, digite e o modelo regenera.

## 1.1.0 — 2026-11-03

### Exportação
- Novo diálogo **Exportar** (Ctrl+E, barra de acesso rápido, aba Exportar, Arquivo): formato em cartões,
  corpos, precisão da malha, pasta e nome com prévia do caminho final, progresso e resultado com "Mostrar na
  pasta" / "Abrir arquivo".
- Correções: erros de exportação agora aparecem (antes falhavam em silêncio); extensão sempre coerente com o
  formato (ou formato deduzido da extensão); pastas criadas automaticamente; nomes inválidos no Windows
  corrigidos; mensagens claras para arquivo aberto em outro programa ou sem permissão; download no navegador
  sem bloqueio de pop-up; exportação de malhas mais rápida (sem arestas de exibição, costuras em tempo linear).

### Interface
- Abas reorganizadas por tarefa (Modelo 3D, Inspecionar, Exportar, Gerenciar, Vista, Claude), botões e ícones
  maiores, dicas ricas com descrição e atalho.
- Instrução do comando ativo no topo da área 3D; cartão "Comece seu modelo" em documentos vazios; rótulos dos
  planos de origem; restrições do esboço com nome; opções dos painéis com texto; ações rápidas no navegador
  (editar, suprimir, ocultar, material) ao passar o mouse; diálogos que se ajustam para caber na tela.
- Erros inesperados da interface viram avisos visíveis.

### Robustez
- O app desktop assume o kernel iniciado pelo Claude (MCP) sem perder o documento; o Claude passa a usar a
  ponte e retoma o kernel se o app fechar.
- Transações de comandos interrompidos (janela fechada/recarregada) são concluídas automaticamente.

## 1.0.0 — 2026-11-02

Primeira versão.

### Kernel e modelagem
- Kernel B-rep exato (OpenCascade em WebAssembly com pthreads), tolerância 1e-7 mm.
- 31 features paramétricas: primitivas, esboço com solver de restrições, extrusão (afunilamento, torção,
  parede fina), revolução, loft, varredura, tubo, assistente de furos ISO M2–M24, filete e chanfro por aresta,
  casca, ângulo de saída, pressionar/puxar, booleanas, padrões, espelho, divisão, offset, junta de montagem,
  importação STEP e STL/OBJ.
- Parâmetros com expressões e unidades, configurações (tabela), versões nomeadas.
- Regeneração incremental com cache, desfazer/refazer e transações para pré-visualização.
- Seleção de faces e arestas por intenção.

### Análise e saída
- Propriedades de massa exatas, interferência, folga, seção, medição, checagem de impressão 3D, lista de
  materiais com custo.
- Desenho técnico SVG por HLR (1º/3º diedro, cotas, chamadas de furos, carimbo).
- Exportação STEP, STL, 3MF, OBJ e GLB.

### Desempenho
- Pool de workers (um kernel por núcleo) para estudo paramétrico e otimização.
- Renderização e análises visuais (zebra, saída, curvatura) na GPU. Monitor de CPU, RAM e GPU.

### Interface
- Layout no estilo do Autodesk Inventor: faixa de opções com aba contextual de esboço, navegador do modelo
  com "Fim da peça", painéis de propriedades flutuantes, ambiente de esboço 2D interativo, menu radial, cubo
  de navegação, página inicial com exemplos, tema claro e escuro.

### Claude
- Servidor MCP com 19 ferramentas: modelagem, visão (render), análise, medição, estudo, otimização, macros,
  desenho e exportação. Modo ponte para o app aberto, com render na GPU.

### Distribuição
- App desktop Electron com instalador NSIS para Windows e associação de arquivos `.projetista`.
