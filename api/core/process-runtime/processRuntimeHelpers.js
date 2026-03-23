'use strict';

function looksLikeCompiledProcessDefinition(definition) {
  return !!(definition && typeof definition === 'object' && definition.executionGraph && definition.nodes);
}

function looksLikeCanonicalProcessDefinition(definition) {
  return !!(definition && typeof definition === 'object' && Array.isArray(definition.nodes) && Array.isArray(definition.edges));
}

function looksLikeEngineFlow(definition) {
  return !!(
    definition
    && typeof definition === 'object'
    && Array.isArray(definition.nodes)
    && definition.nodes.every((node) => node && typeof node.type === 'string' && Object.prototype.hasOwnProperty.call(node, 'next'))
  );
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeGet(value, key, fallbackValue = undefined) {
  try {
    const result = value?.[key];
    return result === undefined ? fallbackValue : result;
  } catch (_) {
    return fallbackValue;
  }
}

function safeIsArray(value) {
  try {
    return Array.isArray(value);
  } catch (_) {
    return false;
  }
}

function isSafeObjectRecord(value) {
  if (!value || typeof value !== 'object') return false;
  return !safeIsArray(value);
}

function safeShallowCloneRecord(value) {
  if (!isSafeObjectRecord(value)) return {};
  try {
    return { ...value };
  } catch (_) {
    return {};
  }
}

function safeCloneArray(value) {
  if (!safeIsArray(value)) return [];
  try {
    return value.slice();
  } catch (_) {
    return [];
  }
}

function safeToString(value, fallbackValue = '') {
  try {
    return String(value);
  } catch (_) {
    return fallbackValue;
  }
}

function safeFiniteNumber(value, fallbackValue = 0) {
  try {
    const coerced = Number(value);
    return Number.isFinite(coerced) ? coerced : fallbackValue;
  } catch (_) {
    return fallbackValue;
  }
}

function sanitizeRuntimeInput(input) {
  const source = safeShallowCloneRecord(input);
  const sanitized = { ...source };
  sanitized.metadata = safeShallowCloneRecord(safeGet(source, 'metadata'));
  sanitized.variables = safeShallowCloneRecord(safeGet(source, 'variables'));
  sanitized.history = safeCloneArray(safeGet(source, 'history'));

  const executionId = safeGet(source, 'executionId');
  if (executionId != null && executionId !== '') {
    sanitized.executionId = safeToString(executionId, '');
  }

  const tenantId = safeGet(source, 'tenantId');
  if (tenantId != null && tenantId !== '') {
    sanitized.tenantId = safeToString(tenantId, null);
  }

  return sanitized;
}

function buildProcessRegistryKey(processId, processVersion) {
  return `${String(processId || '')}:${Number.isFinite(Number(processVersion)) ? Number(processVersion) : 1}`;
}

module.exports = {
  looksLikeCompiledProcessDefinition,
  looksLikeCanonicalProcessDefinition,
  looksLikeEngineFlow,
  clone,
  safeGet,
  safeShallowCloneRecord,
  safeCloneArray,
  safeToString,
  safeFiniteNumber,
  sanitizeRuntimeInput,
  buildProcessRegistryKey,
};