'use strict';

/**
 * Módulo de rotas: DESCOBERTA AUTÔNOMA DE MERCADO (superfície de engenharia).
 *
 * Este é o CHAMADOR DE RUNTIME do `marketDiscoverySupervisor` (T-MR1). Sem ele,
 * a descoberta de mercado continuaria sendo apenas biblioteca + capability:
 * nenhum caminho vivo da plataforma alcançaria o supervisor.
 *
 * Classificação: DEVELOPMENT, tenant SYSTEM — descoberta de mercado é pesquisa
 * de engenharia, nunca superfície PRODUCTION (mesma disciplina do módulo
 * benchmark-research: o guard roda ANTES de qualquer handler e a classificação
 * vem do ator resolvido server-side).
 *
 * Postura de honestidade:
 *   - o provider DEFAULT é resolvido pelo Canonical Tool Registry: tools de MCP
 *     externo registradas no startup atendem as capabilities `research.*` — a
 *     escolha de provider fica no REGISTRY (capability-driven), nunca hardcoded
 *     neste módulo. O provider NATIVO de pesquisa só é usado com opt-in
 *     EXPLÍCITO (`RESEARCH_NATIVE_PROVIDER_ENABLED=1`), auditado em log; a
 *     injeção via `resolveDiscoveryDeps` tem precedência (testes);
 *   - sem provider governado e sem opt-in o run termina
 *     `MARKET_DISCOVERY_BLOCKED_NO_EXTERNAL_ACCESS` — fail closed, nunca egress
 *     direto do Core;
 *   - o holdout é pré-registrado ANTES de qualquer pesquisa profunda; a rota
 *     de handoff (T-MR2) recusa set sem pré-registro
 *     (`market_discovery_holdout_not_preregistered`);
 *   - todo estado é lido do store (Postgres): GET sobrevive a restart porque
 *     nunca houve memória de processo para perder.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const { checkClassification } = require('../../middleware/requireClassification');
const { tenantFromRequest } = require('../../../lib/rpaSecurity');
const { createMarketDiscoveryStore } = require('../../services/marketDiscovery/marketDiscoveryStore');
const {
  createMarketDiscoverySupervisor,
  buildDiscoveryPrincipal,
} = require('../../services/marketDiscovery/marketDiscoverySupervisor');
const { createDiscoveryHandoff } = require('../../services/marketDiscovery/discoveryHandoff');
const { createBenchmarkResearchStore } = require('../../services/benchmark/benchmarkResearchStore');
const { createBenchmarkResearchService } = require('../../services/benchmark/benchmarkResearchService');
const { canonicalResearchTenant, SEMANTIC_CODES } = require('../../services/benchmark/benchmarkResearchSemantics');
const { createNativeResearchProvider } = require('../../services/research/nativeResearchProvider');
const {
  resolveGovernedResearchRunners,
  isNativeResearchProviderEnabled,
  NATIVE_OPT_IN_ENV,
} = require('../../services/research/governedResearchProviders');

const SAMPLES_DIR = path.join(__dirname, '..', '..', '..', 'config', 'benchmarks');

/** Vertical só pode virar caminho de arquivo com este formato. */
const VERTICAL_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Provider NATIVO compartilhado do módulo (lazy): uma única instância preserva
 * a polidez por host entre requisições.
 */
let sharedNativeProviders = null;
function nativeResearchProviders(log) {
  if (!sharedNativeProviders) {
    sharedNativeProviders = createNativeResearchProvider({ logger: log });
  }
  return sharedNativeProviders;
}

/**
 * Providers de pesquisa do caminho PADRÃO (P0 RAP_CORE_RESEARCH_EGRESS).
 *
 * Governado pelo registry primeiro; NATIVO apenas com opt-in explícito
 * (`RESEARCH_NATIVE_PROVIDER_ENABLED=1`); sem nenhum dos dois o conjunto é
 * VAZIO e a descoberta falha fechada em vez de sair para a Internet pelo Core.
 */
