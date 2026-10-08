'use strict';

/**
 * Model SecurityFinding — achado de vulnerabilidade correlacionado a um
 * componente do inventário.
 *
 * Estado CORRENTE (o histórico vive em `security_finding_events`). `factors` e
 * `rationale` guardam a EXPLICAÇÃO do veredito do Risk Engine: um achado sem a
 * razão da sua prioridade não é auditável, e este modelo exige a razão.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let SecurityFinding = null;

function getSecurityFindingModel() {
  if (!SecurityFinding) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    SecurityFinding = sequelize.define('SecurityFinding', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_key: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      finding_key: { type: DataTypes.STRING, allowNull: false },
      advisory_id: { type: DataTypes.STRING, allowNull: false },
      advisory_aliases: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      component_id: { type: DataTypes.UUID, allowNull: true },
      component_bom_ref: { type: DataTypes.STRING, allowNull: false },
      ecosystem: { type: DataTypes.STRING, allowNull: false },
      package_name: { type: DataTypes.STRING, allowNull: false },
      installed_version: { type: DataTypes.STRING, allowNull: true },
      version_class: { type: DataTypes.STRING, allowNull: true },
      service: { type: DataTypes.STRING, allowNull: true },
      severity: { type: DataTypes.STRING, allowNull: false, defaultValue: 'INFORMATIONAL' },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'DETECTED' },
      priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      cvss_score: { type: DataTypes.DOUBLE, allowNull: true },
      epss: { type: DataTypes.DOUBLE, allowNull: true },
      kev: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      exposure: { type: DataTypes.STRING, allowNull: true },
      applicability: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UNKNOWN' },
      match_reason: { type: DataTypes.STRING, allowNull: true },
      fixed_versions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      factors: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      rationale: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      waiver_id: { type: DataTypes.UUID, allowNull: true },
      first_seen_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      last_seen_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      resolved_at: { type: DataTypes.DATE, allowNull: true },
      scan_run_id: { type: DataTypes.UUID, allowNull: true },
    }, {
      tableName: 'security_findings',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['tenant_key', 'finding_key'], name: 'security_findings_tenant_key_unique' },
        { fields: ['tenant_key', 'status', 'severity'], name: 'security_findings_status_idx' },
        { fields: ['component_bom_ref'], name: 'security_findings_component_idx' },
      ],
    });
  }
  return SecurityFinding;
}

module.exports = getSecurityFindingModel;
