'use strict';

const express = require('express');
const { handlePbxRoutes } = require('./handlePbxRoutes');

function runHandled(handler) {
  return async (req, res, next) => {
    const ctx = req.routeContext || req.appRouteContext || {};

    try {
      const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
      const handled = await handler({
        method: req.method,
        pathname,
        params: req.params || {},
        query: req.query || {},
        body: req.body,
        headers: req.headers,
        req,
        res,
        deps: ctx,
      });

      if (!handled && !res.headersSent && !res.writableEnded) {
        next();
      }
    } catch (error) {
      next(error);
    }
  };
}

function createPbxRoutes({ buildDeps }) {
  const router = express.Router();

  router.use((req, res, next) => {
    req.routeContext = buildDeps(req, res);
    next();
  });
  router.use(runHandled(handlePbxRoutes));

  return router;
}

module.exports = {
  createPbxRoutes,
};
