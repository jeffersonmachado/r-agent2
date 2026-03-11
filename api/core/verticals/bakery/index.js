'use strict';

const { BakeryOperationsAdapter } = require('./BakeryOperationsAdapter');
const { BAKERY_EVENTS } = require('./bakeryEvents');
const { BAKERY_DECISION_POLICIES, BAKERY_DECISION_WORKFLOW } = require('./bakeryPolicies');
const { BAKERY_KPI_SET, BAKERY_KPI_AUTOMATIONS } = require('./bakeryKpis');

/**
 * Bakery Vertical Exports
 */
module.exports = {
  BakeryOperationsAdapter,
  BAKERY_EVENTS,
  BAKERY_DECISION_POLICIES,
  BAKERY_DECISION_WORKFLOW,
  BAKERY_KPI_SET,
  BAKERY_KPI_AUTOMATIONS,
};
