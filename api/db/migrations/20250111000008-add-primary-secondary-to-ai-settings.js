/**
 * Migration: Add primary and secondary columns to tenant_ai_settings
 */

'use strict';

const { connect } = require('../sequelize');
const { TenantAISetting } = require('../models');

module.exports = {
  async up(queryInterface, Sequelize) {
    // Conecta ao Sequelize se necessário (garante que os models funcionem)
    const sequelize = queryInterface.sequelize;
    if (!sequelize) {
      await connect();
    }
    
    // Verifica se as colunas já existem usando describeTable
    const tableDescription = await queryInterface.describeTable('tenant_ai_settings');
    const existingColumns = Object.keys(tableDescription);
    
    // Adiciona coluna primary se não existir
    // Usa field: 'primary' para que o Sequelize adicione aspas automaticamente (palavra reservada)
    if (!existingColumns.includes('primary')) {
      await queryInterface.addColumn('tenant_ai_settings', 'primary', {
        type: Sequelize.STRING,
        allowNull: true,
        field: 'primary', // Sequelize adiciona aspas automaticamente para palavras reservadas
      });
    }

    // Adiciona coluna secondary se não existir
    if (!existingColumns.includes('secondary')) {
      await queryInterface.addColumn('tenant_ai_settings', 'secondary', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    // Migra dados existentes: provider vira primary usando o model
    const TenantAISettingModel = TenantAISetting();
    const aiSettings = await TenantAISettingModel.findAll({
      where: {
        primary: null,
        provider: { [Sequelize.Op.ne]: null }
      }
    });

    // Atualiza cada registro usando o model
    for (const setting of aiSettings) {
      await setting.update({
        primary: setting.provider
      });
    }
  },

  async down(queryInterface, Sequelize) {
    // Remove colunas usando removeColumn do Sequelize
    const tableDescription = await queryInterface.describeTable('tenant_ai_settings');
    
    if (tableDescription.secondary) {
      await queryInterface.removeColumn('tenant_ai_settings', 'secondary');
    }
    
    if (tableDescription.primary) {
      await queryInterface.removeColumn('tenant_ai_settings', 'primary');
    }
  },
};
