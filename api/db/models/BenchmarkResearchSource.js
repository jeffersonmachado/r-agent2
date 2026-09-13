/**
 * Model BenchmarkResearchSource - benchmark_research_sources
 *
 * Fonte declarada de um achado de pesquisa (URL + tier + especificidade).
 *
 * Invariantes:
 *   - idempotente por `(tenant_key, run_id, benchmark_id, url)` — registrar a
 *     mesma fonte duas vezes NÃO cria duas provas;
 *   - `verified` / `verification_state` são DERIVADOS pela política de fonte
 *     (`classifyResearchSource`), nunca afirmados pelo agente;
 *   - `http_status` é o status HTTP REAL da obtenção. Sem status real não há
 *     prova de existência do documento.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let BenchmarkResearchSource = null;

function getBenchmarkResearchSourceModel() {
  if (!BenchmarkResearchSource) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    BenchmarkResearchSource = sequelize.define('BenchmarkResearchSource', {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      run_id: { type: DataTypes.STRING(64), allowNull: false },
      benchmark_id: { type: DataTypes.STRING(128), allowNull: false },
      url: { type: DataTypes.STRING(2048), allowNull: false },
      tier: { type: DataTypes.INTEGER, allowNull: true },
      specificity: { type: DataTypes.STRING(32), allowNull: true },
      http_status: { type: DataTypes.INTEGER, allowNull: true },
      verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      verification_state: { type: DataTypes.STRING(48), allowNull: false, defaultValue: 'UNVERIFIED' },
      verified_at: { type: DataTypes.DATE, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'benchmark_research_sources',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'run_id', 'benchmark_id', 'url'], name: 'benchmark_research_sources_identity_uq', unique: true },
        { fields: ['tenant_key', 'run_id'], name: 'benchmark_research_sources_run_idx' },
      ],
    });
  }
  return BenchmarkResearchSource;
}

module.exports = getBenchmarkResearchSourceModel;
