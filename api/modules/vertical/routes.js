'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');
const { handleBeautyRoutes } = require('../../serverHandlers/verticalBeautyRoutes');
const { handleFitnessRoutes } = require('../../serverHandlers/verticalFitnessRoutes');

function createVerticalRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: handleBeautyRoutes,
    buildDeps,
  });

  mountExpressHandler(router, {
    handler: handleFitnessRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createVerticalRoutes,
};
