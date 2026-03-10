'use strict';

jest.mock('../../../services/tenantFeatureService', () => ({
  isEnabled: jest.fn(),
}));

const tenantFeatureService = require('../../../services/tenantFeatureService');
const { isOperationalFeatureEnabled } = require('../featureGates');

describe('operational-state feature gates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('retorna gate ON quando tenantFeatureService resolve true', async () => {
    tenantFeatureService.isEnabled.mockResolvedValueOnce(true);

    await expect(isOperationalFeatureEnabled('tenant-1', 'support_cockpit_enabled', false)).resolves.toBe(true);
  });

  test('usa fallback default quando gate não existir ou tenant estiver ausente', async () => {
    await expect(isOperationalFeatureEnabled('', 'support_cockpit_enabled', true)).resolves.toBe(true);
    expect(tenantFeatureService.isEnabled).not.toHaveBeenCalled();
  });

  test('faz fallback seguro quando provider falha', async () => {
    tenantFeatureService.isEnabled.mockRejectedValueOnce(new Error('redis down'));

    await expect(isOperationalFeatureEnabled('tenant-1', 'operational_decision_engine_enabled', false)).resolves.toBe(false);
  });
});
