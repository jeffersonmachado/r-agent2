/**
 * Model BenchmarkResearchEvidence - benchmark_research_evidence
 *
 * Diário APPEND-ONLY de evidência capturada (§ B4/B6 da missão).
 *
 * Regras estruturais:
 *   - NUNCA há UPDATE nem DELETE neste model (nem no serviço). A evidência é o
 *     que sustenta um achado; reescrevê-la destruiria a auditoria. Correção é
 *     uma NOVA captura, nunca a edição da anterior;
 *   - `id` determinístico por `(tenant, run, benchmark, evidence_ref)` torna a
 *     captura repetida idempotente — o mesmo documento não vira duas provas;
 *   - `content_hash` permite detectar mudança de conteúdo da fonte sem
 *     alterar a linha (um novo hash é uma nova captura).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let BenchmarkResearchEvidence = null;

function getBenchmarkResearchEvidenceModel() {
  if (!BenchmarkResearchEvidence) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    BenchmarkResearchEvidence = sequelize.define('BenchmarkResearchEvidence', {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      run_id: { type: DataTypes.STRING(64), allowNull: false },
      benchmark_id: { type: DataTypes.STRING(128), allowNull: false },
      source_id: { type: DataTypes.STRING(64), allowNull: true },
      /** Referência estável da evidência devolvida pela capability. */
      evidence_ref: { type: DataTypes.STRING(512), allowNull: false },
      content_hash: { type: DataTypes.STRING(128), allowNull: true },
      http_status: { type: DataTypes.INTEGER, allowNull: true },
      captured_at: { type: DataTypes.DATE, allowNull: false },
      /** Imutável por construção: o extra é congelado na captura. */
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'benchmark_research_evidence',
      timestamps: true,
      underscored: true,
      updatedAt: false,
      indexes: [
        { fields: ['tenant_key', 'run_id', 'benchmark_id', 'evidence_ref'], name: 'benchmark_research_evidence_identity_uq', unique: true },
        { fields: ['tenant_key', 'run_id'], name: 'benchmark_research_evidence_run_idx' },
      ],
    });
  }
  return BenchmarkResearchEvidence;
}

module.exports = getBenchmarkResearchEvidenceModel;
