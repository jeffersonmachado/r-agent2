'use strict';

/**
 * Model EngineeringTelemetryEvent — telemetria básica V1 (sem roteamento adaptativo). Um
 * evento por chamada de modelo (CODER ou REVIEWER) dentro de uma tentativa.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringTelemetryEvent = null;

function getEngineeringTelemetryEventModel() {
  if (!EngineeringTelemetryEvent) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringTelemetryEvent = sequelize.define('EngineeringTelemetryEvent', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      task_id: { type: DataTypes.UUID, allowNull: false },
      attempt_id: { type: DataTypes.UUID, allowNull: true },
      role: { type: DataTypes.STRING, allowNull: false },
      provider: { type: DataTypes.STRING, allowNull: true },
      model: { type: DataTypes.STRING, allowNull: true },
      input_tokens: { type: DataTypes.INTEGER, allowNull: true },
      output_tokens: { type: DataTypes.INTEGER, allowNull: true },
      estimated_cost: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UNKNOWN' },
      latency_ms: { type: DataTypes.INTEGER, allowNull: true },
      result: { type: DataTypes.STRING, allowNull: false },
      test_pass: { type: DataTypes.BOOLEAN, allowNull: true },
      review_result: { type: DataTypes.STRING, allowNull: true },
      // Eventos de liveness/deadline (TIMEOUT, NO_PROGRESS, LEASE_LOST, STALE_WRITE_REJECTED) com o
      // registro estruturado completo — ver migration 20260928120000-engineering-telemetry-detail.
      event_type: { type: DataTypes.STRING(48), allowNull: true },
      detail: { type: DataTypes.JSONB, allowNull: true },
    }, {
      tableName: 'engineering_telemetry_events',
      timestamps: true,
      underscored: true,
      updatedAt: false,
      indexes: [
        { fields: ['task_id'], name: 'engineering_telemetry_task_idx' },
        { fields: ['role'], name: 'engineering_telemetry_role_idx' },
        { fields: ['provider', 'model'], name: 'engineering_telemetry_provider_model_idx' },
      ],
    });
  }
  return EngineeringTelemetryEvent;
}

module.exports = getEngineeringTelemetryEventModel;
