/**
 * Model BenchmarkResearchRun - benchmark_research_runs
 *
 * AUTORIDADE PERSISTENTE de uma execução de pesquisa competitiva (benchmark).
 *
 * Antes (gap confirmado 2026-09-13): o estado da pesquisa vivia em
 * `runs = new Map()` dentro de `benchmarkResearchService` — um run "iniciado"
 * desaparecia no restart do processo e nenhum achado era auditável depois. Sem
 * persistência não existe evidência: existe memória de um processo.
 *
 * Escopo:
 *   - `tenant_key` em TODAS as tabelas do agregado (pesquisa é tenant-scoped);
 *   - identidade determinística `(tenant_key, vertical, research_version)` —
 *     reabrir o mesmo run é idempotente, não duplica história;
 *   - `state` é o estado DECLARADO do run (vocabulário de
 *     `RESEARCH_STATES` do serviço); nunca inferido de contagens.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let BenchmarkResearchRun = null;

function getBenchmarkResearchRunModel() {
  if (!BenchmarkResearchRun) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    BenchmarkResearchRun = sequelize.define('BenchmarkResearchRun', {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING(64), allowNull: false },
      research_version: { type: DataTypes.STRING(128), allowNull: false },
      state: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'RESEARCH_DISCOVERY_OPEN' },
      holdout_benchmark_id: { type: DataTypes.STRING(128), allowNull: true },
      saturation_reached: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      registered_at: { type: DataTypes.DATE, allowNull: false },
      // Registro do DISCOVERY SET na ORDEM declarada (§5): a ordem é prova.
      discovery_set: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'benchmark_research_runs',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'vertical', 'research_version'], name: 'benchmark_research_runs_identity_uq', unique: true },
        { fields: ['tenant_key', 'vertical'], name: 'benchmark_research_runs_tenant_vertical_idx' },
      ],
    });
  }
  return BenchmarkResearchRun;
}

// Convenção dos models do projeto: o módulo exporta a FACTORY diretamente.
module.exports = getBenchmarkResearchRunModel;
