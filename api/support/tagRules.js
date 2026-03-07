'use strict';

const REQUIRED_NAMESPACES = ['intent', 'severity'];
const GLOBAL_NAMESPACES = ['intent', 'severity', 'topic', 'state', 'action'];
const MODULE_NAMESPACES = ['crm', 'billing', 'tech', 'voice', 'rag'];
const ALL_NAMESPACES = [...GLOBAL_NAMESPACES, ...MODULE_NAMESPACES];
const SINGLE_VALUE_NAMESPACES = ['intent', 'severity'];

const NAMESPACE_ALIASES = {
  intent: 'intent',
  intencao: 'intent',
  intencoes: 'intent',
  intention: 'intent',
  severity: 'severity',
  severidade: 'severity',
  topic: 'topic',
  tema: 'topic',
  topico: 'topic',
  assunto: 'topic',
};

const UNKNOWN_VALUES = new Set([
  'unknown',
  'unk',
  'undefined',
  'none',
  'null',
  'na',
  'n_a',
  'n_d',
  'nao_informado',
  'nao_definido',
  'indefinido',
  'indefinida',
  'sem_dados',
  'sem_informacao',
  'vazio',
]);

function normalizeChunk(value) {
  const ascii = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return String(ascii || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_:\-]/g, '');
}

function mapNamespaceAliases(namespace) {
  const normalized = normalizeChunk(namespace).replace(/:+/g, '').replace(/_+/g, '_');
  const compact = normalized.replace(/_/g, '');
  if (!compact) return '';
  if (Object.prototype.hasOwnProperty.call(NAMESPACE_ALIASES, compact)) {
    return NAMESPACE_ALIASES[compact];
  }
  if (ALL_NAMESPACES.includes(normalized)) return normalized;
  return normalized;
}

function isUnknownValue(namespace, value) {
  const ns = mapNamespaceAliases(namespace);
  const normalizedValue = normalizeChunk(value).replace(/:+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!normalizedValue) return true;
  if (UNKNOWN_VALUES.has(normalizedValue)) return true;
  if (ns === 'intent' && ['other', 'outro'].includes(normalizedValue)) return true;
  return false;
}

function parseTag(input, options = {}) {
  const sourceFromOptions = options && options.source ? String(options.source) : null;
  if (input === null || input === undefined) return null;

  if (typeof input === 'object' && !Array.isArray(input)) {
    if (typeof input.tag === 'string') {
      return parseTag(input.tag, { source: input.source || sourceFromOptions });
    }
    const namespaceRaw = input.ns ?? input.namespace ?? input.key ?? input.name;
    const valueRaw = input.value ?? input.tagValue ?? input.label ?? input.val;
    if (namespaceRaw === null || namespaceRaw === undefined) return null;
    const namespace = mapNamespaceAliases(namespaceRaw);
    const value = normalizeChunk(valueRaw).replace(/:+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!namespace || !value) return null;
    const finalNamespace = ALL_NAMESPACES.includes(namespace) ? namespace : 'topic';
    return {
      ns: finalNamespace,
      value,
      raw: input,
      source: input.source ? String(input.source) : sourceFromOptions,
    };
  }

  const raw = String(input || '').trim();
  if (!raw) return null;

  const separatorIndex = raw.indexOf(':');
  if (separatorIndex < 0) {
    const value = normalizeChunk(raw).replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!value) return null;
    return {
      ns: 'topic',
      value,
      raw,
      source: sourceFromOptions,
    };
  }

  const namespaceRaw = raw.slice(0, separatorIndex);
  const valueRaw = raw.slice(separatorIndex + 1);
  const namespace = mapNamespaceAliases(namespaceRaw);
  const value = normalizeChunk(valueRaw).replace(/:+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!namespace || !value) return null;
  const finalNamespace = ALL_NAMESPACES.includes(namespace) ? namespace : 'topic';
  return {
    ns: finalNamespace,
    value,
    raw,
    source: sourceFromOptions,
  };
}

