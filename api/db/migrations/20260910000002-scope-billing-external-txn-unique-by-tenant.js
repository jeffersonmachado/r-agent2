'use strict';

/**
 * Corrige o escopo da unicidade de referência externa em `billing_transactions`.
 *
 * DEFEITO PRÉ-EXISTENTE COMPROVADO: o índice único
 * `bt_provider_external_txn_uq (provider, external_transaction_id)` é GLOBAL.
 * Como `external_transaction_id` é o identificador do provedor, e cada academia
 * (tenant) tem seu próprio conjunto de ids, o mesmo id em tenants diferentes
 * colide e a segunda importação falha com 23505.
 *
 * Evidência: `tests/integration/evoSyncIntegration.test.js` ("isola tenants:
 * mesmo external id em outro tenant é outra identidade") — falhava com violação
 * de unicidade antes desta migration.
 *
 * Correção: substituir por UNIQUE PARCIAL por tenant
 * `(tenant_key, provider, external_transaction_id) WHERE external_transaction_id
 * IS NOT NULL`. Parcial porque a coluna é nullable e múltiplos NULL são válidos.
 *
 * Segurança: só troca índices (DDL), sem tocar dados. Idempotente.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Remove o índice global defeituoso.
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS bt_provider_external_txn_uq',
    );

    // 2. Cria o índice correto, escopado por tenant, apenas para referências
    //    externas presentes (parcial: NULLs não concorrem).
    const { addIndexIfNotExists } = require('../migrations-helper');
    await addIndexIfNotExists(
      queryInterface,
      'billing_transactions',
      ['tenant_key', 'provider', 'external_transaction_id'],
      {
        name: 'bt_tenant_provider_external_txn_uq',
        unique: true,
        where: { external_transaction_id: { [Sequelize.Op.ne]: null } },
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS bt_tenant_provider_external_txn_uq',
    );
    const { addIndexIfNotExists } = require('../migrations-helper');
    await addIndexIfNotExists(queryInterface, 'billing_transactions', ['provider', 'external_transaction_id'], {
      name: 'bt_provider_external_txn_uq',
      unique: true,
    });
  },
};
