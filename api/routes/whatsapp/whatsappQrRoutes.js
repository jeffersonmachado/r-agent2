'use strict';

const { validateWhatsAppConnectionBotPayload } = require('./whatsappShared');

async function handleWhatsappQrRoutes(context = {}) {
  const {
    req,
    res,
    method,
    pathname,
    deps: {
      requireAuth,
      requirePermission,
      sendJson,
      hasJsonContentType,
      parseJsonBody,
      logger,
      requireTenant,
      badRequest,
      flows,
      getQrRunner,
    },
  } = context;

  if (method === 'POST' && pathname.startsWith('/whatsapp/connections/') && pathname.endsWith('/start')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'write');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    const id = decodeURIComponent(pathname.slice('/whatsapp/connections/'.length, -'/start'.length));
    const channelAccountId = id;
    let lastQr = null;

    logger.info('WA_QR_HTTP', 'start requested', {
      tenantId,
      channelAccountId,
      path: pathname,
    });

    await getQrRunner().ensureSession(tenantId, channelAccountId, (qr) => { lastQr = qr; }, { qrCacheMs: 15000 });

    logger.info('WA_QR_HTTP', 'start done', {
      tenantId,
      channelAccountId,
      hasQr: !!lastQr,
    });
    sendJson(res, 200, { ok: true, qr: lastQr });
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/whatsapp/connections/') && pathname.endsWith('/stop')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'write');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    const id = decodeURIComponent(pathname.slice('/whatsapp/connections/'.length, -'/stop'.length));
    const channelAccountId = id;

    logger.info('WA_QR_HTTP', 'stop requested', {
      tenantId,
      channelAccountId,
      path: pathname,
    });

    await getQrRunner().stopSession(tenantId, channelAccountId);

    logger.info('WA_QR_HTTP', 'stop done', {
      tenantId,
      channelAccountId,
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (method === 'GET' && pathname === '/whatsapp/connections') {
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
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    try {
      const service = require('../../services/whatsappQrService');
      const out = await service.listConnections(tenantId);
      logger.info('[WhatsAppConnections] Listando conexões', {
        agentId: req.agent && req.agent.id,
        agentRole: req.agent && req.agent.role,
        tenantId,
        connections: (out.connections || []).map((c) => ({ id: c.id, tenantId: c.tenantId, name: c.name })),
      });
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      const connections = (out.connections || []).map((conn) => {
        const runtime = getQrRunner().getStatus(tenantId, conn.id);
        const runtimeStatus = String(runtime?.status || 'disconnected').toLowerCase();
        const runtimeDisconnectCode = Number(runtime?.lastDisconnectCode || 0) || null;
        const runtimeDisconnectReason =
          (typeof runtime?.lastError === 'string' && runtime.lastError.trim()) ||
          runtime?.lastError?.output?.payload?.message ||
          null;
        const runtimeLastDisconnectAt =
          runtimeStatus === 'disconnected' && Number(runtime?.updatedAt || 0) > 0
            ? new Date(Number(runtime.updatedAt)).toISOString()
            : null;

        const merged = {
          ...conn,
          status: String(conn?.status || 'disconnected').trim(),
          runtimeStatus: String(runtimeStatus || 'disconnected').trim(),
          lastDisconnectCode: runtimeDisconnectCode ?? conn?.lastDisconnectCode ?? null,
          lastDisconnectReason: (typeof runtimeDisconnectReason === 'string' ? runtimeDisconnectReason.trim() : null)
            || (typeof conn?.lastDisconnectReason === 'string' ? conn.lastDisconnectReason.trim() : null)
            || null,
          lastDisconnectAtRuntime: runtimeLastDisconnectAt,
        };

        if (runtimeStatus === 'connected') return { ...merged, status: 'connected' };
        if (runtimeStatus === 'syncing' || runtimeStatus === 'connecting' || runtimeStatus === 'qr') return { ...merged, status: 'pairing' };
        if (runtimeStatus === 'disconnected') return { ...merged, status: 'disconnected' };
        return merged;
      });
      sendJson(res, 200, { ok: true, connections });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao listar conexões:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar conexões' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/whatsapp/connections') {
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
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const validation = await validateWhatsAppConnectionBotPayload({ tenantId, body: body || {}, flows });
      if (!validation.ok) {
        sendJson(res, validation.status || 422, { error: validation.error || 'validation_error', message: validation.message || 'Payload inválido' });
        return true;
      }
      const service = require('../../services/whatsappQrService');
      const out = await service.createConnection(tenantId, validation.normalized || {});
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao criar conexão:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar conexão' });
    }
    return true;
  }

  if (method === 'PUT' && /^\/whatsapp\/connections\/[^/]+$/.test(pathname)) {
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
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const id = decodeURIComponent(pathname.slice('/whatsapp/connections/'.length));
      const body = await parseJsonBody(req);
      const validation = await validateWhatsAppConnectionBotPayload({ tenantId, body: body || {}, flows });
      if (!validation.ok) {
        sendJson(res, validation.status || 422, { error: validation.error || 'validation_error', message: validation.message || 'Payload inválido' });
        return true;
      }

      const service = require('../../services/whatsappQrService');
      const out = await service.updateConnection(tenantId, id, validation.normalized || {});
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao atualizar conexão:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar conexão' });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/whatsapp/connections/') && pathname.endsWith('/qr')) {
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
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    let id = null;
    try {
      id = decodeURIComponent(pathname.slice('/whatsapp/connections/'.length, -'/qr'.length));

      logger.info('WA_QR_HTTP_TRIGGER', 'QR endpoint acionado', {
        tenantId,
        connectionId: id,
        method,
        pathname,
        source: {
          origin: String(req.headers.origin || '').trim() || null,
          referer: String(req.headers.referer || '').trim() || null,
          userAgent: String(req.headers['user-agent'] || '').trim() || null,
          forwardedFor: String(req.headers['x-forwarded-for'] || '').trim() || null,
          realIp: String(req.headers['x-real-ip'] || '').trim() || null,
          secFetchSite: String(req.headers['sec-fetch-site'] || '').trim() || null,
          secFetchMode: String(req.headers['sec-fetch-mode'] || '').trim() || null,
          secFetchDest: String(req.headers['sec-fetch-dest'] || '').trim() || null,
        },
        actor: {
          userId: req.agent?.id || null,
          username: req.agent?.username || null,
          role: req.agent?.role || null,
        },
      });

      try {
        const cached = getQrRunner().getCachedQr?.(tenantId, id, 15000);
        if (cached) {
          sendJson(res, 200, { ok: true, qr: { text: cached, cached: true } });
          return true;
        }
      } catch (_) {}

      let connectionName = null;
      try {
        const service = require('../../services/whatsappQrService');
        const c = await service.getConnectionById(tenantId, id);
        connectionName = c?.name || c?.label || null;
      } catch (_) {}

      const qrText = await new Promise((resolve, reject) => {
        let done = false;
        const t = setTimeout(() => {
          if (done) return;
          done = true;
          reject(new Error('QR_TIMEOUT'));
        }, 60000);

        getQrRunner().ensureSession(tenantId, id, (qr) => {
          if (done) return;
          done = true;
          clearTimeout(t);
          resolve(qr);
        }, { name: connectionName, qrCacheMs: 15000 }).catch((err) => {
          if (done) return;
          done = true;
          clearTimeout(t);
          reject(err);
        });
      });

      sendJson(res, 200, { ok: true, qr: { text: qrText } });
    } catch (err) {
      const msg = err?.message === 'QR_TIMEOUT'
        ? 'Tempo esgotado aguardando QR. Tente novamente.'
        : 'Erro ao gerar QR';

      logger.error('[WhatsAppQR] Erro ao gerar QR (Baileys):', {
        tenantId: req.tenantId || req.agent?.tenantId || 'unknown',
        connectionId: id || 'unknown',
        message: err?.message,
        code: err?.code,
        name: err?.name,
        status: err?.status || err?.statusCode || err?.output?.statusCode,
        isQrTimeout: err?.message === 'QR_TIMEOUT',
        stack: err?.stack,
        boomOutput: err?.output ? { statusCode: err.output.statusCode, payload: err.output.payload } : null,
        raw: String(err),
      });

      sendJson(res, err?.message === 'QR_TIMEOUT' ? 504 : 500, {
        error: err?.message === 'QR_TIMEOUT' ? 'timeout' : 'internal_error',
        message: msg,
      });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/whatsapp/connections/') && pathname.endsWith('/disconnect')) {
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
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    try {
      const id = decodeURIComponent(pathname.slice('/whatsapp/connections/'.length, -'/disconnect'.length));
      try {
        await getQrRunner().stopSession(tenantId, id);
      } catch (_) {}

      const service = require('../../services/whatsappQrService');
      const out = await service.disconnectConnection(tenantId, id);
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao desconectar:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao desconectar' });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/whatsapp/connections/') && pathname.endsWith('/status')) {
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
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const id = decodeURIComponent(pathname.slice('/whatsapp/connections/'.length, -'/status'.length));
      const body = await parseJsonBody(req);
      const service = require('../../services/whatsappQrService');
      const out = await service.setConnectionStatus(tenantId, id, body || {});
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return true;
        }
        if (out.error === 'invalid_status') {
          sendJson(res, 400, { error: 'invalid_status', message: 'Status inválido. Use connected|pairing|disconnected|error' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao atualizar status:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar status' });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/whatsapp/connections/') && pathname.endsWith('/events')) {
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
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const id = decodeURIComponent(pathname.slice('/whatsapp/connections/'.length, -'/events'.length));
      const body = await parseJsonBody(req);
      const service = require('../../services/whatsappQrService');
      const out = await service.ingestConnectionEvent(tenantId, id, body || {});
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return true;
        }
        if (out.error === 'event_type_required') {
          sendJson(res, 400, { error: 'event_type_required', message: 'eventType é obrigatório' });
          return true;
        }
        if (out.error === 'invalid_event_type') {
          sendJson(res, 400, { error: 'invalid_event_type', message: 'eventType inválido. Use qr|pairing|connected|ready|disconnected|logout|closed|error|failed' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao ingerir evento de conexão:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao ingerir evento de conexão' });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/whatsapp/connections/') && pathname.endsWith('/status')) {
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
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    try {
      const id = decodeURIComponent(pathname.slice('/whatsapp/connections/'.length, -'/status'.length));

      logger.debug('WA_QR_HTTP', 'status requested', {
        tenantId,
        connectionId: id,
        path: pathname,
      });

      const service = require('../../services/whatsappQrService');
      const out = await service.getStatus(tenantId, id);
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      const runtime = getQrRunner().getStatus(tenantId, id);
      const runtimeStatus = String(runtime?.status || 'disconnected').toLowerCase();
      let effectiveStatus = out.status;

      if (runtimeStatus === 'connected') effectiveStatus = 'connected';
      else if (runtimeStatus === 'syncing' || runtimeStatus === 'connecting' || runtimeStatus === 'qr') effectiveStatus = 'pairing';

      if (effectiveStatus !== out.status) {
        try {
          await service.setConnectionStatus(tenantId, id, {
            status: effectiveStatus,
            metadata: { source: 'qrRunner-runtime-sync', runtimeStatus },
          });
        } catch (_) {}
      }

      const responsePayload = {
        ...out,
        status: String(effectiveStatus || 'disconnected').trim(),
        runtimeStatus: String(runtimeStatus || 'disconnected').trim(),
        lastDisconnectCode: Number(runtime?.lastDisconnectCode || 0) || null,
        lastDisconnectReason: (() => {
          const fallback = (typeof runtime?.lastError === 'string' && runtime.lastError.trim()) || null;
          const message = runtime?.lastError?.output?.payload?.message;
          if (typeof message === 'string' && message.trim()) return message;
          return fallback;
        })(),
        lastDisconnectAtRuntime:
          runtimeStatus === 'disconnected' && Number(runtime?.updatedAt || 0) > 0
            ? new Date(Number(runtime.updatedAt)).toISOString()
            : null,
      };

      logger.debug('WA_QR_HTTP', 'status response', {
        tenantId,
        connectionId: id,
        status: responsePayload.status,
        runtimeStatus: responsePayload.runtimeStatus,
      });

      sendJson(res, 200, responsePayload);
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao obter status:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter status' });
    }
    return true;
  }

  if (method === 'DELETE' && pathname.startsWith('/whatsapp/connections/')) {
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
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    try {
      const id = decodeURIComponent(pathname.slice('/whatsapp/connections/'.length));
      const service = require('../../services/whatsappQrService');
      const out = await service.removeConnection(tenantId, id);
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao remover conexão:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao remover conexão' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/webhooks/whatsapp-qr/events') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const secretExpected = String(process.env.WHATSAPP_QR_WEBHOOK_SECRET || '').trim();
      if (secretExpected) {
        const provided = String(req.headers['x-whatsapp-qr-secret'] || '').trim();
        if (!provided || provided !== secretExpected) {
          sendJson(res, 401, { error: 'unauthorized', message: 'Invalid webhook secret' });
          return true;
        }
      }
      const tenantId = body?.tenantId || body?.tenant_id;
      const connectionId = body?.connectionId || body?.connection_id;
      if (!tenantId || !connectionId) {
        sendJson(res, 400, { error: 'invalid_payload', message: 'tenantId e connectionId são obrigatórios' });
        return true;
      }
      const service = require('../../services/whatsappQrService');
      const out = await service.ingestConnectionEvent(String(tenantId), String(connectionId), body || {});
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return true;
        }
        if (out.error === 'event_type_required' || out.error === 'invalid_event_type') {
          sendJson(res, 400, { error: out.error, message: 'eventType inválido ou ausente' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro no webhook de eventos:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao processar webhook de evento' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/whatsapp/qr-bridge/stats') {
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
      const { getWhatsAppQrBridgeStats } = require('../../services/whatsappQrBridgeService');
      sendJson(res, 200, { ok: true, ...getWhatsAppQrBridgeStats() });
    } catch (err) {
      logger.error('[WhatsAppQRBridge] Erro ao obter stats:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter stats do bridge' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleWhatsappQrRoutes,
};
