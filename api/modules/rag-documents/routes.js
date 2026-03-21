'use strict';

const express = require('express');
const { handleRagOperationsRoutes } = require('./rag/ragOperationsRoutes');
const { handleRagIngestionRoutes } = require('./rag/ragIngestionRoutes');
const { handleRagCoreRoutes } = require('./rag/ragCoreRoutes');
const { handleRagQueryRoutes } = require('./rag/ragQueryRoutes');
const { handleRagLearningRoutes } = require('./rag/ragLearningRoutes');

function createRagDocumentsRoutes({ buildDeps }) {
  const router = express.Router();

  [
    handleRagOperationsRoutes,
    handleRagIngestionRoutes,
    handleRagCoreRoutes,
    handleRagQueryRoutes,
    handleRagLearningRoutes,
  ].forEach((handler) => {
    router.use(async (req, res, next) => {
      try {
        const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
        const handled = await handler({
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
  });

  return router;
}

module.exports = {
  createRagDocumentsRoutes,
};
