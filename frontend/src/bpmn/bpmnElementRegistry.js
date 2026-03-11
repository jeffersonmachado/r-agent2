import { getBpmnFeatureFlags } from './bpmnFeatureFlags';

// Phase 9 prep: registry for optional element-specific import/export handlers.
// This allows introducing advanced BPMN support incrementally without touching
// core parser/exporter switches for every new element.

function normalizeElementName(value) {
  return String(value || '').trim();
}

function isValidHandler(handler) {
  if (!handler || typeof handler !== 'object') return false;
  const hasExport = typeof handler.onExport === 'function';
  const hasImport = typeof handler.onImport === 'function';
  return hasExport || hasImport;
}

export function createBpmnElementRegistry(options = {}) {
  const flags = getBpmnFeatureFlags(options.flags);
  const handlers = new Map();

  return {
    flags,

    register(elementName, handler) {
      const key = normalizeElementName(elementName);
      if (!key) {
        throw new Error('BPMN registry: elementName is required.');
      }
      if (!isValidHandler(handler)) {
        throw new Error('BPMN registry: handler must define onExport and/or onImport.');
      }
      handlers.set(key, handler);
      return this;
    },

    has(elementName) {
      return handlers.has(normalizeElementName(elementName));
    },

    get(elementName) {
      return handlers.get(normalizeElementName(elementName)) || null;
    },

    runExport(elementName, context = {}) {
      const handler = this.get(elementName);
      if (!handler || typeof handler.onExport !== 'function') return null;
      return handler.onExport({ ...context, flags });
    },

    runImport(elementName, context = {}) {
      const handler = this.get(elementName);
      if (!handler || typeof handler.onImport !== 'function') return null;
      return handler.onImport({ ...context, flags });
    },

    listRegisteredElements() {
      return Array.from(handlers.keys());
    },
  };
}

export const defaultBpmnElementRegistry = createBpmnElementRegistry();
