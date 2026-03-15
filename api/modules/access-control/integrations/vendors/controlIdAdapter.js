function buildControlIdCommand({ decision, device, token }) {
  return {
    vendor: 'control_id',
    deviceId: device?.id || null,
    action: decision?.decision === 'allow' ? 'ALLOW' : 'DENY',
    ttlSec: 120,
    token: token || null,
    metadata: {
      reasonCode: decision?.reason_code || null,
      deviceModel: device?.model || null,
    },
  };
}

module.exports = {
  buildControlIdCommand,
};
