#!/usr/bin/env node
// Projetista — ponto de entrada.
//   projetista mcp   -> servidor MCP (stdio) + interface web ao vivo
//   projetista app   -> só a interface web (http://localhost:7777)
import { Studio } from './studio.js';
import { startHub } from './server/hub.js';
import { main as mcpMain } from './mcp/server.js';

const mode = process.argv[2] || 'app';
if (mode === 'mcp') {
  await mcpMain();
} else {
  const studio = await Studio.create();
  const hub = await startHub(studio);
  if (!hub) process.exit(1);
  console.error('[projetista] pressione Ctrl+C para sair');
}
