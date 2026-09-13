/**
 * Model BenchmarkResearchSubject - benchmark_research_subjects
 *
 * Estado de ANÁLISE de UM benchmark dentro de um run de pesquisa.
 *
 * Por que não guardar isso no finding: `analyzedAt`, `research_version`,
 * `findings_inventory` e `market_archetype_mapping` são atributos do BENCHMARK
 * analisado, não de um achado. Guardá-los num JSONB do run tornaria a
 * concorrência destrutiva (dois registros simultâneos se sobrescreveriam) e a
 * auditoria impossível (não haveria linha para o benchmark).
 *
 * `findings_inventory` é o array de IDs de achados VERIFICADOS do benchmark —
 * é exatamente o formato exigido por `benchmarkAnalysisEvidenceGaps`
 * (`HOLDOUT_ANALYSIS_EVIDENCE_FIELDS`) do engine. Um objeto de contagens não
 * prova análise e por isso não é aceito aqui.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let BenchmarkResearchSubject = null;

function getBenchmarkResearchSubjectModel() {
  if (!BenchmarkResearchSubject) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    BenchmarkResearchSubject = sequelize.define('BenchmarkResearchSubject', {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      run_id: { type: DataTypes.STRING(64), allowNull: false },
      benchmark_id: { type: DataTypes.STRING(128), allowNull: false },
      /** Ordem declarada no discovery set: a curva de novidade depende dela. */
      discovery_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      analyzed_at: { type: DataTypes.DATE, allowNull: true },
      research_version: { type: DataTypes.STRING(128), allowNull: true },
      /** Array de finding ids VERIFICADOS (não um contador). */
      findings_inventory: { type: DataTypes.JSONB, allowNull: true },
      market_archetype_mapping: { type: DataTypes.JSONB, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'benchmark_research_subjects',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'run_id', 'benchmark_id'], name: 'benchmark_research_subjects_identity_uq', unique: true },
        { fields: ['tenant_key', 'run_id'], name: 'benchmark_research_subjects_run_idx' },
      ],
    });
  }
  return BenchmarkResearchSubject;
}

module.exports = getBenchmarkResearchSubjectModel;
