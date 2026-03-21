const { buildRagRouteDeps } = require('../rag');
const { buildExtendedCommonDeps } = require('./buildExtendedCommonDeps');
const { buildExtendedOperationsDeps } = require('./buildExtendedOperationsDeps');
const { buildExtendedChannelDeps } = require('./buildExtendedChannelDeps');

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

function createBuildExtendedRoutingContext(localDeps = {}) {
  const {
    requireTenant,
    flows,
    sessionEvents,
    saveSessionEventsToFile,
  } = localDeps;

  return function buildExtendedRoutingContext(req, res) {
    return {
      req,
      res,
      method: getRequestMethod(req),
      pathname: getRequestPathname(req),
      ...buildExtendedCommonDeps({ req, res, requireTenant }),
      ...buildExtendedOperationsDeps(),
      ...buildExtendedChannelDeps({
        flows,
        sessionEvents,
        saveSessionEventsToFile,
      }),
      ragRouteContext: buildRagRouteDeps(),
    };
  };
}

module.exports = {
  createBuildExtendedRoutingContext,
};
