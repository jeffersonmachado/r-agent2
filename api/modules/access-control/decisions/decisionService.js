const accessDecisionService = require('../accessDecisionService');
const decisionStatusService = require('./decisionStatusService');

module.exports = {
  resolveDecision: accessDecisionService.resolveDecision,
  resolveQrToken: accessDecisionService.resolveQrToken,
  issueVisitorQr: accessDecisionService.issueVisitorQr,
  getDecisionExecutionStatus: decisionStatusService.getDecisionExecutionStatus,
};
