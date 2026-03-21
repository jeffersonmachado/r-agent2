'use strict';

const express = require('express');

function createVoiceRoutes({ buildDeps }) {
  const router = express.Router();

  function requirePermissionGuard(req, res, deps, resource, action) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }
    const permResult = deps.requirePermission(req, resource, action);
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return false;
    }
    return true;
  }

  router.post('/api/voice/events', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'config', 'update')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await deps.parseJsonBody(req);
      const { ingestVoiceEvent } = require('../../services/voiceEventService');
      const out = await ingestVoiceEvent({
        tenantId: req.tenantId,
        eventType: body?.eventType || body?.type,
        callId: body?.callId || body?.call_id,
        occurredAt: body?.occurredAt || body?.occurred_at || null,
        correlationId: body?.correlationId || body?.correlation_id || null,
        subjectType: body?.subjectType || body?.subject_type || 'pbx_call',
        subjectId: body?.subjectId || body?.subject_id || null,
        actorType: body?.actorType || body?.actor_type || 'system',
        actorId: body?.actorId || body?.actor_id || 'voice_gateway',
        payload: body?.payload || {},
      });
      if (!out.ok) {
        deps.sendJson(res, 400, { ok: false, error: out.error || 'voice_event_invalid' });
        return;
      }
      deps.sendJson(res, 200, out);
    } catch (err) {
      deps.logger.error('[VoiceEvents] Erro ao ingerir evento de voz:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao ingerir evento de voz' });
    }
  });

  router.post('/api/voice/runtime/start', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'config', 'update')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await deps.parseJsonBody(req);
      const { runVoiceSession } = require('../../services/voiceRuntimeService');
      const out = await runVoiceSession({
        tenantId: req.tenantId,
        flowId: body?.flowId || body?.flow_id,
        callId: body?.callId || body?.call_id,
        input: body?.input || null,
        variables: body?.variables || null,
        maxSteps: body?.maxSteps || body?.max_steps || 40,
        startIfMissing: true,
      });
      if (!out.ok) {
        deps.sendJson(res, 400, { ok: false, error: out.error || 'voice_runtime_start_failed' });
        return;
      }
      deps.sendJson(res, 200, out);
    } catch (err) {
      deps.logger.error('[VoiceRuntime] Erro ao iniciar fluxo de voz:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao iniciar fluxo de voz' });
    }
  });

  router.post('/api/voice/runtime/step', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'config', 'update')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await deps.parseJsonBody(req);
      const { runVoiceSession } = require('../../services/voiceRuntimeService');
      const hasFlow = !!(body?.flowId || body?.flow_id);
      const out = await runVoiceSession({
        tenantId: req.tenantId,
        flowId: body?.flowId || body?.flow_id,
        callId: body?.callId || body?.call_id,
        input: body?.input || null,
        variables: body?.variables || null,
        maxSteps: body?.maxSteps || body?.max_steps || 40,
        startIfMissing: hasFlow,
      });
      if (!out.ok) {
        deps.sendJson(res, 400, { ok: false, error: out.error || 'voice_runtime_step_failed' });
        return;
      }
      deps.sendJson(res, 200, out);
    } catch (err) {
      deps.logger.error('[VoiceRuntime] Erro ao executar passo de voz:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao executar passo de voz' });
    }
  });

  router.delete('/api/voice/runtime/session/:callId', (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'config', 'update')) return;
    try {
      const { clearVoiceSession } = require('../../services/voiceRuntimeService');
      const cleared = clearVoiceSession({ tenantId: req.tenantId, callId: decodeURIComponent(req.params.callId) });
      deps.sendJson(res, 200, { ok: true, cleared: !!cleared });
    } catch (err) {
      deps.logger.error('[VoiceRuntime] Erro ao limpar sessão de voz:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao limpar sessão de voz' });
    }
  });

  router.get('/api/voice/runtime/stats', (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'reports', 'read')) return;
    try {
      const { getVoiceRuntimeStats } = require('../../services/voiceRuntimeService');
      deps.sendJson(res, 200, getVoiceRuntimeStats({ tenantId: req.tenantId }));
    } catch (err) {
      deps.logger.error('[VoiceRuntime] Erro ao obter stats de runtime:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter stats de runtime' });
    }
  });

  router.get('/api/voice/metrics', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'reports', 'read')) return;
    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const windowDays = urlObj.searchParams.get('windowDays');
      const { getVoiceMetrics } = require('../../services/voiceEventService');
      const out = await getVoiceMetrics({
        tenantId: req.tenantId,
        windowDays: windowDays != null ? Number(windowDays) : 7,
      });
      if (!out.ok) {
        deps.sendJson(res, 400, { ok: false, error: out.error || 'voice_metrics_unavailable' });
        return;
      }
      deps.sendJson(res, 200, out);
    } catch (err) {
      deps.logger.error('[VoiceEvents] Erro ao obter métricas:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas' });
    }
  });

  router.get('/api/event-ledger', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'analytics', 'read')) return;
    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const { listEvents } = require('../../services/eventLedgerService');
      const result = await listEvents({
        tenantId: req.tenantId,
        subjectType: urlObj.searchParams.get('subjectType') ? String(urlObj.searchParams.get('subjectType')) : null,
        subjectId: urlObj.searchParams.get('subjectId') ? String(urlObj.searchParams.get('subjectId')) : null,
        correlationId: urlObj.searchParams.get('correlationId') ? String(urlObj.searchParams.get('correlationId')) : null,
        type: urlObj.searchParams.get('type') ? String(urlObj.searchParams.get('type')) : null,
        limit: urlObj.searchParams.get('limit') != null ? Number(urlObj.searchParams.get('limit')) : 200,
        offset: urlObj.searchParams.get('offset') != null ? Number(urlObj.searchParams.get('offset')) : 0,
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      deps.logger.error('[EventLedger] Erro ao listar eventos:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar eventos' });
    }
  });

  return router;
}

module.exports = {
  createVoiceRoutes,
};
