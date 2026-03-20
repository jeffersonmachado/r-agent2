'use strict';

const { handleRagCoreRoutes } = require('./rag/ragCoreRoutes');
const { handleRagOperationsRoutes } = require('./rag/ragOperationsRoutes');
const { handleRagIngestionRoutes } = require('./rag/ragIngestionRoutes');
const { handleRagQueryRoutes } = require('./rag/ragQueryRoutes');
const { handleRagLearningRoutes } = require('./rag/ragLearningRoutes');
const { handleRagEphemeralRoutes } = require('./rag/ragEphemeralRoutes');

async function handleRagRoutes(ctx) {
  const { pathname } = ctx;

  if (!pathname.startsWith('/rag/')) {
    return false;
  }

  if (await handleRagCoreRoutes(ctx)) return true;
  if (await handleRagOperationsRoutes(ctx)) return true;
  if (await handleRagIngestionRoutes(ctx)) return true;
  if (await handleRagQueryRoutes(ctx)) return true;
  if (await handleRagLearningRoutes(ctx)) return true;
  if (await handleRagEphemeralRoutes(ctx)) return true;

  return false;
}

module.exports = {
  handleRagRoutes,
};
