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

function normalizeActiveParam(value) {
  if (value === null) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

async function handleDeveloperKeyRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
  } = deps;

  if (method === 'GET' && pathname === '/developer/keys') {
    if (!ensureConfigPermission(req, res, deps, 'read')) return true;
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const includeToken = urlObj.searchParams.get('includeToken') === 'true';
      const active = normalizeActiveParam(urlObj.searchParams.get('active'));

      if (includeToken) {
        const permSecrets = requirePermission(req, 'config', 'update');
        if (!permSecrets.allowed) {
          sendJson(res, 403, { error: 'forbidden', message: 'Permissão insuficiente para incluir tokens em texto claro' });
          return true;
        }
      }

      const { listPublicTokens } = require('../services/publicAccessTokenService');
      const items = await listPublicTokens({
        tenantId: req.tenantId,
        kind: 'developer',
        active,
        includeToken,
      });
      sendJson(res, 200, { ok: true, items });
    } catch (err) {
      logger.error('[DeveloperKeys] Erro ao listar chaves:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar chaves' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/developer/keys') {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const name = body && body.name ? String(body.name).trim() : '';
      const description = body && body.description ? String(body.description).trim() : '';
      const expiresInSec = body && body.expiresInSec != null ? Number(body.expiresInSec) : null;

      const { createPublicToken } = require('../services/publicAccessTokenService');
      const tokenRow = await createPublicToken({
        tenantId: req.tenantId,
        kind: 'developer',
        meta: {
          name: name || null,
          description: description || null,
        },
        expiresInSec,
      });

      try {
        logAction({
          agentId: req.agent?.id || null,
          username: req.agent?.username || null,
          tenantId: req.tenantId,
          action: 'developer_key_create',
          resource: 'developer_key',
          resourceId: tokenRow.id,
          details: { name: name || null, expiresInSec: expiresInSec || null },
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 201, { ok: true, key: tokenRow });
    } catch (err) {
      logger.error('[DeveloperKeys] Erro ao criar chave:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar chave' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/developer/usage') {
    if (!ensureConfigPermission(req, res, deps, 'read')) return true;

    try {
      const { getPublicTokenStats, listPublicTokens } = require('../services/publicAccessTokenService');
      const result = await getPublicTokenStats({ tenantId: req.tenantId });
      if (!result.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'developer_usage_unavailable' });
        return true;
      }

      const items = Array.isArray(result.items) ? result.items.filter((it) => it.kind === 'developer') : [];
      const keys = await listPublicTokens({ tenantId: req.tenantId, kind: 'developer', includeToken: false });
      const routesMap = new Map();

      for (const key of keys || []) {
        const usageByRoute = key?.meta?.usageByRoute && typeof key.meta.usageByRoute === 'object'
          ? key.meta.usageByRoute
          : {};

        for (const [route, routeInfo] of Object.entries(usageByRoute)) {
          const current = routesMap.get(route) || {
            route,
            count: 0,
            lastUsedAt: null,
            lastStatusCode: null,
            keys: 0,
          };
          const count = Number(routeInfo?.count || 0);
          const lastUsedAtRaw = routeInfo?.lastUsedAt ? new Date(routeInfo.lastUsedAt) : null;

          current.count += count;
          current.keys += 1;
          current.lastStatusCode = Number(routeInfo?.lastStatusCode || current.lastStatusCode || 0) || current.lastStatusCode;
          if (lastUsedAtRaw && !Number.isNaN(lastUsedAtRaw.getTime())) {
            if (!current.lastUsedAt || lastUsedAtRaw > new Date(current.lastUsedAt)) {
              current.lastUsedAt = lastUsedAtRaw.toISOString();
            }
          }
          routesMap.set(route, current);
        }
      }

      const routes = Array.from(routesMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 100);
      const totals = items.reduce((acc, it) => {
        acc.total += it.total;
        acc.active += it.active;
        acc.inactive += it.inactive;
        acc.revoked += it.revoked;
        acc.expired += it.expired;
        return acc;
      }, { total: 0, active: 0, inactive: 0, revoked: 0, expired: 0 });

      sendJson(res, 200, { ok: true, tenantId: req.tenantId, totals, items, routes });
    } catch (err) {
      logger.error('[DeveloperKeys] Erro ao obter uso:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter uso' });
    }

    return true;
  }

  return false;
}

module.exports = {
  handleDeveloperKeyRoutes,
};
