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

  describe('getFunnelMetrics - location scope coverage', () => {
    test('returns strict location scope coverage when locationId is provided', async () => {
      const mock = getSequelize();
      mock.query
        .mockResolvedValueOnce([[{ stage: 'visitor', total: 10 }, { stage: 'lead', total: 4 }, { stage: 'customer', total: 1 }], undefined])
        .mockResolvedValueOnce([[{ channel: 'google', total: 4 }], undefined])
        .mockResolvedValueOnce([[{ total_submissions: 3, unique_leads: 2 }], undefined])
        .mockResolvedValueOnce([[{ total_leads: 10, leads_with_location: 6, leads_without_location: 4 }], undefined])
        .mockResolvedValueOnce([[{ total_submissions: 5, submissions_with_location: 3, submissions_without_location: 2 }], undefined])
        .mockResolvedValueOnce([[{ total_orders: 2, total_revenue: 150 }], undefined])
        .mockResolvedValueOnce([[{ source: 'google', total_orders: 2, total_revenue: 150 }], undefined]);

      const result = await getFunnelMetrics({ tenantId: 'tenant-a', windowDays: 30, locationId: 'loja-centro' });

      expect(result.ok).toBe(true);
      expect(result.locationId).toBe('loja-centro');
      expect(result.locationScope).toEqual({
        requested: true,
        mode: 'strict_column',
        field: 'location_id',
        coverage: {
          leads: {
            total: 10,
            withLocation: 6,
            withoutLocation: 4,
            rate: 0.6,
          },
          submissions: {
            total: 5,
            withLocation: 3,
            withoutLocation: 2,
            rate: 0.6,
          },
        },
      });
      expect(result.totals).toMatchObject({
        leads: 15,
        formSubmissions: 3,
        formSubmissionLeads: 2,
        orders: 2,
        revenue: 150,
      });
      expect(result.conversionRates).toMatchObject({
        visitorToLead: 0.4,
        leadToCustomer: 0.25,
      });
      expect(mock.query).toHaveBeenCalledTimes(7);
      expect(mock.query.mock.calls[0][0]).toContain('location_id = :locationId');
      expect(mock.query.mock.calls[2][0]).toContain('mfs.location_id = :locationId');
      expect(mock.query.mock.calls[0][1]).toMatchObject({ replacements: { tenantKey: 'tenant-a', days: 30, locationId: 'loja-centro' } });
    });
  });
});
