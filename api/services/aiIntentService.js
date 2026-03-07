'use strict';

const logger = require('../utils/logger');
const nlpService = require('./nlpService');
const { normalizeText } = require('./whatsappIvrService');
const { buildDiverseRagContext } = require('./ragContextBuilder');

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeEntities(entities) {
  if (!entities || typeof entities !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(entities)) {
    if (Array.isArray(value)) {
      out[key] = value.map((item) => safeString(item)).filter(Boolean);
      continue;
    }
    const normalized = safeString(value);
    if (normalized) out[key] = normalized;
  }
  return out;
}

function normalizeEntityValue(value) {
  if (Array.isArray(value)) return value.map((item) => safeString(item)).filter(Boolean);
  if (value && typeof value === 'object') {
    const candidate = safeString(value.value || value.label || value.name || value.id);
    return candidate ? candidate : '';
  }
  return safeString(value);
}

function normalizeTicketEntities(ticket = null) {
  const entities = ticket?.context?.metadata?.entities;
  if (!entities || typeof entities !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(entities)) {
    const normalized = normalizeEntityValue(value);
    if (Array.isArray(normalized) ? normalized.length > 0 : !!normalized) {
      out[key] = normalized;
    }
  }
  return out;
}

async function intentContextProvider({
  tenantId = null,
  text,
  history = [],
  ticket = null,
  channel = 'whatsapp',
  config = {},
}) {
  const ragEnabled = config?.aiContextRagEnabled === true || config?.ragEnabled === true;
  const tags = ensureArray(ticket?.context?.metadata?.tags).map((item) => safeString(item)).filter(Boolean);
  const entities = normalizeTicketEntities(ticket);
  const baseContext = {
    text: safeString(text),
    history: ensureArray(history).map((item) => safeString(item)).filter(Boolean).slice(-8),
    tags,
    entities,
    departmentId: safeString(ticket?.context?.whatsappIvr?.departmentId) || null,
    departmentName: safeString(ticket?.context?.whatsappIvr?.departmentName) || null,
    channel: safeString(channel) || 'whatsapp',
    ragReady: true,
    ragUsed: false,
    ragSources: [],
    ragSummary: null,
    providerStatus: ragEnabled ? 'pending' : 'disabled',
  };
  if (!ragEnabled) {
    return baseContext;
  }
  if (!tenantId) {
    return {
      ...baseContext,
      providerStatus: 'tenant_missing',
    };
  }
  const timeoutMs = Math.max(300, Number(config?.aiContextTimeoutMs || 1200));
  const ragQuery = [
    baseContext.text,
    ...baseContext.history.slice(-4),
    baseContext.departmentName,
    Object.entries(baseContext.entities).map(([key, value]) => `${key}:${Array.isArray(value) ? value.join(',') : value}`).join(' '),
  ].filter(Boolean).join(' ');

  if (!ragQuery) {
    return {
      ...baseContext,
      providerStatus: 'skipped_no_query',
    };
  }

  try {
    const ragResult = await Promise.race([
      buildDiverseRagContext({
        query: ragQuery,
        tenantId,
        totalK: 4,
        minUploaded: 1,
        minWeb: 1,
        minScore: 0.28,
        maxTokens: 1200,
      }),
      new Promise((_, reject) => {
        setTimeout(() => {
          const err = new Error('rag_context_timeout');
          err.code = 'rag_context_timeout';
          reject(err);
        }, timeoutMs);
      }),
    ]);
    const ragSources = ensureArray(ragResult?.contextSources).slice(0, 4).map((item) => ({
      sourceType: item.sourceType || 'unknown',
      sourceId: item.sourceId || null,
      score: Number(item.score || 0),
    }));
    return {
      ...baseContext,
      ragUsed: ragSources.length > 0,
      ragSources,
      ragSummary: ragResult?.contextSummary || null,
      ragContext: ragResult?.ragContext || '',
      providerStatus: ragSources.length > 0 ? 'used' : 'no_hits',
    };
  } catch (err) {
    logger.warn('[AIIntentService] Contexto RAG indisponivel; seguindo sem enriquecimento', {
      tenantId,
      error: err?.message || String(err || 'unknown_error'),
    });
    return {
      ...baseContext,
      ragError: err?.code || err?.message || 'rag_context_unavailable',
      providerStatus: err?.code === 'rag_context_timeout' ? 'timeout' : 'error',
    };
  }
}

