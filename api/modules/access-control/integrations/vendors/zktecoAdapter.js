function buildZktecoCommand({ decision, device, token }) {
  return {
    vendor: 'zkteco',
    targetDevice: device?.id || null,
    relayCommand: decision?.decision === 'allow' ? 'OPEN' : 'KEEP_LOCKED',
    expiresInSeconds: 120,
    token: token || null,
    metadata: {
      reasonCode: decision?.reason_code || null,
      deviceModel: device?.model || null,
    },
  };
}

module.exports = {
  buildZktecoCommand,
};
