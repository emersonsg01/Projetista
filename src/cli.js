#!/usr/bin/env node
// Projetista — ponto de entrada.
//   projetista mcp   -> servidor MCP (stdio) + interface web ao vivo
//   projetista app   -> só o backend + interface web (http://localhost:7777)
// Opções: --port=7777  --home=<pasta de projetos>
for (const a of process.argv.slice(3)) {
  const [k, v] = a.replace(/^--/, '').split('=');
  if (k === 'port' && v) process.env.PROJETISTA_PORT = v;
  if (k === 'home' && v) process.env.PROJETISTA_HOME = v;
}

const mode = process.argv[2] || 'app';
if (mode === 'mcp') {
  const { main } = await import('./mcp/server.js');
  await main();
} else {
  const { Studio } = await import('./studio.js');
  const { startHub } = await import('./server/hub.js');
  const studio = await Studio.create();
  const hub = await startHub(studio, { owner: 'app' });
  if (!hub) process.exit(1);
  console.error('[projetista] pressione Ctrl+C para sair');
}
