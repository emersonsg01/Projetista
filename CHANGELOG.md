# Histórico de versões

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
