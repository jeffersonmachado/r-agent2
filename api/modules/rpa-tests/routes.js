'use strict';

const express = require('express');
const { handleRpaTestsRoutes } = require('./handleRpaTestsRoutes');

function createRpaTestsRoutes({ buildDeps }) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
      const handled = await handleRpaTestsRoutes({
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
  createRpaTestsRoutes,
};
