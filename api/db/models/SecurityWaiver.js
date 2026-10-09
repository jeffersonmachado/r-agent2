'use strict';

/**
 * Model SecurityWaiver — aceitação formal de risco, com expiração.
 *
 * Um waiver NÃO é um "silenciador" do gate: ele é a evidência de que um humano
 * identificado aceitou um risco específico por um motivo declarado e por um
 * prazo. O motor de risco só marca `MITIGATED` quando existe waiver VIGENTE —
 * waiver expirado ou revogado volta a contar como risco aberto.
 *
 * `expires_at` é NOT NULL (a isenção perpétua não é representável) e nada é
 * apagado na revogação: `revoked_at`/`revoked_by`/`revoke_reason` preservam o
 * histórico, porque histórico é evidência.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let SecurityWaiver = null;

function getSecurityWaiverModel() {
  if (!SecurityWaiver) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    SecurityWaiver = sequelize.define('SecurityWaiver', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_key: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      waiver_key: { type: DataTypes.STRING, allowNull: false },
      finding_key: { type: DataTypes.STRING, allowNull: false },
      advisory_id: { type: DataTypes.STRING, allowNull: true },
      package_name: { type: DataTypes.STRING, allowNull: true },
      service: { type: DataTypes.STRING, allowNull: true },
      severity: { type: DataTypes.STRING, allowNull: true },
      reason: { type: DataTypes.TEXT, allowNull: false },
      compensating_control: { type: DataTypes.TEXT, allowNull: true },
      approved_by: { type: DataTypes.STRING, allowNull: false },
      created_by: { type: DataTypes.STRING, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      revoked_by: { type: DataTypes.STRING, allowNull: true },
      revoke_reason: { type: DataTypes.TEXT, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'security_waivers',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['tenant_key', 'waiver_key'], name: 'security_waivers_tenant_key_unique' },
        { fields: ['tenant_key', 'finding_key'], name: 'security_waivers_finding_idx' },
        { fields: ['expires_at'], name: 'security_waivers_expires_idx' },
      ],
    });
  }
  return SecurityWaiver;
}

module.exports = getSecurityWaiverModel;
