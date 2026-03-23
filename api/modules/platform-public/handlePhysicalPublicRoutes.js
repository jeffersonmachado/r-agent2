const {
  handlePhysicalAccessControlPublicRoutes,
} = require('./handlePhysicalAccessControlPublicRoutes');
const { handlePhysicalKioskPanelRoutes } = require('./handlePhysicalKioskPanelRoutes');

async function handlePhysicalPublicRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    checkRateLimit,
    logAction,
  } = deps;

  const routeContext = {
    req,
    res,
    method,
    pathname,
    deps: {
      sendJson,
      badRequest,
      hasJsonContentType,
      parseJsonBody,
      logger,
      checkRateLimit,
      logAction,
    },
  };

  const kioskHandled = await handlePhysicalKioskPanelRoutes(routeContext);
  if (kioskHandled) return true;

  const accessControlHandled = await handlePhysicalAccessControlPublicRoutes(routeContext);
  if (accessControlHandled) return true;

  return false;
}

module.exports = {
  handlePhysicalPublicRoutes,
};
