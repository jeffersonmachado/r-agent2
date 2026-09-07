const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let VerticalProductionBatch = null;

function getVerticalProductionBatchModel() {
  if (!VerticalProductionBatch) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); },
      });
    }

    VerticalProductionBatch = sequelize.define('VerticalProductionBatch', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING, allowNull: false, defaultValue: 'bakery' },
      product_key: { type: DataTypes.STRING, allowNull: false },
      batch_date: { type: DataTypes.DATEONLY, allowNull: false },
      forecast_qty: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      recommended_qty: { type: DataTypes.INTEGER, allowNull: true },
      planned_qty: { type: DataTypes.INTEGER, allowNull: true },
      produced_qty: { type: DataTypes.INTEGER, allowNull: true },
      sold_qty: { type: DataTypes.INTEGER, allowNull: true },
      leftover_qty: { type: DataTypes.INTEGER, allowNull: true },
      stockout: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      model_version: { type: DataTypes.INTEGER, allowNull: true },
      computed_by: { type: DataTypes.STRING, allowNull: false, defaultValue: 'ml_ridge_regression' },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'vertical_production_batches',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'vertical', 'batch_date'], name: 'vpb_tenant_vertical_date_idx' },
        { unique: true, fields: ['tenant_key', 'vertical', 'product_key', 'batch_date'], name: 'vpb_unique_batch_idx' },
      ],
    });
  }
  return VerticalProductionBatch;
}

module.exports = getVerticalProductionBatchModel;
