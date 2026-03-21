'use strict';

async function resolveStorefrontToken(req, res, sendJson) {
  const urlObj = new URL(req.url || '/', 'http://localhost');
  const token = urlObj.searchParams.get('token');
  if (!token) {
    sendJson(res, 401, { error: 'unauthorized', message: 'Token obrigatório' });
    return null;
  }
  const { resolvePublicToken } = require('../../services/publicAccessTokenService');
  const resolved = await resolvePublicToken({ token, allowedKinds: ['storefront'] });
  if (!resolved.ok) {
    sendJson(res, 401, { error: 'unauthorized', message: 'Token inválido' });
    return null;
  }
  return { token, resolved };
}

async function enforceStorefrontRateLimit(resolved, res, sendJson, checkRateLimit) {
  const rl = await checkRateLimit({
    userId: `publicToken:${resolved.tokenId}`,
    operationType: 'PUBLIC_TOKEN_STOREFRONT',
  });
  if (!rl.allowed) {
    res.setHeader('Retry-After', rl.retryAfter || 60);
    sendJson(res, 429, { error: 'rate_limit_exceeded', retryAfter: rl.retryAfter || 60 });
    return false;
  }
  return true;
}

module.exports = {
  resolveStorefrontToken,
  enforceStorefrontRateLimit,
};
