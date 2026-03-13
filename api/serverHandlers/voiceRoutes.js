/**
 * Voice Routes Handler
 * Gerencia endpoints de eventos de voz, runtime de voz, e event ledger
 */

module.exports = {
  handleVoiceRoutes,
};

/**
 * Verifica e trata rotas de voz
 * @returns {boolean} true se a rota foi tratada, false caso contrário
 */
async function handleVoiceRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  // POST /api/voice/events - ingestão de eventos de voz (ARI/AMI/gateway)
  if (method === 'POST' && pathname === '/api/voice/events') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const { ingestVoiceEvent } = require('../services/voiceEventService');
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
        sendJson(res, 400, { ok: false, error: out.error || 'voice_event_invalid' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[VoiceEvents] Erro ao ingerir evento de voz:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao ingerir evento de voz' });
    }
    return true;
  }

  // POST /api/voice/runtime/start - inicia fluxo de voz (URA) via editor
  if (method === 'POST' && pathname === '/api/voice/runtime/start') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const { runVoiceSession } = require('../services/voiceRuntimeService');
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
        sendJson(res, 400, { ok: false, error: out.error || 'voice_runtime_start_failed' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[VoiceRuntime] Erro ao iniciar fluxo de voz:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao iniciar fluxo de voz' });
    }
    return true;
  }

  // POST /api/voice/runtime/step - executa próximo passo com input
  if (method === 'POST' && pathname === '/api/voice/runtime/step') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const { runVoiceSession } = require('../services/voiceRuntimeService');
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
        sendJson(res, 400, { ok: false, error: out.error || 'voice_runtime_step_failed' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[VoiceRuntime] Erro ao executar passo de voz:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao executar passo de voz' });
    }
    return true;
  }

  // DELETE /api/voice/runtime/session/:callId - encerra sessão de voz (best-effort)
  if (method === 'DELETE' && pathname.startsWith('/api/voice/runtime/session/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const callId = decodeURIComponent(pathname.slice('/api/voice/runtime/session/'.length));
      const { clearVoiceSession } = require('../services/voiceRuntimeService');
      const cleared = clearVoiceSession({ tenantId: req.tenantId, callId });
      sendJson(res, 200, { ok: true, cleared: !!cleared });
    } catch (err) {
      logger.error('[VoiceRuntime] Erro ao limpar sessão de voz:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao limpar sessão de voz' });
    }
    return true;
  }

  // GET /api/voice/runtime/stats - sessões ativas de runtime de voz
  if (method === 'GET' && pathname === '/api/voice/runtime/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const { getVoiceRuntimeStats } = require('../services/voiceRuntimeService');
      const out = getVoiceRuntimeStats({ tenantId: req.tenantId });
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[VoiceRuntime] Erro ao obter stats de runtime:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter stats de runtime' });
    }
    return true;
  }

  // GET /api/voice/metrics - métricas básicas de voz (por tipo)
  if (method === 'GET' && pathname === '/api/voice/metrics') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const windowDays = urlObj.searchParams.get('windowDays');
      const { getVoiceMetrics } = require('../services/voiceEventService');
      const out = await getVoiceMetrics({
        tenantId: req.tenantId,
        windowDays: windowDays != null ? Number(windowDays) : 7,
      });
      if (!out.ok) {
        sendJson(res, 400, { ok: false, error: out.error || 'voice_metrics_unavailable' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[VoiceEvents] Erro ao obter métricas:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas' });
    }
    return true;
  }

  // GET /api/event-ledger?subjectType=&subjectId=&correlationId=&type=&limit=&offset=
  if (method === 'GET' && pathname === '/api/event-ledger') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const subjectType = urlObj.searchParams.get('subjectType');
      const subjectId = urlObj.searchParams.get('subjectId');
      const correlationId = urlObj.searchParams.get('correlationId');
      const type = urlObj.searchParams.get('type');
      const limit = urlObj.searchParams.get('limit');
      const offset = urlObj.searchParams.get('offset');

      const { listEvents } = require('../services/eventLedgerService');
      const result = await listEvents({
        tenantId: req.tenantId,
        subjectType: subjectType ? String(subjectType) : null,
        subjectId: subjectId ? String(subjectId) : null,
        correlationId: correlationId ? String(correlationId) : null,
        type: type ? String(type) : null,
        limit: limit != null ? Number(limit) : 200,
        offset: offset != null ? Number(offset) : 0,
      });
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('[EventLedger] Erro ao listar eventos:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar eventos' });
    }
    return true;
  }

  // Nenhuma rota tratada
  return false;
}
