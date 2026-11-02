// Biblioteca de materiais: densidade (g/cm³), cor padrão e preço aproximado (R$/kg).
export const MATERIALS = {
  'PLA': { density: 1.24, color: '#4f8cff', pricePerKg: 120, kind: 'polímero (impressão 3D)' },
  'PETG': { density: 1.27, color: '#3fbfa0', pricePerKg: 130, kind: 'polímero (impressão 3D)' },
  'ABS': { density: 1.04, color: '#e0e0e0', pricePerKg: 110, kind: 'polímero (impressão 3D)' },
  'ASA': { density: 1.07, color: '#d8d8d8', pricePerKg: 150, kind: 'polímero (impressão 3D)' },
  'TPU': { density: 1.21, color: '#333333', pricePerKg: 180, kind: 'elastômero (impressão 3D)' },
  'Nylon PA12': { density: 1.01, color: '#f2efe6', pricePerKg: 350, kind: 'polímero' },
  'Resina': { density: 1.18, color: '#9aa5b1', pricePerKg: 250, kind: 'fotopolímero (SLA)' },
  'Aço 1020': { density: 7.87, color: '#8c9196', pricePerKg: 12, kind: 'metal' },
  'Aço Inox 304': { density: 8.0, color: '#b4b9be', pricePerKg: 35, kind: 'metal' },
  'Alumínio 6061': { density: 2.7, color: '#c3c8cd', pricePerKg: 40, kind: 'metal' },
  'Latão': { density: 8.5, color: '#c9a64a', pricePerKg: 60, kind: 'metal' },
  'Cobre': { density: 8.96, color: '#c27a4a', pricePerKg: 70, kind: 'metal' },
  'Titânio Ti6Al4V': { density: 4.43, color: '#8f8f9a', pricePerKg: 400, kind: 'metal' },
  'Madeira (Pinus)': { density: 0.5, color: '#c8a06a', pricePerKg: 8, kind: 'madeira' },
  'MDF': { density: 0.75, color: '#b08a5a', pricePerKg: 6, kind: 'madeira' },
  'Concreto': { density: 2.4, color: '#a0a0a0', pricePerKg: 0.5, kind: 'construção' },
  'Vidro': { density: 2.5, color: '#bfe3ef', pricePerKg: 15, kind: 'cerâmico' },
};

export const DEFAULT_MATERIAL = 'PLA';

const PALETTE = ['#4f8cff', '#ff8a3d', '#3fbf6f', '#c45bff', '#ffcc33', '#ff5c7a', '#2ec4d6', '#9aa5b1'];
export function paletteColor(i) { return PALETTE[i % PALETTE.length]; }
