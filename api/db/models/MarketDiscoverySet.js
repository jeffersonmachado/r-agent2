/**
 * Model MarketDiscoverySet - market_discovery_sets
 *
 * O DISCOVERY SET selecionado pela descoberta de mercado e o PRÉ-REGISTRO do
 * holdout. O holdout é escolhido ANTES de qualquer pesquisa profunda:
 * `holdout_selected_at` é a âncora temporal da verificação de leakage
 * (consistente com `evaluateHoldout` de qa/benchmarks/benchmarkSufficiencyEngine).
 *
 * Máquina de estados (`state`):
 *   SELECTED → HOLDOUT_PREREGISTERED → OPENED_FOR_RESEARCH
 *   qualquer → LEAKAGE_DETECTED (terminal, auditável)
 *
 * Identidade determinística `(tenant_key, vertical, discovery_set_version)`.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketDiscoverySet = null;

function getMarketDiscoverySetModel() {
  if (!MarketDiscoverySet) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketDiscoverySet = sequelize.define('MarketDiscoverySet', {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING(64), allowNull: false },
      run_id: { type: DataTypes.STRING(64), allowNull: true },
      discovery_set_version: { type: DataTypes.STRING(128), allowNull: false },
      state: { type: DataTypes.STRING(48), allowNull: false, defaultValue: 'SELECTED' },
      selected_candidates: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      selection_rationale: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      selection_policy: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      holdout_candidate_id: { type: DataTypes.STRING(128), allowNull: true },
      holdout_selected_at: { type: DataTypes.DATE, allowNull: true },
      holdout_selection_basis: { type: DataTypes.JSONB, allowNull: true },
      holdout_preregistered: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      opened_at: { type: DataTypes.DATE, allowNull: true },
      deep_research_run_id: { type: DataTypes.STRING(64), allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'market_discovery_sets',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'vertical', 'discovery_set_version'], name: 'market_discovery_sets_identity_uq', unique: true },
        { fields: ['tenant_key', 'vertical'], name: 'market_discovery_sets_tenant_vertical_idx' },
      ],
    });
  }
  return MarketDiscoverySet;
}

module.exports = getMarketDiscoverySetModel;
