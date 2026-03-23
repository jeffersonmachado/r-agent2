'use strict';

const { handleProcessRuntimeControlRoutes } = require('./handleProcessRuntimeControlRoutes');
const { handleProcessInstanceRoutes } = require('./handleProcessInstanceRoutes');

module.exports = { handleProcessRuntimeRoutes };

async function handleProcessRuntimeRoutes({ req, res, method, pathname, deps }) {
  const isApiPath = pathname.startsWith('/api/process-instances') || pathname.startsWith('/api/process-runtime/');
  if (!isApiPath) return false;
  const authResult = deps.requireAuth(req);
  if (!authResult.valid) {
    deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return true;
  }
  if (await handleProcessRuntimeControlRoutes({ req, res, method, pathname, deps })) return true;
  if (await handleProcessInstanceRoutes({ req, res, method, pathname, deps })) return true;
  return false;
}
