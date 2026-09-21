'use strict';

/**
 * Model EngineeringReview — decisão estruturada de um REVIEWER independente sobre uma
 * EngineeringAttempt. Nunca texto livre puro: decisão fechada (APPROVE/REJECT) + findings
 * classificados (BLOCKER/REGRESSION/POST_RELEASE).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringReview = null;

function getEngineeringReviewModel() {
  if (!EngineeringReview) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringReview = sequelize.define('EngineeringReview', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      attempt_id: { type: DataTypes.UUID, allowNull: false },
      reviewer_provider: { type: DataTypes.STRING, allowNull: true },
      reviewer_model: { type: DataTypes.STRING, allowNull: true },
      decision: { type: DataTypes.STRING, allowNull: true },
      findings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      independent_of_coder: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      raw_response_ref: { type: DataTypes.STRING, allowNull: true },
      error: { type: DataTypes.JSONB, allowNull: true },
    }, {
      tableName: 'engineering_reviews',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['attempt_id'], name: 'engineering_reviews_attempt_idx' },
        { fields: ['decision'], name: 'engineering_reviews_decision_idx' },
      ],
    });
  }
  return EngineeringReview;
}

module.exports = getEngineeringReviewModel;
