/**
 * Migration: adiciona evidência real de PROMOTION a engineering_attempts.
 *
 * ERV1-CLOSE-005: sem isso, GREEN não distinguia "patch validado num workspace temporário" de
 * "patch existe no repositório real" — a evidência de promoção (hash validado, commit
 * candidato, branch, resultado do smoke pós-promoção) precisa ser persistida por tentativa.
 */

'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDescription = await queryInterface.describeTable('engineering_attempts');

    if (!tableDescription.promotion_evidence) {
      await queryInterface.addColumn('engineering_attempts', 'promotion_evidence', {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Evidência real de promoção (validatedPatchHash, candidateCommit, candidateBranch, smoke pós-promoção)',
      });
    }

    if (!tableDescription.promotion_status) {
      await queryInterface.addColumn('engineering_attempts', 'promotion_status', {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'PROMOTED|READY_FOR_PROMOTION — null quando a tentativa não chegou a GREEN',
      });
    }
  },

  async down(queryInterface) {
    const tableDescription = await queryInterface.describeTable('engineering_attempts');
    if (tableDescription.promotion_status) await queryInterface.removeColumn('engineering_attempts', 'promotion_status');
    if (tableDescription.promotion_evidence) await queryInterface.removeColumn('engineering_attempts', 'promotion_evidence');
  },
};
