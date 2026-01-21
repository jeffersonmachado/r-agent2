const crypto = require('crypto');

function generateRequestId() {
  try {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // ignora
  }
  try {
    return crypto.randomBytes(16).toString('hex');
  } catch {
    return `req-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

/**
 * Middleware simples (sem Express) para garantir req.id.
 * - Prioriza header "X-Request-Id" se vier do cliente.
 * - Define também o header de resposta "X-Request-Id".
 *
 * @param {import('http').IncomingMessage & { id?: string }} req
 * @param {import('http').ServerResponse} res
 * @returns {string} requestId
 */
function requestIdMiddleware(req, res) {
  const fromHeader = (req.headers && (req.headers['x-request-id'] || req.headers['x-correlation-id']))
    ? String(req.headers['x-request-id'] || req.headers['x-correlation-id']).trim()
    : '';
  const id = fromHeader || req.id || generateRequestId();
  req.id = id;
  try {
    res.setHeader('X-Request-Id', id);
  } catch {
    // ignora
  }
  return id;
}

module.exports = { requestIdMiddleware };

