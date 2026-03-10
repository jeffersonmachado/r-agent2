/**
 * @fileoverview Unit tests for OperationalQuickActionRegistry
 */

const {
  OperationalQuickActionRegistry,
  quickActionRegistry,
  QUICK_ACTIONS,
  SIGNAL_ACTION_MAP,
  RECOMMENDATION_ACTION_MAP,
} = require('../OperationalQuickActionRegistry');

describe('OperationalQuickActionRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new OperationalQuickActionRegistry();
  });

  describe('configuration integrity', () => {
    test('exports quick actions and maps', () => {
      expect(QUICK_ACTIONS).toBeDefined();
      expect(SIGNAL_ACTION_MAP).toBeDefined();
      expect(RECOMMENDATION_ACTION_MAP).toBeDefined();
      expect(typeof QUICK_ACTIONS).toBe('object');
    });

    test('all mapped action IDs exist in QUICK_ACTIONS', () => {
      const actionIds = new Set(Object.keys(QUICK_ACTIONS));

      Object.values(SIGNAL_ACTION_MAP).forEach((mappedIds) => {
        mappedIds.forEach((actionId) => {
          expect(actionIds.has(actionId)).toBe(true);
        });
      });

      Object.values(RECOMMENDATION_ACTION_MAP).forEach((mappedIds) => {
        mappedIds.forEach((actionId) => {
          expect(actionIds.has(actionId)).toBe(true);
        });
      });
    });

    test('each action has required fields', () => {
      const actions = registry.listAllActions();
      expect(actions.length).toBeGreaterThan(0);

      actions.forEach((action) => {
        expect(typeof action.id).toBe('string');
        expect(action.id.length).toBeGreaterThan(0);
        expect(typeof action.label).toBe('string');
        expect(['contact', 'tenant']).toContain(action.targetType);
        expect(Array.isArray(action.allowedSources)).toBe(true);
        expect(['playbook_step', 'service_call', 'event_emit', 'navigation']).toContain(action.executorType);
        expect(typeof action.icon).toBe('string');
        expect(['primary', 'secondary', 'warning', 'error', 'info']).toContain(action.variant);
        expect(action.payloadTemplate && typeof action.payloadTemplate).toBe('object');
      });
    });
  });

  describe('signal and recommendation lookups', () => {
    test('returns actions for known signal type', () => {
      const actions = registry.getActionsForSignal({ id: 'sig-1', type: 'customer_reactivation' });
      expect(Array.isArray(actions)).toBe(true);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some((a) => a.id === 'open_followup')).toBe(true);
      actions.forEach((action) => {
        expect(action.allowedSources).toContain('customer_reactivation');
      });
    });

    test('returns empty for unknown signal type', () => {
      const actions = registry.getActionsForSignal({ id: 'sig-2', type: 'unknown_signal_type' });
      expect(actions).toEqual([]);
    });

    test('returns actions for known recommendation type', () => {
      const actions = registry.getActionsForRecommendation({ id: 'rec-1', type: 'upsell_opportunity' });
      expect(Array.isArray(actions)).toBe(true);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some((a) => a.id === 'create_opportunity')).toBe(true);
      actions.forEach((action) => {
        expect(action.allowedSources).toContain('upsell_opportunity');
      });
    });

    test('returns empty for unknown recommendation type', () => {
      const actions = registry.getActionsForRecommendation({ id: 'rec-2', type: 'unknown_recommendation' });
      expect(actions).toEqual([]);
    });

    test('resolves canonical recommendation type to executable quick actions', () => {
      const actions = registry.getActionsForRecommendation({ id: 'rec-3', type: 'schedule_contact' });
      expect(Array.isArray(actions)).toBe(true);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some((a) => a.id === 'schedule_callback')).toBe(true);
    });
  });

  describe('helpers', () => {
    test('getActionById returns action or null', () => {
      expect(registry.getActionById('open_followup')?.id).toBe('open_followup');
      expect(registry.getActionById('schedule_contact')?.id).toBe('schedule_callback');
      expect(registry.getActionById('non_existent_action')).toBeNull();
    });

    test('hasActionsForSignalType / hasActionsForRecommendationType', () => {
      expect(registry.hasActionsForSignalType('customer_reactivation')).toBe(true);
      expect(registry.hasActionsForSignalType('unknown_signal')).toBe(false);

      expect(registry.hasActionsForRecommendationType('upsell_opportunity')).toBe(true);
      expect(registry.hasActionsForRecommendationType('unknown_recommendation')).toBe(false);
    });

    test('isActionAllowedForSource validates allowedSources', () => {
      expect(registry.isActionAllowedForSource('open_followup', 'customer_reactivation')).toBe(true);
      expect(registry.isActionAllowedForSource('open_followup', 'high_cancel_rate')).toBe(false);
      expect(registry.isActionAllowedForSource('non_existent_action', 'customer_reactivation')).toBe(false);
    });
  });

  describe('singleton', () => {
    test('exports singleton instance', () => {
      expect(quickActionRegistry).toBeDefined();
      expect(quickActionRegistry instanceof OperationalQuickActionRegistry).toBe(true);
    });
  });
});
