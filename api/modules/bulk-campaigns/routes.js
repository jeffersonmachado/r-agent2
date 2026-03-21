'use strict';

const express = require('express');
const { handleBulkCampaignsRoutes } = require('./handleBulkCampaignsRoutes');

function createBulkCampaignsRoutes({ buildDeps }) {
  const router = express.Router();

  function runHandled(pathnameBuilder) {
    return async (req, res, next) => {
      try {
        const pathname = typeof pathnameBuilder === 'function' ? pathnameBuilder(req) : pathnameBuilder;
        const handled = await handleBulkCampaignsRoutes({
          req,
          res,
          method: (req.method || 'GET').toUpperCase(),
          pathname,
          deps: buildDeps(req, res),
        });
        if (!handled && !res.writableEnded) {
          next();
        }
      } catch (err) {
        next(err);
      }
    };
  }

  router.get('/bulk-campaigns', runHandled('/bulk-campaigns'));
  router.get('/bulk-campaigns/:campaignId', runHandled((req) => `/bulk-campaigns/${encodeURIComponent(req.params.campaignId)}`));
  router.post('/bulk-campaigns', runHandled('/bulk-campaigns'));
  router.put('/bulk-campaigns/:campaignId', runHandled((req) => `/bulk-campaigns/${encodeURIComponent(req.params.campaignId)}`));
  router.delete('/bulk-campaigns/:campaignId', runHandled((req) => `/bulk-campaigns/${encodeURIComponent(req.params.campaignId)}`));
  router.post('/bulk-campaigns/:campaignId/start', runHandled((req) => `/bulk-campaigns/${encodeURIComponent(req.params.campaignId)}/start`));
  router.post('/bulk-campaigns/:campaignId/pause', runHandled((req) => `/bulk-campaigns/${encodeURIComponent(req.params.campaignId)}/pause`));
  router.post('/bulk-campaigns/:campaignId/resume', runHandled((req) => `/bulk-campaigns/${encodeURIComponent(req.params.campaignId)}/resume`));

  return router;
}

module.exports = {
  createBulkCampaignsRoutes,
};
