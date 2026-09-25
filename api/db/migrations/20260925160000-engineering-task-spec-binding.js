'use strict';

/**
 * Vínculo verificável EngineeringTask ↔ MissionSpec (missão V2, §22/§23 — stale mission spec).
 *
 * GAP CONFIRMADO por inspeção (2026-09-25): `engineering_tasks` não tinha NENHUMA coluna de
 * vínculo com a missão. Uma task criada para a MissionSpec v1 continuava executando
 * (CODING → TESTING → REVIEWING → REGRESSION → GOVERNANCE → PROMOTING, com efeito REAL no git)
 * depois de a missão já estar na v2 aprovada, e nenhuma fase material podia detectar isso.
 *
 * Aqui entram as colunas de vínculo + o estado de frescor persistido. Nenhuma coluna é removida:
 * tasks antigas ficam com vínculo nulo e o serviço faz backfill quando o vínculo for derivável.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const table = 'engineering_tasks';

    const describe = await queryInterface.describeTable(table);

    const columns = [
      ['mission_id', { type: DataTypes.UUID, allowNull: true }],
      ['mission_version', { type: DataTypes.INTEGER, allowNull: true }],
      ['mission_spec_hash', { type: DataTypes.STRING(80), allowNull: true }],
      // CURRENT | STALE | SUPERSEDED | UNBOUND — estado medido, não presumido.
      ['mission_spec_state', { type: DataTypes.STRING(20), allowNull: true }],
      ['superseded_by_task_id', { type: DataTypes.UUID, allowNull: true }],
      ['mission_spec_checked_at', { type: DataTypes.DATE, allowNull: true }],
    ];

    for (const [name, definition] of columns) {
      if (!describe[name]) await queryInterface.addColumn(table, name, definition);
    }

    const indexes = [
      { fields: ['mission_id'], name: 'engineering_tasks_mission_id_idx' },
      { fields: ['mission_spec_state'], name: 'engineering_tasks_mission_spec_state_idx' },
    ];
    const existing = (await queryInterface.showIndex(table)).map((i) => i.name);
    for (const index of indexes) {
      if (!existing.includes(index.name)) await queryInterface.addIndex(table, index);
    }
  },

  async down(queryInterface) {
    const table = 'engineering_tasks';
    const describe = await queryInterface.describeTable(table);
    for (const name of ['mission_id', 'mission_version', 'mission_spec_hash', 'mission_spec_state', 'superseded_by_task_id', 'mission_spec_checked_at']) {
      if (describe[name]) await queryInterface.removeColumn(table, name);
    }
  },
};
