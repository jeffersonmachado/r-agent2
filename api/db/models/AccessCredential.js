const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AccessCredential = null;

function getAccessCredentialModel() {
  if (!AccessCredential) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    AccessCredential = sequelize.define('AccessCredential', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      subject_id: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      credential_hash: { type: DataTypes.STRING, allowNull: true },
      credential_ref: { type: DataTypes.STRING, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      expires_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      tableName: 'access_credentials',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'subject_id'], name: 'access_credentials_tenant_subject_idx' },
        { fields: ['tenant_key', 'credential_hash'], name: 'access_credentials_tenant_hash_idx' },
      ],
    });
  }

  return AccessCredential;
}

module.exports = getAccessCredentialModel;
