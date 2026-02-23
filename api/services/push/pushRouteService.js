'use strict';

const { requireAuth } = require('../../middleware/auth');
const logger = require('../../utils/logger');
const {
  registerPushToken,
  unregisterPushToken,
  assertPlatform,
  assertToken,
} = require('./tokenService');

async function handleRegisterPushRoute(req, { parseJsonBody, hasJsonContentType }) {
  const requestId = (req.headers['x-request-id'] && String(req.headers['x-request-id']).trim())
    || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const client = (req.headers['x-client'] && String(req.headers['x-client']).trim()) || 'unknown';
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    logger.warn('[Push] Registro rejeitado (auth)', { requestId, client, reason: authResult.error });
    return { status: 401, body: { error: 'unauthorized', message: authResult.error } };
  }

  if (!hasJsonContentType(req)) {
    return { status: 400, body: { error: 'bad_request', message: 'Content-Type deve ser application/json' } };
  }

  const tenantId = req.tenantId || req.agent?.tenantId;
  const userId = req.agent?.id;
  if (!tenantId || !userId) {
    logger.warn('[Push] Registro rejeitado (tenant/user ausente)', {
      requestId,
      client,
      tenantId: tenantId || null,
      userId: userId || null,
    });
    return { status: 403, body: { error: 'forbidden', message: 'tenantId ou userId ausente no contexto autenticado' } };
  }

  const body = await parseJsonBody(req);
  const platform = assertPlatform(body?.platform);
  const token = assertToken(body?.token);
  logger.info('[Push] Registro solicitado', {
    requestId,
    client,
    tenantId,
    userId,
    platform,
    tokenPreview: `${String(token).slice(0, 10)}...`,
  });

  await registerPushToken({
    tenantId,
    userId,
    platform,
    token,
    deviceName: body?.device_name || body?.deviceName || null,
    deviceId: body?.device_id || body?.deviceId || null,
    appVersion: body?.app_version || body?.appVersion || null,
  });
  logger.info('[Push] Registro concluído', {
    requestId,
    client,
    tenantId,
    userId,
    platform,
  });

  return { status: 200, body: { ok: true } };
}

async function handleUnregisterPushRoute(req, { parseJsonBody, hasJsonContentType }) {
  const requestId = (req.headers['x-request-id'] && String(req.headers['x-request-id']).trim())
    || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const client = (req.headers['x-client'] && String(req.headers['x-client']).trim()) || 'unknown';
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    logger.warn('[Push] Remoção rejeitada (auth)', { requestId, client, reason: authResult.error });
    return { status: 401, body: { error: 'unauthorized', message: authResult.error } };
  }

  if (!hasJsonContentType(req)) {
    return { status: 400, body: { error: 'bad_request', message: 'Content-Type deve ser application/json' } };
  }

  const tenantId = req.tenantId || req.agent?.tenantId;
  const userId = req.agent?.id;
  if (!tenantId || !userId) {
    logger.warn('[Push] Remoção rejeitada (tenant/user ausente)', {
      requestId,
      client,
      tenantId: tenantId || null,
      userId: userId || null,
    });
    return { status: 403, body: { error: 'forbidden', message: 'tenantId ou userId ausente no contexto autenticado' } };
  }

  const body = await parseJsonBody(req);
  const platform = assertPlatform(body?.platform);
  const token = assertToken(body?.token);
  logger.info('[Push] Remoção solicitada', {
    requestId,
    client,
    tenantId,
    userId,
    platform,
    tokenPreview: `${String(token).slice(0, 10)}...`,
  });

  await unregisterPushToken({ tenantId, userId, platform, token });
  logger.info('[Push] Remoção concluída', { requestId, client, tenantId, userId, platform });
  return { status: 200, body: { ok: true } };
}

module.exports = {
  handleRegisterPushRoute,
  handleUnregisterPushRoute,
};
