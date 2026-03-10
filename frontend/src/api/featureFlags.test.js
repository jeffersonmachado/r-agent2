import { describe, expect, test, vi, beforeEach } from 'vitest';
import { getTenantFeatureFlag, isTenantFeatureEnabled } from './featureFlags';

const fetchJsonMock = vi.fn();

vi.mock('./client', () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
}));

describe('featureFlags API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('getTenantFeatureFlag chama endpoint esperado', async () => {
    fetchJsonMock.mockResolvedValueOnce({ ok: true, item: { enabled: true } });

    await getTenantFeatureFlag('support_cockpit_enabled');

    expect(fetchJsonMock).toHaveBeenCalledWith('/api/tenant/feature-flags/support_cockpit_enabled', {
      method: 'GET',
    });
  });

  test('isTenantFeatureEnabled respeita fallback em erro', async () => {
    fetchJsonMock.mockRejectedValueOnce(new Error('network_error'));

    await expect(isTenantFeatureEnabled('support_cockpit_enabled', false)).resolves.toBe(false);
  });
});
