'use strict';

const { revokePublicToken, rotatePublicToken, resolvePublicToken } = require('../../services/publicAccessTokenService');

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

function parseTokenId(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  return parts[1] ? String(parts[1]) : null;
}

function getIpAddress(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
}

module.exports = { handlePublicTokenLifecycleRoutes };

async function handlePublicTokenLifecycleRoutes({ req, res, method, pathname, deps }) {
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    logger,
    logAction,
    checkRateLimit,
  } = deps;

  if (method === 'POST' && pathname.startsWith('/public-tokens/') && pathname.endsWith('/revoke')) {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;

    try {
      const tokenId = parseTokenId(pathname);
      if (!tokenId) {
        sendJson(res, 400, { error: 'bad_request', message: 'tokenId obrigatório' });
        return true;
      }

      const reason = (() => {
        try {
          const urlObj = new URL(req.url || '/', 'http://localhost');
          const q = urlObj.searchParams.get('reason');
          return q ? String(q) : null;
        } catch (_) {
          return null;
        }
      })();

      const result = await revokePublicToken({ tenantId: req.tenantId, tokenId, reason });
      if (!result.ok) {
        sendJson(res, 404, { error: 'not_found', message: 'Token não encontrado' });
        return true;
      }

      try {
        logAction({
          agentId: req.agent?.id || null,
          username: req.agent?.username || null,
          tenantId: req.tenantId,
          action: 'public_token_revoke',
          resource: 'public_token',
          resourceId: tokenId,
          details: { reason: reason || null },
          ipAddress: getIpAddress(req),
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 200, { ok: true, token: result.token });
    } catch (err) {
      logger.error('[PublicTokens] Erro ao revogar token:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao revogar token público' });
    }

    return true;
  }

  if (method === 'POST' && pathname.startsWith('/public-tokens/') && pathname.endsWith('/rotate')) {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;

    try {
      const tokenId = parseTokenId(pathname);
      if (!tokenId) {
        sendJson(res, 400, { error: 'bad_request', message: 'tokenId obrigatório' });
        return true;
      }

      const urlObj = new URL(req.url || '/', 'http://localhost');
      const expiresInSecRaw = urlObj.searchParams.get('expiresInSec');
      const expiresInSec = expiresInSecRaw != null ? Number(expiresInSecRaw) : null;

      const result = await rotatePublicToken({ tenantId: req.tenantId, tokenId, expiresInSec });
      if (!result.ok) {
        const code = result.error;
        if (code === 'token_not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Token não encontrado' });
          return true;
        }
        if (code === 'token_inactive') {
          sendJson(res, 409, { error: 'conflict', message: 'Token já está inativo' });
          return true;
        }
        sendJson(res, 400, { error: 'bad_request', message: 'Não foi possível rotacionar token' });
        return true;
      }

      try {
        logAction({
          agentId: req.agent?.id || null,
          username: req.agent?.username || null,
          tenantId: req.tenantId,
          action: 'public_token_rotate',
          resource: 'public_token',
          resourceId: tokenId,
          details: { newTokenId: result.newToken?.id || null },
          ipAddress: getIpAddress(req),
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 200, { ok: true, oldTokenId: result.oldTokenId, newToken: result.newToken });
    } catch (err) {
      logger.error('[PublicTokens] Erro ao rotacionar token:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao rotacionar token público' });
    }

    return true;
  }

  if (method === 'GET' && pathname === '/public-tokens/resolve') {
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const token = urlObj.searchParams.get('token');
      if (!token) {
        sendJson(res, 400, { error: 'bad_request', message: 'Token obrigatório' });
        return true;
      }

      const ipAddress = getIpAddress(req);
      const rl = await checkRateLimit({ userId: `ip:${ipAddress}`, operationType: 'PUBLIC_TOKEN_RESOLVE' });
      if (!rl.allowed) {
        res.setHeader('Retry-After', rl.retryAfter || 60);
        sendJson(res, 429, {
          error: 'rate_limit_exceeded',
          message: `Limite de requisições excedido. Tente novamente em ${rl.retryAfter || 60} segundos.`,
          retryAfter: rl.retryAfter || 60,
        });
        return true;
      }

      const resolved = await resolvePublicToken({
        token,
        allowedKinds: ['storefront', 'kiosk', 'panel', 'station', 'access_control'],
      });
      if (!resolved.ok) {
        sendJson(res, 401, { error: 'unauthorized', message: 'Token inválido' });
        return true;
      }

      try {
        logAction({
          agentId: 'public',
          username: 'public',
          tenantId: resolved.tenantId,
          action: 'public_token_resolve',
          resource: 'public_token',
          resourceId: resolved.tokenId,
          details: { kind: resolved.kind, locationId: resolved.locationId || null },
          ipAddress: getIpAddress(req),
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 200, {
        ok: true,
        token: {
          id: resolved.tokenId,
          kind: resolved.kind,
          tenantId: resolved.tenantId,
          locationId: resolved.locationId,
          meta: resolved.meta || {},
          allowedKinds: ['storefront', 'kiosk', 'panel', 'station', 'access_control'],
        },
      });
    } catch (err) {
      logger.error('[PublicTokens] Erro ao resolver token:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao resolver token público' });
    }

    return true;
  }

  return false;
}
