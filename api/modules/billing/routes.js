'use strict';

const express = require('express');
const { handleBillingRoutes } = require('./handleBillingRoutes');

function createBillingRoutes() {
  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
      const handled = await handleBillingRoutes({
        req,
        res,
        method: (req.method || 'GET').toUpperCase(),
        pathname,
      });
      if (!handled && !res.writableEnded) next();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = {
  createBillingRoutes,
};
