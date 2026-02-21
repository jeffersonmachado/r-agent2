'use strict';

const { requireAuth } = require('../../middleware/auth');
const {
  registerPushToken,
  unregisterPushToken,
  assertPlatform,
  assertToken,
} = require('./tokenService');

async function handleRegisterPushRoute(req, { parseJsonBody, hasJsonContentType }) {
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    return { status: 401, body: { error: 'unauthorized', message: authResult.error } };
  }

  if (!hasJsonContentType(req)) {
    return { status: 400, body: { error: 'bad_request', message: 'Content-Type deve ser application/json' } };
  }

  const tenantId = req.tenantId || req.agent?.tenantId;
  const userId = req.agent?.id;
  if (!tenantId || !userId) {
    return { status: 403, body: { error: 'forbidden', message: 'tenantId ou userId ausente no contexto autenticado' } };
  }

  const body = await parseJsonBody(req);
  const platform = assertPlatform(body?.platform);
  const token = assertToken(body?.token);

  await registerPushToken({
    tenantId,
    userId,
    platform,
    token,
    deviceName: body?.device_name || body?.deviceName || null,
    deviceId: body?.device_id || body?.deviceId || null,
    appVersion: body?.app_version || body?.appVersion || null,
  });

  return { status: 200, body: { ok: true } };
}

async function handleUnregisterPushRoute(req, { parseJsonBody, hasJsonContentType }) {
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    return { status: 401, body: { error: 'unauthorized', message: authResult.error } };
  }

  if (!hasJsonContentType(req)) {
    return { status: 400, body: { error: 'bad_request', message: 'Content-Type deve ser application/json' } };
  }

  const tenantId = req.tenantId || req.agent?.tenantId;
  const userId = req.agent?.id;
  if (!tenantId || !userId) {
    return { status: 403, body: { error: 'forbidden', message: 'tenantId ou userId ausente no contexto autenticado' } };
  }

  const body = await parseJsonBody(req);
  const platform = assertPlatform(body?.platform);
  const token = assertToken(body?.token);

  await unregisterPushToken({ tenantId, userId, platform, token });
  return { status: 200, body: { ok: true } };
}

module.exports = {
  handleRegisterPushRoute,
  handleUnregisterPushRoute,
};
