'use strict';

/**
 * Model EngineeringBugFindingEvent — histórico APPEND-ONLY do ciclo de um bug.
 *
 * Nunca sofre UPDATE (o serviço só cria registros). É o que permite responder, meses depois: "este
 * bug foi confirmado com qual base objetiva?", "a regressão rodou antes de fechar?", "esta é a
 * segunda reincidência?". Sem isso, o estado corrente poderia ser reescrito sem rastro.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringBugFindingEvent = null;

function getEngineeringBugFindingEventModel() {
  if (!EngineeringBugFindingEvent) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringBugFindingEvent = sequelize.define('EngineeringBugFindingEvent', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      finding_id: { type: DataTypes.UUID, allowNull: false },
      // Sem enum no banco de propósito: o vocabulário é validado no serviço contra
      // `FINDING_EVENT_TYPES` — ter uma fonte única (o engine) evita enum duplicado no schema.
      type: { type: DataTypes.STRING(32), allowNull: false },
      actor: { type: DataTypes.STRING, allowNull: true },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'engineering_bug_finding_events',
      timestamps: true,
      updatedAt: false,
      underscored: true,
      indexes: [
        { fields: ['finding_id'], name: 'engineering_bug_finding_events_finding_idx' },
        { fields: ['type'], name: 'engineering_bug_finding_events_type_idx' },
      ],
    });
  }
  return EngineeringBugFindingEvent;
}

module.exports = getEngineeringBugFindingEventModel;
