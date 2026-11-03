// Corpo sólido B-rep com malha de exibição preguiçosa. Expõe a mesma interface
// mínima que o renderizador/analisadores usam (getMesh, boundingBox, volume…).
import * as occ from './occ.js';

export const QUALITY = {
  draft: { linDefl: 0.1, angDefl: 0.5 },
  normal: { linDefl: 0.02, angDefl: 0.25 },
  fine: { linDefl: 0.005, angDefl: 0.1 },
  ultra: { linDefl: 0.001, angDefl: 0.05 },
};

export class Solid {
  constructor(shape) {
    this.shape = shape;
    this._mesh = null;
    this._props = null;
    this._bbox = null;
  }
  static of(shape) { return new Solid(shape); }

  tess(quality = 'normal') {
    if (!this._mesh || this._mesh.quality !== quality) {
      this._mesh = { quality, ...occ.tessellate(this.shape, QUALITY[quality] || QUALITY.normal) };
    }
    return this._mesh;
  }
  /** Malha para exportação (sem arestas de exibição), em cache por qualidade. */
  meshFor(quality = 'fine') {
    this._meshes ||= new Map();
    if (!this._meshes.has(quality)) this._meshes.set(quality, occ.tessellate(this.shape, { ...(QUALITY[quality] || QUALITY.fine), edges: false }));
    return this._meshes.get(quality);
  }
  /** Formato compatível com o renderizador: vértices + triângulos. */
  getMesh() {
    const t = this.tess();
    return { numProp: 3, vertProperties: Float32Array.from(t.positions), triVerts: t.indices, faceIds: t.faceIds };
  }
  props() { return (this._props ||= occ.massProps(this.shape)); }
  boundingBox() { return (this._bbox ||= occ.bbox(this.shape)); }
  volume() { return this.props().volume; }
  surfaceArea() { return this.props().area; }
  numTri() { return this.tess().indices.length / 3; }
  isEmpty() { return this.shape.IsNull() || occ.unique(this.shape, 'SOLID').length === 0; }
  faces() { return (this._faces ||= occ.unique(this.shape, 'FACE')); }
  edges() { return (this._edges ||= occ.unique(this.shape, 'EDGE')); }
  /** Característica de Euler-Poincaré → gênero (número de "furos passantes"). */
  genus() {
    const V = occ.unique(this.shape, 'VERTEX').length, E = this.edges().length, F = this.faces().length;
    const S = Math.max(1, occ.unique(this.shape, 'SHELL').length);
    return Math.round(S - (V - E + F) / 2);
  }
}
