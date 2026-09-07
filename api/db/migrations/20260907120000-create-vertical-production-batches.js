'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

/**
 * Migration: Vertical production batches (Bakery demand→production loop)
 *
 * Persiste o loop previsão→produção→sobra/ruptura por produto e dia:
 * forecast ML (ridge regression por produto), recomendação de produção,
 * resultado real (produzido/vendido/sobra/ruptura) e versão do modelo usada.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'vertical_production_batches', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      vertical: { type: Sequelize.STRING, allowNull: false, defaultValue: 'bakery' },
      product_key: { type: Sequelize.STRING, allowNull: false },
      batch_date: { type: Sequelize.DATEONLY, allowNull: false },
      forecast_qty: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      recommended_qty: { type: Sequelize.INTEGER, allowNull: true },
      planned_qty: { type: Sequelize.INTEGER, allowNull: true },
      produced_qty: { type: Sequelize.INTEGER, allowNull: true },
      sold_qty: { type: Sequelize.INTEGER, allowNull: true },
      leftover_qty: { type: Sequelize.INTEGER, allowNull: true },
      stockout: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      model_version: { type: Sequelize.INTEGER, allowNull: true },
      computed_by: { type: Sequelize.STRING, allowNull: false, defaultValue: 'ml_ridge_regression' },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'vertical_production_batches', ['tenant_key', 'vertical', 'batch_date'], {
      name: 'vpb_tenant_vertical_date_idx',
    });
    await addIndexIfNotExists(queryInterface, 'vertical_production_batches', ['tenant_key', 'vertical', 'product_key', 'batch_date'], {
      name: 'vpb_unique_batch_idx',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('vertical_production_batches');
  },
};
