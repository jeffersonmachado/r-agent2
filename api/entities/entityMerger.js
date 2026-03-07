'use strict';

const SOURCE_PRECEDENCE = {
  user: 5,
  enrichment: 5,
  regex: 4,
  llm: 3,
  system: 2,
};

function ensureIso(value) {
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function normalizeEntityItem(raw) {
  if (!raw || typeof raw !== 'object' || !Object.prototype.hasOwnProperty.call(raw, 'value')) {
    return {
      value: raw,
      source: 'system',
      confidence: 0.5,
      updated_at: ensureIso(),
    };
  }

  const source = SOURCE_PRECEDENCE[raw.source] ? raw.source : 'system';
  const confidence = Number.isFinite(Number(raw.confidence))
    ? Math.max(0, Math.min(1, Number(raw.confidence)))
    : 0.5;

  return {
    value: raw.value,
    source,
    confidence,
    updated_at: ensureIso(raw.updated_at),
  };
}

function toList(raw) {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map((item) => normalizeEntityItem(item));
  return [normalizeEntityItem(raw)];
}

function compareEntityStrength(a, b) {
  const aScore = SOURCE_PRECEDENCE[a.source] || 0;
  const bScore = SOURCE_PRECEDENCE[b.source] || 0;
  if (aScore !== bScore) return aScore - bScore;
  if (a.confidence !== b.confidence) return a.confidence - b.confidence;
  const aTs = new Date(a.updated_at).getTime();
  const bTs = new Date(b.updated_at).getTime();
  return aTs - bTs;
}

function isMultiEntityKey(key) {
  return /_ids$|topics?|tags?|products?|plans?|order_id|ticket_id|invoice_id|contract_id/i.test(String(key || ''));
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function selectBest(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return [...items].sort((a, b) => compareEntityStrength(b, a))[0];
}

function collapseValue(key, list) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  if (isMultiEntityKey(key) && list.length > 1) return list;
  return selectBest(list);
}

function mergeKeyValues(key, prevValue, newValue) {
  const existing = toList(prevValue);
  const incoming = toList(newValue);
  if (incoming.length === 0) return existing;

  const merged = [...existing];
  for (const candidate of incoming) {
    const existingIdx = merged.findIndex((item) => sameValue(item.value, candidate.value));
    if (existingIdx >= 0) {
      if (compareEntityStrength(candidate, merged[existingIdx]) > 0) {
        merged[existingIdx] = candidate;
      }
      continue;
    }

    if (isMultiEntityKey(key)) {
      merged.push(candidate);
      continue;
    }

    const bestCurrent = selectBest(merged);
    if (!bestCurrent || compareEntityStrength(candidate, bestCurrent) > 0) {
      merged.splice(0, merged.length, candidate);
    }
  }

  return merged;
}

function mergeEntities(prevEntities = {}, prevMeta = {}, newEntities = {}, newMeta = {}) {
  const entitiesOut = {};
  const metaOut = { ...(prevMeta && typeof prevMeta === 'object' ? prevMeta : {}) };
  const allKeys = new Set([
    ...Object.keys(prevEntities || {}),
    ...Object.keys(newEntities || {}),
  ]);

  for (const key of allKeys) {
    const mergedList = mergeKeyValues(key, prevEntities[key], newEntities[key]);
    const collapsed = collapseValue(key, mergedList);
    if (collapsed !== undefined) {
      entitiesOut[key] = collapsed;
      const strongest = Array.isArray(collapsed) ? selectBest(collapsed) : collapsed;
      const explicitMeta = newMeta && newMeta[key] ? newMeta[key] : null;
      metaOut[key] = {
        source: explicitMeta && explicitMeta.source ? explicitMeta.source : strongest.source,
        confidence: explicitMeta && Number.isFinite(Number(explicitMeta.confidence))
          ? Math.max(0, Math.min(1, Number(explicitMeta.confidence)))
          : strongest.confidence,
        updated_at: ensureIso(explicitMeta && explicitMeta.updated_at ? explicitMeta.updated_at : strongest.updated_at),
      };
    }
  }

  return {
    entities: entitiesOut,
    meta: metaOut,
  };
}

module.exports = {
  SOURCE_PRECEDENCE,
  mergeEntities,
};
