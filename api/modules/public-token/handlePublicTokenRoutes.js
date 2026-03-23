'use strict';

const { handlePublicTokenCrudRoutes } = require('./handlePublicTokenCrudRoutes');
const { handlePublicTokenLifecycleRoutes } = require('./handlePublicTokenLifecycleRoutes');

module.exports = { handlePublicTokenRoutes };

async function handlePublicTokenRoutes({ req, res, method, pathname, deps }) {
  if (!pathname.startsWith('/public-tokens')) return false;
  if (await handlePublicTokenCrudRoutes({ req, res, method, pathname, deps })) return true;
  if (await handlePublicTokenLifecycleRoutes({ req, res, method, pathname, deps })) return true;
  return false;
}
