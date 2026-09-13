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
 *   - sem provider governado para as capabilities `research.*`, `execute`
 *     devolve `RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS` com a lista NOMINAL do que
 *     falta. Nada é registrado e nenhum sample é tocado;
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
const { createBenchmarkResearchSupervisor } = require('../../services/benchmark/benchmarkResearchSupervisor');
const { applySamplePatch, SAMPLES_DIR } = require('../../services/benchmark/benchmarkSampleRegistry');
const { evaluateSampleSufficiency } = require('../../../qa/benchmarks/benchmarkSufficiencyEngine');
const policy = require('../../../config/benchmark-sufficiency-policy.json');

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
    const tenantId = requireTenant(deps, req, res, auth);
    if (!tenantId) return null;
    return { auth, tenantId };
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
        providers: injected.providers || {},
        tenantId: injected.tenantId || 'system',
        actor: injected.actor || { classification: 'DEVELOPMENT', permissions: ['benchmark.research.execute'] },
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
      const summary = await supervisor.service.openDiscoverySet({
        tenantId: context.tenantId,
        vertical,
        researchVersion,
        benchmarkIds,
        holdoutBenchmarkId: body?.holdoutBenchmarkId || null,
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
