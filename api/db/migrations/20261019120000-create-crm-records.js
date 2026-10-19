'use strict';

/**
 * Migration: `crm_records` — persistência dos registros do CRM.
 *
 * DEFEITO MEDIDO (2026-10-19, H21): contas, funis, oportunidades e atividades
 * viviam em um `Map` por processo dentro de `api/modules/crm/routes.js`. O
 * registro era aceito com 200, NÃO aparecia na lista logo depois (leitura vinha
 * de outra fonte) e desaparecia no restart. A regra do projeto também proíbe
 * fallback em memória: falha de banco tem de ser erro explícito.
 *
 * Modelo: uma tabela genérica com o payload da entidade em JSONB. Isso evita
 * quatro tabelas quase idênticas e mantém a fonte de verdade única por registro,
 * com escopo de tenant e índice por (tenant, entidade).
 *
 * Leads e contatos NÃO usam esta tabela: eles vivem em `marketing_leads`, que é
 * de onde o painel sempre agregou esses números.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const tables = await queryInterface.showAllTables();
    const existe = tables.map((t) => String(t).toLowerCase()).includes('crm_records');
    if (existe) return;

    await queryInterface.createTable('crm_records', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      entity: { type: DataTypes.STRING, allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('crm_records', ['tenant_key', 'entity'], {
      name: 'crm_records_tenant_entity_idx',
    });
    await queryInterface.addIndex('crm_records', ['tenant_key', 'entity', 'updated_at'], {
      name: 'crm_records_tenant_entity_updated_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('crm_records');
  },
};
