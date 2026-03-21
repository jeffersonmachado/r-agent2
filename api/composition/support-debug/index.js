'use strict';

const { createSupportDebugRoutes } = require('../../modules/support-debug/routes');
const { pickRouteDeps } = require('../shared/pickRouteDeps');

function createSupportDebugExpressRouter({ buildExtendedRoutingContext }) {
  return createSupportDebugRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);
      return pickRouteDeps(ctx, [
        'requireAuth',
        'sendJson',
        'parseJsonBody',
        'scheduleService',
        'extractSemanticContext',
        'logger',
        'nlpExtractKeywords',
        'nlpAnalyzeText',
      ]);
    },
  });
}

module.exports = {
  createSupportDebugExpressRouter,
};
