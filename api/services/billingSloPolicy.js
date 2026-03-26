'use strict';

const BILLING_SLO_TARGETS = Object.freeze({
  maxProblematicRatePct: 20,
  maxChargebackRatePct: 2,
  maxRefundRatePct: 8,
  maxPendingRatePct: 12,
  maxOverdueRatePct: 10,
  maxDeadJobs: 0,
  maxPendingLagSec: 1800,
});

module.exports = {
  BILLING_SLO_TARGETS,
};
