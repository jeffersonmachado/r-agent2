/**
 * Model BenchmarkSourceInspection - benchmark_source_inspections
 *
 * Proveniência de INSPEÇÃO por fonte (T-B2 da missão de 2026-09-15).
 *
 * Antes deste model, a evidência só era gravada dentro de `recordFinding`:
 * uma fonte buscada + inspecionada com ZERO achados não deixava rastro
 * (contentHash, retrievedAt, inspectedAt, documentType, estado por eixo).
 * Sem essa linha, "pesquisei e não achei nada novo" era indistinguível de
 * "não pesquisei" — e o critério de ANÁLISE com zero achados (T-B1) ficaria
 * sem prova auditável.
 *
 * Regras estruturais:
 *   - `id` determinístico por `(tenant, run, benchmark, source, contentHash)`:
 *     re-inspecionar o MESMO conteúdo faz UPSERT, nunca duplica; um hash novo
 *     é uma NOVA inspeção (o conteúdo mudou — é outro documento);
 *   - `content_hash` é obrigatório: inspeção sem hash não está ligada ao
 *     conteúdo analisado e não pode sustentar o critério de análise;
 *   - estados por eixo usam o vocabulário de `AXIS_STATES` da semântica de
 *     pesquisa (RESEARCHED_NO_FINDINGS é resultado, não falha).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let BenchmarkSourceInspection = null;

function getBenchmarkSourceInspectionModel() {
  if (!BenchmarkSourceInspection) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    BenchmarkSourceInspection = sequelize.define('BenchmarkSourceInspection', {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      run_id: { type: DataTypes.STRING(64), allowNull: false },
      subject_id: { type: DataTypes.STRING(64), allowNull: false },
      benchmark_id: { type: DataTypes.STRING(128), allowNull: false },
      source_id: { type: DataTypes.STRING(64), allowNull: true },
      url: { type: DataTypes.STRING(2048), allowNull: false },
      /** Hash do conteúdo EFETIVAMENTE analisado — binding com fetch/evidência. */
      content_hash: { type: DataTypes.STRING(128), allowNull: false },
      retrieved_at: { type: DataTypes.DATE, allowNull: false },
      inspected_at: { type: DataTypes.DATE, allowNull: false },
      document_type: { type: DataTypes.STRING(64), allowNull: true },
      provider: { type: DataTypes.STRING(128), allowNull: true },
      documentation_status: { type: DataTypes.STRING(32), allowNull: false },
      api_status: { type: DataTypes.STRING(32), allowNull: false },
      capability_axis_status: { type: DataTypes.STRING(48), allowNull: false },
      journey_axis_status: { type: DataTypes.STRING(48), allowNull: false },
      business_rule_axis_status: { type: DataTypes.STRING(48), allowNull: false },
      errors: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'benchmark_source_inspections',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'run_id', 'benchmark_id'], name: 'benchmark_source_inspections_benchmark_idx' },
        { fields: ['tenant_key', 'run_id'], name: 'benchmark_source_inspections_run_idx' },
      ],
    });
  }
  return BenchmarkSourceInspection;
}

module.exports = getBenchmarkSourceInspectionModel;
