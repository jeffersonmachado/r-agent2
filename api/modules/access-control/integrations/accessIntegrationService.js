const { buildControlIdCommand } = require('./vendors/controlIdAdapter');
const { buildZktecoCommand } = require('./vendors/zktecoAdapter');

function buildVendorCommand({ vendor, decision, device, token }) {
  const normalized = String(vendor || device?.vendor || '').trim().toLowerCase();
  if (normalized === 'control id' || normalized === 'control_id') {
    return buildControlIdCommand({ decision, device, token });
  }
  if (normalized === 'zkteco') {
    return buildZktecoCommand({ decision, device, token });
  }
  return {
    vendor: normalized || 'generic',
    deviceId: device?.id || null,
    action: decision?.decision === 'allow' ? 'ALLOW' : 'DENY',
    token: token || null,
    metadata: {
      reasonCode: decision?.reason_code || null,
    },
  };
}

module.exports = {
  buildVendorCommand,
};
