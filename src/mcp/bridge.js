// Ponte MCP → app em execução: os comandos do Claude vão por WebSocket para o
// processo do app, que mantém o documento, o kernel, o pool de workers e a GPU.
import WebSocket from 'ws';

export async function findRunningApp(port = Number(process.env.PROJETISTA_PORT) || 7777) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(800) });
    const j = await r.json();
    return j.app === 'projetista' ? { url: `http://localhost:${port}`, ...j } : null;
  } catch { return null; }
}

export class RemoteStudio {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const rs = new RemoteStudio();
      rs.ws = new WebSocket(url.replace('http', 'ws'));
      rs.pending = new Map();
      rs.next = 1;
      rs.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.type !== 'reply') return;
        const p = rs.pending.get(m.id);
        rs.pending.delete(m.id);
        if (!p) return;
        if (!m.ok) return p.reject(new Error(m.error));
        const r = m.result;
        if (r && r.image) { r.png = Buffer.from(r.image, 'base64'); delete r.image; }
        p.resolve(r);
      });
      rs.ws.once('open', () => resolve(rs));
      rs.ws.once('error', reject);
      rs.ws.on('close', () => { for (const p of rs.pending.values()) p.reject(new Error('Conexão com o app encerrada')); rs.pending.clear(); });
    });
  }

  run(cmd, args = {}, source = 'claude') {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== 1) return reject(new Error('O app Projetista foi fechado'));
      const id = this.next++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, cmd, args, source }));
    });
  }
}
