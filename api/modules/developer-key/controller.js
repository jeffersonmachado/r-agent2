'use strict';

function getIpAddress(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
}

function createDeveloperKeyController({ service, deps }) {
  function ensureConfigPermission(req, res, action) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }

    const permResult = deps.requirePermission(req, 'config', action);
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return false;
    }

    return true;
  }

  function bestEffortLogAction(payload) {
    try {
      deps.logAction(payload);
    } catch (_) {}
  }

  return {
    async list(req, res) {
      if (!ensureConfigPermission(req, res, 'read')) return;

      try {
        const filters = service.parseListFilters(req.url);

        if (filters.includeToken) {
          const permSecrets = deps.requirePermission(req, 'config', 'update');
          if (!permSecrets.allowed) {
            deps.sendJson(res, 403, {
              error: 'forbidden',
              message: 'Permissão insuficiente para incluir tokens em texto claro',
            });
            return;
          }
        }

        const items = await service.listDeveloperKeys({
          tenantId: req.tenantId,
          active: filters.active,
          includeToken: filters.includeToken,
        });
        deps.sendJson(res, 200, { ok: true, items });
      } catch (err) {
        deps.logger.error('[DeveloperKeys] Erro ao listar chaves:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar chaves' });
      }
    },

    async create(req, res) {
      if (!ensureConfigPermission(req, res, 'update')) return;
      if (!deps.hasJsonContentType(req)) {
        deps.badRequest(res, 'Content-Type deve ser application/json');
        return;
      }

      try {
        const payload = service.parseCreatePayload(await deps.parseJsonBody(req));
        const tokenRow = await service.createDeveloperKey({
          tenantId: req.tenantId,
          name: payload.name,
          description: payload.description,
          expiresInSec: payload.expiresInSec,
        });

        bestEffortLogAction({
          agentId: req.agent?.id || null,
          username: req.agent?.username || null,
          tenantId: req.tenantId,
          action: 'developer_key_create',
          resource: 'developer_key',
          resourceId: tokenRow.id,
          details: { name: payload.name || null, expiresInSec: payload.expiresInSec || null },
          ipAddress: getIpAddress(req),
          userAgent: req.headers['user-agent'] || 'unknown',
        });

        deps.sendJson(res, 201, { ok: true, key: tokenRow });
      } catch (err) {
        deps.logger.error('[DeveloperKeys] Erro ao criar chave:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar chave' });
      }
    },

    async usage(req, res) {
      if (!ensureConfigPermission(req, res, 'read')) return;

      try {
        const { result, keys } = await service.getDeveloperUsage({ tenantId: req.tenantId });
        if (!result.ok) {
          deps.sendJson(res, 503, {
            error: 'service_unavailable',
            message: result.error || 'developer_usage_unavailable',
          });
          return;
        }

        deps.sendJson(res, 200, service.buildUsageResponse({
          tenantId: req.tenantId,
          result,
          keys,
        }));
      } catch (err) {
        deps.logger.error('[DeveloperKeys] Erro ao obter uso:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter uso' });
      }
    },
  };
}

module.exports = {
  createDeveloperKeyController,
};
