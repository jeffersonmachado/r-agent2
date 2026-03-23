'use strict';

const { listPublicTokens, getPublicTokenStats, createPublicToken } = require('../../services/publicAccessTokenService');

function ensureConfigPermission(req, res, deps, action) {
  const { requireAuth, requirePermission, sendJson } = deps;
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }
  const permResult = requirePermission(req, 'config', action);
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }
  return true;
}

function getIpAddress(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
}

module.exports = { handlePublicTokenCrudRoutes };

async function handlePublicTokenCrudRoutes({ req, res, method, pathname, deps }) {
  const {
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
  } = deps;

  if (method === 'GET' && pathname === '/public-tokens') {
    if (!ensureConfigPermission(req, res, deps, 'read')) return true;

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const kind = urlObj.searchParams.get('kind');
      const locationId = urlObj.searchParams.get('locationId');
      const activeParam = urlObj.searchParams.get('active');
      const includeTokenParam = urlObj.searchParams.get('includeToken');
      const active = activeParam === null ? null : (activeParam === 'true' ? true : activeParam === 'false' ? false : null);
      const includeToken = includeTokenParam === 'true';

      if (includeToken) {
        const permSecrets = requirePermission(req, 'config', 'update');
        if (!permSecrets.allowed) {
          sendJson(res, 403, { error: 'forbidden', message: 'Permissão insuficiente para incluir tokens em texto claro' });
          return true;
        }
      }

      const items = await listPublicTokens({
        tenantId: req.tenantId,
        kind: kind ? String(kind) : null,
        locationId: locationId ? String(locationId) : null,
        active,
        includeToken,
      });
      sendJson(res, 200, { ok: true, items });
    } catch (err) {
      logger.error('[PublicTokens] Erro ao listar tokens:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar tokens públicos' });
    }

    return true;
  }

  if (method === 'GET' && pathname === '/public-tokens/stats') {
    if (!ensureConfigPermission(req, res, deps, 'read')) return true;

    try {
      const result = await getPublicTokenStats({ tenantId: req.tenantId });
      if (!result.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'public_token_stats_unavailable' });
        return true;
      }
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('[PublicTokens] Erro ao obter stats:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter stats de tokens públicos' });
    }

    return true;
  }

  if (method === 'POST' && pathname === '/public-tokens') {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const kind = body && body.kind ? String(body.kind).trim() : '';
      const locationId = body && body.locationId ? String(body.locationId).trim() : null;
      const meta = body && typeof body.meta === 'object' && body.meta ? body.meta : {};
      const expiresInSec = body && body.expiresInSec != null ? Number(body.expiresInSec) : null;

      const allowedKinds = new Set(['storefront', 'kiosk', 'panel', 'station', 'access_control']);
      if (!allowedKinds.has(kind)) {
        badRequest(res, 'Campo "kind" inválido. Use: storefront|kiosk|panel|station|access_control');
        return true;
      }

      const tokenRow = await createPublicToken({
        tenantId: req.tenantId,
        kind,
        locationId,
        meta,
        expiresInSec,
      });

      try {
        logAction({
          agentId: req.agent?.id || null,
          username: req.agent?.username || null,
          tenantId: req.tenantId,
          action: 'public_token_create',
          resource: 'public_token',
          resourceId: tokenRow.id,
          details: { kind, locationId: locationId || null, expiresInSec: expiresInSec || null },
          ipAddress: getIpAddress(req),
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 201, { ok: true, token: tokenRow });
    } catch (err) {
      logger.error('[PublicTokens] Erro ao criar token:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar token público' });
    }

    return true;
  }

  return false;
}
