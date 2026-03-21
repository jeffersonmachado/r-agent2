const { getAllTags, getAllCategories, filterTickets, addTagToTicket, removeTagFromTicket, setTicketCategory, getSegmentationStats } = require('../../services/segmentationService');
const { buildPlatformCommonDeps } = require('./buildPlatformCommonDeps');
const { buildPlatformAdminDeps } = require('./buildPlatformAdminDeps');
const { buildPlatformContentDeps } = require('./buildPlatformContentDeps');
const { buildPlatformPublicDeps } = require('./buildPlatformPublicDeps');
const { buildTicketRouteDeps } = require('../ticket');

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

function createBuildPlatformRoutingContext(localDeps = {}) {
  const {
    requireTenant,
    validateFlowStructure,
    ensureFlowHasMeta,
    persistFlowBestEffort,
    flows,
    detectProcessManager,
  } = localDeps;

  return function buildPlatformRoutingContext(req, res) {
    return {
      req,
      res,
      method: getRequestMethod(req),
      pathname: getRequestPathname(req),
      ...buildPlatformCommonDeps({ req, res, detectProcessManager, requireTenant }),
      ...buildPlatformAdminDeps(),
      ...buildPlatformContentDeps({
        validateFlowStructure,
        ensureFlowHasMeta,
        persistFlowBestEffort,
        flows,
      }),
      ...buildPlatformPublicDeps(),
      getAllTags,
      getAllCategories,
      filterTickets,
      getSegmentationStats,
      addTagToTicket,
      removeTagFromTicket,
      setTicketCategory,
      ticketRouteContext: buildTicketRouteDeps(),
    };
  };
}

module.exports = {
  createBuildPlatformRoutingContext,
};
