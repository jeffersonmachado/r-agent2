async function resolveStationToken(req, res, sendJson) {
  const urlObj = new URL(req.url || '/', 'http://localhost');
  const token = urlObj.searchParams.get('token');
  if (!token) {
    sendJson(res, 401, { error: 'unauthorized', message: 'Token obrigatório' });
    return null;
  }

  const { resolvePublicToken } = require('../../../services/publicAccessTokenService');
  const resolved = await resolvePublicToken({ token, allowedKinds: ['station'] });
  if (!resolved.ok) {
    sendJson(res, 401, { error: 'unauthorized', message: 'Token inválido' });
    return null;
  }

  return resolved;
}

async function enforceStationRateLimit(resolved, req, res, sendJson, checkRateLimit) {
  const rl = await checkRateLimit({
    userId: `publicToken:${resolved.tokenId}`,
    operationType: 'PUBLIC_TOKEN_STATION',
  });
  if (!rl.allowed) {
    res.setHeader('Retry-After', rl.retryAfter || 60);
    sendJson(res, 429, {
      error: 'rate_limit_exceeded',
      message: `Limite de requisições excedido. Tente novamente em ${rl.retryAfter || 60} segundos.`,
      retryAfter: rl.retryAfter || 60,
    });
    return false;
  }

  return true;
}

function getIpAddress(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
}

module.exports = {
  resolveStationToken,
  enforceStationRateLimit,
  getIpAddress,
};
