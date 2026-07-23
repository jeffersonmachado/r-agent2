'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let UserCertification = null;

function getUserCertificationModel() {
  if (!UserCertification) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    UserCertification = sequelize.define('UserCertification', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      agentId: { type: DataTypes.STRING, allowNull: false },
      skillKey: { type: DataTypes.STRING, allowNull: false },
      level: { type: DataTypes.STRING, allowNull: false, defaultValue: 'operacional' },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      assessmentSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      evidenceRefs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      issuedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      revokedAt: { type: DataTypes.DATE, allowNull: true },
      revokeReason: { type: DataTypes.STRING, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'user_certifications',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'agent_id', 'skill_key'], name: 'uc_tenant_agent_skill_idx' },
        { fields: ['tenant_id', 'agent_id', 'status'], name: 'uc_tenant_agent_status_idx' },
      ],
    });
  }

  return UserCertification;
}

module.exports = getUserCertificationModel;
