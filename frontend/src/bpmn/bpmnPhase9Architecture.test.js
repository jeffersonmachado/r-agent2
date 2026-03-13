import { describe, expect, it } from 'vitest';

import {
  createBpmnElementRegistry,
  defaultBpmnElementRegistry,
} from './bpmnElementRegistry';

describe('Phase 9 architecture prep', () => {
  describe('bpmnElementRegistry', () => {
    it('allows registering export/import handlers and executing them', () => {
      const registry = createBpmnElementRegistry();

      registry.register('bpmn:parallelGateway', {
        onExport: () => ({ mode: 'export', enabled: true }),
        onImport: () => ({ mode: 'import', enabled: true }),
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
