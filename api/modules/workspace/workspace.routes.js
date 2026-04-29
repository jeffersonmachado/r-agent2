'use strict';

const express = require('express');
const { createWorkspaceService } = require('./workspace.service');
const { createWorkspaceController } = require('./workspace.controller');

function createWorkspaceRoutes({ buildDeps }) {
  const router = express.Router();
  const service = createWorkspaceService();
  const controllerFor = (req, res) => createWorkspaceController({ service, deps: buildDeps(req, res) });

  router.get('/workspace/entities', (req, res) => controllerFor(req, res).listEntities(req, res));
  router.get('/workspace/entities/:id/timeline', (req, res) => controllerFor(req, res).timeline(req, res));
  router.get('/workspace/entities/:id/insights', (req, res) => controllerFor(req, res).insights(req, res));
  router.get('/workspace/entities/:id/actions', (req, res) => controllerFor(req, res).actions(req, res));
  router.post('/workspace/entities/:id/actions/auto', (req, res) => controllerFor(req, res).executeSuggestedActions(req, res));
  router.get('/workspace/entities/:id', (req, res) => controllerFor(req, res).getEntity(req, res));
  router.post('/workspace/entities', (req, res) => controllerFor(req, res).createEntity(req, res));
  router.post('/workspace/links', (req, res) => controllerFor(req, res).linkEntity(req, res));
  router.post('/workspace/actions', (req, res) => controllerFor(req, res).createAction(req, res));

  router.get('/workspace/tasks', (req, res) => controllerFor(req, res).listTasks(req, res));
  router.post('/workspace/tasks', (req, res) => controllerFor(req, res).createTask(req, res));

  router.get('/timesheet', (req, res) => controllerFor(req, res).listTimesheet(req, res));
  router.post('/timesheet', (req, res) => controllerFor(req, res).createTimesheet(req, res));

  router.get('/resources', (req, res) => controllerFor(req, res).listResources(req, res));
  router.post('/resources', (req, res) => controllerFor(req, res).createResource(req, res));
  router.post('/resources/availability', (req, res) => controllerFor(req, res).createResourceAvailability(req, res));
  router.get('/resource-bookings', (req, res) => controllerFor(req, res).listResourceBookings(req, res));
  router.post('/resource-bookings', (req, res) => controllerFor(req, res).createResourceBooking(req, res));

  router.get('/payment-events', (req, res) => controllerFor(req, res).listPayments(req, res));
  router.post('/payment-events', (req, res) => controllerFor(req, res).createPayment(req, res));

  return router;
}

module.exports = { createWorkspaceRoutes };