function buildDepartmentCatalog(config = {}, departments = []) {
  const bindingsById = new Map(ensureArray(config.departmentBindings).map((item) => [String(item.departmentId), item]));
  return ensureArray(departments).map((department) => {
    const binding = bindingsById.get(String(department.id)) || null;
    const aliases = [
      safeString(department.name),
      safeString(binding?.menuLabel),
      ...ensureArray(binding?.aliases),
      ...ensureArray(department.queueNames),
    ].map(normalizeText).filter(Boolean);

    return {
      departmentId: String(department.id),
      departmentName: safeString(department.name),
      binding,
      aliases: Array.from(new Set(aliases)),
    };
  });
}

function flattenContextText({ text, history = [], ticket = null, channel = 'whatsapp' }) {
  const tags = ensureArray(ticket?.context?.metadata?.tags);
  const entities = normalizeTicketEntities(ticket);
  const parts = [
    safeString(text),
    ...ensureArray(history).map((item) => safeString(item)).filter(Boolean).slice(-4),
    safeString(ticket?.subject),
    safeString(ticket?.queue),
    safeString(ticket?.department),
    safeString(ticket?.context?.whatsappIvr?.departmentName),
    safeString(ticket?.context?.whatsappIvr?.departmentId),
    safeString(ticket?.context?.metadata?.last_intent),
    ...tags,
    ...Object.entries(entities).flatMap(([key, value]) => {
      const values = Array.isArray(value) ? value : [value];
      return [`${key}:${values.join(',')}`];
    }),
    safeString(channel),
  ].filter(Boolean);

  return parts.join('\n');
}

function buildContextUsedSummary(context = {}) {
  return {
    historyMessages: ensureArray(context.history).length,
    tagsCount: ensureArray(context.tags).length,
    entityKeys: Object.keys(context.entities || {}),
    departmentId: context.departmentId || null,
    channel: context.channel || 'whatsapp',
    ragReady: context.ragReady === true,
    ragUsed: context.ragUsed === true,
    providerStatus: context.providerStatus || 'disabled',
    ragSources: ensureArray(context.ragSources).map((item) => ({
      sourceType: item.sourceType || 'unknown',
      sourceId: item.sourceId || null,
      score: Number(item.score || 0),
    })),
  };
}

function scoreDepartmentMatch({ catalogItem, haystack, nlpIntent, entities, ticket }) {
  let score = 0;
  const reasons = [];
  for (const alias of catalogItem.aliases) {
    if (!alias) continue;
    if (haystack.includes(alias)) {
      score += alias === normalizeText(catalogItem.departmentName) ? 0.45 : 0.3;
      reasons.push(`alias:${alias}`);
    }
    if (nlpIntent && nlpIntent.includes(alias)) {
      score += 0.25;
      reasons.push(`intent:${alias}`);
    }
  }

  const entityValues = Object.values(entities || {})
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => normalizeText(value))
    .filter(Boolean);
  for (const value of entityValues) {
    if (catalogItem.aliases.some((alias) => alias && value.includes(alias))) {
      score += 0.18;
      reasons.push(`entity:${value}`);
      break;
    }
  }

  if (safeString(ticket?.context?.whatsappIvr?.departmentId) === catalogItem.departmentId) {
    score += 0.08;
    reasons.push('ticket_context');
  }

  if (catalogItem.binding?.enabled === true) {
    score += 0.05;
  }

  return {
    score: Number(Math.min(0.99, score).toFixed(3)),
    reasons,
  };
}

