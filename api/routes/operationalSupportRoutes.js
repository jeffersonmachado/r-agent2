'use strict';

const { composeRouteHandlers } = require('./support/shared');
const { handleOperationalSupportCoreRoutes } = require('./support/operationalSupportCoreRoutes');
const { handleOperationalQuickActionRoutes } = require('./support/operationalQuickActionRoutes');
const { handleOperationalPlaybookRoutes } = require('./support/operationalPlaybookRoutes');

async function handleOperationalSupportRoutes({
  req,
  res,
  method,
  pathname,
  deps,
}) {
  return composeRouteHandlers([
    handleOperationalSupportCoreRoutes,
    handleOperationalQuickActionRoutes,
    handleOperationalPlaybookRoutes,
  ], {
    req,
    res,
    method,
    pathname,
    deps,
  });
}

module.exports = {
  handleOperationalSupportRoutes,
};
