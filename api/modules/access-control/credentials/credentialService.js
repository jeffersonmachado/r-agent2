const accessControlService = require('../accessControlService');

module.exports = {
  listCredentials: accessControlService.listCredentials,
  createCredential: accessControlService.createCredential,
  patchCredential: accessControlService.patchCredential,
};
