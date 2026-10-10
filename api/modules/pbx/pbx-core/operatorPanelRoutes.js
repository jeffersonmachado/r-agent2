async function handlePbxOperatorPanelRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    buildApiError,
  } = deps;

  if (!pathname.startsWith('/api/pbx/operator-panel')) {
    return false;
  }

  // GET /api/pbx/operator-panel/events  — SSE stream do snapshot
  if (method === 'GET' && pathname === '/api/pbx/operator-panel/events') {
    // EventSource não envia header Authorization — aceita o token via query
    // param (escopo restrito a esta rota SSE; demais rotas seguem exigindo o
    // header). O frontend anexa ?token= em buildOperatorPanelEventsUrl.
    if (!req.headers.authorization) {
      const tokenFromQuery = new URL(req.url || '/', 'http://localhost').searchParams.get('token');
      if (tokenFromQuery) {
        req.headers.authorization = `Bearer ${tokenFromQuery}`;
      }
    }
    // Mesma limitação para o tenant: `requireAuth` só preenche `req.tenantId` de
    // super-admin a partir do header `X-Tenant-Id`, que o EventSource também não
    // envia. Sem isto o stream responde 403 `tenant_required` para o próprio
    // super-admin que abriu a página (medido em 2026-10-09). Aceito apenas nesta
    // rota SSE; o tenant continua sendo validado por `requireTenant`.
    if (!req.headers['x-tenant-id']) {
      const tenantFromQuery = new URL(req.url || '/', 'http://localhost').searchParams.get('tenantId');
      if (tenantFromQuery && tenantFromQuery.trim()) {
        req.headers['x-tenant-id'] = tenantFromQuery.trim();
      }
    }
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const filters = {
      queueId: urlObj.searchParams.get('queueId') || null,
      memberRef: urlObj.searchParams.get('memberRef') || null,
      cdrLimit: urlObj.searchParams.get('cdrLimit') || null,
      callWindowMinutes: urlObj.searchParams.get('callWindowMinutes') || null,
      activeCallWindowMinutes: urlObj.searchParams.get('activeCallWindowMinutes') || null,
    };
    const intervalSec = Math.max(5, Math.min(60, Number(urlObj.searchParams.get('intervalSec') || 10)));
    const maxDurationSec = Math.max(30, Math.min(600, Number(urlObj.searchParams.get('maxDurationSec') || 300)));

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    const service = require('../../../services/pbx/pbxOperatorPanelService');

    function sendEvent(eventName, data) {
      try {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
        if (typeof res.flush === 'function') res.flush();
      } catch (_) { /* connection closed */ }
    }

    async function pushSnapshot() {
      try {
        const snapshot = await service.listOperatorPanelSnapshot({ tenantKey, filters });
        sendEvent('snapshot', { ok: true, ...snapshot });
      } catch (err) {
        logger.error('[PBX] SSE snapshot error', err);
        sendEvent('error', { ok: false, error: err.message || 'snapshot_error' });
      }
    }

    // First push immediately
    await pushSnapshot();

    const intervalMs = intervalSec * 1000;
    const timer = setInterval(pushSnapshot, intervalMs);

    const maxTimer = setTimeout(() => {
      clearInterval(timer);
      try { sendEvent('close', { reason: 'max_duration' }); res.end(); } catch (_) {}
    }, maxDurationSec * 1000);

    req.on('close', () => {
      clearInterval(timer);
      clearTimeout(maxTimer);
    });

    return true;
  }

  // GET /api/pbx/operator-panel/snapshot
  if (method === 'GET' && pathname === '/api/pbx/operator-panel/snapshot') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const filters = {
        queueId: urlObj.searchParams.get('queueId') || null,
        memberRef: urlObj.searchParams.get('memberRef') || null,
        cdrLimit: urlObj.searchParams.get('cdrLimit') || null,
        callWindowMinutes: urlObj.searchParams.get('callWindowMinutes') || null,
        activeCallWindowMinutes: urlObj.searchParams.get('activeCallWindowMinutes') || null,
      };

      const service = require('../../../services/pbx/pbxOperatorPanelService');
      const snapshot = await service.listOperatorPanelSnapshot({ tenantKey, filters });
      sendJson(res, 200, { ok: true, ...snapshot });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/operator-panel/snapshot', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_operator_panel_snapshot_error',
        message: err.message || 'Erro ao consultar snapshot do painel operador',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }

    return true;
  }

  // POST /api/pbx/operator-panel/agent-status
  if (method === 'POST' && pathname === '/api/pbx/operator-panel/agent-status') {
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

    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const actorUserId = req.user?.id || null;
      const service = require('../../../services/pbx/pbxOperatorPanelService');
      const result = await service.setAgentPauseStatus({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, result);
    } catch (err) {
      const code = err.code || 'pbx_operator_panel_agent_status_error';
      const httpStatus = [
        'member_ref_required',
        'paused_required',
        'member_type_invalid',
        'agent_not_found_in_queues',
      ].includes(code)
        ? 400
        : 500;

      logger.error('[PBX] Erro em POST /api/pbx/operator-panel/agent-status', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao atualizar status do operador',
        httpStatus,
        retryable: httpStatus >= 500,
        details: err.details || null,
        req,
      }));
    }

    return true;
  }

  // POST /api/pbx/operator-panel/agent-pause-queue
  // Pausa ou retoma agente em uma fila específica (ou todas, se queueId omitido)
  if (method === 'POST' && pathname === '/api/pbx/operator-panel/agent-pause-queue') {
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

    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const actorUserId = req.user?.id || null;
      const service = require('../../../services/pbx/pbxOperatorPanelService');
      const result = await service.setAgentPauseStatus({
        tenantKey,
        payload: { ...body, singleQueue: true },
        actorUserId,
      });
      sendJson(res, 200, result);
    } catch (err) {
      const code = err.code || 'pbx_operator_panel_pause_queue_error';
      const httpStatus = ['member_ref_required', 'paused_required', 'agent_not_found_in_queues'].includes(code) ? 400 : 500;
      logger.error('[PBX] Erro em POST /api/pbx/operator-panel/agent-pause-queue', err);
      sendJson(res, httpStatus, buildApiError({ code, message: err.message, httpStatus, retryable: httpStatus >= 500, details: err.details || null, req }));
    }

    return true;
  }

  // POST /api/pbx/operator-panel/transfer
  // Transferência assistida: origina chamada AMI de ramal_origem para ramal_destino
  if (method === 'POST' && pathname === '/api/pbx/operator-panel/transfer') {
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

    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const service = require('../../../services/pbx/pbxOperatorPanelService');
      const result = await service.assistedTransfer({ tenantKey, payload: body });
      sendJson(res, 200, result);
    } catch (err) {
      const code = err.code || 'pbx_operator_panel_transfer_error';
      const httpStatus = ['transfer_from_required', 'transfer_to_required', 'ami_timeout', 'ami_login_failed'].includes(code) ? 400 : 500;
      logger.error('[PBX] Erro em POST /api/pbx/operator-panel/transfer', err);
      sendJson(res, httpStatus, buildApiError({ code, message: err.message, httpStatus, retryable: httpStatus >= 500, details: err.details || null, req }));
    }

    return true;
  }

  // POST /api/pbx/operator-panel/callback
  // Callback rápido: agenda uma ligação de retorno para um número via click2call
  if (method === 'POST' && pathname === '/api/pbx/operator-panel/callback') {
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

    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const actorUserId = req.user?.id || null;
      const service = require('../../../services/pbx/pbxOperatorPanelService');
      const result = await service.quickCallback({ tenantKey, payload: body, actorUserId });
      sendJson(res, 201, result);
    } catch (err) {
      const code = err.code || 'pbx_operator_panel_callback_error';
      const httpStatus = ['callback_phone_required', 'callback_target_required', 'click2call_phone_required', 'click2call_target_required'].includes(code) ? 400 : 500;
      logger.error('[PBX] Erro em POST /api/pbx/operator-panel/callback', err);
      sendJson(res, httpStatus, buildApiError({ code, message: err.message, httpStatus, retryable: httpStatus >= 500, details: err.details || null, req }));
    }

    return true;
  }

  return false;
}

module.exports = { handlePbxOperatorPanelRoutes };
