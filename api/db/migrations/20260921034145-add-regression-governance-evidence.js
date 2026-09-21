/**
 * Migration: adiciona evidência real de REGRESSION/GOVERNANCE a engineering_attempts.
 *
 * ERV1-CLOSE-004: antes desta migration, REGRESSION/GOVERNANCE eram só transições de status —
 * nenhuma evidência persistida provava que algo determinístico rodou. Estas colunas guardam o
 * resultado real (comando/gate, exitCode, timestamps, sourceFingerprint) de cada checagem.
 */

'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDescription = await queryInterface.describeTable('engineering_attempts');

    if (!tableDescription.regression_evidence) {
      await queryInterface.addColumn('engineering_attempts', 'regression_evidence', {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Evidência real da checagem de regressão (testRuns já executados na tentativa)',
      });
    }

    if (!tableDescription.governance_evidence) {
      await queryInterface.addColumn('engineering_attempts', 'governance_evidence', {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Evidência real da execução do gate de governança (exitCode/output do script canônico)',
      });
    }
  },

  async down(queryInterface) {
    const tableDescription = await queryInterface.describeTable('engineering_attempts');
    if (tableDescription.governance_evidence) await queryInterface.removeColumn('engineering_attempts', 'governance_evidence');
    if (tableDescription.regression_evidence) await queryInterface.removeColumn('engineering_attempts', 'regression_evidence');
  },
};
