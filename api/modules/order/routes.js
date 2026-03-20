'use strict';

const express = require('express');
const orderService = require('../../services/orderService');
const deliveryService = require('../../services/deliveryService');
const dbModels = require('../../db/models');
const eventLedgerService = require('../../services/eventLedgerService');
const { createOrderService } = require('./service');
const { createOrderController } = require('./controller');

function createOrderRoutes({ buildDeps }) {
  const router = express.Router();
  const service = createOrderService({
    orderService,
    deliveryService,
    dbModels,
    eventLedgerService,
  });

  function controllerFor(req, res) {
    return createOrderController({
      service,
      deps: buildDeps(req, res),
    });
  }

  router.get('/orders', (req, res) => controllerFor(req, res).list(req, res));
  router.get('/orders/:orderId', (req, res) => controllerFor(req, res).getOrder(req, res));
  router.get('/deliveries/:deliveryId', (req, res) => controllerFor(req, res).getDelivery(req, res));
  router.put('/deliveries/:deliveryId/status', (req, res) => controllerFor(req, res).updateDeliveryStatus(req, res));
  router.put('/orders/:orderId/status', (req, res) => controllerFor(req, res).updateOrderStatus(req, res));
  router.post('/orders/:orderId/incidents', (req, res) => controllerFor(req, res).createIncident(req, res));

  return router;
}

module.exports = {
  createOrderRoutes,
};
