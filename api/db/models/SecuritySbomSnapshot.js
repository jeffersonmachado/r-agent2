'use strict';

/**
 * Model SecuritySbomSnapshot — SBOM gerado, versionado e verificável.
 *
 * O `sha256` é calculado sobre a serialização canônica do documento; a
 * unicidade (tenant_key, sha256) torna a geração idempotente: o MESMO inventário
 * produz o MESMO snapshot, e um SBOM diferente só existe quando o inventário
 * mudou. Isso é o que permite usar o SBOM como evidência (e comparar releases).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let SecuritySbomSnapshot = null;

function getSecuritySbomSnapshotModel() {
  if (!SecuritySbomSnapshot) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    SecuritySbomSnapshot = sequelize.define('SecuritySbomSnapshot', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_key: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      serial_number: { type: DataTypes.STRING, allowNull: false },
      sbom_format: { type: DataTypes.STRING, allowNull: false, defaultValue: 'CycloneDX' },
      spec_version: { type: DataTypes.STRING, allowNull: false, defaultValue: '1.5' },
      sha256: { type: DataTypes.STRING, allowNull: false },
      component_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      root_name: { type: DataTypes.STRING, allowNull: false },
      root_version: { type: DataTypes.STRING, allowNull: true },
      generated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      run_id: { type: DataTypes.UUID, allowNull: true },
      validation: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      artifact_ref: { type: DataTypes.STRING, allowNull: true },
      sbom: { type: DataTypes.JSONB, allowNull: true },
    }, {
      tableName: 'security_sbom_snapshots',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['tenant_key', 'sha256'], name: 'security_sbom_snapshots_tenant_sha_unique' },
        { fields: ['generated_at'], name: 'security_sbom_snapshots_generated_idx' },
      ],
    });
  }
  return SecuritySbomSnapshot;
}

module.exports = getSecuritySbomSnapshotModel;