async function classifyIncomingMessage({
  tenantId,
  text,
  config = {},
  departments = [],
  ticket = null,
  history = [],
  channel = 'whatsapp',
}) {
  const startedAt = Date.now();
  const inputText = safeString(text);
  const catalog = buildDepartmentCatalog(config, departments);
  const context = await intentContextProvider({ tenantId, text: inputText, history, ticket, channel, config });
  const contextText = flattenContextText({ text: context.text, history: context.history, ticket, channel: context.channel });
  const contextPrefix = context.ragUsed && context.ragContext
    ? [`[RAG CONTEXT]`, context.ragContext, '', '[MENSAGEM E CONTEXTO OPERACIONAL]', contextText].join('\n')
    : contextText;
  const fallback = {
    ok: true,
    source: 'fallback',
    intent: null,
    entities: {},
    confidence: 0,
    departmentId: null,
    reasoning: ['no_match'],
    contextUsed: buildContextUsedSummary(context),
    ragUsed: context.ragUsed === true,
    providerStatus: context.providerStatus || 'disabled',
    latencyMs: Date.now() - startedAt,
  };

  if (!inputText) {
    return fallback;
  }

  let nlpResult = null;
  try {
    nlpResult = await nlpService.analyzeText(contextPrefix, true);
  } catch (err) {
    logger.warn('[AIIntentService] NLP indisponivel; seguindo com heuristica local', {
      tenantId: tenantId || null,
      error: err?.message || String(err || 'unknown_error'),
    });
  }

  const entities = normalizeEntities(nlpResult?.entities);
  const ticketEntities = normalizeTicketEntities(ticket);
  const nlpIntent = normalizeText(nlpResult?.intent || '');
  const haystack = normalizeText([contextText, context.ragContext || '', nlpIntent].filter(Boolean).join(' '));
  const ranked = catalog
    .map((item) => ({
      ...item,
      match: scoreDepartmentMatch({
        catalogItem: item,
        haystack,
        nlpIntent,
        entities,
        ticket,
      }),
    }))
    .sort((a, b) => b.match.score - a.match.score);

  const best = ranked[0] || null;
  const confidence = Number(Math.max(
    Number(nlpResult?.confidence || 0),
    Number(best?.match?.score || 0),
  ).toFixed(3));

  const result = {
    ok: true,
    source: nlpResult ? 'nlp' : 'fallback',
    intent: safeString(nlpResult?.intent) || null,
    secondaryIntent: safeString(
      nlpResult?.secondaryIntent
      || entities.activity
      || entities.service
      || ticketEntities.activity
      || ticketEntities.service
      || best?.departmentName
      || '',
    ) || null,
    entities: {
      ...ticketEntities,
      ...entities,
    },
    confidence,
    departmentId: best?.match?.score >= 0.2 ? best.departmentId : null,
    reasoning: best?.match?.reasons?.length ? best.match.reasons : ['no_match'],
    explanation: best?.match?.reasons?.length
      ? `Decisao baseada em ${best.match.reasons.join(', ')}.`
      : 'Nenhum sinal forte encontrado; seguir fallback.',
    contextUsed: buildContextUsedSummary(context),
    ragUsed: context.ragUsed === true,
    providerStatus: context.providerStatus || 'disabled',
    latencyMs: Date.now() - startedAt,
    rawIntent: nlpResult?.intent || null,
  };

  logger.info('[AIIntentService] Classificacao concluida', {
    tenantId: tenantId || null,
    source: result.source,
    intent: result.intent,
    confidence: result.confidence,
    departmentId: result.departmentId,
    ragUsed: result.ragUsed,
    providerStatus: result.providerStatus,
    reasoning: result.reasoning,
  });

  return result;
}

module.exports = {
  intentContextProvider,
  classifyIncomingMessage,
};
