/**
 * Coercion safety tests for roiService.js
 * Validates that all String() coercions are protected against hostile objects with malicious getters
 */

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn()
}));

const { getRoiSummary, getFunnelMetrics } = require('../../api/services/roiService');
const { getSequelize } = require('../../api/db/sequelize');

describe('roiService coercion safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock returns object with query method that returns dummy data
    getSequelize.mockReturnValue({
      query: jest.fn().mockResolvedValue([[{ total_orders: 0 }], undefined])
    });
  });

  const createHostileToString = () => {
    const obj = {};
    Object.defineProperty(obj, 'toString', {
      enumerable: false,
      get() {
        throw new Error('Hostile toString getter');
      }
    });
    return obj;
  };

  describe('getRoiSummary - tenantId coercion', () => {
    test('should not throw when tenantId has malicious toString getter', async () => {
      const hostileTenantId = createHostileToString();
      const result = await getRoiSummary({ tenantId: hostileTenantId });
      // Should return gracefully with error status, not throw
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should handle undefined tenantId gracefully', async () => {
      const result = await getRoiSummary({ tenantId: undefined });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('tenant_required');
    });

    test('should handle null tenantId gracefully', async () => {
      const result = await getRoiSummary({ tenantId: null });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('tenant_required');
    });
  });

  describe('getFunnelMetrics - tenantId coercion', () => {
    test('should not throw when tenantId has malicious toString getter', async () => {
      const hostileTenantId = createHostileToString();
      const result = await getFunnelMetrics({ tenantId: hostileTenantId });
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should handle undefined tenantId gracefully', async () => {
      const result = await getFunnelMetrics({ tenantId: undefined });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('tenant_required');
    });
  });

  describe('getSequelize unavailable', () => {
    test('getRoiSummary handles sequelize unavailable', async () => {
      getSequelize.mockReturnValue(null);
      const result = await getRoiSummary({ tenantId: 'test-tenant' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('db_unavailable');
    });

    test('getFunnelMetrics handles sequelize unavailable', async () => {
      getSequelize.mockReturnValue(null);
      const result = await getFunnelMetrics({ tenantId: 'test-tenant' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('db_unavailable');
    });
  });

  describe('query result coercion', () => {
    test('handles empty result set gracefully', async () => {
      const mock = getSequelize();
      mock.query.mockResolvedValue([[], undefined]);
      const result = await getRoiSummary({ tenantId: 'test-tenant' });
      expect(result).toBeDefined();
    });
  });
});
