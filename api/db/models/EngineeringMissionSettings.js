'use strict';

/**
 * Model EngineeringMissionSettings — política de autoaprovação da instalação (singleton `default`).
 *
 * Por que uma tabela e não `api/data/config.json`: a política governa execução autônoma e precisa
 * ser durável, auditável (quem mudou, quando) e transacional — não é configuração de apresentação.
 * Não existe fallback em memória: sem linha persistida, vale apenas o DEFAULT declarado em
 * `engine/engineeringMission/autoApprovalPolicy.js` (que é fail-closed: `enabled=false`).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringMissionSettings = null;

function getEngineeringMissionSettingsModel() {
  if (!EngineeringMissionSettings) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringMissionSettings = sequelize.define('EngineeringMissionSettings', {
      id: { type: DataTypes.STRING, primaryKey: true, defaultValue: 'default' },
      auto_approval_policy: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      updated_by: { type: DataTypes.STRING, allowNull: true },
    }, {
      tableName: 'engineering_mission_settings',
      timestamps: true,
      underscored: true,
    });
  }
  return EngineeringMissionSettings;
}

module.exports = getEngineeringMissionSettingsModel;
