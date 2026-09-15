/**
 * Model MarketDiscoveryRun - market_discovery_runs
 *
 * AUTORIDADE PERSISTENTE de uma execução de DESCOBERTA AUTÔNOMA DE MERCADO —
 * a camada que antecede o Discovery Set de benchmarks: MARKET → ARCHETYPES →
 * CANDIDATES → CANDIDATE ANALYSIS → DIVERSITY → DISCOVERY SET → HOLDOUT
 * PREREGISTRATION → handoff para a pesquisa profunda (benchmark research).
 *
 * Invariantes:
 *   - `tenant_key` em todas as tabelas do agregado (descoberta é SYSTEM);
 *   - identidade determinística `(tenant_key, vertical, discovery_version)` —
 *     reabrir o mesmo run é idempotente, não duplica história;
 *   - `state` é o estado DECLARADO do run (vocabulário de
 *     `DISCOVERY_RUN_STATES` do supervisor); nunca inferido de contagens.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketDiscoveryRun = null;

function getMarketDiscoveryRunModel() {
  if (!MarketDiscoveryRun) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketDiscoveryRun = sequelize.define('MarketDiscoveryRun', {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING(64), allowNull: false },
      discovery_version: { type: DataTypes.STRING(128), allowNull: false },
      state: { type: DataTypes.STRING(48), allowNull: false, defaultValue: 'MARKET_DISCOVERY_OPEN' },
      started_at: { type: DataTypes.DATE, allowNull: false },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'market_discovery_runs',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'vertical', 'discovery_version'], name: 'market_discovery_runs_identity_uq', unique: true },
        { fields: ['tenant_key', 'vertical'], name: 'market_discovery_runs_tenant_vertical_idx' },
      ],
    });
  }
  return MarketDiscoveryRun;
}

// Convenção dos models do projeto: o módulo exporta a FACTORY diretamente.
module.exports = getMarketDiscoveryRunModel;
