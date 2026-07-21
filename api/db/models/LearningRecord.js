'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let LearningRecord = null;

function getLearningRecordModel() {
  if (!LearningRecord) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    LearningRecord = sequelize.define('LearningRecord', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      type: {
        type: DataTypes.ENUM('failure', 'regression', 'pattern', 'improvement', 'correction', 'promotion'),
        allowNull: false,
      },
      source: { type: DataTypes.STRING, allowNull: true },
      sourceRef: { type: DataTypes.STRING, allowNull: true },
      classification: { type: DataTypes.STRING, allowNull: true },
      rootCause: { type: DataTypes.TEXT, allowNull: true },
      suggestion: { type: DataTypes.JSONB, allowNull: true },
      validationResult: { type: DataTypes.JSONB, allowNull: true },
      status: {
        type: DataTypes.ENUM('detected', 'classified', 'analyzed', 'suggested', 'validated', 'promoted', 'rejected'),
        allowNull: false,
        defaultValue: 'detected',
      },
      affectedAgents: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      affectedJourneys: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      metrics: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      promotedAt: { type: DataTypes.DATE, allowNull: true },
      promotedBy: { type: DataTypes.STRING, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'learning_records',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'type'], name: 'learning_records_tenant_type_idx' },
        { fields: ['status'], name: 'learning_records_status_idx' },
        { fields: ['classification'], name: 'learning_records_classification_idx' },
        { fields: ['source', 'source_ref'], name: 'learning_records_source_idx' },
      ],
    });
  }

  return LearningRecord;
}

module.exports = getLearningRecordModel;
