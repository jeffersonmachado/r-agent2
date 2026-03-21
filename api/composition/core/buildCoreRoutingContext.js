'use strict';

const { buildCoreCommonDeps } = require('./buildCoreCommonDeps');
const { buildCoreAdminDeps } = require('./buildCoreAdminDeps');
const { buildCoreIdentityDeps } = require('./buildCoreIdentityDeps');
const { buildCoreFlowDeps } = require('./buildCoreFlowDeps');

function getRequestMethod(req) {
  return (req.method || 'GET').toUpperCase();
}

function getRequestPathname(req) {
  if (typeof req.path === 'string' && req.path) {
    return req.path;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  return url.pathname;
}

/**
 * Cria o builder de contexto do domínio core.
 *
 * @param {object} localDeps Dependências que ainda pertencem ao runtime do server.js
 * @returns {(req: any, res: any) => object}
 */
function createBuildCoreRoutingContext(localDeps) {
  const {
    validateFlowStructure,
    ensureFlowHasMeta,
    flows,
    persistFlowBestEffort,
    deleteFlowBestEffort,
    sessionEvents,
    saveSessionEventsToFile,
    strictTenantMode,
  } = localDeps;

  return function buildCoreRoutingContext(req, res) {
    return {
      req,
      res,
      method: getRequestMethod(req),
      pathname: getRequestPathname(req),
      ...buildCoreCommonDeps({ req, res, strictTenantMode }),
      ...buildCoreAdminDeps(),
      ...buildCoreIdentityDeps(),
      ...buildCoreFlowDeps({
        validateFlowStructure,
        ensureFlowHasMeta,
        flows,
        persistFlowBestEffort,
        deleteFlowBestEffort,
        sessionEvents,
        saveSessionEventsToFile,
      }),
    };
  };
}

module.exports = {
  createBuildCoreRoutingContext,
};
