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
 */

const express = require('express');
const { checkClassification } = require('../../middleware/requireClassification');

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
    return auth;
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
      MISSION_TYPE_NOT_MAPPED: 422,
      INVALID_MISSION_TRANSITION: 422,
      ENRICHMENT_FAILED: 422,
    };
    const status = statusByCode[code] || 500;
    if (status >= 500) deps.logger.error(`[engineering-missions] ${context}`, err);
    deps.sendJson(res, status, { error: code, message: err.message, detail: err.detail || undefined });
  }

  async function readBody(req, res, deps) {
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return null;
    }
    return deps.parseJsonBody(req);
  }

  // ── Overview e listagem ────────────────────────────────────────────────────────────────────

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
        tenantId: req.tenantId || 'system',
        idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey || null,
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
        tenantId: req.tenantId || 'system',
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
        tenantId: req.tenantId || 'system',
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
        tenantId: req.tenantId || 'system',
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
        tenantId: req.tenantId || 'system',
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
      const tenantId = req.tenantId || 'system';
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
        tenantId: req.tenantId || 'system',
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
        mission = await deps.missionOrchestratorService.refreshMissionState(req.params.id, { tenantId: req.tenantId || 'system' });
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

  return router;
}

module.exports = { createEngineeringMissionRoutes };
