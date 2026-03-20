'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');
const { handleBulkCampaignsRoutes } = require('../../serverHandlers/bulkCampaignsRoutes');

function createBulkCampaignsRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: handleBulkCampaignsRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createBulkCampaignsRoutes,
};
