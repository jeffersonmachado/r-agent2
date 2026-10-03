'use strict';

/**
 * api/modules/engineering-missions/routes.js
 *
 * Rotas REST do Engineering Mission Compiler / Enriquecimento — DEVELOPMENT-only, mesmo padrão de
 * `api/modules/engineering-router/routes.js`: `requireAuth` + `checkClassification('DEVELOPMENT')`
 * em TODA rota (nunca confiando no frontend).
 *
 * Uma única responsabilidade por rota, sempre delegando aos serviços:
 *   - o enriquecimento NUNCA executa;
 *   - a aprovação NUNCA executa;
 *   - a execução exige aprovação válida para a versão corrente (409 com causa exata).
 *
 * AUTORIZAÇÃO (§19): classificação DEVELOPMENT não é autorização suficiente para toda ação —
 * ela diz ONDE a rota pode ser chamada, não O QUE aquele usuário pode fazer. O módulo passa a
 * compor, além de auth + classificação, o RBAC real do produto
 * (`requirePermission(req, 'engineering', <ação>)` de `api/middleware/auth.js`), com um mapa
 * DECLARATIVO rota→ação. Rota sem entrada no mapa é NEGADA (fail-closed) — nunca "herda" a
 * permissão da vizinha por esquecimento.
 */

const express = require('express');
const { checkClassification } = require('../../middleware/requireClassification');

/**
 * Fail-closed: o tenant do request é OBRIGATÓRIO. Sem ele, lança TENANT_REQUIRED
 * em vez de operar no tenant de plataforma por fallback silencioso.
 *
 * `api/middleware/auth.js` já devolve `req.tenantId = null` de propósito para
 * super-admin sem o header `X-Tenant-Id` ("evita operar silenciosamente no tenant
 * do usuário"); um fallback para o tenant de plataforma aqui anularia esse
 * hardening e criaria missões no tenant ADMINISTRATIVO. Mesmo padrão de
 * vertical-templates/rap-learn/knowledge-graph/ai-governance.
 */
function requireTenantId(tenantId) {
  const tid = typeof tenantId === 'string' ? tenantId.trim() : tenantId;
  if (!tid) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  return tid;
}

/**
 * Mapa rota→ação do RBAC. `pattern` casa o pathname RELATIVO ao prefixo do GRUPO da rota
 * (`/engineering/missions` ou `/engineering/findings`); os padrões de sufixo primeiro
 * (aprovar/rejeitar/executar) e os genéricos por último.
 *
 * O ciclo de BUG vive no MESMO módulo/router das missões de propósito: um finding é trabalho
 * interno da missão, não um domínio paralelo. `group` mantém o mapa explícito e fail-closed.
 */
