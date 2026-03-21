'use strict';

const express = require('express');
const { handleDevManagementRoutes } = require('./handleDevManagementRoutes');

function createDevManagementRoutes({ buildDeps }) {
  const router = express.Router();

  async function devManagementAdapter(req, res, next) {
    try {
      const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
      const handled = await handleDevManagementRoutes({
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
  }

  router.use('/dev', devManagementAdapter);

  return router;
}

module.exports = {
  createDevManagementRoutes,
};
