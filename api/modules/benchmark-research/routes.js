'use strict';

/**
 * Módulo de rotas: PESQUISA COMPETITIVA DE BENCHMARKS (superfície de engenharia).
 *
 * Este é o CHAMADOR DE PRODUÇÃO do `benchmarkResearchSupervisor` (§B1/§B2). Sem
 * ele, `createBenchmarkResearchRunner()` continuaria sendo apenas biblioteca.
 *
 * Classificação: DEVELOPMENT (engenharia). Benchmark é pesquisa SYSTEM/INTERNAL
 * — nunca superfície PRODUCTION. O guard é aplicado ANTES de qualquer handler,
 * e a classificação vem do ator resolvido server-side (nunca do corpo).
 *
 * Postura de honestidade:
 *   - o provider DEFAULT é o provider NATIVO de pesquisa
 *     (`api/services/research/nativeResearchProvider.js`): fetch real sob a
 *     política de endpoint do MCP (SSRF guard), busca DuckDuckGo sem chave,
 *     inspeções determinísticas. A injeção via `resolveResearchDeps` continua
 *     disponível para testes;
 *   - se um provider injetado omitir capabilities, `execute` devolve
 *     `RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS` com a lista NOMINAL do que falta.
 *     Nada é registrado e nenhum sample é tocado;
 *   - o DISCOVERY SET é pré-registrado por `POST /runs` (§5). `execute` recusa
 *     rodar sem ele;
 *   - a escrita no sample versionado exige tenant `system` e é transacional.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const { checkClassification } = require('../../middleware/requireClassification');
const { tenantFromRequest } = require('../../../lib/rpaSecurity');
const { createBenchmarkResearchStore } = require('../../services/benchmark/benchmarkResearchStore');
const {
  createBenchmarkResearchSupervisor,
  buildResearchPrincipal,
} = require('../../services/benchmark/benchmarkResearchSupervisor');
const { canonicalResearchTenant, SEMANTIC_CODES } = require('../../services/benchmark/benchmarkResearchSemantics');
const { applySamplePatch, SAMPLES_DIR } = require('../../services/benchmark/benchmarkSampleRegistry');
const { evaluateSampleSufficiency } = require('../../../qa/benchmarks/benchmarkSufficiencyEngine');
const { createNativeResearchProvider } = require('../../services/research/nativeResearchProvider');
const policy = require('../../../config/benchmark-sufficiency-policy.json');

/**
 * Provider NATIVO compartilhado do módulo (lazy): uma única instância preserva
 * a polidez por host entre requisições. Injeção via `resolveResearchDeps`
 * continua tendo precedência (testes).
 */
let sharedNativeProviders = null;
function defaultResearchProviders(log) {
  if (!sharedNativeProviders) {
    sharedNativeProviders = createNativeResearchProvider({ logger: log });
  }
  return sharedNativeProviders;
}

/** Vertical só pode virar caminho de arquivo com este formato. */
const VERTICAL_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function readSample(vertical) {
  if (!VERTICAL_PATTERN.test(String(vertical || ''))) return null;
  const samplePath = path.join(SAMPLES_DIR, `${vertical}.json`);
  if (!fs.existsSync(samplePath)) return null;
  return { samplePath, sample: JSON.parse(fs.readFileSync(samplePath, 'utf8')) };
}

