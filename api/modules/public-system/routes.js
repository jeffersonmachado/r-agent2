'use strict';

const express = require('express');
const { handlePublicHealthRoutes } = require('./publicHealthRoutes');
const { handlePublicMarketingRoutes } = require('./publicMarketingRoutes');
const { handlePublicProvisioningRoutes } = require('./publicProvisioningRoutes');
const { handlePublicRuntimeRoutes } = require('./publicRuntimeRoutes');

function createPublicSystemRoutes({ buildDeps }) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
    const deps = buildDeps(req, res);
    const ctx = { req, res, method: req.method, pathname, deps };

    if (req.method === 'OPTIONS') {
      deps.setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/metrics')) {
      deps.logger.debug(`[Server] Requisição GET recebida: ${pathname}`);
    }

    if (await handlePublicHealthRoutes(ctx)) return;
    if (await handlePublicMarketingRoutes(ctx)) return;
    if (await handlePublicProvisioningRoutes(ctx)) return;
    if (await handlePublicRuntimeRoutes(ctx)) return;

    next();
  });

  return router;
}

module.exports = {
  createPublicSystemRoutes,
};
