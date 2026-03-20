'use strict';

function getIpAddress(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
}

function parseTokenId(req) {
  return req.params && req.params.tokenId ? String(req.params.tokenId) : null;
}

function createPublicTokenController({ service, deps }) {
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

        const items = await service.listPublicTokens({
          tenantId: req.tenantId,
          kind: filters.kind,
          locationId: filters.locationId,
          active: filters.active,
          includeToken: filters.includeToken,
        });

        deps.sendJson(res, 200, { ok: true, items });
      } catch (err) {
        deps.logger.error('[PublicTokens] Erro ao listar tokens:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar tokens públicos' });
      }
    },

    async stats(req, res) {
      if (!ensureConfigPermission(req, res, 'read')) return;

      try {
        const result = await service.getPublicTokenStats({ tenantId: req.tenantId });
        if (!result.ok) {
          deps.sendJson(res, 503, {
            error: 'service_unavailable',
            message: result.error || 'public_token_stats_unavailable',
          });
          return;
        }

        deps.sendJson(res, 200, result);
      } catch (err) {
        deps.logger.error('[PublicTokens] Erro ao obter stats:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter stats de tokens públicos' });
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
        const validation = service.validateCreatePayload(payload);
        if (!validation.valid) {
          deps.badRequest(res, validation.message);
          return;
        }

        const tokenRow = await service.createPublicToken({
          tenantId: req.tenantId,
          kind: payload.kind,
          locationId: payload.locationId,
          meta: payload.meta,
          expiresInSec: payload.expiresInSec,
        });

        bestEffortLogAction({
          agentId: req.agent?.id || null,
          username: req.agent?.username || null,
          tenantId: req.tenantId,
          action: 'public_token_create',
          resource: 'public_token',
          resourceId: tokenRow.id,
          details: {
            kind: payload.kind,
            locationId: payload.locationId || null,
            expiresInSec: payload.expiresInSec || null,
          },
          ipAddress: getIpAddress(req),
          userAgent: req.headers['user-agent'] || 'unknown',
        });

        deps.sendJson(res, 201, { ok: true, token: tokenRow });
      } catch (err) {
        deps.logger.error('[PublicTokens] Erro ao criar token:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar token público' });
      }
    },

    async revoke(req, res) {
      if (!ensureConfigPermission(req, res, 'update')) return;

      try {
        const tokenId = parseTokenId(req);
        if (!tokenId) {
          deps.sendJson(res, 400, { error: 'bad_request', message: 'tokenId obrigatório' });
          return;
        }

        const { reason } = service.parseRevokeRequest(req.url);
        const result = await service.revokePublicToken({
          tenantId: req.tenantId,
          tokenId,
          reason,
        });

        if (!result.ok) {
          deps.sendJson(res, 404, { error: 'not_found', message: 'Token não encontrado' });
          return;
        }

        bestEffortLogAction({
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

        deps.sendJson(res, 200, { ok: true, token: result.token });
      } catch (err) {
        deps.logger.error('[PublicTokens] Erro ao revogar token:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao revogar token público' });
      }
    },

    async rotate(req, res) {
      if (!ensureConfigPermission(req, res, 'update')) return;

      try {
        const tokenId = parseTokenId(req);
        if (!tokenId) {
          deps.sendJson(res, 400, { error: 'bad_request', message: 'tokenId obrigatório' });
          return;
        }

        const { expiresInSec } = service.parseRotateRequest(req.url);
        const result = await service.rotatePublicToken({
          tenantId: req.tenantId,
          tokenId,
          expiresInSec,
        });

        if (!result.ok) {
          if (result.error === 'token_not_found') {
            deps.sendJson(res, 404, { error: 'not_found', message: 'Token não encontrado' });
            return;
          }

          if (result.error === 'token_inactive') {
            deps.sendJson(res, 409, { error: 'conflict', message: 'Token já está inativo' });
            return;
          }

          deps.sendJson(res, 400, { error: 'bad_request', message: 'Não foi possível rotacionar token' });
          return;
        }

        bestEffortLogAction({
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

        deps.sendJson(res, 200, {
          ok: true,
          oldTokenId: result.oldTokenId,
          newToken: result.newToken,
        });
      } catch (err) {
        deps.logger.error('[PublicTokens] Erro ao rotacionar token:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao rotacionar token público' });
      }
    },

    async resolve(req, res) {
      try {
        const { token } = service.parseResolveRequest(req.url);
        if (!token) {
          deps.sendJson(res, 400, { error: 'bad_request', message: 'Token obrigatório' });
          return;
        }

        const ipAddress = getIpAddress(req);
        const rl = await deps.checkRateLimit({
          userId: `ip:${ipAddress}`,
          operationType: 'PUBLIC_TOKEN_RESOLVE',
        });

        if (!rl.allowed) {
          res.setHeader('Retry-After', rl.retryAfter || 60);
          deps.sendJson(res, 429, {
            error: 'rate_limit_exceeded',
            message: `Limite de requisições excedido. Tente novamente em ${rl.retryAfter || 60} segundos.`,
            retryAfter: rl.retryAfter || 60,
          });
          return;
        }

        const resolved = await service.resolvePublicToken(token);
        if (!resolved.ok) {
          deps.sendJson(res, 401, { error: 'unauthorized', message: 'Token inválido' });
          return;
        }

        bestEffortLogAction({
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

        deps.sendJson(res, 200, {
          ok: true,
          token: {
            id: resolved.tokenId,
            kind: resolved.kind,
            tenantId: resolved.tenantId,
            locationId: resolved.locationId,
            meta: resolved.meta || {},
            allowedKinds: service.getAllowedKinds(),
          },
        });
      } catch (err) {
        deps.logger.error('[PublicTokens] Erro ao resolver token:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao resolver token público' });
      }
    },
  };
}

module.exports = {
  createPublicTokenController,
};
