// Registry for element-specific import/export handlers.

function normalizeElementName(value) {
  return String(value || '').trim();
}

function isValidHandler(handler) {
  if (!handler || typeof handler !== 'object') return false;
  const hasExport = typeof handler.onExport === 'function';
  const hasImport = typeof handler.onImport === 'function';
  return hasExport || hasImport;
}

export function createBpmnElementRegistry() {
  const handlers = new Map();

  return {
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
      return handler.onExport(context);
    },

    runImport(elementName, context = {}) {
      const handler = this.get(elementName);
      if (!handler || typeof handler.onImport !== 'function') return null;
      return handler.onImport(context);
    },

    listRegisteredElements() {
      return Array.from(handlers.keys());
    },
  };
}

export const defaultBpmnElementRegistry = createBpmnElementRegistry();
