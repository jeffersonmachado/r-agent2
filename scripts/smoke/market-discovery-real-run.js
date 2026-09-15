'use strict';

/**
 * Smoke REAL de Market Discovery — executa a pipeline completa do
 * marketDiscoverySupervisor contra o stack local vivo:
 *
 *   - store REAL (Postgres via api/db/sequelize + createMarketDiscoveryStore);
 *   - registry COMPARTILHADO (resolveToolRegistry — mesma resolução do
 *     copiloto/benchmark-research; sem orchestrator vivo cai no registry
 *     canônico local);
 *   - provider NATIVO real (createNativeResearchProvider — DuckDuckGo→Bing,
 *     fetch sob SSRF guard, evidência hash-bound).
 *
 * Uso:
 *   node --env-file-if-exists=.env scripts/smoke/market-discovery-real-run.js
 *
 * Nada aqui é mock: se a busca/fetch falhar, o run reflete a falha
 * (arquétipo sem evidência NÃO é aceito; candidato sem evidência NÃO entra).
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
process.chdir(ROOT);

const logger = require('../../api/utils/logger');

async function main() {
  const vertical = process.env.MARKET_DISCOVERY_VERTICAL || 'fitness';
  const discoveryVersion = process.env.MARKET_DISCOVERY_VERSION || 'fitness-market-real-2026-09-15';

  const { connect, getSequelize } = require('../../api/db/sequelize');
  await connect();
  const sequelize = getSequelize();
  if (!sequelize) throw new Error('persistence_required: sequelize não inicializado');

  const { createMarketDiscoveryStore } = require('../../api/services/marketDiscovery/marketDiscoveryStore');
  const { createMarketDiscoverySupervisor } = require('../../api/services/marketDiscovery/marketDiscoverySupervisor');
  const { createNativeResearchProvider } = require('../../api/services/research/nativeResearchProvider');
  const { resolveToolRegistry } = require('../../api/services/askAi/toolRegistry');

  const samplePath = path.join(ROOT, 'config', 'benchmarks', `${vertical}.json`);
  const sample = require(samplePath);

  const store = createMarketDiscoveryStore();
  const registry = resolveToolRegistry(null);
  const providers = createNativeResearchProvider({ logger });

  const supervisor = createMarketDiscoverySupervisor({
    store,
    registry,
    providers,
    tenantId: 'system',
    logger,
  });

  const registration = supervisor.register();
  const availability = supervisor.providerAvailability();
  console.log('=== MARKET DISCOVERY REAL RUN ===');
  console.log(JSON.stringify({ vertical, discoveryVersion, registration, availability }, null, 2));

  const result = await supervisor.discover({ vertical, discoveryVersion, sample });
  console.log('=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));

  // Estado PERSISTIDO (prova pós-run, relido do Postgres):
  const persisted = {
    archetypes: await store.listArchetypes({ tenantId: 'system', vertical }),
    candidates: await store.listCandidates({ tenantId: 'system', vertical }),
    discoverySet: await store.getLatestDiscoverySet({ tenantId: 'system', vertical }),
  };
  console.log('=== PERSISTED STATE ===');
  console.log(JSON.stringify({
    archetypes: (persisted.archetypes || []).map((a) => ({
      key: a.archetype_key, state: a.state, evidenceCount: Array.isArray(a.evidence) ? a.evidence.length : 0,
    })),
    candidates: (persisted.candidates || []).map((c) => ({
      key: c.candidate_key, name: c.name, state: c.state,
      independenceGroup: c.independence_group, origin: c.origin,
      evidenceCount: Array.isArray(c.source_evidence) ? c.source_evidence.length : 0,
      profiled: Boolean(c.profiled_at),
    })),
    discoverySet: persisted.discoverySet ? {
      id: persisted.discoverySet.id,
      selected: persisted.discoverySet.selected_candidates,
      rationale: persisted.discoverySet.selection_rationale,
      holdoutCandidateKey: persisted.discoverySet.holdout_candidate_key,
      holdoutSelectedAt: persisted.discoverySet.holdout_selected_at,
      holdoutSelectionBasis: persisted.discoverySet.holdout_selection_basis,
      holdoutPreregistered: persisted.discoverySet.holdout_preregistered,
      state: persisted.discoverySet.state,
    } : null,
  }, null, 2));

  await sequelize.close();
  process.exit(result.status === 'MARKET_DISCOVERY_COMPLETED' ? 0 : 2);
}

main().catch((error) => {
  console.error('MARKET_DISCOVERY_REAL_RUN_FAILED', error.code || error.message);
  console.error(error.stack);
  process.exit(1);
});
