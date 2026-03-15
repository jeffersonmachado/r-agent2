const accessControlService = require('../accessControlService');

module.exports = {
  listPolicies: accessControlService.listPolicies,
  createPolicy: accessControlService.createPolicy,
  patchPolicy: accessControlService.patchPolicy,
};
