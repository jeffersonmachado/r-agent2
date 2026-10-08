'use strict';

/**
 * Model SecurityDiscoveryRun — execução de descoberta de componentes.
 *
 * Guarda o resultado JUNTO com a cobertura e as indisponibilidades da coleta.
 * Sem isso, "não encontrei vulnerabilidade" ficaria indistinguível de "não
 * consegui olhar" — que é exatamente a confusão que esta capacidade existe
 * para eliminar.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let SecurityDiscoveryRun = null;

function getSecurityDiscoveryRunModel() {
  if (!SecurityDiscoveryRun) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    SecurityDiscoveryRun = sequelize.define('SecurityDiscoveryRun', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_key: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'PASS' },
      started_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      finished_at: { type: DataTypes.DATE, allowNull: true },
      duration_ms: { type: DataTypes.INTEGER, allowNull: true },
      counts: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      coverage: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      sources: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      unavailable: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      drift: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      warnings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      identity_conflicts: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      engine_version: { type: DataTypes.STRING, allowNull: false, defaultValue: 'unknown' },
      actor: { type: DataTypes.STRING, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true, unique: true },
    }, {
      tableName: 'security_discovery_runs',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'started_at'], name: 'security_discovery_runs_tenant_started_idx' },
        { unique: true, fields: ['idempotency_key'], name: 'security_discovery_runs_idempotency_key_unique' },
      ],
    });
  }
  return SecurityDiscoveryRun;
}

module.exports = getSecurityDiscoveryRunModel;