function defaultResearchProviders(log, { registry, actor, tenantId } = {}) {
  const governed = resolveGovernedResearchRunners({ registry, actor, tenantId });
  if (governed.available.length > 0) {
    if (log && typeof log.info === 'function') {
      log.info('[market-discovery] providers governados de pesquisa resolvidos pelo registry', {
        available: governed.available,
        missing: governed.missing,
      });
    }
    return governed.runners;
  }
  if (isNativeResearchProviderEnabled()) {
    if (log && typeof log.warn === 'function') {
      log.warn('[market-discovery] egress NATIVO de pesquisa habilitado explicitamente', {
        env: NATIVE_OPT_IN_ENV,
        missing: governed.missing,
      });
    }
    return nativeResearchProviders(log);
  }
  if (log && typeof log.warn === 'function') {
    log.warn('[market-discovery] sem provider governado de pesquisa; egress nativo desabilitado (fail closed)', {
      missing: governed.missing,
      optInEnv: NATIVE_OPT_IN_ENV,
    });
  }
  return {};
}

function readSample(vertical) {
  if (!VERTICAL_PATTERN.test(String(vertical || ''))) return null;
  const samplePath = path.join(SAMPLES_DIR, `${vertical}.json`);
  if (!fs.existsSync(samplePath)) return null;
  return { samplePath, sample: JSON.parse(fs.readFileSync(samplePath, 'utf8')) };
}

/** Serializa linha Sequelize (ou objeto plano do store de teste). */
function plain(row) {
  if (!row) return null;
  if (typeof row.get === 'function') return row.get({ plain: true });
  return JSON.parse(JSON.stringify(row));
}

