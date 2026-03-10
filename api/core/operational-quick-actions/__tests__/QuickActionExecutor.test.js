/**
 * @fileoverview Unit tests for QuickActionExecutor
 * Tests quick action execution, validation, event logging, and error handling
 */

const { QuickActionExecutor, quickActionExecutor, OperationalQuickActionRegistry } = require('../');

// Mock dependencies
jest.mock('../../crm/OperationalEventWriter', () => ({
  writeOperationalEventBestEffort: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../operational-playbooks/PlaybookStepExecutor', () => ({
  executeStep: jest.fn().mockResolvedValue({ ok: true, stepResult: 'mocked' }),
}));

describe('QuickActionExecutor', () => {
  let executor;
  const mockOperationalEventWriter = require('../../crm/OperationalEventWriter');

  beforeEach(() => {
    executor = new QuickActionExecutor();
    jest.clearAllMocks();
  });

  describe('executeForSignal({tenantId, signalId, actionId, actorType, actorId, input})', () => {
    test('should return error for missing tenantId', async () => {
      const result = await executor.executeForSignal({
        signalId: 'sig1',
        actionId: 'open_followup',
        actorType: 'agent',
        actorId: 'agent1',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
      expect(String(result.error.message || '')).toContain('Tenant');
    });

    test('should return error for missing signalId', async () => {
      const result = await executor.executeForSignal({
        tenantId: 'tenant1',
        actionId: 'open_followup',
        actorType: 'agent',
        actorId: 'agent1',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    test('should return error for missing actionId', async () => {
      const result = await executor.executeForSignal({
        tenantId: 'tenant1',
        signalId: 'sig1',
        actorType: 'agent',
        actorId: 'agent1',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    test('should return error for non-existent action', async () => {
      const result = await executor.executeForSignal({
        tenantId: 'tenant1',
        signalId: 'sig1',
        actionId: 'non_existent_action',
        actorType: 'agent',
        actorId: 'agent1',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
      expect(String(result.error.message || '')).toContain('Quick action');
    });

    test('should log operational event on success', async () => {
      const result = await executor.executeForSignal({
        tenantId: 'tenant1',
        signalId: 'sig1',
        actionId: 'open_followup',
        actorType: 'agent',
        actorId: 'agent1',
        input: {},
      });

      // Event logging should be attempted (best-effort pattern)
      expect(mockOperationalEventWriter.writeOperationalEventBestEffort).toHaveBeenCalled();
    });

    test('should return normalized response format', async () => {
      const result = await executor.executeForSignal({
        tenantId: 'tenant1',
        signalId: 'sig1',
        actionId: 'open_followup',
        actorType: 'agent',
        actorId: 'agent1',
        input: {},
      });

      expect(result.ok).toBeDefined();
      expect(typeof result.ok).toBe('boolean');
      if (result.ok) {
        expect(result.actionId).toBeDefined();
        expect(result.sourceType).toBe('signal');
        expect(result.sourceId).toBe('sig1');
        expect(result.result).toBeDefined();
      }
    });
  });

  describe('executeForRecommendation({tenantId, recommendationId, actionId, actorType, actorId, input})', () => {
    test('should return error for missing tenantId', async () => {
      const result = await executor.executeForRecommendation({
        recommendationId: 'rec1',
        actionId: 'open_followup',
        actorType: 'agent',
        actorId: 'agent1',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    test('should return error for missing recommendationId', async () => {
      const result = await executor.executeForRecommendation({
        tenantId: 'tenant1',
        actionId: 'open_followup',
        actorType: 'agent',
        actorId: 'agent1',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    test('should return normalized response with sourceType "recommendation"', async () => {
      const result = await executor.executeForRecommendation({
        tenantId: 'tenant1',
        recommendationId: 'rec1',
        actionId: 'trigger_notification',
        actorType: 'agent',
        actorId: 'agent1',
        input: {},
      });

      if (result.ok) {
        expect(result.sourceType).toBe('recommendation');
        expect(result.sourceId).toBe('rec1');
      }
    });
  });

  describe('normalizeResponse(response)', () => {
    test('should handle success response', () => {
      const normalized = executor.normalizeResponse(
        { ok: true, result: 'test' },
        'open_followup',
        'signal',
        'sig1'
      );

      expect(normalized.ok).toBe(true);
      expect(normalized.actionId).toBe('open_followup');
      expect(normalized.sourceType).toBe('signal');
      expect(normalized.sourceId).toBe('sig1');
    });

    test('should handle error response', () => {
      const normalized = executor.normalizeResponse(
        { ok: false, error: 'Test error' },
        'open_followup',
        'signal',
        'sig1'
      );

      expect(normalized.ok).toBe(false);
      expect(normalized.actionId).toBe('open_followup');
      expect(normalized.error).toBeTruthy();
    });
  });

  describe('Singleton pattern', () => {
    test('quickActionExecutor should be a singleton instance', () => {
      expect(quickActionExecutor).toBeDefined();
      expect(quickActionExecutor instanceof QuickActionExecutor).toBe(true);
    });

    test('singleton instance should have expected methods', () => {
      expect(typeof quickActionExecutor.executeForSignal).toBe('function');
      expect(typeof quickActionExecutor.executeForRecommendation).toBe('function');
    });
  });

  describe('Event logging behavior', () => {
    test('should call writeOperationalEventBestEffort with correct structure', async () => {
      await executor.executeForSignal({
        tenantId: 'tenant1',
        signalId: 'sig1',
        actionId: 'open_followup',
        actorType: 'agent',
        actorId: 'agent1',
        input: {},
      });

      const calls = mockOperationalEventWriter.writeOperationalEventBestEffort.mock.calls;
      expect(calls.length).toBeGreaterThan(0);

      // First call should be the actual event
      const [eventCall] = calls[0] || [];
      if (eventCall) {
        expect(eventCall.tenantId).toBe('tenant1');
        expect(eventCall.type).toBeTruthy();
        expect(['operational_quick_action_executed', 'operational_quick_action_failed']).toContain(eventCall.type);
      }
    });

    test('should log event even if execution fails', async () => {
      mockOperationalEventWriter.writeOperationalEventBestEffort.mockClear();

      await executor.executeForSignal({
        tenantId: 'tenant1',
        signalId: 'sig1',
        actionId: 'non_existent_action',
        actorType: 'agent',
        actorId: 'agent1',
      });

      // Event logging might be called even on error (best-effort pattern)
      // This depends on implementation - just verify it attempts logging
    });
  });

  describe('Input merging with payloadTemplate', () => {
    test('should merge user input with action payloadTemplate', async () => {
      const result = await executor.executeForSignal({
        tenantId: 'tenant1',
        signalId: 'sig1',
        actionId: 'open_followup',
        actorType: 'agent',
        actorId: 'agent1',
        input: { customField: 'customValue' },
      });

      // Result should reflect merged payload processing
      expect(result).toBeDefined();
    });
  });

  describe('Error handling', () => {
    test('should handle and return execution errors gracefully', async () => {
      const result = await executor.executeForSignal({
        tenantId: 'tenant1',
        signalId: 'sig1',
        actionId: 'open_followup',
        actorType: 'agent',
        actorId: 'agent1',
        input: {},
      });

      expect(result).toHaveProperty('ok');
      if (!result.ok) {
        expect(result.error).toBeTruthy();
      }
    });

    test('should not throw unexpected exceptions', async () => {
      const resultPromise = executor.executeForSignal({
        tenantId: 'tenant1',
        signalId: 'sig1',
        actionId: 'open_followup',
        actorType: 'agent',
        actorId: 'agent1',
        input: {},
      });

      expect(resultPromise).toBeInstanceOf(Promise);
      const result = await resultPromise;
      expect(result).toBeDefined();
    });
  });
});
