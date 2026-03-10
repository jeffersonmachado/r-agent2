'use strict';

const { OperationalActionsService } = require('./OperationalActionsService');

const operationalActionsService = new OperationalActionsService();

module.exports = {
  OperationalActionsService,
  operationalActionsService,
};
