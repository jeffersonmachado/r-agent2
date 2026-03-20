'use strict';

const express = require('express');
const authService = require('../../services/authService');
const departmentsService = require('../../services/departmentsService');
const scheduleService = require('../../services/scheduleService');
const { MarketingLead } = require('../../db/models');
const { createSchedulingSupportService } = require('./service');
const { createSchedulingSupportController } = require('./controller');

function createSchedulingSupportRoutes({ buildDeps }) {
  const router = express.Router();
  const service = createSchedulingSupportService({
    authService,
    departmentsService,
    scheduleService,
    MarketingLead,
  });

  function controllerFor(req, res) {
    return createSchedulingSupportController({
      service,
      deps: buildDeps(req, res),
    });
  }

  router.get('/api/users/search', (req, res) => controllerFor(req, res).searchUsers(req, res));
  router.get('/api/teams/search', (req, res) => controllerFor(req, res).searchTeams(req, res));
  router.get('/api/schedule-purposes', (req, res) => controllerFor(req, res).listPurposes(req, res));
  router.get('/api/crm/contacts', (req, res) => controllerFor(req, res).listCrmContacts(req, res));
  router.get('/api/calendar/me', (req, res) => controllerFor(req, res).getMyCalendar(req, res));
  router.get('/api/calendar/resource/:resourceId', (req, res) => controllerFor(req, res).getResourceCalendar(req, res));
  router.post('/api/calendar/resource/:resourceId/blocks', (req, res) => controllerFor(req, res).createBlock(req, res));
  router.delete('/api/calendar/resource/:resourceId/blocks/:blockId', (req, res) => controllerFor(req, res).deleteBlock(req, res));

  return router;
}

module.exports = {
  createSchedulingSupportRoutes,
};
