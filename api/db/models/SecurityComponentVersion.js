'use strict';

/**
 * Model SecurityComponentVersion — histórico append-only das versões
 * observadas por componente e classe de versão.
 *
 * Cada observação é um EVENTO: a unicidade é
 * (component_id, version, version_class, fingerprint), então reobservar o mesmo
 * fato é idempotente e uma MUDANÇA de versão vira uma linha nova. É isso que
 * permite responder "desde quando este componente está nesta versão?" sem
 * depender de log de aplicação.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let SecurityComponentVersion = null;

function getSecurityComponentVersionModel() {
  if (!SecurityComponentVersion) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    SecurityComponentVersion = sequelize.define('SecurityComponentVersion', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_key: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      component_id: { type: DataTypes.UUID, allowNull: false },
      bom_ref: { type: DataTypes.STRING, allowNull: false },
      version: { type: DataTypes.STRING, allowNull: true },
      version_class: { type: DataTypes.STRING, allowNull: false },
      source: { type: DataTypes.STRING, allowNull: true },
      evidence_origin: { type: DataTypes.STRING, allowNull: true },
      integrity: { type: DataTypes.STRING, allowNull: true },
      fingerprint: { type: DataTypes.STRING, allowNull: false },
      observed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      run_id: { type: DataTypes.UUID, allowNull: true },
      drift: { type: DataTypes.JSONB, allowNull: true },
    }, {
      tableName: 'security_component_versions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['component_id', 'observed_at'], name: 'security_component_versions_component_observed_idx' },
        {
          unique: true,
          fields: ['component_id', 'version', 'version_class', 'fingerprint'],
          name: 'security_component_versions_observation_unique',
        },
      ],
    });
  }
  return SecurityComponentVersion;
}

module.exports = getSecurityComponentVersionModel;
