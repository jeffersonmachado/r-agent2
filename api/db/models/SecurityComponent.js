'use strict';

/**
 * Model SecurityComponent — identidade corrente de um componente de software
 * descoberto (pacote npm/pypi, imagem OCI, runtime, biblioteca de sistema).
 *
 * `bom_ref` é a identidade canônica dentro do inventário e é único por tenant.
 * `version_class` distingue DECLARED/RESOLVED/BUILT/RUNNING: a versão que está
 * EXECUTANDO não é a mesma coisa que a versão declarada no manifesto, e o
 * schema preserva essa distinção em vez de achatá-la.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let SecurityComponent = null;

function getSecurityComponentModel() {
  if (!SecurityComponent) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    SecurityComponent = sequelize.define('SecurityComponent', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_key: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      bom_ref: { type: DataTypes.STRING, allowNull: false },
      ecosystem: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      namespace: { type: DataTypes.STRING, allowNull: true },
      version: { type: DataTypes.STRING, allowNull: true },
      version_class: { type: DataTypes.STRING, allowNull: false, defaultValue: 'RESOLVED' },
      purl: { type: DataTypes.STRING, allowNull: true },
      kind: { type: DataTypes.STRING, allowNull: true },
      service: { type: DataTypes.STRING, allowNull: true },
      source: { type: DataTypes.STRING, allowNull: true },
      sources: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      install_path: { type: DataTypes.STRING, allowNull: true },
      direct: { type: DataTypes.BOOLEAN, allowNull: true },
      dev: { type: DataTypes.BOOLEAN, allowNull: true },
      optional: { type: DataTypes.BOOLEAN, allowNull: true },
      built_locally: { type: DataTypes.BOOLEAN, allowNull: true },
      pinned_by_digest: { type: DataTypes.BOOLEAN, allowNull: true },
      fingerprint: { type: DataTypes.STRING, allowNull: false },
      integrity: { type: DataTypes.STRING, allowNull: true },
      license_name: { type: DataTypes.STRING, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      first_seen_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      last_seen_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      last_run_id: { type: DataTypes.UUID, allowNull: true },
    }, {
      tableName: 'security_components',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['tenant_key', 'bom_ref'], name: 'security_components_tenant_bom_ref_unique' },
        { fields: ['tenant_key', 'ecosystem', 'name'], name: 'security_components_lookup_idx' },
        { fields: ['service'], name: 'security_components_service_idx' },
      ],
    });
  }
  return SecurityComponent;
}

module.exports = getSecurityComponentModel;
