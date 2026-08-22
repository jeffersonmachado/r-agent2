const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CoverageEvidence = null;

function getCoverageEvidenceModel() {
  if (!CoverageEvidence) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    CoverageEvidence = sequelize.define('CoverageEvidence', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
      run_id: { type: DataTypes.STRING, allowNull: true },
      journey_id: { type: DataTypes.STRING, allowNull: true },
      scenario_id: { type: DataTypes.STRING, allowNull: true },
      step_id: { type: DataTypes.STRING, allowNull: true },
      inventory_item_id: { type: DataTypes.STRING, allowNull: true },
      coverage_state: { type: DataTypes.STRING, allowNull: true },
      evidence_id: { type: DataTypes.UUID, allowNull: true },
      record: { type: DataTypes.JSONB, allowNull: false },
      hash: { type: DataTypes.STRING, allowNull: false },
      prev_hash: { type: DataTypes.STRING, allowNull: false },
    }, {
      tableName: 'coverage_evidence',
      timestamps: true,
      updatedAt: false, // append-only: sem update
      underscored: true,
      indexes: [
        { fields: ['hash'], unique: true, name: 'coverage_evidence_hash_idx' },
        { fields: ['prev_hash'], name: 'coverage_evidence_prev_hash_idx' },
        { fields: ['run_id', 'journey_id', 'scenario_id'], name: 'coverage_evidence_lineage_idx' },
      ],
    });
  }

  return CoverageEvidence;
}

module.exports = getCoverageEvidenceModel;
