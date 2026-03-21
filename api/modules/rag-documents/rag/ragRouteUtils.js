const logger = require('../../../utils/logger');
const { buildApiError, sendApiError } = require('../../../utils/apiError');

function isRouteMatch(method, pathname, expectedMethod, expectedPath) {
  return method === expectedMethod && pathname === expectedPath;
}

function canHandlePrefix(method, pathname, expectedMethod, prefix) {
  return method === expectedMethod && pathname.startsWith(prefix);
}

function ensureRagPermission({ req, res, deps, permission }) {
  const authResult = deps.requireAuth(req);
  if (!authResult.valid) {
    deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }

  const permResult = deps.requirePermission(req, 'rag', permission);
  if (!permResult.allowed) {
    deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }

  return true;
}

function ensureJsonRequest({ req, res, deps }) {
  if (!deps.hasJsonContentType(req)) {
    deps.badRequest(res, 'Content-Type deve ser application/json');
    return false;
  }

  return true;
}

function logRagAction({ req, deps, action, resource, resourceId }) {
  if (!req?.agent?.id || !deps.logAction) {
    return;
  }

  deps.logAction({
    agentId: req.agent.id,
    username: req.agent.username,
    action,
    resource,
    resourceId,
    ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
  });
}

function createInternalErrorResponder(req, res, deps, message) {
  return (err, { loggerMessage = message } = {}) => {
    logger.error(loggerMessage, err);
    deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    return true;
  };
}

function sendRagApiError(req, res, deps, errorConfig, loggerMessage, err) {
  logger.error(loggerMessage, err);
  sendApiError(res, buildApiError({
    ...errorConfig,
    details: errorConfig.details || { message: err.message },
    req,
  }), deps.setCorsHeaders);
  return true;
}

module.exports = {
  canHandlePrefix,
  createInternalErrorResponder,
  ensureJsonRequest,
  ensureRagPermission,
  isRouteMatch,
  logRagAction,
  sendRagApiError,
};