const ROUTE_ACTIONS = Object.freeze([
  { group: 'missions', method: 'GET', pattern: /^\/overview\/?$/, action: 'read' },
  { group: 'missions', method: 'GET', pattern: /^\/self-assessment\/?$/, action: 'read' },
  { group: 'missions', method: 'GET', pattern: /^\/policy\/?$/, action: 'read' },
  { group: 'missions', method: 'PUT', pattern: /^\/policy\/?$/, action: 'policy_admin' },
  { group: 'missions', method: 'POST', pattern: /^\/resume-interrupted\/?$/, action: 'execute' },
  { group: 'missions', method: 'GET', pattern: /^\/?$/, action: 'read' },
  { group: 'missions', method: 'POST', pattern: /^\/?$/, action: 'create' },
  { group: 'missions', method: 'GET', pattern: /^\/workers\/health\/?$/, action: 'read' },
  { group: 'missions', method: 'GET', pattern: /^\/[^/]+\/preview\/?$/, action: 'read' },
  { group: 'missions', method: 'GET', pattern: /^\/[^/]+\/versions\/?$/, action: 'read' },
  { group: 'missions', method: 'GET', pattern: /^\/[^/]+\/approvals\/?$/, action: 'read' },
  { group: 'missions', method: 'GET', pattern: /^\/[^/]+\/report\/?$/, action: 'read' },
  { group: 'missions', method: 'GET', pattern: /^\/[^/]+\/review\/?$/, action: 'read' },
  { group: 'missions', method: 'POST', pattern: /^\/[^/]+\/enrich\/?$/, action: 'enrich' },
  { group: 'missions', method: 'POST', pattern: /^\/[^/]+\/approve\/?$/, action: 'approve' },
  { group: 'missions', method: 'POST', pattern: /^\/[^/]+\/reject\/?$/, action: 'reject' },
  { group: 'missions', method: 'POST', pattern: /^\/[^/]+\/edit\/?$/, action: 'approve' },
  { group: 'missions', method: 'POST', pattern: /^\/[^/]+\/execute\/?$/, action: 'execute' },
  { group: 'missions', method: 'POST', pattern: /^\/[^/]+\/review\/?$/, action: 'execute' },
  { group: 'missions', method: 'GET', pattern: /^\/[^/]+\/?$/, action: 'read' },
  // ── Findings do ciclo de bug (mesma classificação DEVELOPMENT) ──────────────────────────────
  // Estáticas ANTES das parametrizadas: `/summary`, `/sweep` e `/telemetry` casariam com `/:id`.
  { group: 'findings', method: 'GET', pattern: /^\/summary\/?$/, action: 'read' },
  { group: 'findings', method: 'POST', pattern: /^\/sweep\/?$/, action: 'execute' },
  { group: 'findings', method: 'POST', pattern: /^\/telemetry\/?$/, action: 'execute' },
  { group: 'findings', method: 'GET', pattern: /^\/?$/, action: 'read' },
  { group: 'findings', method: 'POST', pattern: /^\/?$/, action: 'create' },
  { group: 'findings', method: 'GET', pattern: /^\/[^/]+\/history\/?$/, action: 'read' },
  { group: 'findings', method: 'POST', pattern: /^\/[^/]+\/reproduce\/?$/, action: 'execute' },
  { group: 'findings', method: 'POST', pattern: /^\/[^/]+\/confirm\/?$/, action: 'execute' },
  { group: 'findings', method: 'POST', pattern: /^\/[^/]+\/triage\/?$/, action: 'execute' },
  { group: 'findings', method: 'POST', pattern: /^\/[^/]+\/fix\/?$/, action: 'execute' },
  { group: 'findings', method: 'POST', pattern: /^\/[^/]+\/evidence\/?$/, action: 'execute' },
  { group: 'findings', method: 'POST', pattern: /^\/[^/]+\/approve-self-modification\/?$/, action: 'approve_self_modification' },
  { group: 'findings', method: 'GET', pattern: /^\/[^/]+\/?$/, action: 'read' },
]);

/** Descobre a ação exigida por (método, pathname). Sem match ⇒ null ⇒ negação. */
function resolveRequiredAction(method, pathname) {
  const url = String(pathname || '');
  const group = url.startsWith('/engineering/findings') ? 'findings' : 'missions';
  const stripped = group === 'findings'
    ? url.replace(/^\/engineering\/findings/, '')
    : url.replace(/^\/engineering\/missions/, '');
  const relative = stripped || '/';
  const upper = String(method || '').toUpperCase();
  const match = ROUTE_ACTIONS.find((entry) => entry.group === group && entry.method === upper && entry.pattern.test(relative));
  return match ? match.action : null;
}

