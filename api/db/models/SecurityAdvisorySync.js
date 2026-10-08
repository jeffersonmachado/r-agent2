'use strict';

/**
 * Model SecurityAdvisorySync — registro de cada sincronização de base de
 * advisories.
 *
 * Existe para responder "de quando é esta informação?" com dado, e não com
 * suposição. `snapshot_sha256` permite comparar duas bases; `failures` mantém
 * as fontes que falharam visíveis (uma base parcial nunca pode ser lida como
 * base completa).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let SecurityAdvisorySync = null;

function getSecurityAdvisorySyncModel() {
  if (!SecurityAdvisorySync) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    SecurityAdvisorySync = sequelize.define('SecurityAdvisorySync', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_key: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      source: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'PASS' },
      scope: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      packages_queried: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      advisories_upserted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      advisories_total: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      snapshot_sha256: { type: DataTypes.STRING, allowNull: true },
      source_age_hours: { type: DataTypes.INTEGER, allowNull: true },
      failures: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      started_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      finished_at: { type: DataTypes.DATE, allowNull: true },
      duration_ms: { type: DataTypes.INTEGER, allowNull: true },
      actor: { type: DataTypes.STRING, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
    }, {
      tableName: 'security_advisory_syncs',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'source', 'started_at'], name: 'security_advisory_syncs_lookup_idx' },
      ],
    });
  }
  return SecurityAdvisorySync;
}

module.exports = getSecurityAdvisorySyncModel;
