'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let LearningJourneyFaq = null;

function getLearningJourneyFaqModel() {
  if (!LearningJourneyFaq) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    LearningJourneyFaq = sequelize.define('LearningJourneyFaq', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      journeyKey: { type: DataTypes.STRING, allowNull: false },
      fingerprint: { type: DataTypes.STRING, allowNull: false },
      category: { type: DataTypes.STRING, allowNull: false },
      question: { type: DataTypes.TEXT, allowNull: false },
      answer: { type: DataTypes.TEXT, allowNull: false },
      sources: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'suggested' },
      current: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      curatedBy: { type: DataTypes.STRING, allowNull: true },
      curatedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'learning_journey_faqs',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'journey_key'], name: 'ljf_tenant_journey_idx' },
        { fields: ['tenant_id', 'journey_key', 'status'], name: 'ljf_tenant_journey_status_idx' },
        { unique: true, fields: ['tenant_id', 'journey_key', 'fingerprint'], name: 'ljf_tenant_journey_fingerprint_uk' },
      ],
    });
  }

  return LearningJourneyFaq;
}

module.exports = getLearningJourneyFaqModel;
