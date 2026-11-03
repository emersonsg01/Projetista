# Guia de desenvolvimento

## Requisitos

- Windows 10/11 x64, Node.js 22 ou mais recente (testado com 24) e npm.
- Para gerar o instalador, o `electron-builder` baixa o Electron e o NSIS na primeira execução.

```bash
npm install
```

## Scripts

| Comando | O que faz |
|---|---|
| `npm start` | Backend + interface em http://localhost:7777 (abra no navegador) |
| `npm run desktop` | App desktop (Electron) em modo de desenvolvimento |
| `npm run mcp` | Servidor MCP por stdio (sobe também a interface, ou vira ponte se o app já estiver aberto) |
| `npm test` | Núcleo paramétrico com verificações analíticas, kernel exato e API da interface |
| `npm run docs` | Regenera `docs/referencia-mcp.md`, `docs/referencia-de-modelagem.md`, `docs/catalogos.md` e `THIRD_PARTY_NOTICES.md` |
| `npm run icon` | Regenera `build/icon.png` |
| `npm run dist` | Gera `dist/Projetista-Setup-<versão>.exe` |

Outros testes:

| Script | Cobre |
|---|---|
| `node tests/pool-test.mjs` | Estudo paramétrico e otimização em paralelo |
| `node tests/handover.mjs` | Passagem de controle do kernel entre MCP e app (e retomada ao fechar o app) |
| `PROJETISTA_PORT=<porta> LOAD_EXAMPLE=1 node tests/export-check.mjs <pasta>` | Exportação em todos os formatos, extensões, subpastas e mensagens de erro (com um kernel rodando na porta) |
| `node tests/mcp-e2e.mjs` | MCP ponta a ponta (imagens em `tests/out/`). Com `PROJETISTA_PORT=7777` e o app aberto, testa o modo ponte |
| `node tests/mcp-exe.mjs dist/win-unpacked/Projetista.exe` | MCP pelo executável empacotado |
| `node tests/desktop-shot.mjs <png> [expressão]` | Captura a janela do app aberto com `--remote-debugging-port=9223` |

## Variáveis de ambiente

| Variável | Padrão | Efeito |
|---|---|---|
| `PROJETISTA_HOME` | `workspace/` (dev) ou `Documentos\Projetista` (app) | Pasta de projetos e do salvamento automático |
| `PROJETISTA_PORT` | `7777` | Porta HTTP/WebSocket |
| `PROJETISTA_WORKERS` | núcleos − 2 | Tamanho máximo do pool |
| `PROJETISTA_THREADS` | ligado | `0` usa o OpenCascade sem pthreads no processo principal |
| `PROJETISTA_NO_UI` | — | O servidor MCP não sobe a interface |

## Adicionar uma feature

1. **Kernel** (`src/core/features.js`): adicione a entrada em `FEATURES` com `label` e
   `apply(f, ctx)`. Use `ctx.num`/`ctx.vec` para avaliar campos (expressões), `output(ctx, f, shape)` para
   criar ou combinar corpos e as funções de `src/occ/occ.js`. Adicione o prefixo de nome em `FEATURE_PREFIX`.
2. **Manual do Claude** (`src/mcp/reference.js`): documente os campos.
3. **Interface** (`web/js/commands.js`): crie o painel em `P.<tipo>` (`defaults`, `fromFeature`,
   `toFeature`, `valid`, `sections`) e registre o comando na lista. Para colocá-lo na faixa de opções, inclua
   o id em `web/js/ribbon.js`. Para o ícone, use `web/js/icons.js` e, no navegador do modelo, `ICON` em
   `web/js/browser.js`.
4. **Teste**: adicione um caso com verificação numérica em `tests/smoke.mjs`.
5. Rode `npm run docs` para atualizar o catálogo.

## Adicionar um comando de interface

Registre-o em `COMMANDS` (`web/js/commands.js`) com `simple(id, rótulo, ícone, função, { key })`, ou como
painel. Atalhos em `key` entram sozinhos no mapa de teclado. Comandos do esboço levam `{ sketch: true }`.

## Convenções

- Textos de interface, mensagens de erro e comentários em português do Brasil.
- Unidades internas: milímetros e graus. Z para cima.
- Toda mutação do documento passa por `Document.mutate` (desfazer e regeneração). Comandos interativos usam
  transações.
- Objetos do OpenCascade criados durante uma feature são registrados na arena (`T()` em `occ.js`).

## Depuração

- App desktop: F12 abre as ferramentas de desenvolvedor e Ctrl+Shift+R recarrega a interface.
- O log do backend fica em `Documentos\Projetista\projetista.log`.
- Para inspecionar a janela do app por scripts, abra-o com `--remote-debugging-port=9223` e use
  `tests/desktop-shot.mjs`.

## Limitações conhecidas e próximos passos

- Esboço: faltam aparar, estender, offset, filete 2D, spline, texto e projetar geometria do modelo.
- Um documento por vez (sem montagens multi-arquivo).
- Furos posicionados por clique e coordenadas, sem cotar até arestas.
- O kernel roda em WebAssembly, mais lento que o OpenCascade nativo. Booleanas não escalam com threads.
- Sem IGES (o build do OpenCascade não inclui), sem elementos finitos e sem CAM.
- O instalador não tem assinatura de código.
