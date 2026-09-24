'use strict';

/**
 * Model EngineeringMissionApproval — registro de aprovação (humana ou por política).
 *
 * Uma aprovação referencia EXATAMENTE (mission_id, spec_version, spec_hash). Isso é o que torna
 * impossível executar uma versão diferente da aprovada — e o que torna a autoaprovação auditável:
 * política aplicada, regras avaliadas, bloqueios encontrados e diff de enriquecimento ficam
 * persistidos mesmo quando a decisão foi automática (§10, §12).
 *
 * `(mission_id, spec_version, state)` é único: dois workers não conseguem criar duas aprovações
 * divergentes para a mesma versão.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringMissionApproval = null;

function getEngineeringMissionApprovalModel() {
  if (!EngineeringMissionApproval) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringMissionApproval = sequelize.define('EngineeringMissionApproval', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      mission_id: { type: DataTypes.UUID, allowNull: false },
      spec_version: { type: DataTypes.INTEGER, allowNull: false },
      spec_hash: { type: DataTypes.STRING, allowNull: false },
      state: { type: DataTypes.STRING, allowNull: false, defaultValue: 'PENDING' },
      mode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'MANUAL' },
      policy_id: { type: DataTypes.STRING, allowNull: true },
      policy_snapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      rules_evaluated: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      blockers: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      enrichment_diff: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      // Histórico append-only das decisões anteriores desta versão (ex.: PENDING→APPROVED,
      // APPROVED→REJECTED). Uma decisão nunca apaga a anterior — apenas a sucede.
      history: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      decision_reason: { type: DataTypes.TEXT, allowNull: true },
      actor: { type: DataTypes.STRING, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true, unique: true },
      decided_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      tableName: 'engineering_mission_approvals',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['mission_id', 'spec_version'], name: 'engineering_mission_approvals_version_unique' },
        { fields: ['mission_id'], name: 'engineering_mission_approvals_mission_idx' },
        { unique: true, fields: ['idempotency_key'], name: 'engineering_mission_approvals_idempotency_key_unique' },
      ],
    });
  }
  return EngineeringMissionApproval;
}

module.exports = getEngineeringMissionApprovalModel;
