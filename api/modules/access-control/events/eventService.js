const accessControlService = require('../accessControlService');

module.exports = {
  listDecisions: accessControlService.listDecisions,
  listEvents: accessControlService.listEvents,
  createEvent: accessControlService.createEvent,
};
