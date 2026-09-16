'use strict';

/**
 * Migration: veredito de RELEVÂNCIA DE MERCADO persistido por candidato.
 *
 * `market_relevance` (JSONB, nullable): o veredito completo do gate de
 * pertencimento (`api/services/marketDiscovery/relevance.js`) medido sobre o
 * conteúdo obtido — evaluated/state/reason/signalCount/minSignals/
 * matchedTerms/domain. Sem esta coluna, o veredito era computado em memória
 * para decidir ACCEPTED/OUT_OF_MARKET e DESCARTADO na gravação: depois do
 * persist, ninguém conseguia auditar POR QUE um candidato foi aceito (o run
 * real r4 de 2026-09-16 mostrou aceites com market_relevance ausente).
 * Rejeição e aceitação são fatos auditáveis — não só o estado final.
 *
 * Idempotente: a coluna é criada apenas quando ainda não existe.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const description = await queryInterface.describeTable('market_candidates');
    if (description.market_relevance) return;
    await queryInterface.addColumn('market_candidates', 'market_relevance', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    const description = await queryInterface.describeTable('market_candidates');
    if (!description.market_relevance) return;
    await queryInterface.removeColumn('market_candidates', 'market_relevance');
  },
};
