// Estado compartilhado da interface.
import { rpc } from './rpc.js';

const saved = (() => { try { return JSON.parse(localStorage.getItem('projetista.settings') || '{}'); } catch { return {}; } })();

export const app = {
  state: null, // estado do documento (parâmetros, linha do tempo, corpos…)
  scene: null, // última cena recebida
  vp: null, // Viewport
  hidden: new Set(),
  originPinned: false,
  sketching: null, // sessão de esboço ativa
  lastCommand: null,
  settings: { theme: 'light', style: 'shadedEdges', projection: 'persp', gridSnap: true, showConstraints: true, showSketches: true, quality: 'normal', ...saved },
  cache: new Map(),
};

export function saveSettings() {
  try { localStorage.setItem('projetista.settings', JSON.stringify(app.settings)); } catch { /* armazenamento indisponível */ }
}

/** Faces/arestas exatas de um corpo, em cache por versão da cena. */
async function cached(kind, body) {
  const key = `${kind}:${body}:${app.scene?.version}`;
  if (!app.cache.has(key)) app.cache.set(key, rpc(kind === 'faces' ? 'list_faces' : 'list_edges', { body }));
  return app.cache.get(key);
}
export const facesOf = (body) => cached('faces', body);
export const edgesOf = (body) => cached('edges', body);

export const bodyNames = () => (app.state?.summary.bodies || []).map((b) => b.name);
export const sketchNames = () => app.state?.sketches || [];
export const r6 = (p) => p.map((x) => +(+x).toFixed(6));
