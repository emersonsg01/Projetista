// Captura a janela do app desktop via DevTools Protocol (requer --remote-debugging-port=9223).
import fs from 'node:fs';
import WebSocket from 'ws';
const list = await (await fetch('http://127.0.0.1:9223/json')).json();
const page = list.find((p) => p.type === 'page' && p.url.startsWith('http'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let id = 0;
const call = (method, params = {}) => new Promise((res) => { const i = ++id; ws.on('message', function h(m) { const j = JSON.parse(m); if (j.id === i) { ws.off('message', h); res(j.result); } }); ws.send(JSON.stringify({ id: i, method, params })); });
const expr = process.argv[3];
if (expr) { const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); console.log(JSON.stringify(r.result?.value ?? r.exceptionDetails ?? r).slice(0, 600)); }
const shot = await call('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(process.argv[2] || 'tests/out/desktop-ui.png', Buffer.from(shot.data, 'base64'));
console.log('captura salva');
ws.close();
