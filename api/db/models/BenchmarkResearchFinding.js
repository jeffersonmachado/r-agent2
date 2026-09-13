/**
 * Model BenchmarkResearchFinding - benchmark_research_findings
 *
 * Achado de pesquisa (capability/jornada/regra de negócio) com a CADEIA de
 * prova persistida: finding → evidence → source (§ B3/B6).
 *
 * Invariante central: `verified` é derivado da política de fonte E da
 * existência de uma linha de evidência. Um achado sem `evidence_id` NUNCA é
 * `verified` — é `UNVERIFIED`, não entra no inventário de novidade, não conta
 * para saturação e não certifica nada.
 *
 * Idempotência: `id` determinístico por
 * `(tenant, run, benchmark, kind, external_name, canonical_id, evidence_ref)`.
 * Registrar o mesmo achado duas vezes (retry, replay do runner) não duplica
 * novidade — o que, sem isso, inflaria artificialmente a curva.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let BenchmarkResearchFinding = null;

function getBenchmarkResearchFindingModel() {
  if (!BenchmarkResearchFinding) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    BenchmarkResearchFinding = sequelize.define('BenchmarkResearchFinding', {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      run_id: { type: DataTypes.STRING(64), allowNull: false },
      benchmark_id: { type: DataTypes.STRING(128), allowNull: false },
      /** capability | journey | businessRule */
      kind: { type: DataTypes.STRING(32), allowNull: false },
      external_name: { type: DataTypes.STRING(512), allowNull: true },
      /** null ⇒ capacidade NOVA (não mapeada no inventário canônico). */
      canonical_id: { type: DataTypes.STRING(128), allowNull: true },
      /** CRITICAL | REQUIRED | OPTIONAL | null (não classificada). */
      classification: { type: DataTypes.STRING(16), allowNull: true },
      archetype: { type: DataTypes.STRING(64), allowNull: true },
      verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      verification_state: { type: DataTypes.STRING(48), allowNull: false, defaultValue: 'UNVERIFIED' },
      source_id: { type: DataTypes.STRING(64), allowNull: true },
      evidence_id: { type: DataTypes.STRING(64), allowNull: true },
      recorded_at: { type: DataTypes.DATE, allowNull: false },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'benchmark_research_findings',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'run_id', 'benchmark_id'], name: 'benchmark_research_findings_run_idx' },
        { fields: ['tenant_key', 'run_id', 'verified'], name: 'benchmark_research_findings_verified_idx' },
      ],
    });
  }
  return BenchmarkResearchFinding;
}

module.exports = getBenchmarkResearchFindingModel;
