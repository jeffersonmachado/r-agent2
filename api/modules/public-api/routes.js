'use strict';

const express = require('express');

function extractApiKey(req) {
  const headerKey = req.headers['x-api-key'] || req.headers['x-api_key'] || null;
  if (headerKey) return String(headerKey).trim();

  const authHeader = req.headers.authorization ? String(req.headers.authorization) : '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (authHeader.toLowerCase().startsWith('apikey ')) {
    return authHeader.slice(7).trim();
  }

  return null;
}

function createPublicApiRoutes({ buildDeps }) {
  const router = express.Router();

  router.use('/public', async (req, res, next) => {
    if (req.method !== 'POST') {
      next();
      return;
    }

    const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
    const {
      sendJson,
      badRequest,
      hasJsonContentType,
      parseJsonBody,
      logger,
      checkRateLimit,
    } = buildDeps(req, res);

    if (!pathname.startsWith('/public/')) {
      next();
      return;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const apiKey = extractApiKey(req);
      if (!apiKey) {
        sendJson(res, 401, { error: 'unauthorized', message: 'API key obrigatória' });
        return;
      }

      const { resolvePublicToken, recordPublicTokenUsage } = require('../../services/publicAccessTokenService');
      const resolved = await resolvePublicToken({ token: apiKey, allowedKinds: ['developer'] });
      if (!resolved.ok) {
        sendJson(res, 401, { error: 'unauthorized', message: 'API key inválida' });
        return;
      }

      const rl = await checkRateLimit({
        userId: `publicToken:${resolved.tokenId}`,
        operationType: 'PUBLIC_API',
      });
      if (!rl.allowed) {
        res.setHeader('Retry-After', rl.retryAfter || 60);
        sendJson(res, 429, {
          error: 'rate_limit_exceeded',
          message: `Limite de requisições excedido. Tente novamente em ${rl.retryAfter || 60} segundos.`,
          retryAfter: rl.retryAfter || 60,
        });
        return;
      }

      const body = await parseJsonBody(req);
      const response = {
        ok: true,
        route: pathname,
        tenantId: resolved.tenantId,
        tokenId: resolved.tokenId,
        received: body || null,
      };

      try {
        await recordPublicTokenUsage({
          tokenId: resolved.tokenId,
          route: pathname,
          method: req.method,
          statusCode: 200,
        });
      } catch (_) {}

      sendJson(res, 200, response);
    } catch (err) {
      logger.error('[PublicAPI] Erro ao processar request:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao processar request público' });
    }
  });

  return router;
}

module.exports = {
  createPublicApiRoutes,
};
