import { describe, expect, it } from 'vitest';

import {
  BPMN_FEATURE_FLAGS,
  getBpmnFeatureFlags,
  isBpmnFeatureEnabled,
} from './bpmnFeatureFlags';

import {
  createBpmnElementRegistry,
  defaultBpmnElementRegistry,
} from './bpmnElementRegistry';

describe('Phase 9 architecture prep', () => {
  describe('bpmnFeatureFlags', () => {
    it('starts with all advanced features disabled by default', () => {
      expect(Object.values(BPMN_FEATURE_FLAGS).every((flag) => flag === false)).toBe(true);
    });

    it('supports safe overrides without mutating defaults', () => {
      const merged = getBpmnFeatureFlags({ ADVANCED_GATEWAYS: true });
      expect(merged.ADVANCED_GATEWAYS).toBe(true);
      expect(BPMN_FEATURE_FLAGS.ADVANCED_GATEWAYS).toBe(false);
    });

    it('evaluates feature enablement by key', () => {
      expect(isBpmnFeatureEnabled('ADVANCED_GATEWAYS')).toBe(false);
      expect(isBpmnFeatureEnabled('ADVANCED_GATEWAYS', { ADVANCED_GATEWAYS: true })).toBe(true);
    });
  });

  describe('bpmnElementRegistry', () => {
    it('allows registering export/import handlers and executing them', () => {
      const registry = createBpmnElementRegistry({ flags: { ADVANCED_GATEWAYS: true } });

      registry.register('bpmn:parallelGateway', {
        onExport: ({ flags }) => ({ mode: 'export', enabled: flags.ADVANCED_GATEWAYS }),
        onImport: ({ flags }) => ({ mode: 'import', enabled: flags.ADVANCED_GATEWAYS }),
      });

      expect(registry.has('bpmn:parallelGateway')).toBe(true);
      expect(registry.runExport('bpmn:parallelGateway')).toEqual({ mode: 'export', enabled: true });
      expect(registry.runImport('bpmn:parallelGateway')).toEqual({ mode: 'import', enabled: true });
    });

    it('returns null when no handler exists', () => {
      const registry = createBpmnElementRegistry();
      expect(registry.runExport('bpmn:laneSet')).toBeNull();
      expect(registry.runImport('bpmn:laneSet')).toBeNull();
    });

    it('validates handler contract', () => {
      const registry = createBpmnElementRegistry();
      expect(() => registry.register('bpmn:laneSet', {})).toThrow();
      expect(() => registry.register('', { onExport: () => ({}) })).toThrow();
    });

    it('keeps a shared default registry instance available', () => {
      expect(defaultBpmnElementRegistry).toBeTruthy();
      expect(Array.isArray(defaultBpmnElementRegistry.listRegisteredElements())).toBe(true);
    });
  });
});
