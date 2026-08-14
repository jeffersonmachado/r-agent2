const { checkClassification } = require('../../middleware/requireClassification');
const { tenantFromRequest } = require('../../../lib/rpaSecurity');

const ensureAuthenticated = (req, res, requireAuth, sendJson) => {
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }

  return true;
};

// Replay e gravações RPA são ferramentas de SUPPORT/DEVELOPMENT: operadores de
// produção não têm acesso. Deve ser usado no lugar de ensureAuthenticated.
const ensureSupportAccess = (req, res, requireAuth, sendJson) => {
  if (!ensureAuthenticated(req, res, requireAuth, sendJson)) return false;

  const check = checkClassification(req, 'SUPPORT');
  if (!check.allowed) {
    sendJson(res, 403, {
      error: 'classification_required',
      required: check.required,
      classification: check.classification,
    });
    return false;
  }

  return true;
};

const getPathSuffix = (pathname, prefix) => decodeURIComponent(pathname.slice(prefix.length));

const resolveRequestTenant = (req, res, sendJson) => {
  try {
    return tenantFromRequest(req);
  } catch (error) {
    sendJson(res, 400, { error: 'tenant_required', message: 'Tenant autenticado obrigatório' });
    return null;
  }
};

const getExecutionIdFromActionPath = (pathname) => {
  const parts = pathname.split('/').filter(Boolean);
  const executionIndex = parts.indexOf('execution');
  if (executionIndex === -1 || executionIndex + 1 >= parts.length) {
    return '';
  }
  return decodeURIComponent(parts[executionIndex + 1]);
};

const isSafeJsonFilename = (filename) => {
  if (!filename || typeof filename !== 'string') return false;
  if (!filename.endsWith('.json')) return false;
  if (filename.includes('/') || filename.includes('\\')) return false;
  if (filename.includes('..')) return false;
  return true;
};

module.exports = {
  ensureAuthenticated,
  ensureSupportAccess,
  getPathSuffix,
  getExecutionIdFromActionPath,
  isSafeJsonFilename,
  resolveRequestTenant,
};