function createEngineeringMissionRoutes({ buildDeps }) {
  const router = express.Router();

  function guard(req, res, deps) {
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return null;
    }
    const check = checkClassification(req, 'DEVELOPMENT');
    if (!check.allowed) {
      deps.sendJson(res, 403, { error: 'classification_required', required: check.required, classification: check.classification });
      return null;
    }
    // RBAC por AÇÃO (§19). Fail-closed: rota não mapeada não é liberada por omissão.
    const action = resolveRequiredAction(req.method, req.path || req.url);
    if (!action) {
      deps.sendJson(res, 403, { error: 'action_not_mapped', message: 'rota sem ação de RBAC declarada', method: req.method, path: req.path });
      return null;
    }
    if (typeof deps.requirePermission !== 'function') {
      // Composition incompleta = falha de fiação. NUNCA liberar por ausência de checker.
      deps.logger.error('[engineering-missions] requirePermission ausente na composition — acesso negado', { method: req.method, path: req.path });
      deps.sendJson(res, 500, { error: 'permission_checker_missing', message: 'checador de permissão não injetado nesta montagem' });
      return null;
    }
    const permission = deps.requirePermission(req, 'engineering', action);
    if (!permission.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', required: { resource: 'engineering', action }, message: permission.error });
      return null;
    }
    return auth;
  }

  /**
   * Autorização de ESCALAÇÃO DE POLÍTICA (§20): exige a permissão administrativa explícita
   * `engineering.policy_admin`. Sem ela, `policyEscalationAuthorized` é false e o resolver recusa
   * qualquer pedido que amplie a política da instalação.
   */
  function policyEscalationAuthorized(req, deps) {
    const check = deps.requirePermission(req, 'engineering', 'policy_admin');
    return check.allowed === true;
  }

  function handleError(res, deps, err, context) {
    const code = err.code || 'internal_error';
    const statusByCode = {
      not_found: 404,
      persistence_required: 503,
      ORIGINAL_MISSION_MUTATED: 409,
      MISSION_SPEC_NOT_APPROVED: 409,
      MISSION_APPROVAL_NOT_FOUND: 409,
      MISSION_STALE_VERSION: 409,
      MISSION_REJECTED: 409,
      MISSION_LOCKED_BY_OTHER_WORKER: 409,
      MISSION_LEASE_HELD_BY_OTHER_WORKER: 409,
      MISSION_LEASE_LOST: 409,
      MISSION_STALE_WORKER_WRITE: 409,
      MISSION_TYPE_NOT_MAPPED: 422,
      INVALID_MISSION_TRANSITION: 422,
      ENRICHMENT_FAILED: 422,
      // Escalação de política é NEGADA, não "ajustada": 403 com os eixos recusados.
      POLICY_ESCALATION_DENIED: 403,
      // Tenant ausente no boundary HTTP é erro do CLIENTE, não do servidor.
      TENANT_REQUIRED: 400,
      // ── Ciclo de bug: TODAS as recusas de honestidade são 409 (conflito com o estado real) ──
      // INSUFFICIENT_CONFIRMATION_BASIS: tentar confirmar sem base objetiva (suspeita de LLM).
      // FIX_WITHOUT_REPRODUCTION/FIX_WITHOUT_REVIEW: declarar FIXED sem as provas exigidas.
      // REGRESSION_WITHOUT_FIX/REGRESSION_EVIDENCE_MISSING: validar regressão sem fix/execução.
      // FINDING_GREENWASHING_BLOCKED: fechar finding escondendo o ciclo.
      // SELF_MODIFICATION_HUMAN_APPROVAL_REQUIRED: self-modification sem aprovação humana.
      INSUFFICIENT_CONFIRMATION_BASIS: 409,
      FIX_WITHOUT_REPRODUCTION: 409,
      FIX_WITHOUT_REVIEW: 409,
      REGRESSION_WITHOUT_FIX: 409,
      REGRESSION_EVIDENCE_MISSING: 409,
      FINDING_GREENWASHING_BLOCKED: 409,
      FINDING_NOT_CONFIRMED: 409,
      FINDING_TASK_ALREADY_LINKED: 409,
      SELF_MODIFICATION_HUMAN_APPROVAL_REQUIRED: 409,
      // GOVERNANCE_BASELINE_*: o próprio fix alterou as regras de julgamento (ou não há como provar
      // que não alterou). É conflito com o estado real das regras — nunca erro de servidor.
      GOVERNANCE_BASELINE_VIOLATION: 409,
      GOVERNANCE_BASELINE_UNVERIFIED: 409,
      // Quem tenta aprovar não tem autoridade para isso (não é humano autenticado).
      SELF_MODIFICATION_APPROVAL_ACTOR_NOT_HUMAN: 403,
      INVALID_FINDING_TRANSITION: 409,
      REPRODUCTION_PLAN_MISSING: 422,
      REPRODUCTION_INCONCLUSIVE: 422,
      INVALID_FINDING: 422,
      INVALID_FINDING_SOURCE: 422,
      INVALID_EVIDENCE_TYPE: 422,
      INVALID_EVIDENCE: 422,
      FINDING_FINGERPRINT_UNAVAILABLE: 422,
      FINDING_BLOCKED_EXTERNAL_DEPENDENCY: 409,
      ACTOR_REQUIRED: 400,
    };
    const status = statusByCode[code] || 500;
    if (status >= 500) deps.logger.error(`[engineering-missions] ${context}`, err);
    deps.sendJson(res, status, {
      error: code,
      message: err.message,
      detail: err.detail || undefined,
      escalations: err.escalations || undefined,
    });
  }

  async function readBody(req, res, deps) {
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return null;
    }
    return deps.parseJsonBody(req);
  }

  // ── Overview e listagem ────────────────────────────────────────────────────────────────────

  /**
   * SAÚDE DOS WORKERS DE ENGENHARIA — o consumidor REAL que faltava (DEVELOPMENT).
   *
   * DEFEITO ELIMINADO (2026-10-03): `getEngineeringWorkerHealth()` já existia e sabia classificar
   * worker DOWN como NO_GO, mas NENHUMA superfície o consumia — com o laço de bugs morto, a
   * prontidão de engenharia seguia invisível: não havia onde observar nem o que bloquear. Existir
   * em código e não ser consumido é indistinguível de não existir.
   *
   * A guarda mantém a segregação: classificação DEVELOPMENT e permissão `engineering:read`, de modo
   * que diagnóstico de engenharia não vaza para a superfície PRODUCTION do cliente.
   */
  router.get('/engineering/missions/workers/health', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const { getEngineeringWorkerHealth } = require('../../runtime/startWorkers');
      const health = getEngineeringWorkerHealth();
      deps.sendJson(res, 200, {
        engineeringReadiness: health.engineeringReadiness,
        code: health.code,
        reason: health.reason,
        blocking: health.blocking,
        degraded: health.degraded,
        worker: health.workers ? health.workers.bugLoop : null,
        boundedBy: 'DEVELOPMENT',
      });
    } catch (err) {
      handleError(res, deps, err, 'worker-health');
    }
  });

  router.get('/engineering/missions/overview', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const missions = await deps.missionStore.listMissions({ limit: 200 });
      const byDisplayStatus = {};
      for (const m of missions) {
        const detailStatus = deps.deriveDisplayStatus(m, null);
        byDisplayStatus[detailStatus] = (byDisplayStatus[detailStatus] || 0) + 1;
      }
      const policy = await deps.missionApprovalService.getPolicy();
      deps.sendJson(res, 200, {
        total: missions.length,
        byDisplayStatus,
        autoApprovalPolicy: policy,
        boundedBy: 'DEVELOPMENT',
      });
    } catch (err) {
      handleError(res, deps, err, 'overview');
    }
  });

  router.get('/engineering/missions', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const { status, missionType, risk, limit, offset } = req.query;
      const missions = await deps.missionStore.listMissions({ status, missionType, risk, limit, offset });
      deps.sendJson(res, 200, {
        missions: missions.map((m) => ({ ...m, displayStatus: deps.deriveDisplayStatus(m, null) })),
        count: missions.length,
      });
    } catch (err) {
      handleError(res, deps, err, 'list missions');
    }
  });

  // ── Política de autoaprovação (administrável, persistida) ──────────────────────────────────

  router.get('/engineering/missions/policy', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      deps.sendJson(res, 200, await deps.missionApprovalService.getPolicy());
    } catch (err) {
      handleError(res, deps, err, 'get policy');
    }
  });

  router.put('/engineering/missions/policy', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = await readBody(req, res, deps);
      if (!body) return;
      const policy = await deps.missionApprovalService.setPolicy(body, {
        actor: req.agent?.id || req.agent?.email || null,
      });
      deps.sendJson(res, 200, policy);
    } catch (err) {
      handleError(res, deps, err, 'set policy');
    }
  });

  router.get('/engineering/missions/self-assessment', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const assessment = await deps.missionSelfAssessmentService.computeSelfAssessment({
        limit: Number(req.query.limit) || 500,
      });
      if (String(req.query.persist) === '1') {
        assessment.persistedTo = await deps.missionSelfAssessmentService.persistSelfAssessment(assessment);
      }
      deps.sendJson(res, 200, assessment);
    } catch (err) {
      handleError(res, deps, err, 'self assessment');
    }
  });

  // ── Compilação (missão em linguagem natural → enriquecimento + preview) ────────────────────

  router.post('/engineering/missions', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = await readBody(req, res, deps);
      if (!body) return;
      const raw = body.mission || body.originalMission || body.objective || body.title;
      if (!raw || !String(raw).trim()) {
        deps.sendJson(res, 400, { error: 'invalid_body', message: 'mission (texto em linguagem natural) é obrigatório' });
        return;
      }
      if (body.missionType && !deps.MISSION_TYPES.includes(body.missionType)) {
        deps.sendJson(res, 400, { error: 'invalid_body', message: `missionType inválido. Use um de: ${deps.MISSION_TYPES.join(', ')}` });
        return;
      }
      const result = await deps.missionCompilerService.compileMission(String(raw), {
        title: body.title,
        repository: body.repository,
        branch: body.branch,
        scope: body.scope,
        approvalMode: body.approvalMode,
        autoApprovalPolicy: body.autoApprovalPolicy,
        constraints: body.constraints,
        contextHints: body.contextHints,
        createdBy: req.agent?.id || req.agent?.email || null,
        tenantId: requireTenantId(req.tenantId),
        idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey || null,
        // §20: a autorização de escalação vem da PERMISSÃO do agente (`engineering.policy_admin`),
        // nunca do corpo da requisição. Sem ela, pedir política mais ampla que a instalação falha
        // com POLICY_ESCALATION_DENIED (403).
        policyEscalationAuthorized: policyEscalationAuthorized(req, deps),
      });
      deps.sendJson(res, result.created ? 201 : 200, {
        mission: result.mission,
        created: result.created,
        // O preview acompanha a resposta: o usuário vê exatamente o que foi acrescentado.
        preview: result.mission.preview,
        autoApproved: result.mission.approval_state === 'AUTO_APPROVED',
      });
    } catch (err) {
      handleError(res, deps, err, 'compile mission');
    }
  });

  router.get('/engineering/missions/:id', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const mission = await deps.missionCompilerService.getMissionDetail(req.params.id);
      if (!mission) { deps.sendJson(res, 404, { error: 'not_found' }); return; }
      deps.sendJson(res, 200, mission);
    } catch (err) {
      handleError(res, deps, err, 'get mission');
    }
  });

  router.get('/engineering/missions/:id/preview', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const mission = await deps.missionCompilerService.getMissionDetail(req.params.id);
      if (!mission) { deps.sendJson(res, 404, { error: 'not_found' }); return; }
      deps.sendJson(res, 200, {
        missionId: mission.id,
        version: mission.current_version,
        specHash: mission.current_spec_hash,
        displayStatus: mission.displayStatus,
        preview: mission.preview,
        policyEvaluation: await deps.missionApprovalService.evaluatePolicyForMission(req.params.id),
      });
    } catch (err) {
      handleError(res, deps, err, 'get preview');
    }
  });

  router.get('/engineering/missions/:id/versions', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const versions = await deps.missionStore.listVersions(req.params.id);
      deps.sendJson(res, 200, { versions, count: versions.length });
    } catch (err) {
      handleError(res, deps, err, 'list versions');
    }
  });

  router.get('/engineering/missions/:id/approvals', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const approvals = await deps.missionStore.listApprovals(req.params.id);
      deps.sendJson(res, 200, { approvals, count: approvals.length });
    } catch (err) {
      handleError(res, deps, err, 'list approvals');
    }
  });

  // ── Decisões humanas ───────────────────────────────────────────────────────────────────────

  router.post('/engineering/missions/:id/enrich', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = (await readBody(req, res, deps)) || {};
      const mission = await deps.missionApprovalService.reEnrich(req.params.id, {
        actor: req.agent?.id || req.agent?.email || null,
        tenantId: requireTenantId(req.tenantId),
        contextHints: body.contextHints || {},
      });
      deps.sendJson(res, 200, { mission, preview: mission.preview });
    } catch (err) {
      handleError(res, deps, err, 're-enrich mission');
    }
  });

  router.post('/engineering/missions/:id/approve', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = (await readBody(req, res, deps)) || {};
      const result = await deps.missionApprovalService.approve(req.params.id, {
        actor: req.agent?.id || req.agent?.email || null,
        reason: body.reason || null,
        tenantId: requireTenantId(req.tenantId),
        idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey || null,
      });
      deps.sendJson(res, result.created ? 201 : 200, result);
    } catch (err) {
      handleError(res, deps, err, 'approve mission');
    }
  });

  router.post('/engineering/missions/:id/reject', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = (await readBody(req, res, deps)) || {};
      const result = await deps.missionApprovalService.reject(req.params.id, {
        actor: req.agent?.id || req.agent?.email || null,
        reason: body.reason || null,
        tenantId: requireTenantId(req.tenantId),
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      handleError(res, deps, err, 'reject mission');
    }
  });

  router.post('/engineering/missions/:id/edit', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = await readBody(req, res, deps);
      if (!body) return;
      const result = await deps.missionApprovalService.editAndApprove(req.params.id, {
        patch: body.patch || body,
        actor: req.agent?.id || req.agent?.email || null,
        reason: body.reason || null,
        approveEdited: body.approveEdited !== false,
        tenantId: requireTenantId(req.tenantId),
        // §20: mesma origem de autorização da rota de enriquecimento — a PERMISSÃO do agente
        // (`engineering.policy_admin`), nunca o corpo. Sem ela, editar uma missão cuja política
        // declarada amplia a da instalação falha com POLICY_ESCALATION_DENIED (403) em vez de
        // aprovar sob uma política que o operador não autorizou.
        policyEscalationAuthorized: policyEscalationAuthorized(req, deps),
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      handleError(res, deps, err, 'edit mission');
    }
  });

  // ── Execução (exige aprovação válida para a versão corrente) ───────────────────────────────

  router.post('/engineering/missions/:id/execute', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = (await readBody(req, res, deps)) || {};
      const tenantId = requireTenantId(req.tenantId);
      const started = await deps.missionOrchestratorService.startExecution(req.params.id, {
        actor: req.agent?.id || req.agent?.email || null,
        tenantId,
      });
      // Execução real é demorada (múltiplas chamadas de modelo + testes): dispara em background e
      // devolve imediatamente; o cliente acompanha por WebSocket/polling. Nunca aguarda aqui.
      if (body.waitForCompletion !== true) {
        deps.missionOrchestratorService
          .runMissionTask(req.params.id, { tenantId })
          .catch((err) => deps.logger.error('[engineering-missions] execução em background falhou', err));
      } else {
        await deps.missionOrchestratorService.runMissionTask(req.params.id, { tenantId });
      }
      deps.sendJson(res, 202, {
        mission: started.mission,
        taskId: started.task.id,
        taskStatus: started.task.status,
        approvalState: started.approval.state,
      });
    } catch (err) {
      handleError(res, deps, err, 'execute mission');
    }
  });

  router.get('/engineering/missions/:id/report', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const report = await deps.missionReportService.buildMissionReport(req.params.id);
      if (!report) { deps.sendJson(res, 404, { error: 'not_found' }); return; }
      deps.sendJson(res, 200, report);
    } catch (err) {
      handleError(res, deps, err, 'mission report');
    }
  });

  router.post('/engineering/missions/resume-interrupted', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const summary = await deps.missionOrchestratorService.resumeInterruptedMissions({
        tenantId: requireTenantId(req.tenantId),
      });
      deps.sendJson(res, 200, summary);
    } catch (err) {
      handleError(res, deps, err, 'resume missions');
    }
  });

  // ── Meta Review (§23) / Adversarial Review (§24) e autoavaliação (§45) ─────────────────────

  router.post('/engineering/missions/:id/review', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = (await readBody(req, res, deps)) || {};
      const kinds = Array.isArray(body.kinds) && body.kinds.length > 0 ? body.kinds : ['META', 'ADVERSARIAL'];
      const invalid = kinds.filter((k) => !['META', 'ADVERSARIAL'].includes(k));
      if (invalid.length > 0) {
        deps.sendJson(res, 400, { error: 'invalid_body', message: `kinds inválido(s): ${invalid.join(', ')}. Use META e/ou ADVERSARIAL` });
        return;
      }
      const result = await deps.missionReviewService.runReviews(req.params.id, {
        actor: req.agent?.id || req.agent?.email || null,
        kinds,
        changedFiles: Array.isArray(body.changedFiles) ? body.changedFiles : [],
        idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey || null,
      });
      // A revisão NÃO muda o status sozinha: quem recusa GREEN é refreshMissionState, ao
      // reconciliar. Aqui devolvemos os findings e, se houver bloqueio, o estado reconciliado.
      let mission = null;
      const blocking = await deps.missionReviewService.getBlockingReview(result.missionId, result.missionVersion);
      if (blocking) {
        mission = await deps.missionOrchestratorService.refreshMissionState(req.params.id, { tenantId: requireTenantId(req.tenantId) });
      }
      deps.sendJson(res, 200, { ...result, blocking, mission });
    } catch (err) {
      handleError(res, deps, err, 'run mission review');
    }
  });

  router.get('/engineering/missions/:id/review', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const mission = await deps.missionStore.getMission(req.params.id);
      if (!mission) { deps.sendJson(res, 404, { error: 'not_found' }); return; }
      const [meta, adversarial, all] = await Promise.all([
        deps.missionReviewService.getLatestReview(req.params.id, 'META'),
        deps.missionReviewService.getLatestReview(req.params.id, 'ADVERSARIAL'),
        deps.missionReviewService.listReviews(req.params.id),
      ]);
      deps.sendJson(res, 200, {
        missionId: req.params.id,
        missionVersion: mission.current_version,
        latest: { meta, adversarial },
        blocking: await deps.missionReviewService.getBlockingReview(req.params.id, mission.current_version),
        history: all.map((r) => ({ id: r.id, kind: r.kind, status: r.status, blocksGreen: r.blocks_green, engineVersion: r.engine_version, createdAt: r.created_at })),
      });
    } catch (err) {
      handleError(res, deps, err, 'get mission review');
    }
  });

  // ── CICLO DE BUG (detecção → reprodução → confirmação → task → correção → regressão) ────────
  //
  // Relato HUMANO é uma fonte de finding entre as outras (`HUMAN_REPORT`), nunca um caminho
  // especial: o mesmo endpoint registra, e o Mission Compiler/Bug Triage enriquece depois com
  // contexto, logs, rotas, código, testes, RAG e histórico.
  router.get('/engineering/findings/summary', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const summary = await deps.bugFindingService.summarizeFindings({ missionId: req.query.missionId || null });
      deps.sendJson(res, 200, summary);
    } catch (err) {
      handleError(res, deps, err, 'summarize findings');
    }
  });

  router.post('/engineering/findings/sweep', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = (await readBody(req, res, deps)) || {};
      const summary = await deps.bugLoopCoordinatorService.runBugLoopSweep({
        actor: req.agent?.id || req.agent?.email || null,
        tenantId: requireTenantId(req.tenantId),
        limit: Number(body.limit) || 10,
        autoFix: body.autoFix !== false,
        allowedPaths: Array.isArray(body.allowedPaths) ? body.allowedPaths : null,
      });
      deps.sendJson(res, 200, summary);
    } catch (err) {
      handleError(res, deps, err, 'bug loop sweep');
    }
  });

  router.post('/engineering/findings/telemetry', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = (await readBody(req, res, deps)) || {};
      if (!body.metrics || typeof body.metrics !== 'object') {
        deps.sendJson(res, 400, { error: 'invalid_body', message: 'metrics (objeto) é obrigatório' });
        return;
      }
      if (body.metrics.noProgress === true) {
        const result = await deps.bugLoopCoordinatorService.diagnoseNoProgress({
          missionId: body.missionId || null,
          taskId: body.taskId || null,
          phase: body.metrics.phase || null,
          operation: body.metrics.operation || null,
          metadata: body.metrics,
        }, { actor: 'SYSTEM:TELEMETRY', tenantId: requireTenantId(req.tenantId) });
        deps.sendJson(res, 200, result);
        return;
      }
      const result = await deps.bugLoopCoordinatorService.ingestTelemetry({
        metrics: body.metrics,
        context: body.context || {},
        missionId: body.missionId || null,
        taskId: body.taskId || null,
      }, { actor: 'SYSTEM:TELEMETRY', tenantId: requireTenantId(req.tenantId) });
      deps.sendJson(res, 200, result);
    } catch (err) {
      handleError(res, deps, err, 'ingest telemetry');
    }
  });

  router.get('/engineering/findings', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const findings = await deps.bugFindingService.listFindings({
        missionId: req.query.missionId || null,
        status: req.query.status ? String(req.query.status).split(',') : null,
        severity: req.query.severity ? String(req.query.severity).split(',') : null,
        category: req.query.category || null,
        selfModification: req.query.selfModification === undefined ? null : req.query.selfModification === 'true',
        limit: Number(req.query.limit) || 50,
        offset: Number(req.query.offset) || 0,
      });
      deps.sendJson(res, 200, { findings });
    } catch (err) {
      handleError(res, deps, err, 'list findings');
    }
  });

  router.post('/engineering/findings', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = (await readBody(req, res, deps)) || {};
      const result = await deps.bugFindingService.registerFinding(body, {
        actor: req.agent?.id || req.agent?.email || null,
        tenantId: requireTenantId(req.tenantId),
      });
      deps.sendJson(res, result.deduplicated ? 200 : 201, result);
    } catch (err) {
      handleError(res, deps, err, 'register finding');
    }
  });

  router.get('/engineering/findings/:id', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const finding = await deps.bugFindingService.getFinding(req.params.id);
      if (!finding) { deps.sendJson(res, 404, { error: 'not_found' }); return; }
      deps.sendJson(res, 200, finding);
    } catch (err) {
      handleError(res, deps, err, 'get finding');
    }
  });

  router.get('/engineering/findings/:id/history', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!guard(req, res, deps)) return;
    try {
      const finding = await deps.bugFindingService.getFinding(req.params.id);
      if (!finding) { deps.sendJson(res, 404, { error: 'not_found' }); return; }
      const history = await deps.bugFindingService.getFindingHistory(req.params.id);
      deps.sendJson(res, 200, { findingId: req.params.id, status: finding.status, history });
    } catch (err) {
      handleError(res, deps, err, 'get finding history');
    }
  });

  router.post('/engineering/findings/:id/evidence', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = (await readBody(req, res, deps)) || {};
      const result = await deps.bugFindingService.addEvidence(req.params.id, body, {
        actor: req.agent?.id || req.agent?.email || null,
        tenantId: requireTenantId(req.tenantId),
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      handleError(res, deps, err, 'add finding evidence');
    }
  });

  router.post('/engineering/findings/:id/reproduce', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = (await readBody(req, res, deps)) || {};
      const result = await deps.bugReproductionService.reproduce(req.params.id, {
        actor: req.agent?.id || req.agent?.email || null,
        tenantId: requireTenantId(req.tenantId),
        invariantResults: Array.isArray(body.invariantResults) ? body.invariantResults : null,
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      handleError(res, deps, err, 'reproduce finding');
    }
  });

  router.post('/engineering/findings/:id/confirm', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = (await readBody(req, res, deps)) || {};
      const result = await deps.bugFindingService.confirmFinding(req.params.id, {
        basis: body.basis,
        evidence: Array.isArray(body.evidence) ? body.evidence : [],
        rootCause: body.rootCause || null,
        actor: req.agent?.id || req.agent?.email || null,
        tenantId: requireTenantId(req.tenantId),
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      handleError(res, deps, err, 'confirm finding');
    }
  });

  router.post('/engineering/findings/:id/triage', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = (await readBody(req, res, deps)) || {};
      const result = await deps.bugTriageService.triage(req.params.id, {
        actor: req.agent?.id || req.agent?.email || null,
        tenantId: requireTenantId(req.tenantId),
        allowedPaths: Array.isArray(body.allowedPaths) ? body.allowedPaths : null,
        forbiddenPaths: Array.isArray(body.forbiddenPaths) ? body.forbiddenPaths : [],
        explicitPolicyAuthorization: body.explicitPolicyAuthorization === true,
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      handleError(res, deps, err, 'triage finding');
    }
  });

  router.post('/engineering/findings/:id/fix', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      const body = (await readBody(req, res, deps)) || {};
      const result = await deps.bugLoopCoordinatorService.runFixLoop(req.params.id, {
        actor: req.agent?.id || req.agent?.email || null,
        tenantId: requireTenantId(req.tenantId),
        maxAttempts: Number(body.maxAttempts) || undefined,
        secondaryFindings: Array.isArray(body.secondaryFindings) ? body.secondaryFindings : [],
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      handleError(res, deps, err, 'run fix loop');
    }
  });

  router.post('/engineering/findings/:id/approve-self-modification', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = guard(req, res, deps);
    if (!auth) return;
    try {
      // RBAC GRANULAR: a permissão é checada EXPLICITAMENTE aqui e o resultado é PROPAGADO ao
      // serviço. Não se assume que o guard genérico já cobriu: a autoridade para alterar as regras
      // que julgam o sistema precisa ser verificada no ponto em que o efeito acontece, e o serviço
      // recusa fail-closed quando a permissão não chega como `true` estrito.
      const permission = deps.requirePermission(req, 'engineering', 'approve_self_modification');
      if (!permission.allowed) {
        deps.sendJson(res, 403, {
          error: 'forbidden',
          required: { resource: 'engineering', action: 'approve_self_modification', label: 'engineering:self-modification' },
          message: permission.error,
        });
        return;
      }

      const body = (await readBody(req, res, deps)) || {};
      const result = await deps.bugTriageService.approveSelfModification(req.params.id, {
        actor: req.agent?.id || req.agent?.email || null,
        actorType: body.actorType || null,
        authenticatedActorType: req.agent?.actorType || req.agent?.type || null,
        approvalRef: body.approvalRef || null,
        note: body.note || null,
        tenantId: requireTenantId(req.tenantId),
        hasSelfModificationPermission: permission.allowed === true,
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      handleError(res, deps, err, 'approve self modification');
    }
  });

  return router;
}

module.exports = {
  createEngineeringMissionRoutes,
  // Exportado para teste direto do mapa rota→ação: a garantia de que uma rota nova NÃO passa em
  // silêncio (fail-closed) é verificável sem subir HTTP.
  resolveRequiredAction,
  ROUTE_ACTIONS,
};