function createBenchmarkResearchRoutes({ buildDeps, resolveResearchDeps }) {
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
        message: 'Tenant autenticado é obrigatório para pesquisa de benchmarks',
      });
      return null;
    }
  }

  function enforceSystemTenant(deps, res, tenantId) {
    if (tenantId === 'system') return true;
    deps.sendJson(res, 403, {
      error: 'system_tenant_required',
      message: 'O sample de benchmark é artefato canônico global e exige o tenant system',
    });
    return false;
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

    // §TAREFA 30/31/32/84 — COMPETITIVE BENCHMARK RESEARCH É SYSTEM/INTERNAL.
    //
    // O tenant é resolvido SERVER-SIDE para 'system'. Antes, o tenant
    // autenticado era usado direto: um engineer logado no tenant de um cliente
    // criava o run NAQUELE tenant, misturando pesquisa de mercado interna com
    // dado operacional (e colocando o resultado ao alcance do RAG do cliente).
    //
    // A recusa é fail-closed: tenant que não é um alias interno conhecido NÃO
    // é silenciosamente convertido — a operação é negada.
    const researchTenant = canonicalResearchTenant(authenticatedTenant);
    if (!researchTenant) {
      deps.sendJson(res, 403, {
        error: SEMANTIC_CODES.SYSTEM_TENANT_REQUIRED,
        message: 'Pesquisa competitiva de benchmark é superfície SYSTEM/INTERNAL; '
          + 'não é executável em tenant operacional',
        authenticatedTenant,
        requiredTenant: 'system',
      });
      return null;
    }

    return { auth, tenantId: researchTenant, authenticatedTenant };
  }

  /**
   * Monta o supervisor para a requisição. `resolveResearchDeps` injeta store e
   * registry (e, em teste, providers). Sem registry o supervisor não é criado —
   * a capability não existiria em lugar nenhum.
   */
  function buildSupervisor(deps, req, context) {
    const injected = typeof resolveResearchDeps === 'function'
      ? (resolveResearchDeps({ req, tenantId: context.tenantId, actor: req.agent }) || {})
      : {};
    const store = injected.store || createBenchmarkResearchStore();
    const registry = injected.registry || resolveSharedToolRegistry();
    return {
      supervisor: createBenchmarkResearchSupervisor({
        store,
        registry,
        providers: injected.providers || defaultResearchProviders(deps.logger),
        // O tenant do run é SEMPRE SYSTEM (já resolvido em `authenticate`).
        tenantId: injected.tenantId || context.tenantId || 'system',
        // §TAREFA 27/28 — principal interno com delegação EXPLÍCITA a
        // `research.*` (sem wildcard). O default antigo só tinha
        // `benchmark.research.execute`, então os provedores de pesquisa nunca
        // eram alcançáveis pelo caminho de produção.
        actor: injected.actor || buildResearchPrincipal(),
        logger: deps.logger,
      }),
      store,
      registry,
    };
  }

  /**
   * Registry COMPARTILHADO (o mesmo onde as tools MCP externas são registradas
   * no startup). Resolvido pelo mesmo módulo que o copiloto usa — a regra de
   * precedência existe em um único lugar.
   */
  function resolveSharedToolRegistry() {
    try {
      const { resolveToolRegistry } = require('../../services/askAi/toolRegistry');
      return resolveToolRegistry(null);
    } catch (error) {
      const wrapped = new Error(`benchmark_research_registry_unavailable: ${error.message}`);
      wrapped.code = 'benchmark_research_registry_unavailable';
      throw wrapped;
    }
  }

  function sendError(deps, res, error) {
    const code = error?.code || 'benchmark_research_failed';
    const status = code === 'persistence_required' ? 503 : 400;
    deps.sendJson(res, status, { error: code, message: error.message });
  }

  // --- GET /api/benchmark-research/status ---------------------------------
  router.get('/api/benchmark-research/status', async (req, res) => {
    const deps = buildDeps(req, res);
    const context = authenticate(deps, req, res);
    if (!context) return;
    try {
      const { supervisor } = buildSupervisor(deps, req, context);
      supervisor.register();
      deps.sendJson(res, 200, {
        classification: 'DEVELOPMENT',
        capability: supervisor.capability,
        availability: supervisor.providerAvailability(),
      });
    } catch (error) {
      sendError(deps, res, error);
    }
  });

  // --- POST /api/benchmark-research/runs ----------------------------------
  router.post('/api/benchmark-research/runs', async (req, res) => {
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
      const researchVersion = String(body?.researchVersion || '').trim();
      const benchmarkIds = Array.isArray(body?.benchmarkIds) ? body.benchmarkIds : [];
      if (!vertical || !researchVersion || benchmarkIds.length === 0) {
        deps.sendJson(res, 400, {
          error: 'bad_request',
          message: 'vertical, researchVersion e benchmarkIds são obrigatórios',
        });
        return;
      }
      const { supervisor } = buildSupervisor(deps, req, context);
      // T-MR2 — lineage: quando o discovery set vem de um run de market
      // discovery, a proveniência (`marketDiscoveryRunId`) é gravada no
      // metadata do run de benchmark. Lineage declarada sem runId é recusada
      // pelo serviço (`market_discovery_lineage_invalid`).
      const lineage = body?.lineage && typeof body.lineage === 'object'
        ? body.lineage
        : (body?.marketDiscoveryRunId
          ? {
            source: 'market-discovery',
            marketDiscoveryRunId: body.marketDiscoveryRunId,
            discoverySetId: body?.discoverySetId || null,
            holdoutPreregisteredAt: body?.holdoutPreregisteredAt || null,
          }
          : null);
      const summary = await supervisor.service.openDiscoverySet({
        tenantId: context.tenantId,
        vertical,
        researchVersion,
        benchmarkIds,
        holdoutBenchmarkId: body?.holdoutBenchmarkId || null,
        lineage,
      });
      deps.logAction?.(req, 'benchmark_research.run_opened', { vertical, researchVersion, benchmarkIds });
      deps.sendJson(res, 200, { opened: true, summary });
    } catch (error) {
      sendError(deps, res, error);
    }
  });

  // --- GET /api/benchmark-research/runs/:vertical -------------------------
  router.get('/api/benchmark-research/runs/:vertical', async (req, res) => {
    const deps = buildDeps(req, res);
    const context = authenticate(deps, req, res);
    if (!context) return;
    try {
      const { supervisor } = buildSupervisor(deps, req, context);
      deps.sendJson(res, 200, { summary: await supervisor.summarize({ vertical: req.params.vertical }) });
    } catch (error) {
      sendError(deps, res, error);
    }
  });

  // --- POST /api/benchmark-research/runs/:vertical/execute ----------------
  router.post('/api/benchmark-research/runs/:vertical/execute', async (req, res) => {
    const deps = buildDeps(req, res);
    const context = authenticate(deps, req, res);
    if (!context) return;
    const vertical = String(req.params.vertical || '');
    const loaded = readSample(vertical);
    if (!loaded) {
      deps.sendJson(res, 404, { error: 'sample_not_found', message: `sample ausente para ${vertical}` });
      return;
    }
    try {
      const { supervisor } = buildSupervisor(deps, req, context);
      const result = await supervisor.research({ vertical, sample: loaded.sample });
      deps.logAction?.(req, 'benchmark_research.executed', {
        vertical,
        status: result.status,
        analyzed: result.analyzed,
      });
      // Bloqueio externo NÃO é erro do cliente: é estado operacional honesto.
      deps.sendJson(res, 200, result);
    } catch (error) {
      sendError(deps, res, error);
    }
  });

  // --- POST /api/benchmark-research/runs/:vertical/apparent-saturation ------
  // T-B3 — a saturação aparente precisa ser ALCANÇÁVEL pelo caminho de
  // produção. Sem esta rota (e sem a auto-marcação do supervisor), o holdout
  // ficava bloqueado para sempre por `assertHoldoutNotAnalyzedEarly`. O módulo
  // endereça runs por `:vertical` (mesma convenção de GET/execute/sample-patch).
  router.post('/api/benchmark-research/runs/:vertical/apparent-saturation', async (req, res) => {
    const deps = buildDeps(req, res);
    const context = authenticate(deps, req, res);
    if (!context) return;
    const vertical = String(req.params.vertical || '');
    try {
      const { supervisor } = buildSupervisor(deps, req, context);
      const result = await supervisor.service.markApparentSaturation({
        tenantId: context.tenantId,
        vertical,
      });
      deps.logAction?.(req, 'benchmark_research.apparent_saturation_marked', { vertical });
      deps.sendJson(res, 200, {
        ...result,
        summary: await supervisor.summarize({ vertical }),
      });
    } catch (error) {
      sendError(deps, res, error);
    }
  });

  // --- POST /api/benchmark-research/runs/:vertical/sample-patch -----------
  router.post('/api/benchmark-research/runs/:vertical/sample-patch', async (req, res) => {
    const deps = buildDeps(req, res);
    const context = authenticate(deps, req, res);
    if (!context) return;
    if (!enforceSystemTenant(deps, res, context.tenantId)) return;
    const vertical = String(req.params.vertical || '');
    const loaded = readSample(vertical);
    if (!loaded) {
      deps.sendJson(res, 404, { error: 'sample_not_found', message: `sample ausente para ${vertical}` });
      return;
    }
    try {
      const { supervisor } = buildSupervisor(deps, req, context);
      const patch = await supervisor.buildSamplePatch({
        vertical,
        inventoryVersion: loaded.sample.inventoryVersion || null,
        // Ciclo N+1: a novidade dos benchmarks do run é medida contra o
        // canônico + o que o sample versionado já conhece.
        priorSample: loaded.sample,
      });
      // Validação pós-merge COM O ENGINE: se o resultado não é avaliável, a
      // escrita é abortada e o arquivo anterior é restaurado.
      const applied = applySamplePatch({
        patch,
        samplePath: loaded.samplePath,
        validate: (candidate) => {
          const evaluation = evaluateSampleSufficiency({ sample: candidate, policy });
          if (!evaluation || !evaluation.status) {
            throw new Error('engine não produziu avaliação para o sample candidato');
          }
        },
      });
      deps.logAction?.(req, 'benchmark_research.sample_patched', {
        vertical,
        applied: applied.applied,
      });
      deps.sendJson(res, 200, applied);
    } catch (error) {
      sendError(deps, res, error);
    }
  });

  return router;
}

module.exports = { createBenchmarkResearchRoutes };
