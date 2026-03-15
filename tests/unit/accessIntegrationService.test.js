const { buildVendorCommand } = require('../../api/modules/access-control/integrations/accessIntegrationService');

describe('accessIntegrationService', () => {
  it('normaliza envelope para Control iD', () => {
    const result = buildVendorCommand({
      vendor: 'Control iD',
      decision: { decision: 'allow', reason_code: 'allowed_active' },
      device: { id: 'dev-1', model: 'IDBlock' },
      token: 'signed-token',
    });

    expect(result).toEqual({
      vendor: 'control_id',
      deviceId: 'dev-1',
      action: 'ALLOW',
      ttlSec: 120,
      token: 'signed-token',
      metadata: {
        reasonCode: 'allowed_active',
        deviceModel: 'IDBlock',
      },
    });
  });

  it('normaliza envelope para ZKTeco', () => {
    const result = buildVendorCommand({
      vendor: 'ZKTeco',
      decision: { decision: 'deny', reason_code: 'deny_billing_delinquent' },
      device: { id: 'dev-2', model: 'ProFace X' },
      token: 'signed-token',
    });

    expect(result).toEqual({
      vendor: 'zkteco',
      targetDevice: 'dev-2',
      relayCommand: 'KEEP_LOCKED',
      expiresInSeconds: 120,
      token: 'signed-token',
      metadata: {
        reasonCode: 'deny_billing_delinquent',
        deviceModel: 'ProFace X',
      },
    });
  });

  it('gera envelope genérico para vendor desconhecido', () => {
    const result = buildVendorCommand({
      vendor: 'generic-vendor',
      decision: { decision: 'allow', reason_code: 'allowed_active' },
      device: { id: 'dev-3' },
      token: 'signed-token',
    });

    expect(result).toEqual({
      vendor: 'generic-vendor',
      deviceId: 'dev-3',
      action: 'ALLOW',
      token: 'signed-token',
      metadata: {
        reasonCode: 'allowed_active',
      },
    });
  });
});
