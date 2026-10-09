'use strict';

/**
 * Módulo de rotas: RAP VERSION & SECURITY INTELLIGENCE (superfície de engenharia).
 *
 * Classificação: **DEVELOPMENT**. Inventário de componentes, CVEs internos, plano
 * de correção e integridade de índice vetorial são superfície de ENGENHARIA —
 * nunca de cliente. O guard roda ANTES de qualquer handler e a classificação vem
 * do ator resolvido server-side (`checkClassification`), nunca do corpo/query.
 *
 * Postura de honestidade (a mesma do resto da capacidade):
 *   - nenhuma rota devolve "sem vulnerabilidades": o resumo carrega a IDADE da
 *     base de advisories e o estado da cobertura, e marca base vencida;
 *   - `POST /scan` e `POST /patches/generate` são idempotentes;
 *   - `POST /patch-mission` NÃO aplica correção: submete missão ao Roteador
 *     Engenheiro e exige `authorizedBy` para candidato de Nível C;
 *   - falha de persistência devolve 503 `persistence_required` em vez de dado
 *     parcial silencioso.
 */

const express = require('express');

const { checkClassification } = require('../../middleware/requireClassification');
const { tenantFromRequest } = require('../../../lib/rpaSecurity');

const ROUTE_ACTIONS = Object.freeze({
  SUMMARY: 'read',
  INVENTORY: 'read',
  FINDINGS: 'read',
  PATCHES: 'read',
  ADVISORIES: 'read',
  VECTOR_INDEX: 'read',
  SCAN: 'scan',
  PLAN: 'plan',
  PATCH_MISSION: 'patch_mission',
  WAIVERS_LIST: 'read',
  WAIVER_CREATE: 'waiver_create',
  WAIVER_REVOKE: 'waiver_revoke',
});

