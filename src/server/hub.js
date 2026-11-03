// Servidor HTTP + WebSocket da interface web. Transmite a cena a cada regeneração.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { WORKSPACE } from '../studio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.stl': 'model/stl', '.3mf': 'model/3mf', '.glb': 'model/gltf-binary', '.obj': 'text/plain' };

const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');

function sceneMessage(studio) {
  const bodies = [];
  for (const [name, b] of studio.doc.bodies) {
    const t = b.m.tess(studio.displayQuality || 'normal');
    // arestas exatas do B-rep como segmentos de linha (não arestas de malha)
    const seg = [], segEdge = [];
    (t.edges || []).forEach((pl, ei) => { for (let i = 0; i + 1 < pl.length; i++) { seg.push(...pl[i], ...pl[i + 1]); segEdge.push(ei); } });
    bodies.push({
      name, color: b.color, material: b.material, feature: b.feature,
      positions: b64(Float32Array.from(t.positions)), indices: b64(t.indices), faceIds: b64(t.faceIds), edges: b64(Float32Array.from(seg)), edgeIds: b64(Uint32Array.from(segEdge)),
    });
  }
  return { type: 'scene', version: studio.doc.version || 0, bodies, sketches: studio.sketchPolylines() };
}

export function startHub(studio, { port = Number(process.env.PROJETISTA_PORT) || 7777, quiet = false, owner = 'app', onHandover } = {}) {
  let closing = false;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/web/index.html';
    if (p === '/api/upload' && req.method === 'POST') {
      // importação pelo navegador: o arquivo é gravado em <workspace>/importados
      const name = path.basename(url.searchParams.get('name') || 'arquivo.bin').replace(/[^\w.\-]+/g, '_');
      const dir = path.join(WORKSPACE, 'importados');
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, name);
      const out = fs.createWriteStream(dest);
      let size = 0;
      req.on('data', (c) => { size += c.length; if (size > 1024 ** 3) req.destroy(); });
      req.pipe(out);
      out.on('finish', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ path: dest, bytes: size })); });
      out.on('error', (e) => { res.writeHead(500); res.end(e.message); });
      return;
    }
    if (p === '/api/info') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ app: 'projetista', owner, pid: process.pid, workspace: WORKSPACE, gpuRenderer: !!studio.gpuRender })); return; }
    if (p === '/api/handover' && req.method === 'POST') {
      // O app desktop assume o kernel: este backend (iniciado pelo MCP) entrega o documento,
      // libera a porta e passa a operar como ponte para o app.
      if (owner !== 'mcp' || closing) { res.writeHead(409, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'este kernel pertence ao app' })); return; }
      closing = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ document: studio.doc.toJSON(), workspace: WORKSPACE }), () => {
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => onHandover?.());
        server.closeAllConnections?.();
      });
      return;
    }
    let file;
    if (p.startsWith('/vendor/three/')) file = path.join(ROOT, 'node_modules/three', p.slice('/vendor/three/'.length));
    else if (p.startsWith('/files/')) file = path.join(WORKSPACE, p.slice(7));
    else if (p.startsWith('/web/')) file = path.join(ROOT, p);
    else if (p === '/render.png') {
      try {
        const r = await studio.run('render', { view: url.searchParams.get('view') || 'iso', width: 800, height: 600, sheet: url.searchParams.has('sheet') });
        res.writeHead(200, { 'content-type': 'image/png' }); res.end(r.png);
      } catch (e) { res.writeHead(500); res.end(e.message); }
      return;
    }
    const allowed = [path.join(ROOT, 'web'), path.join(ROOT, 'node_modules/three'), WORKSPACE];
    if (file && !allowed.some((a) => path.resolve(file).startsWith(a + path.sep))) file = null;
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('não encontrado'); return; }
    const head = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' };
    if (url.searchParams.has('download')) head['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;
    res.writeHead(200, head);
    fs.createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ server });
  const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const broadcast = (m) => { const s = JSON.stringify(m); for (const c of wss.clients) if (c.readyState === 1) c.send(s); };

  const pushState = async () => {
    broadcast(sceneMessage(studio));
    broadcast({ type: 'state', state: await studio.run('state') });
  };
  let pending = null;
  studio.doc.on('change', () => { clearTimeout(pending); pending = setTimeout(pushState, 30); });
  studio.doc.on('activity', (a) => broadcast({ type: 'activity', activity: a }));

  // renderização na GPU: a interface (WebGL) renderiza vistas sob demanda para o MCP
  const renderers = new Set();
  const renderWaits = new Map();
  let rid = 1;
  const registerRenderer = (ws) => {
    renderers.add(ws);
    ws.on('close', () => { renderers.delete(ws); if (!renderers.size) studio.gpuRender = null; });
    studio.gpuRender = (opts) => new Promise((resolve, reject) => {
      const all = [...renderers];
      const target = all.filter((r) => r.desktop).at(-1) || all.at(-1); // prefere a janela do app desktop
      if (!target) return reject(new Error('sem renderizador GPU'));
      const id = rid++;
      renderWaits.set(id, { resolve, reject });
      send(target, { type: 'render-request', id, version: studio.doc.version || 0, opts });
      setTimeout(() => { if (renderWaits.delete(id)) reject(new Error('renderização GPU expirou')); }, 15000);
    });
  };

  wss.on('connection', async (ws) => {
    // janela fechada/recarregada no meio de um comando: conclui a transação (mantém o trabalho)
    ws.on('close', () => { if (ws.ownsTx && studio.doc?.tx) studio.doc.commitTransaction(); });
    send(ws, sceneMessage(studio));
    send(ws, { type: 'state', state: await studio.run('state') });
    send(ws, { type: 'activities', activities: studio.activity });
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'register' && msg.role === 'gpu-renderer') { ws.desktop = !!msg.desktop; registerRenderer(ws); return; }
      if (msg.type === 'render-result') { const p = renderWaits.get(msg.id); renderWaits.delete(msg.id); if (p) (msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error))); return; }
      // quem abre um comando interativo (transação) é responsável por fechá-lo
      if (msg.cmd === 'tx_begin') ws.ownsTx = true;
      if (msg.cmd === 'tx_commit' || msg.cmd === 'tx_cancel') ws.ownsTx = false;
      try {
        const result = await studio.run(msg.cmd, msg.args || {}, msg.source === 'claude' ? 'claude' : 'ui');
        const clean = result && result.png ? { ...result, png: undefined, image: result.png.toString('base64') } : result;
        send(ws, { type: 'reply', id: msg.id, ok: true, result: clean });
      } catch (e) {
        send(ws, { type: 'reply', id: msg.id, ok: false, error: e.message });
      }
    });
  });

  return new Promise((resolve) => {
    server.once('error', (e) => {
      if (!quiet) console.error(`[projetista] interface web não iniciada (${e.code}) — porta ${port} ocupada?`);
      resolve(null);
    });
    server.listen(port, '127.0.0.1', () => {
      if (!quiet) console.error(`[projetista] interface web em http://localhost:${port}`);
      resolve({ server, port, url: `http://localhost:${port}` });
    });
  });
}
