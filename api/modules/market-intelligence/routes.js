'use strict';

const express = require('express');
const { handleMarketIntelligenceRoutes } = require('./handleMarketIntelligenceRoutes');

function createMarketIntelligenceRoutes({ buildDeps }) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
      const handled = await handleMarketIntelligenceRoutes({
        req,
        res,
        method: (req.method || 'GET').toUpperCase(),
        pathname,
        deps: buildDeps(req, res),
      });
      if (!handled && !res.writableEnded) {
        next();
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = {
  createMarketIntelligenceRoutes,
};
