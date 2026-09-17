'use strict';

/**
 * Model BenchmarkResearchChangeProposal - benchmark_research_change_proposals
 *
 * PROPOSTA DE MUDANÇA da pesquisa competitiva de benchmarks (política de
 * 2026-09-17): a pesquisa nunca escreve o sample versionado diretamente.
 * Ela produz uma proposta persistida com avaliação documentada que só vira
 * mudança depois de APROVAÇÃO humana (com ressalvas registradas).
 *
 * Regras estruturais:
 *   - `id` determinístico por `(vertical, run_id, patch_sha256)`: re-criar a
 *     MESMA proposta é idempotente; após estado terminal (applied/rejected),
 *     uma nova proposta do mesmo patch recebe versão determinística nova;
 *   - `patch_sha256` é o binding de integridade: a aplicação recompute o hash
 *     do patch persistido e recusa divergência (`patch_tampered`);
 *   - `review_token_sha256` guarda apenas o HASH do token de revisão HMAC
 *     (TTL 30 min) — o token em claro nunca é persistido;
 *   - `status` é o estado DECLARADO: proposed → approved|rejected → applied.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let BenchmarkResearchChangeProposal = null;

function getBenchmarkResearchChangeProposalModel() {
  if (!BenchmarkResearchChangeProposal) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    BenchmarkResearchChangeProposal = sequelize.define('BenchmarkResearchChangeProposal', {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      vertical: { type: DataTypes.STRING(64), allowNull: false },
      run_id: { type: DataTypes.STRING(64), allowNull: true },
      patch: { type: DataTypes.JSONB, allowNull: false },
      patch_sha256: { type: DataTypes.STRING(64), allowNull: false },
      evaluation: { type: DataTypes.JSONB, allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'proposed' },
      caveats: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      decision_reason: { type: DataTypes.TEXT, allowNull: true },
      proposed_by: { type: DataTypes.STRING(128), allowNull: false },
      reviewed_by: { type: DataTypes.STRING(128), allowNull: true },
      applied_by: { type: DataTypes.STRING(128), allowNull: true },
      review_token_sha256: { type: DataTypes.STRING(64), allowNull: true },
      review_token_expires_at: { type: DataTypes.DATE, allowNull: true },
      proposed_at: { type: DataTypes.DATE, allowNull: false },
      reviewed_at: { type: DataTypes.DATE, allowNull: true },
      applied_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      tableName: 'benchmark_research_change_proposals',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['vertical', 'status'], name: 'benchmark_research_change_proposals_vertical_status_idx' },
        { fields: ['run_id'], name: 'benchmark_research_change_proposals_run_idx' },
      ],
    });
  }
  return BenchmarkResearchChangeProposal;
}

module.exports = getBenchmarkResearchChangeProposalModel;
