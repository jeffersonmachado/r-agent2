/**
 * Migration: adiciona explicit_policy_authorization a engineering_tasks.
 *
 * ER-V1-FINAL-003 — Fail-Closed Scope: allowedPaths vazio/ausente nunca mais significa "tudo
 * permitido" por omissão. A única exceção (scope=REPOSITORY_WIDE) exige uma autorização
 * explícita e deliberada, persistida — nunca inferida ou default.
 */

'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDescription = await queryInterface.describeTable('engineering_tasks');

    if (!tableDescription.explicit_policy_authorization) {
      await queryInterface.addColumn('engineering_tasks', 'explicit_policy_authorization', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Autorização explícita e deliberada para scope=REPOSITORY_WIDE com allowedPaths vazio — nunca default true',
      });
    }
  },

  async down(queryInterface) {
    const tableDescription = await queryInterface.describeTable('engineering_tasks');
    if (tableDescription.explicit_policy_authorization) {
      await queryInterface.removeColumn('engineering_tasks', 'explicit_policy_authorization');
    }
  },
};
