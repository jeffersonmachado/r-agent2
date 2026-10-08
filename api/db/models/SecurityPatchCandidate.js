'use strict';

/**
 * Model SecurityPatchCandidate — proposta de correção de um achado.
 *
 * `status` separa PROPOSTA de EXECUÇÃO: uma proposta nunca aplica nada; a
 * execução acontece na missão do Roteador Engenheiro (`mission_id`) e é o
 * resultado dela que muda o estado. `requires_human_approval` é gravado no
 * registro (não recalculado na leitura) para que a decisão de autonomia fique
 * auditável mesmo se a política mudar depois.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let SecurityPatchCandidate = null;

function getSecurityPatchCandidateModel() {
  if (!SecurityPatchCandidate) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    SecurityPatchCandidate = sequelize.define('SecurityPatchCandidate', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_key: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      candidate_key: { type: DataTypes.STRING, allowNull: false },
      finding_key: { type: DataTypes.STRING, allowNull: false },
      advisory_id: { type: DataTypes.STRING, allowNull: true },
      ecosystem: { type: DataTypes.STRING, allowNull: true },
      package_name: { type: DataTypes.STRING, allowNull: false },
      service: { type: DataTypes.STRING, allowNull: true },
      current_version: { type: DataTypes.STRING, allowNull: true },
      target_version: { type: DataTypes.STRING, allowNull: true },
      kind: { type: DataTypes.STRING, allowNull: false },
      update_risk: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UNKNOWN' },
      autonomy: { type: DataTypes.STRING, allowNull: false, defaultValue: 'LEVEL_C_PRODUCTION' },
      requires_human_approval: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      severity: { type: DataTypes.STRING, allowNull: true },
      kev: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      dev_only: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'PROPOSED' },
      preconditions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      rationale: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      mission_id: { type: DataTypes.UUID, allowNull: true },
      mission_requested_at: { type: DataTypes.DATE, allowNull: true },
      mission_requested_by: { type: DataTypes.STRING, allowNull: true },
      plan: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      generated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'security_patch_candidates',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['tenant_key', 'candidate_key'], name: 'security_patch_candidates_tenant_key_unique' },
        { fields: ['tenant_key', 'status', 'severity'], name: 'security_patch_candidates_status_idx' },
        { fields: ['finding_key'], name: 'security_patch_candidates_finding_idx' },
      ],
    });
  }
  return SecurityPatchCandidate;
}

module.exports = getSecurityPatchCandidateModel;
