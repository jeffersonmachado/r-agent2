'use strict';

/**
 * Model EngineeringMissionVersion — histórico versionado de MissionSpec (§13, §29).
 *
 * Cada versão é imutável por contrato: uma nova descoberta material cria uma LINHA NOVA, nunca um
 * UPDATE na versão aprovada. `(mission_id, version)` e `(mission_id, spec_hash)` são únicos — o
 * banco é a última linha de defesa contra duas versões divergentes ou contra a "mesma" versão
 * gravada duas vezes por dois workers concorrentes.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringMissionVersion = null;

function getEngineeringMissionVersionModel() {
  if (!EngineeringMissionVersion) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringMissionVersion = sequelize.define('EngineeringMissionVersion', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      mission_id: { type: DataTypes.UUID, allowNull: false },
      version: { type: DataTypes.INTEGER, allowNull: false },
      // Cópia literal da intenção original — permite provar imutabilidade sem abrir o JSON.
      original_mission: { type: DataTypes.TEXT, allowNull: false },
      spec: { type: DataTypes.JSONB, allowNull: false },
      spec_hash: { type: DataTypes.STRING, allowNull: false },
      materiality: { type: DataTypes.STRING, allowNull: false, defaultValue: 'MATERIAL' },
      materiality_reasons: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      enrichment: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      diff: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      event: { type: DataTypes.STRING, allowNull: false, defaultValue: 'ENRICHED' },
      note: { type: DataTypes.TEXT, allowNull: true },
      created_by: { type: DataTypes.STRING, allowNull: true },
    }, {
      tableName: 'engineering_mission_versions',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['mission_id', 'version'], name: 'engineering_mission_versions_version_unique' },
        { unique: true, fields: ['mission_id', 'spec_hash'], name: 'engineering_mission_versions_spec_hash_unique' },
        { fields: ['mission_id'], name: 'engineering_mission_versions_mission_idx' },
      ],
    });
  }
  return EngineeringMissionVersion;
}

module.exports = getEngineeringMissionVersionModel;
