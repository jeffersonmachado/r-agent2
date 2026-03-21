'use strict';

const { createExecutionLedgerRoutes } = require('../../modules/execution-ledger/routes');
const { pickRouteDeps } = require('../shared/pickRouteDeps');

function createExecutionLedgerExpressRouter({ buildExtendedRoutingContext }) {
  return createExecutionLedgerRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);
      return pickRouteDeps(ctx, [
        'requireAuth',
        'requirePermission',
        'sendJson',
        'badRequest',
        'hasJsonContentType',
        'parseJsonBody',
        'logger',
        'logAction',
      ]);
    },
  });
}

module.exports = {
  createExecutionLedgerExpressRouter,
};