function createSecurityIntelRoutes({ buildDeps } = {}) {
  const router = express.Router();

  function depsFor(req, res) {
    return typeof buildDeps === 'function' ? buildDeps(req, res) : {};
  }

  /**
   * Guard de engenharia: autenticação (401) -> classificação DEVELOPMENT (403)
   * -> tenant resolvido server-side (400). Fail-closed em todas as etapas.
   *
   * O tenant NUNCA é assumido: se não for resolvível, a requisição é negada em
   * vez de cair silenciosamente em 'system' (substituição silenciosa de tenant
   * é exatamente o que a governança deste repo proíbe).
   */
  function guard(req, res) {
    const deps = depsFor(req, res);
    const auth = deps.requireAuth(req);
    if (!auth || !auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth && auth.error ? auth.error : 'não autenticado' });
      return null;
    }
    const check = checkClassification(req, 'DEVELOPMENT');
    if (!check.allowed) {
      deps.sendJson(res, 403, {
        error: 'classification_required',
        required: check.required,
        classification: check.classification,
        route: req.path,
      });
      return null;
    }
    let tenantKey;
    try {
      tenantKey = tenantFromRequest(req, auth);
    } catch (error) {
      deps.sendJson(res, 400, {
        error: error.code === 'TENANT_INVALID' ? 'tenant_invalid' : 'tenant_required',
        message: 'Tenant autenticado é obrigatório para a inteligência de versões/segurança',
      });
      return null;
    }
    const agent = auth.agent || req.agent || {};
    return {
      deps,
      tenantKey,
      actor: agent.username || agent.email || agent.id || 'security-intel-api',
      classification: check.classification,
    };
  }

  function handleError(deps, res, error) {
    const code = error && error.code ? error.code : null;
    if (code === 'persistence_required') {
      return deps.sendJson(res, 503, { error: 'persistence_required', detail: error.message });
    }
    // Recusas do waiver são decisões de política, não falhas de servidor: o
    // código e o motivo precisam chegar ao cliente para a ação ser corrigível.
    if (code && String(code).startsWith('waiver_')) {
      return deps.sendJson(res, error.statusCode || 400, {
        error: code,
        detail: String(error.message || '').slice(code.length + 1) || null,
      });
    }
    if (code === 'patch_candidate_requires_authorization') {
      return deps.sendJson(res, 403, {
        error: 'patch_candidate_requires_authorization',
        autonomy: error.autonomy || null,
        detail: 'candidato exige autorização explícita (Nível C): informe authorizedBy',
      });
    }
    if (code === 'patch_candidate_not_found') {
      return deps.sendJson(res, 404, { error: 'patch_candidate_not_found' });
    }
    if (code === 'security_intel_bom_ref_required' || code === 'security_intel_finding_key_required') {
      return deps.sendJson(res, 400, { error: code });
    }
    return deps.sendJson(res, 500, { error: 'security_intel_failed', detail: error.message });
  }

  // ── Leitura ─────────────────────────────────────────────────────────────

  router.get('/api/security-intel/summary', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps, tenantKey } = ctx;
    try {
      const { getInventorySummary, getLatestDiscoveryRun } = require('../../services/securityIntel/inventoryStoreService');
      const { getFindingSummary, loadPolicy } = require('../../services/securityIntel/vulnerabilityScanService');
      const { getLatestSbomSnapshot, listSbomSnapshots } = require('../../services/securityIntel/sbomService');
      const { listPatchCandidates } = require('../../services/securityIntel/patchPlanService');
      const {
        getSecurityIntelWorkerStatus,
        getLatestAdvisorySyncAge,
      } = require('../../services/securityIntel/securityIntelWorker');

      const [inventory, findings, latestRun, snapshot, snapshots, patches, advisoryAgeHours] = await Promise.all([
        getInventorySummary({ tenantKey }),
        getFindingSummary({ tenantKey }),
        getLatestDiscoveryRun({ tenantKey }),
        getLatestSbomSnapshot({ tenantKey }),
        listSbomSnapshots({ tenantKey, limit: 5 }),
        listPatchCandidates({ tenantKey, limit: 1 }),
        getLatestAdvisorySyncAge(),
      ]);

      const policy = loadPolicy();
      const staleAfterHours = policy.advisorySources?.osv?.maxAgeHoursBeforeStale || 72;
      const blockOnSeverity = policy.releaseGate?.blockOnSeverity || [];
      // Só risco ABERTO por severidade: as linhas descartadas por VEX ficam em
      // `vexEvaluations` (evidência de triagem), nunca somadas ao risco.
      const blockingFindings = blockOnSeverity.reduce(
        (total, severity) => total + (findings.bySeverity?.[severity] || 0),
        0,
      );
      const discoveryAgeHours = latestRun
        ? (Date.now() - new Date(latestRun.started_at).getTime()) / 3600000
        : null;

      deps.sendJson(res, 200, {
        tenantKey,
        generatedAt: new Date().toISOString(),
        inventory,
        findings,
        blockingFindings,
        vexEvaluations: findings.vex?.total ?? 0,
        policy: {
          blockOnSeverity,
          blockOnDevDependencies: policy.releaseGate?.blockOnDevDependencies === true,
          blockWhenKevWithoutFix: policy.releaseGate?.blockWhenKevWithoutFix !== false,
          minCoveragePercent: policy.releaseGate?.minCoveragePercent ?? null,
          waiverMaxDays: policy.releaseGate?.maxWaiverDays ?? null,
        },
        // Idade da BASE DE ADVISORIES (não do discovery): base vencida não pode
        // ser apresentada como "sem vulnerabilidades".
        advisoryBase: {
          source: 'osv',
          ageHours: advisoryAgeHours === null ? null : Math.round(advisoryAgeHours * 100) / 100,
          staleAfterHours,
          stale: advisoryAgeHours === null || advisoryAgeHours > staleAfterHours,
        },
        discovery: latestRun
          ? {
            runId: latestRun.id,
            status: latestRun.status,
            startedAt: latestRun.started_at,
            ageHours: discoveryAgeHours === null ? null : Math.round(discoveryAgeHours * 100) / 100,
            coveragePercent: latestRun.coverage?.coveragePercent ?? null,
            unavailable: latestRun.unavailable || [],
            driftFindings: (latestRun.drift || []).filter((entry) => entry.verdict === 'drift').length,
          }
          : null,
        sbom: snapshot
          ? {
            snapshotId: snapshot.id,
            sha256: snapshot.sha256,
            components: snapshot.component_count,
            valid: snapshot.validation?.valid === true,
            generatedAt: snapshot.generated_at,
          }
          : null,
        sbomHistory: snapshots.map((row) => ({ sha256: row.sha256, generatedAt: row.generated_at, components: row.component_count })),
        patchCandidates: patches.total,
        worker: getSecurityIntelWorkerStatus(),
      });
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  router.get('/api/security-intel/inventory', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps, tenantKey } = ctx;
    try {
      const { getInventory } = require('../../services/securityIntel/inventoryStoreService');
      const result = await getInventory({
        tenantKey,
        service: req.query.service,
        ecosystem: req.query.ecosystem,
        versionClass: req.query.versionClass,
        search: req.query.search,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      deps.sendJson(res, 200, result);
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  router.get('/api/security-intel/versions', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps, tenantKey } = ctx;
    try {
      const { getComponentVersions } = require('../../services/securityIntel/inventoryStoreService');
      const rows = await getComponentVersions({
        bomRef: req.query.bomRef,
        tenantKey,
        limit: req.query.limit,
      });
      deps.sendJson(res, 200, { bomRef: req.query.bomRef, items: rows });
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  router.get('/api/security-intel/findings', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps, tenantKey } = ctx;
    try {
      const { listFindings } = require('../../services/securityIntel/vulnerabilityScanService');
      const result = await listFindings({
        tenantKey,
        status: req.query.status,
        severity: req.query.severity,
        service: req.query.service,
        kev: req.query.kev === 'true' ? true : undefined,
        includeResolved: req.query.includeResolved === 'true',
        limit: req.query.limit,
        offset: req.query.offset,
      });
      deps.sendJson(res, 200, result);
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  router.get('/api/security-intel/findings/timeline', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps, tenantKey } = ctx;
    try {
      const { getFindingTimeline } = require('../../services/securityIntel/vulnerabilityScanService');
      const rows = await getFindingTimeline({
        findingKey: req.query.findingKey,
        tenantKey,
        limit: req.query.limit,
      });
      deps.sendJson(res, 200, { findingKey: req.query.findingKey, items: rows });
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  router.get('/api/security-intel/patches', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps, tenantKey } = ctx;
    try {
      const { listPatchCandidates } = require('../../services/securityIntel/patchPlanService');
      const result = await listPatchCandidates({
        tenantKey,
        status: req.query.status,
        autonomy: req.query.autonomy,
        severity: req.query.severity,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      deps.sendJson(res, 200, result);
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  router.get('/api/security-intel/vector-index', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps } = ctx;
    try {
      const { checkVectorIndexHealth } = require('../../services/securityIntel/vectorIndexProbe');
      const { loadPolicy } = require('../../services/securityIntel/vulnerabilityScanService');
      const result = await checkVectorIndexHealth({ policy: loadPolicy({ reload: true }) });
      deps.sendJson(res, 200, {
        verdict: result.evaluation.verdict,
        summary: result.evaluation.summary,
        findings: result.evaluation.findings,
        unmeasured: result.evaluation.unmeasured,
        evidence: result.evaluation.evidence,
      });
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  router.get('/api/security-intel/advisories', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps } = ctx;
    try {
      const { connect, getSequelize } = require('../../db/sequelize');
      const getSecurityAdvisorySync = require('../../db/models/SecurityAdvisorySync');
      const getSecurityAdvisory = require('../../db/models/SecurityAdvisory');
      if (!getSequelize()) await connect(3, 500);
      const Sync = getSecurityAdvisorySync();
      const Advisory = getSecurityAdvisory();
      const [syncs, total, kevCount] = await Promise.all([
        Sync.findAll({ where: { source: 'osv' }, order: [['started_at', 'DESC']], limit: 10, raw: true }),
        Advisory.count(),
        Advisory.count({ where: { kev: true } }),
      ]);
      deps.sendJson(res, 200, {
        source: 'osv',
        advisoriesTotal: total,
        kevTotal: kevCount,
        syncs: syncs.map((row) => ({
          id: row.id,
          status: row.status,
          startedAt: row.started_at,
          ageHours: Math.round(((Date.now() - new Date(row.finished_at || row.started_at).getTime()) / 3600000) * 100) / 100,
          packagesQueried: row.packages_queried,
          advisoriesUpserted: row.advisories_upserted,
          snapshotSha256: row.snapshot_sha256,
          failures: row.failures || [],
        })),
      });
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  // ── Ações (idempotentes; nada aplica correção) ──────────────────────────

  router.post('/api/security-intel/scan', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps, tenantKey, actor } = ctx;
    try {
      const { scanComponents } = require('../../services/securityIntel/vulnerabilityScanService');
      const report = await scanComponents({
        tenantKey,
        scope: req.body?.scope || 'installed',
        actor,
      });
      deps.sendJson(res, 200, report);
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  router.post('/api/security-intel/patches/generate', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps, tenantKey } = ctx;
    try {
      const { generatePatchPlans } = require('../../services/securityIntel/patchPlanService');
      const result = await generatePatchPlans({
        tenantKey,
        onlyBlocking: req.body?.onlyBlocking === true,
        includeDevOnly: req.body?.includeDevOnly === true,
      });
      deps.sendJson(res, 200, {
        findings: result.findings,
        candidates: result.candidates,
        summary: result.summary,
      });
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  router.post('/api/security-intel/patch-mission', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps, tenantKey, actor } = ctx;
    try {
      const { createPatchMission } = require('../../services/securityIntel/patchPlanService');
      const result = await createPatchMission({
        candidateKey: req.body?.candidateKey,
        tenantKey,
        actor,
        authorizedBy: req.body?.authorizedBy || null,
      });
      deps.sendJson(res, 202, {
        candidateKey: result.candidateKey || req.body?.candidateKey,
        missionId: result.missionId || null,
        created: result.created === true,
        reason: result.reason || null,
      });
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  // ── Waivers: aceitação formal e temporária de risco (decisão HUMANA) ─────

  router.get('/api/security-intel/waivers', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps, tenantKey } = ctx;
    try {
      const { listWaivers } = require('../../services/securityIntel/waiverService');
      const result = await listWaivers({
        tenantKey,
        state: String(req.query.state || 'ACTIVE').toUpperCase(),
        limit: req.query.limit,
        offset: req.query.offset,
      });
      const { loadPolicy } = require('../../services/securityIntel/vulnerabilityScanService');
      deps.sendJson(res, 200, {
        ...result,
        maxWaiverDays: loadPolicy().releaseGate?.maxWaiverDays ?? null,
      });
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  router.post('/api/security-intel/waivers', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps, tenantKey, actor } = ctx;
    try {
      const { createWaiver } = require('../../services/securityIntel/waiverService');
      const { loadPolicy } = require('../../services/securityIntel/vulnerabilityScanService');
      const result = await createWaiver({
        tenantKey,
        findingKey: req.body?.findingKey,
        reason: req.body?.reason,
        approvedBy: req.body?.approvedBy,
        createdBy: actor,
        expiresInDays: req.body?.expiresInDays,
        expiresAt: req.body?.expiresAt,
        compensatingControl: req.body?.compensatingControl || null,
        maxWaiverDays: loadPolicy().releaseGate?.maxWaiverDays ?? undefined,
      });
      deps.sendJson(res, 201, {
        waiverKey: result.waiverKey,
        findingKey: req.body?.findingKey,
        created: result.created === true,
        expiresAt: result.waiver.expires_at,
        approvedBy: result.waiver.approved_by,
      });
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  router.post('/api/security-intel/waivers/revoke', async (req, res) => {
    const ctx = guard(req, res);
    if (!ctx) return;
    const { deps, tenantKey, actor } = ctx;
    try {
      const { revokeWaiver } = require('../../services/securityIntel/waiverService');
      const result = await revokeWaiver({
        waiverKey: req.body?.waiverKey,
        tenantKey,
        actor,
        reason: req.body?.reason || null,
      });
      deps.sendJson(res, 200, {
        waiverKey: req.body?.waiverKey,
        revoked: result.revoked === true,
        reason: result.reason || null,
      });
    } catch (error) {
      handleError(deps, res, error);
    }
  });

  void ROUTE_ACTIONS;
  return router;
}

module.exports = { createSecurityIntelRoutes, ROUTE_ACTIONS };
