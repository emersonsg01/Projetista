// Testa a API usada pela interface: transações (pré-visualização), edição de esboço e renomear.
import { Studio } from '../src/studio.js';
process.env.PROJETISTA_HOME ||= 'tests/out';
const s = await Studio.create();
let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(cond ? 'ok  ' : 'FALHA', msg); };
await s.run('new_document', { name: 'ui' });
await s.run('add_feature', { feature: { type: 'box', width: 20, body: 'B' } });
const undo0 = s.doc.undoStack.length;
// transação cancelada: tudo volta
await s.run('tx_begin', { label: 'Filete' });
await s.run('add_feature', { feature: { type: 'fillet', body: 'B', edges: 'all', radius: 1 } });
await s.run('update_feature', { name: 'Filete1', patch: { radius: 2 } });
await s.run('tx_cancel');
ok(s.doc.features.length === 1 && s.doc.undoStack.length === undo0, 'cancelar transação restaura o documento e o histórico');
// transação confirmada: vira uma entrada só
await s.run('tx_begin', { label: 'Filete' });
await s.run('add_feature', { feature: { type: 'fillet', body: 'B', edges: 'all', radius: 1 } });
await s.run('update_feature', { name: 'Filete1', patch: { radius: 2 } });
await s.run('update_feature', { name: 'Filete1', patch: { radius: 3 } });
await s.run('tx_commit', { label: 'Filete Filete1' });
ok(s.doc.undoStack.length === undo0 + 1 && s.doc.undoStack.at(-1).label === 'Filete Filete1', 'confirmar transação gera uma única entrada de desfazer');
await s.run('undo');
ok(s.doc.features.length === 1, 'desfazer remove o filete inteiro');
// esboço com shapes → explodir → editar como geometria explícita
await s.run('add_feature', { feature: { type: 'sketch', name: 'S', plane: 'XY', offset: 30, shapes: [{ type: 'rect', center: [0, 0], width: 'L0', height: 10 }] } }).catch(() => {});
await s.run('set_parameter', { name: 'L0', expr: 25 });
const before = await s.run('sketch_info', { name: 'S' });
await s.run('explode_sketch', { name: 'S' });
const after = await s.run('sketch_info', { name: 'S' });
ok(after.explicit && after.dof === before.dof && after.constraints.some((c) => c.value === 'L0'), `explodir mantém cotas paramétricas (dof ${after.dof})`);
await s.run('add_feature', { feature: { type: 'extrude', sketch: 'S', distance: 5, body: 'E' } });
await s.run('rename_feature', { name: 'S', to: 'Base do perfil' });
ok(s.doc.features.find((f) => f.type === 'extrude').sketch === 'Base do perfil' && !s.doc.summary().errors.length, 'renomear esboço atualiza a extrusão que o usa');
await s.run('set_parameter', { name: 'L0', expr: 40 });
ok(Math.abs(s.doc.bodies.get('E').m.volume() - 40 * 10 * 5) < 1e-6, 'cota paramétrica do esboço explodido continua dirigindo a geometria');
console.log(fails ? `${fails} FALHA(S)` : 'TUDO OK');
process.exit(fails ? 1 : 0);
