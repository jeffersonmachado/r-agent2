/**
 * Migration: adiciona status/saldo/último erro a tenant_ai_credentials.
 *
 * Antes desta migration a única forma de "reagir" a uma credencial sem saldo ou inválida era
 * apagar a linha inteira — perdendo a chave e qualquer histórico. Estas colunas permitem manter
 * a credencial salva e destacar visualmente na UI quando ela está sem saldo/inválida, com o
 * resultado do último teste real feito contra o provider (POST /config/validate-provider-token).
 */

'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDescription = await queryInterface.describeTable('tenant_ai_credentials');

    if (!tableDescription.status) {
      await queryInterface.addColumn('tenant_ai_credentials', 'status', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'unknown',
        comment: "unknown|valid|invalid_token|no_credit|error — resultado do último teste real contra o provider",
      });
    }

    if (!tableDescription.last_tested_at) {
      await queryInterface.addColumn('tenant_ai_credentials', 'last_tested_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!tableDescription.last_error) {
      await queryInterface.addColumn('tenant_ai_credentials', 'last_error', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }

    if (!tableDescription.metadata) {
      await queryInterface.addColumn('tenant_ai_credentials', 'metadata', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Dados extras não sensíveis do último teste, ex.: { balance: { amount, currency, checkedAt } }',
      });
    }
  },

  async down(queryInterface) {
    const tableDescription = await queryInterface.describeTable('tenant_ai_credentials');
    if (tableDescription.metadata) await queryInterface.removeColumn('tenant_ai_credentials', 'metadata');
    if (tableDescription.last_error) await queryInterface.removeColumn('tenant_ai_credentials', 'last_error');
    if (tableDescription.last_tested_at) await queryInterface.removeColumn('tenant_ai_credentials', 'last_tested_at');
    if (tableDescription.status) await queryInterface.removeColumn('tenant_ai_credentials', 'status');
  },
};
