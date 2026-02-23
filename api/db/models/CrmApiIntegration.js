const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmApiIntegration = null;

function getCrmApiIntegrationModel() {
  if (!CrmApiIntegration) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }

    CrmApiIntegration = sequelize.define('CrmApiIntegration', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      provider: {
        type: DataTypes.ENUM('salesforce', 'hubspot', 'pipedrive', 'custom'),
        allowNull: false,
      },
      credentials: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      sync_direction: {
        type: DataTypes.ENUM('inbound', 'outbound', 'bidirectional'),
        defaultValue: 'bidirectional',
      },
      last_sync_at: {
        type: DataTypes.DATE,
      },
      active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    }, {
      tableName: 'crm_api_integrations',
      timestamps: false,
    });
  }

  return CrmApiIntegration;
}

module.exports = getCrmApiIntegrationModel;
