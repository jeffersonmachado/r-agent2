'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');
const { handleRagOperationsRoutes } = require('../../serverHandlers/rag/ragOperationsRoutes');
const { handleRagIngestionRoutes } = require('../../serverHandlers/rag/ragIngestionRoutes');
const { handleRagCoreRoutes } = require('../../serverHandlers/rag/ragCoreRoutes');
const { handleRagQueryRoutes } = require('../../serverHandlers/rag/ragQueryRoutes');
const { handleRagLearningRoutes } = require('../../serverHandlers/rag/ragLearningRoutes');

function createRagDocumentsRoutes({ buildDeps }) {
  const router = express.Router();

  [
    handleRagOperationsRoutes,
    handleRagIngestionRoutes,
    handleRagCoreRoutes,
    handleRagQueryRoutes,
    handleRagLearningRoutes,
  ].forEach((handler) => {
    mountExpressHandler(router, {
      handler,
      buildDeps,
    });
  });

  return router;
}

module.exports = {
  createRagDocumentsRoutes,
};