function splitTags(textOrList) {
  if (Array.isArray(textOrList)) {
    const items = [];
    for (const item of textOrList) {
      if (typeof item === 'string') {
        items.push(...item.split(/[\n,;|]+/g).map((v) => v.trim()).filter(Boolean));
      } else if (item !== null && item !== undefined) {
        items.push(item);
      }
    }
    return items;
  }
  if (typeof textOrList !== 'string') return [];
  return textOrList
    .split(/[\n,;|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTag(tag) {
  const parsed = parseTag(tag);
  if (!parsed) return '';
  return `${parsed.ns}:${parsed.value}`;
}

function uniqTags(tags = []) {
  return Array.from(new Set(tags.filter(Boolean)));
}

function consolidateTags(tags = [], options = {}) {
  const warnings = [];
  const sourceOrder = Array.isArray(options.sourceOrder) && options.sourceOrder.length > 0
    ? options.sourceOrder.map((s) => String(s))
    : ['manual', 'inbound', 'state', 'heuristic', 'default', 'unknown'];
  const sourceRank = new Map(sourceOrder.map((source, idx) => [source, idx]));
  const singleNamespaces = new Set(
    Array.isArray(options.singleNamespaces) && options.singleNamespaces.length > 0
      ? options.singleNamespaces.map((ns) => mapNamespaceAliases(ns)).filter(Boolean)
      : SINGLE_VALUE_NAMESPACES
  );

  const entries = [];
  const pushEntries = (source, value) => {
    for (const item of splitTags(value)) {
      const parsed = parseTag(item, { source });
      if (!parsed) continue;
      const effectiveSource = parsed.source || source || 'unknown';
      entries.push({
        ...parsed,
        source: effectiveSource,
        rank: sourceRank.has(effectiveSource)
          ? sourceRank.get(effectiveSource)
          : sourceOrder.length,
      });
    }
  };

  if (Array.isArray(options.manualTags)) pushEntries('manual', options.manualTags);
  if (Array.isArray(options.inboundTags)) pushEntries('inbound', options.inboundTags);
  if (Array.isArray(options.stateTags)) pushEntries('state', options.stateTags);
  if (Array.isArray(options.heuristicTags)) pushEntries('heuristic', options.heuristicTags);
  pushEntries(options.defaultSource || 'unknown', tags);

  const grouped = new Map();
  for (const entry of entries) {
    if (!grouped.has(entry.ns)) grouped.set(entry.ns, []);
    grouped.get(entry.ns).push(entry);
  }

  const output = [];
  for (const [namespace, nsEntries] of grouped.entries()) {
    if (nsEntries.length === 0) continue;
    const validEntries = nsEntries.filter((entry) => !isUnknownValue(namespace, entry.value));
    const unknownEntries = nsEntries.filter((entry) => isUnknownValue(namespace, entry.value));

    if (singleNamespaces.has(namespace)) {
      const pool = validEntries.length > 0 ? validEntries : unknownEntries;
      if (pool.length === 0) continue;
      pool.sort((a, b) => (a.rank - b.rank));
      output.push(`${namespace}:${pool[0].value}`);
      if (nsEntries.length > 1) warnings.push(`namespace_consolidated:${namespace}`);
      if (validEntries.length > 0 && unknownEntries.length > 0) warnings.push(`unknown_dropped:${namespace}`);
      continue;
    }

    const namespaceOutput = [];
    const valuesSeen = new Set();
    const iterable = validEntries.length > 0 ? validEntries : unknownEntries;
    iterable.sort((a, b) => (a.rank - b.rank));

    for (const entry of iterable) {
      const key = `${namespace}:${entry.value}`;
      if (valuesSeen.has(key)) continue;
      valuesSeen.add(key);
      namespaceOutput.push(key);
    }

    output.push(...namespaceOutput);
    if (validEntries.length > 0 && unknownEntries.length > 0) warnings.push(`unknown_dropped:${namespace}`);
  }

  return {
    tags: uniqTags(output),
    warnings: uniqTags(warnings),
  };
}

function validateCoherence(tags = []) {
  const normalized = consolidateTags(tags).tags;
  const errors = [];
  const warnings = [];
  const byNamespace = new Map();

  for (const rawTag of normalized) {
    const parsed = parseTag(rawTag);
    if (!parsed) continue;
    if (!byNamespace.has(parsed.ns)) byNamespace.set(parsed.ns, []);
    byNamespace.get(parsed.ns).push(parsed.value);
  }

  for (const namespace of SINGLE_VALUE_NAMESPACES) {
    const values = byNamespace.get(namespace) || [];
    if (values.length > 1) errors.push(`duplicate_namespace:${namespace}`);
    if (values.length === 1 && isUnknownValue(namespace, values[0])) warnings.push(`namespace_unknown:${namespace}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function hasNamespace(tags, namespace) {
  const ns = mapNamespaceAliases(namespace);
  return tags.some((tag) => {
    const parsed = parseTag(tag);
    return !!parsed && parsed.ns === ns;
  });
}

function hasValidNamespace(tags, namespace) {
  const ns = mapNamespaceAliases(namespace);
  return tags.some((tag) => {
    const parsed = parseTag(tag);
    if (!parsed || parsed.ns !== ns) return false;
    return !isUnknownValue(parsed.ns, parsed.value);
  });
}

function ensureRequiredTags(tags, defaults = { intent: 'intent:support', severity: 'severity:medium' }) {
  const consolidated = consolidateTags(tags, { defaultSource: 'state' });
  const warnings = [...(consolidated.warnings || [])];
  const normalized = [...consolidated.tags];

  for (const namespace of REQUIRED_NAMESPACES) {
    if (!hasValidNamespace(normalized, namespace)) {
      const fallback = normalizeTag(defaults[namespace] || `${namespace}:unknown`);
      if (fallback) normalized.push(fallback);
      warnings.push(`required_tag_added:${namespace}`);
    }
  }

  const finalConsolidated = consolidateTags(normalized, { defaultSource: 'default' });
  return {
    tags: finalConsolidated.tags,
    warnings: uniqTags([...(warnings || []), ...(finalConsolidated.warnings || [])]),
  };
}

function diffTags(oldTags, newTags) {
  const from = new Set(splitTags(oldTags).map(normalizeTag).filter(Boolean));
  const to = new Set(splitTags(newTags).map(normalizeTag).filter(Boolean));

  const added = [];
  const removed = [];

  for (const tag of to) {
    if (!from.has(tag)) added.push(tag);
  }
  for (const tag of from) {
    if (!to.has(tag)) removed.push(tag);
  }

  return { added, removed };
}

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasAnyKeyword(text, keywords = []) {
  const normalized = Array.isArray(keywords)
    ? keywords.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (normalized.length === 0) return false;
  const pattern = new RegExp(`\\b(${normalized.map(escapeRegexLiteral).join('|')})\\b`, 'i');
  return pattern.test(text);
}

function findMatchedKeywords(text, keywords = []) {
  const normalized = Array.isArray(keywords)
    ? keywords.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (normalized.length === 0) return [];
  const unique = Array.from(new Set(normalized));
  return unique.filter((kw) => hasAnyKeyword(text, [kw]));
}

function suggestTagsFromText(text, options = {}) {
  const raw = String(text || '').toLowerCase();
  const suggested = [];

  const tenantKeywords = (options && typeof options === 'object' && options.tenantKeywords && typeof options.tenantKeywords === 'object')
    ? options.tenantKeywords
    : {};

  const salesKeywords = [
    'comprar', 'orçamento', 'orcamento', 'preço', 'preco', 'plano', 'contratar', 'vendas',
    ...(Array.isArray(tenantKeywords.sales) ? tenantKeywords.sales : []),
  ];
  const cancelKeywords = [
    'cancelar', 'cancelamento', 'desistir', 'encerrar',
    ...(Array.isArray(tenantKeywords.cancel) ? tenantKeywords.cancel : []),
  ];
  const billingKeywords = [
    'boleto', 'fatura', 'nota', 'pagamento', 'cobrança', 'cobranca',
    ...(Array.isArray(tenantKeywords.billing) ? tenantKeywords.billing : []),
  ];
  const supportKeywords = [
    'erro', 'bug', 'não funciona', 'nao funciona', 'suporte', 'chamado',
    ...(Array.isArray(tenantKeywords.support) ? tenantKeywords.support : []),
  ];
  const complaintKeywords = [
    'reclama', 'insatisfeito', 'péssimo', 'horrível', 'horrivel',
    ...(Array.isArray(tenantKeywords.complaint) ? tenantKeywords.complaint : []),
  ];

  const salesMatches = findMatchedKeywords(raw, salesKeywords);
  const cancelMatches = findMatchedKeywords(raw, cancelKeywords);
  const billingMatches = findMatchedKeywords(raw, billingKeywords);
  const supportMatches = findMatchedKeywords(raw, supportKeywords);
  const complaintMatches = findMatchedKeywords(raw, complaintKeywords);

  const isSales = salesMatches.length > 0;
  const isCancel = cancelMatches.length > 0;
  const isBilling = billingMatches.length > 0;
  const isSupport = supportMatches.length > 0;
  const isComplaint = complaintMatches.length > 0;

  let decisionBranch = 'fallback_support';
  let unclassified = false;

  if (isSales) {
    decisionBranch = 'sales_keyword';
    suggested.push('intent:sales', 'topic:comercial');
  } else if (isCancel) {
    decisionBranch = 'cancel_keyword';
    suggested.push('intent:cancel', 'severity:high', 'state:churn_risk');
  } else if (isBilling) {
    decisionBranch = 'billing_keyword';
    suggested.push('intent:billing', 'topic:financeiro');
  } else if (isSupport) {
    decisionBranch = 'support_keyword';
    suggested.push('intent:support', 'topic:suporte');
  } else if (isComplaint) {
    decisionBranch = 'complaint_keyword';
    suggested.push('intent:complaint', 'severity:high', 'state:at_risk');
  } else {
    // Fallback determinístico para evitar persistência de intent:unknown.
    unclassified = true;
    suggested.push('intent:support');
  }

  const urgencyMatched = /urgente|imediato|agora|crítico|critico/.test(raw);
  if (urgencyMatched) {
    suggested.push('severity:critical');
  } else if (!suggested.some((tag) => String(tag).startsWith('severity:'))) {
    suggested.push('severity:medium');
  }

  const ensured = ensureRequiredTags(suggested);
  return {
    tags: ensured.tags,
    warnings: ensured.warnings,
    reasons: {
      decisionBranch,
      unclassified,
      urgencyMatched,
      matchedKeywords: {
        sales: salesMatches,
        cancel: cancelMatches,
        billing: billingMatches,
        support: supportMatches,
        complaint: complaintMatches,
      },
      requiredTagsAdded: ensured.warnings,
    },
  };
}

module.exports = {
  REQUIRED_NAMESPACES,
  GLOBAL_NAMESPACES,
  MODULE_NAMESPACES,
  mapNamespaceAliases,
  isUnknownValue,
  parseTag,
  normalizeTag,
  splitTags,
  consolidateTags,
  validateCoherence,
  ensureRequiredTags,
  diffTags,
  suggestTagsFromText,
};
