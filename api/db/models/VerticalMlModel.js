const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let VerticalMlModel = null;

function getVerticalMlModelModel() {
  if (!VerticalMlModel) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); },
      });
    }

    VerticalMlModel = sequelize.define('VerticalMlModel', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      model_type: { type: DataTypes.STRING, allowNull: false },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      algorithm: { type: DataTypes.STRING, allowNull: false, defaultValue: 'logistic_regression' },
      weights: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      metrics: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      trained_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'vertical_ml_models',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'model_type', 'status'], name: 'vmm_tenant_type_status_idx' },
        { fields: ['tenant_key', 'model_type', 'version'], name: 'vmm_tenant_type_version_idx' },
      ],
    });
  }
  return VerticalMlModel;
}

module.exports = getVerticalMlModelModel;
