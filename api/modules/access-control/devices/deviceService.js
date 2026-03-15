const accessControlService = require('../accessControlService');

module.exports = {
  listDevices: accessControlService.listDevices,
  getDevice: accessControlService.getDevice,
  createDevice: accessControlService.createDevice,
  patchDevice: accessControlService.patchDevice,
};
