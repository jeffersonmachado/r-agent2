const { handlePublicHealthRoutes } = require('./public-system/publicHealthRoutes');
const { handlePublicMarketingRoutes } = require('./public-system/publicMarketingRoutes');
const { handlePublicProvisioningRoutes } = require('./public-system/publicProvisioningRoutes');
const { handlePublicRuntimeRoutes } = require('./public-system/publicRuntimeRoutes');

async function handlePublicSystemRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { setCorsHeaders, logger } = deps;

  // Handle CORS preflight globally before route-specific checks.
  if (method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return true;
  }

  // Keep legacy debug log for all /metrics requests without claiming the route.
  if (method === 'GET' && pathname.startsWith('/metrics')) {
    logger.debug(`[Server] Requisição GET recebida: ${pathname}`);
  }

  if (await handlePublicHealthRoutes(ctx)) return true;
  if (await handlePublicMarketingRoutes(ctx)) return true;
  if (await handlePublicProvisioningRoutes(ctx)) return true;
  if (await handlePublicRuntimeRoutes(ctx)) return true;

  return false;
}

module.exports = { handlePublicSystemRoutes };
