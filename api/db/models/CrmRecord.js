/**
 * Model CrmRecord — registros do CRM (contas, funis, oportunidades, atividades).
 *
 * O CRM expõe CRUD por entidade; o payload de cada uma é JSONB em `payload`,
 * escopado por `tenant_key` + `entity`. Leads e contatos NÃO ficam aqui: eles
 * usam `marketing_leads` (mesma fonte que o painel agrega).
 *
 * Criado por `api/db/migrations/20261019120000-create-crm-records.js`.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmRecord = null;

function getCrmRecordModel() {
  if (!CrmRecord) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    CrmRecord = sequelize.define('CrmRecord', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      entity: { type: DataTypes.STRING, allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'crm_records',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'entity'], name: 'crm_records_tenant_entity_idx' },
        { fields: ['tenant_key', 'entity', 'updated_at'], name: 'crm_records_tenant_entity_updated_idx' },
      ],
    });
  }

  return CrmRecord;
}

module.exports = getCrmRecordModel;
