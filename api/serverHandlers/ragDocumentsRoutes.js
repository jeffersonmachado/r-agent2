const { handleRagCoreRoutes } = require('./rag/ragCoreRoutes');
const { handleRagOperationsRoutes } = require('./rag/ragOperationsRoutes');
const { handleRagIngestionRoutes } = require('./rag/ragIngestionRoutes');
const { handleRagQueryRoutes } = require('./rag/ragQueryRoutes');
const { handleRagLearningRoutes } = require('./rag/ragLearningRoutes');

async function handleRagDocumentsRoutes({
  req,
  res,
  method,
  pathname,
  deps,
}) {
  if (!pathname.startsWith('/rag')) {
    return false;
  }

  if (await handleRagOperationsRoutes({ req, res, method, pathname, deps })) return true;
  if (await handleRagIngestionRoutes({ req, res, method, pathname, deps })) return true;
  if (await handleRagCoreRoutes({ req, res, method, pathname, deps })) return true;
  if (await handleRagQueryRoutes({ req, res, method, pathname, deps })) return true;
  if (await handleRagLearningRoutes({ req, res, method, pathname, deps })) return true;

  return false;
}

module.exports = {
  handleRagDocumentsRoutes,
};
