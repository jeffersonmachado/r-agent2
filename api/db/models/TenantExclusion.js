/**
 * Model TenantExclusion - termos de exclusão persistidos por tenant (tenant_id-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let TenantExclusion = null;

function getTenantExclusionModel() {
  if (!TenantExclusion) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    TenantExclusion = sequelize.define('TenantExclusion', {
      tenant_id: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
      },
      term: {
        type: DataTypes.STRING(120),
        allowNull: false,
        primaryKey: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    }, {
      tableName: 'tenant_exclusions',
      timestamps: false, // tabela minimalista: só created_at
      underscored: true,
      indexes: [
        { fields: ['tenant_id'], name: 'tenant_exclusions_tenant_id_idx' },
        { unique: true, fields: ['tenant_id', 'term'], name: 'tenant_exclusions_unique' },
        { fields: ['created_at'], name: 'tenant_exclusions_created_at_idx' },
      ],
    });
  }

  return TenantExclusion;
}

module.exports = getTenantExclusionModel;

