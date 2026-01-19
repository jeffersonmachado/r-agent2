/**
 * Model GenerationAudit - Auditoria de geração (metadata)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let GenerationAudit = null;

function getGenerationAuditModel() {
  if (!GenerationAudit) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }

    GenerationAudit = sequelize.define('GenerationAudit', {
      audit_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      timestamp: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      flow_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      rpa_test_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      sources: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      data: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    }, {
      tableName: 'generation_audits',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'timestamp'], name: 'generation_audits_tenant_key_timestamp_idx' },
        { fields: ['flow_id'], name: 'generation_audits_flow_id_idx' },
        { fields: ['rpa_test_id'], name: 'generation_audits_rpa_test_id_idx' },
      ],
    });
  }

  return GenerationAudit;
}

module.exports = getGenerationAuditModel;

