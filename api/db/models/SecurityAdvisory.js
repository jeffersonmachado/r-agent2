'use strict';

/**
 * Model SecurityAdvisory — advisory de vulnerabilidade normalizado.
 *
 * As FAIXAS AFETADAS ficam em JSONB aqui de propósito: a correlação com o
 * inventário roda offline contra o banco (local scanning plane), sem tocar a
 * internet. O enriquecimento (KEV/EPSS) é gravado na mesma linha com o
 * timestamp da consulta, para que a idade do dado seja auditável.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let SecurityAdvisory = null;

function getSecurityAdvisoryModel() {
  if (!SecurityAdvisory) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    SecurityAdvisory = sequelize.define('SecurityAdvisory', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_key: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      advisory_id: { type: DataTypes.STRING, allowNull: false },
      source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'osv' },
      source_url: { type: DataTypes.STRING, allowNull: true },
      aliases: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      summary: { type: DataTypes.STRING, allowNull: true },
      details: { type: DataTypes.TEXT, allowNull: true },
      published: { type: DataTypes.DATE, allowNull: true },
      modified: { type: DataTypes.DATE, allowNull: true },
      withdrawn: { type: DataTypes.DATE, allowNull: true },
      severity: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      cvss_score: { type: DataTypes.DOUBLE, allowNull: true },
      declared_severity: { type: DataTypes.STRING, allowNull: true },
      affected: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      references: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      database_specific: { type: DataTypes.JSONB, allowNull: true },
      kev: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      kev_due_date: { type: DataTypes.DATE, allowNull: true },
      kev_checked_at: { type: DataTypes.DATE, allowNull: true },
      epss: { type: DataTypes.DOUBLE, allowNull: true },
      epss_percentile: { type: DataTypes.DOUBLE, allowNull: true },
      epss_checked_at: { type: DataTypes.DATE, allowNull: true },
      fetched_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      checksum: { type: DataTypes.STRING, allowNull: true },
    }, {
      tableName: 'security_advisories',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['source', 'advisory_id'], name: 'security_advisories_source_id_unique' },
        { fields: ['kev'], name: 'security_advisories_kev_idx' },
        { fields: ['cvss_score'], name: 'security_advisories_cvss_idx' },
      ],
    });
  }
  return SecurityAdvisory;
}

module.exports = getSecurityAdvisoryModel;
