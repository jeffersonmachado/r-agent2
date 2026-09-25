'use strict';

/**
 * Fencing e lease distribuído para EngineeringTask (missão V2, §fencing).
 *
 * GAP CONFIRMADO por inspeção (2026-09-25): `engineering_tasks` tinha apenas `locked_at`/`locked_by`
 * — o mecanismo antigo, puramente temporal ("recuperando lock órfão" por tempo). Isso não impede:
 *   - worker ANTIGO finalizando depois de um takeover (sobrescreve o estado do novo);
 *   - dois workers executando a mesma task;
 *   - unlock indevido (qualquer um com o taskId limpa o lock).
 *
 * A missão exige os mesmos primitivos que `engineering_missions` já usa: lease_token, lease_fence
 * (monotônico), worker_instance_id, heartbeat e expiração. Aqui eles entram na tabela de TAREFA.
 * Nenhuma coluna é removida: `locked_at`/`locked_by` continuam para compatibilidade e diagnóstico.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const table = 'engineering_tasks';

    const describe = await queryInterface.describeTable(table);

    const columns = [
      ['lease_token', { type: DataTypes.UUID, allowNull: true }],
      ['lease_fence', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }],
      ['lease_worker_instance_id', { type: DataTypes.STRING(160), allowNull: true }],
      ['lease_host', { type: DataTypes.STRING(160), allowNull: true }],
      ['lease_acquired_at', { type: DataTypes.DATE, allowNull: true }],
      ['lease_expires_at', { type: DataTypes.DATE, allowNull: true }],
      ['lease_heartbeat_at', { type: DataTypes.DATE, allowNull: true }],
    ];

    for (const [name, spec] of columns) {
      if (Object.prototype.hasOwnProperty.call(describe, name)) continue;
      await queryInterface.addColumn(table, name, spec);
    }

    const indexes = await queryInterface.showIndex(table).catch(() => []);
    const hasIndex = (name) => indexes.some((idx) => idx.name === name);
    if (!hasIndex('engineering_tasks_lease_expires_idx')) {
      await queryInterface.addIndex(table, ['lease_expires_at'], { name: 'engineering_tasks_lease_expires_idx' });
    }
    if (!hasIndex('engineering_tasks_lease_worker_idx')) {
      await queryInterface.addIndex(table, ['lease_worker_instance_id'], { name: 'engineering_tasks_lease_worker_idx' });
    }
  },

  async down(queryInterface) {
    const table = 'engineering_tasks';
    const describe = await queryInterface.describeTable(table).catch(() => ({}));
    await queryInterface.removeIndex(table, 'engineering_tasks_lease_expires_idx').catch(() => {});
    await queryInterface.removeIndex(table, 'engineering_tasks_lease_worker_idx').catch(() => {});
    for (const name of ['lease_token', 'lease_fence', 'lease_worker_instance_id', 'lease_host', 'lease_acquired_at', 'lease_expires_at', 'lease_heartbeat_at']) {
      if (Object.prototype.hasOwnProperty.call(describe, name)) {
        await queryInterface.removeColumn(table, name).catch(() => {});
      }
    }
  },
};
