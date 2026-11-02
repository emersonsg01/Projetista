// Documentos de exemplo para a tela inicial.
const bolt = (n, r, z) => Array.from({ length: n }, (_, i) => [`${r}*cos(${(360 / n) * i})`, `${r}*sin(${(360 / n) * i})`, z]);

export const EXAMPLES = [
  {
    title: 'Suporte de motor NEMA 17', desc: 'Cantoneira em alumínio com furos ISO, rebaixos e filetes', icon: 'mate',
    data: {
      name: 'Suporte NEMA17', defaultMaterial: 'Alumínio 6061',
      parameters: { L: { expr: 70 }, W: { expr: 42.3 }, esp: { expr: 5 }, aba: { expr: 45 }, r: { expr: 4 } },
      features: [
        { type: 'sketch', name: 'Perfil', plane: 'XZ', shapes: [{ type: 'polygon', points: [[0, 0], ['L', 0], ['L', 'esp'], ['esp', 'esp'], ['esp', 'aba'], [0, 'aba']] }] },
        { type: 'extrude', name: 'Extrusão1', sketch: 'Perfil', distance: 'W', direction: 'symmetric', body: 'Suporte', material: 'Alumínio 6061' },
        { type: 'fillet', name: 'Filete1', body: 'Suporte', edges: { type: 'line', parallel: 'y', near: ['esp', 0, 'esp'] }, radius: 'r' },
        { type: 'hole', name: 'FuroMotor', target: 'Suporte', diameter: 22.5, direction: '+x', at: [0, 0, 'aba/2+esp/2'] },
        { type: 'hole', name: 'FurosM3', target: 'Suporte', size: 'M3', direction: '+x', positions: [[0, 15.5, 'aba/2+esp/2+15.5'], [0, -15.5, 'aba/2+esp/2+15.5'], [0, 15.5, 'aba/2+esp/2-15.5'], [0, -15.5, 'aba/2+esp/2-15.5']] },
        { type: 'hole', name: 'FurosBase', target: 'Suporte', size: 'M5', holeType: 'counterbore', positions: [['L-12', 12, 'esp'], ['L-12', -12, 'esp']] },
        { type: 'fillet', name: 'Filete2', body: 'Suporte', edges: { type: 'line', parallel: 'z', within: { min: ['L-1', -100, -1], max: ['L+1', 100, 'esp+1'] } }, radius: 3 },
      ],
    },
  },
  {
    title: 'Flange DN50', desc: 'Revolução, padrão de furos por expressões e chanfros', icon: 'revolve',
    data: {
      name: 'Flange DN50', defaultMaterial: 'Aço Inox 304',
      parameters: { D: { expr: 165 }, esp: { expr: 18 }, PCD: { expr: 125 }, d_furo: { expr: 18 }, DN: { expr: 60.3 }, colar: { expr: 45 } },
      features: [
        { type: 'sketch', name: 'Seção', plane: 'XZ', shapes: [{ type: 'polygon', points: [['DN/2', 0], ['D/2', 0], ['D/2', 'esp'], ['DN/2+10', 'esp'], ['DN/2+10', 'esp+colar'], ['DN/2', 'esp+colar']] }] },
        { type: 'revolve', name: 'Revolução1', sketch: 'Seção', axis: 'y', body: 'Flange', material: 'Aço Inox 304' },
        { type: 'hole', name: 'Parafusos', target: 'Flange', diameter: 'd_furo', positions: bolt(8, 'PCD/2', 'esp') },
        { type: 'chamfer', name: 'Chanfro1', body: 'Flange', edges: { type: 'circle', radius: 'D/2', onFace: { normal: '+z', pick: 'min' } }, distance: 2 },
        { type: 'fillet', name: 'Concordância', body: 'Flange', edges: { type: 'circle', radius: 'DN/2+10', within: { min: [-200, -200, 'esp-0.1'], max: [200, 200, 'esp+0.1'] } }, radius: 5 },
      ],
    },
  },
  {
    title: 'Caixa com tampa', desc: 'Casca, divisão em tampa, furos de fixação e arredondamentos', icon: 'shell',
    data: {
      name: 'Caixa eletrônica', defaultMaterial: 'PETG',
      parameters: { C: { expr: 100 }, L: { expr: 60 }, A: { expr: 35 }, parede: { expr: 2 }, corte: { expr: 'A-8' } },
      features: [
        { type: 'box', name: 'Bloco', width: 'C', depth: 'L', height: 'A', body: 'Caixa', material: 'PETG' },
        { type: 'fillet', name: 'Cantos', body: 'Caixa', edges: { type: 'line', parallel: 'z' }, radius: 6 },
        { type: 'shell', name: 'Casca1', body: 'Caixa', thickness: 'parede' },
        { type: 'split', name: 'Tampa', body: 'Caixa', normal: 'z', offset: 'corte', keep: 'both', otherBody: 'Base' },
        { type: 'rename_body', name: 'NomeTampa', body: 'Caixa', to: 'Tampa' },
        { type: 'transform', name: 'AbrirTampa', body: 'Tampa', translate: [0, 0, 15] },
        { type: 'hole', name: 'Ventilação', target: 'Tampa', diameter: 4, positions: [[-20, 0, 'A+15'], [-10, 0, 'A+15'], [0, 0, 'A+15'], [10, 0, 'A+15'], [20, 0, 'A+15']] },
      ],
    },
  },
];
