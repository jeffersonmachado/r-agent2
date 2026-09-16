/**
 * Model MarketCandidate - market_candidates
 *
 * Candidato do universo de mercado descoberto. Os concorrentes conhecidos do
 * config entram como SEED (referência), não como verdade: para virar ACCEPTED
 * o candidato precisa de `source_evidence` com URL + hash/referência.
 *
 * Campos de análise distinguem dois momentos que NUNCA se confundem:
 *   - `profiled_at` / `profile`: PROFILING de candidato (estágio CANDIDATE
 *     ANALYSIS da descoberta — site oficial, docs, maturidade declarada);
 *   - `deep_research_at`: pesquisa PROFUNDA, executada pelo subsistema de
 *     benchmark research DEPOIS do handoff. É este campo que a verificação de
 *     leakage do holdout compara com o pré-registro.
 *
 * Identidade determinística `(tenant_key, vertical, candidate_key)`:
 * re-descobrir o mesmo fornecedor é upsert idempotente, nunca duplicata.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketCandidate = null;

function getMarketCandidateModel() {
  if (!MarketCandidate) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketCandidate = sequelize.define('MarketCandidate', {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING(64), allowNull: false },
      run_id: { type: DataTypes.STRING(64), allowNull: true },
      candidate_key: { type: DataTypes.STRING(128), allowNull: false },
      name: { type: DataTypes.STRING(256), allowNull: false },
      vendor: { type: DataTypes.STRING(256), allowNull: true },
      official_site: { type: DataTypes.STRING(2048), allowNull: true },
      official_docs: { type: DataTypes.STRING(2048), allowNull: true },
      api_docs: { type: DataTypes.STRING(2048), allowNull: true },
      country: { type: DataTypes.STRING(8), allowNull: true },
      region: { type: DataTypes.STRING(64), allowNull: true },
      segments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      target_customers: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      archetypes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      independence_group: { type: DataTypes.STRING(128), allowNull: true },
      clone_of: { type: DataTypes.STRING(128), allowNull: true },
      base_product: { type: DataTypes.STRING(128), allowNull: true },
      origin: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'research' },
      state: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'EVIDENCE_REQUIRED' },
      market_relevance: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
      source_evidence: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      rationale: { type: DataTypes.TEXT, allowNull: true },
      profile: { type: DataTypes.JSONB, allowNull: true },
      profiled_at: { type: DataTypes.DATE, allowNull: true },
      deep_research_at: { type: DataTypes.DATE, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'market_candidates',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'vertical', 'candidate_key'], name: 'market_candidates_identity_uq', unique: true },
        { fields: ['tenant_key', 'vertical'], name: 'market_candidates_tenant_vertical_idx' },
        { fields: ['tenant_key', 'vertical', 'state'], name: 'market_candidates_state_idx' },
      ],
    });
  }
  return MarketCandidate;
}

module.exports = getMarketCandidateModel;