function createMarketDiscoveryRoutes({ buildDeps, resolveDiscoveryDeps }) {
  const router = express.Router();

  function enforceDevelopment(deps, req, res) {
    const check = checkClassification(req, 'DEVELOPMENT');
    if (!check.allowed) {
      deps.sendJson(res, 403, {
        error: 'classification_required',
        required: check.required,
        classification: check.classification,
      });
      return false;
    }
    return true;
  }

  function requireTenant(deps, req, res, auth) {
    try {
      return tenantFromRequest(req, auth);
    } catch (error) {
      deps.sendJson(res, 400, {
        error: error.code === 'TENANT_INVALID' ? 'tenant_invalid' : 'tenant_required',
        message: 'Tenant autenticado é obrigatório para descoberta de mercado',
      });
      return null;
    }
  }

  function authenticate(deps, req, res) {
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return null;
    }
    if (!enforceDevelopment(deps, req, res)) return null;
    const authenticatedTenant = requireTenant(deps, req, res, auth);
    if (!authenticatedTenant) return null;

    // Descoberta de mercado é superfície SYSTEM/INTERNAL: o tenant é resolvido
    // SERVER-SIDE para 'system'; tenant operacional é recusado fail-closed
    // (nunca convertido em silêncio).
    const discoveryTenant = canonicalResearchTenant(authenticatedTenant);
    if (!discoveryTenant) {
      deps.sendJson(res, 403, {
        error: SEMANTIC_CODES.SYSTEM_TENANT_REQUIRED,
        message: 'Descoberta de mercado é superfície SYSTEM/INTERNAL; '
          + 'não é executável em tenant operacional',
        authenticatedTenant,
        requiredTenant: 'system',
      });
      return null;
    }

    return { auth, tenantId: discoveryTenant, authenticatedTenant };
  }

  /**
   * Registry COMPARTILHADO (o mesmo onde as tools MCP externas são registradas
   * no startup) — a precedência de providers fica em um único lugar.
   */
  function resolveSharedToolRegistry() {
    try {
      const { resolveToolRegistry } = require('../../services/askAi/toolRegistry');
      return resolveToolRegistry(null);
    } catch (error) {
      const wrapped = new Error(`market_discovery_registry_unavailable: ${error.message}`);
      wrapped.code = 'market_discovery_registry_unavailable';
      throw wrapped;
    }
  }

  function resolveInjected(req, context) {
    return typeof resolveDiscoveryDeps === 'function'
      ? (resolveDiscoveryDeps({ req, tenantId: context.tenantId, actor: req.agent }) || {})
      : {};
  }

  function buildSupervisor(deps, req, context, injected) {
    const registry = injected.registry || resolveSharedToolRegistry();
    // O principal governado é REQUISITO da resolução de providers: o registry
    // filtra por classificação/permissão e o binding de tenant externo exige
    // `actor.tenant` (src/core/mcp/capability-resolution.js). Com `actor`
    // undefined a resolução descarta TODO proxy de MCP externo (fail-closed) e
    // o run sai BLOCKED_NO_EXTERNAL_ACCESS mesmo com o MCP research vivo —
    // era o estado real antes da correção (2026-09-19). Mesmo contrato do
    // benchmark research (`injected.actor || buildResearchPrincipal()`).
    const actor = injected.actor || buildDiscoveryPrincipal();
    return createMarketDiscoverySupervisor({
      store: injected.store || createMarketDiscoveryStore(),
      registry,
      providers: injected.providers || defaultResearchProviders(deps.logger, { registry, actor, tenantId: context.tenantId }),
      tenantId: context.tenantId,
      actor,
      now: injected.now,
      logger: deps.logger,
      selection: injected.selection || {},
      // Exclusão DURÁVEL (run real r18, ABS-20): benchmarks já analisados
      // segundo o benchmark research store nunca voltam ao set — o sample
      // esquece benchmark graduado, o store não.
      researchedKeysProvider: injected.researchedKeysProvider
        || (({ tenantId, vertical }) => (injected.benchmarkStore || createBenchmarkResearchStore())
          .listAnalyzedBenchmarkIds({ tenantId, vertical })),
    });
  }

  function buildHandoff(context, injected) {
    const marketStore = injected.store || createMarketDiscoveryStore();
    const benchmarkService = createBenchmarkResearchService({
      store: injected.benchmarkStore || createBenchmarkResearchStore(),
      now: injected.now,
    });
    return createDiscoveryHandoff({ marketStore, benchmarkService, now: injected.now });
  }

  function sendError(deps, res, error) {
    const code = error?.code || 'market_discovery_failed';
    const status = code === 'persistence_required' ? 503 : 400;
    deps.sendJson(res, status, { error: code, message: error.message });
  }

  // --- POST /api/market-discovery/runs ------------------------------------
  router.post('/api/market-discovery/runs', async (req, res) => {
    const deps = buildDeps(req, res);
    const context = authenticate(deps, req, res);
    if (!context) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await deps.parseJsonBody(req);
      const vertical = String(body?.vertical || '').trim();
      if (!vertical) {
        deps.sendJson(res, 400, { error: 'bad_request', message: 'vertical é obrigatória' });
        return;
      }
      // Sample: corpo da requisição ou o config versionado da vertical.
      let sample = body?.sample && typeof body.sample === 'object' ? body.sample : null;
      if (!sample) {
        const loaded = readSample(vertical);
        if (!loaded) {
          deps.sendJson(res, 404, { error: 'sample_not_found', message: `sample ausente para ${vertical}` });
          return;
        }
        sample = loaded.sample;
      }
      const discoveryVersion = String(body?.discoveryVersion || '').trim()
        || (sample.sampleVersion ? `market-discovery-${sample.sampleVersion}` : '');
      if (!discoveryVersion) {
        deps.sendJson(res, 400, {
          error: 'bad_request',
          message: 'discoveryVersion é obrigatória quando o sample não declara sampleVersion',
        });
        return;
      }

      const injected = resolveInjected(req, context);
      const supervisor = buildSupervisor(deps, req, context, injected);
      const result = await supervisor.discover({
        vertical,
        discoveryVersion,
        sample,
        marketQueries: Array.isArray(body?.marketQueries) ? body.marketQueries : null,
      });
      deps.logAction?.(req, 'market_discovery.run_executed', {
        vertical,
        discoveryVersion,
        runId: result.runId,
        status: result.status,
      });
      // Bloqueio externo NÃO é erro do cliente: é estado operacional honesto.
      deps.sendJson(res, 200, result);
    } catch (error) {
      sendError(deps, res, error);
    }
  });

  // --- GET /api/market-discovery/runs -------------------------------------
  router.get('/api/market-discovery/runs', async (req, res) => {
    const deps = buildDeps(req, res);
    const context = authenticate(deps, req, res);
    if (!context) return;
    try {
      const injected = resolveInjected(req, context);
      const store = injected.store || createMarketDiscoveryStore();
      const vertical = String(req.query?.vertical || '').trim() || null;
      const runs = await store.listRuns({ tenantId: context.tenantId, vertical });
      deps.sendJson(res, 200, { runs: runs.map(plain) });
    } catch (error) {
      sendError(deps, res, error);
    }
  });

  // --- GET /api/market-discovery/runs/:runId -------------------------------
  router.get('/api/market-discovery/runs/:runId', async (req, res) => {
    const deps = buildDeps(req, res);
    const context = authenticate(deps, req, res);
    if (!context) return;
    try {
      const injected = resolveInjected(req, context);
      const store = injected.store || createMarketDiscoveryStore();
      const run = await store.getRunById({ tenantId: context.tenantId, runId: req.params.runId });
      if (!run) {
        deps.sendJson(res, 404, {
          error: 'market_discovery_run_not_found',
          message: `run inexistente: ${req.params.runId}`,
        });
        return;
      }
      const runPlain = plain(run);
      const setId = runPlain?.metadata?.handoff?.discoverySetId || runPlain?.metadata?.discoverySetId || null;
      const set = setId
        ? await store.getDiscoverySet({ tenantId: context.tenantId, setId })
        : await store.getLatestDiscoverySet({ tenantId: context.tenantId, vertical: runPlain.vertical });
      deps.sendJson(res, 200, { run: runPlain, discoverySet: plain(set) });
    } catch (error) {
      sendError(deps, res, error);
    }
  });

  // --- POST /api/market-discovery/runs/:runId/handoff ----------------------
  // T-MR2 — abre o run de benchmark research a partir do handoff PERSISTIDO
  // do run de mercado, com lineage (`marketDiscoveryRunId`) gravada no run de
  // benchmark. A ordem holdout-antes-de-pesquisa-profunda é enforced pelo
  // discoveryHandoff contra o estado persistido do set.
  router.post('/api/market-discovery/runs/:runId/handoff', async (req, res) => {
    const deps = buildDeps(req, res);
    const context = authenticate(deps, req, res);
    if (!context) return;
    try {
      const injected = resolveInjected(req, context);
      const store = injected.store || createMarketDiscoveryStore();
      const run = await store.getRunById({ tenantId: context.tenantId, runId: req.params.runId });
      if (!run) {
        deps.sendJson(res, 404, {
          error: 'market_discovery_run_not_found',
          message: `run inexistente: ${req.params.runId}`,
        });
        return;
      }
      const runPlain = plain(run);
      const handoff = runPlain?.metadata?.handoff;
      if (!handoff) {
        deps.sendJson(res, 400, {
          error: 'market_discovery_handoff_unavailable',
          message: `run ${req.params.runId} não produziu handoff (estado: ${runPlain?.state || 'desconhecido'})`,
        });
        return;
      }
      const opened = await buildHandoff(context, injected).openBenchmarkResearchRun({
        tenantId: context.tenantId,
        handoff,
      });
      deps.logAction?.(req, 'market_discovery.handed_off', {
        runId: req.params.runId,
        discoverySetId: opened.discoverySetId,
        researchVersion: handoff.researchVersion,
      });
      deps.sendJson(res, 200, opened);
    } catch (error) {
      sendError(deps, res, error);
    }
  });

  return router;
}

module.exports = { createMarketDiscoveryRoutes };
