// Conexão WebSocket com o backend (kernel). Mesmo protocolo usado pela ponte MCP.
const handlers = { scene: [], state: [], activity: [], 'render-request': [], open: [], close: [] };
let ws = null;
let nextId = 1;
const pending = new Map();

export function on(type, fn) { (handlers[type] ||= []).push(fn); }
const emit = (type, m) => (handlers[type] || []).forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } });

export function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'register', role: 'gpu-renderer', desktop: !!window.projetista?.desktop }));
    emit('open');
  };
  ws.onclose = () => { emit('close'); setTimeout(connect, 1500); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'reply') {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) (m.ok ? p.res(m.result) : p.rej(new Error(m.error)));
    } else emit(m.type, m);
  };
}

export function send(obj) { if (ws?.readyState === 1) ws.send(JSON.stringify(obj)); }

export function rpc(cmd, args = {}) {
  return new Promise((res, rej) => {
    if (!ws || ws.readyState !== 1) return rej(new Error('Sem conexão com o kernel'));
    const id = nextId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, cmd, args }));
  });
}
