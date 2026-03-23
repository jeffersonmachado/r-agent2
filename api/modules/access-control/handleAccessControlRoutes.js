'use strict';

const { handleAccessControlCatalogRoutes } = require('./handleAccessControlCatalogRoutes');
const { handleAccessControlDecisionRoutes } = require('./handleAccessControlDecisionRoutes');

module.exports = { handleAccessControlRoutes };

async function handleAccessControlRoutes({ req, res, method, pathname, deps }) {
  if (!pathname.startsWith('/api/access-control')) return false;
  if (await handleAccessControlCatalogRoutes({ req, res, method, pathname, deps })) return true;
  if (await handleAccessControlDecisionRoutes({ req, res, method, pathname, deps })) return true;
  return false;
}

