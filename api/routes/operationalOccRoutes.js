'use strict';

const { composeRouteHandlers } = require('./occ/occShared');
const { handleOccOverviewRoutes } = require('./occ/occOverviewRoutes');
const { handleOccSignalsRoutes } = require('./occ/occSignalsRoutes');
const { handleOccRecommendationsRoutes } = require('./occ/occRecommendationsRoutes');
const { handleOccOutcomesRoutes } = require('./occ/occOutcomesRoutes');

async function handleOperationalOccRoutes({
  req,
  res,
  method,
  pathname,
  deps,
}) {
  return composeRouteHandlers([
    handleOccOverviewRoutes,
    handleOccSignalsRoutes,
    handleOccRecommendationsRoutes,
    handleOccOutcomesRoutes,
  ], {
    req,
    res,
    method,
    pathname,
    deps,
  });
}

module.exports = {
  handleOperationalOccRoutes,
};
