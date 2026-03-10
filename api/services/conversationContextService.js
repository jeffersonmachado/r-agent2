'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../utils/config');
const { ConversationSummary, ConversationFact, ConversationEvent } = require('../db/models');
const { searchRelevantMemories } = require('./conversationMemoryService');
const { isEnabled: isTenantFeatureEnabled } = require('./tenantFeatureService');
const { getRedisClientOrNull } = require('../utils/redisClient');

const FEATURE_KEY = 'context_reconstruction_enabled';

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function toBool(value, fallback = false) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
    if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  }
  if (typeof value === 'number') return value > 0;
  return fallback;
}

async function isContextReconstructionEnabled(tenantId) {
  const envGlobal = toBool(process.env.CONTEXT_RECONSTRUCTION_ENABLED, null);
  if (envGlobal !== null) return envGlobal;

  const cfgGlobal = toBool(config.get('ai.contextReconstruction.enabled', false), false);
  if (!tenantId) return cfgGlobal;

  try {
    const tenantFlag = await isTenantFeatureEnabled(String(tenantId), FEATURE_KEY, cfgGlobal);
    return tenantFlag === true;
  } catch (_) {
    return cfgGlobal;
  }
}

function parseJsonSafe(raw, fallback = {}) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch (_) { return fallback; }
}

function normalizeEventDirection(message = {}) {
  if (message.sender === 'user') return 'in';
  if (message.sender === 'agent') return 'out';
  return 'system';
}

async function appendConversationEvent({
  tenantId,
  ticketId,
  conversationId = null,
  eventType,
  direction = null,
  messageId = null,
  payload = {},
  occurredAt = null,
}) {
  if (!tenantId || !ticketId || !eventType) return null;
  try {
    const Model = typeof ConversationEvent === 'function' ? ConversationEvent() : ConversationEvent;
    if (!Model) return null;

    const event = await Model.create({
      id: newId('cevt'),
      tenant_key: String(tenantId),
      ticket_id: String(ticketId),
      conversation_id: conversationId ? String(conversationId) : null,
      event_type: String(eventType),
      direction: direction ? String(direction) : null,
      message_id: messageId ? String(messageId) : null,
      payload_json: payload && typeof payload === 'object' ? payload : {},
      occurred_at: occurredAt || new Date(),
    });

    return event;
  } catch (err) {
    logger.debug('[ConversationContext] Falha ao registrar evento (best-effort)', {
      tenantId,
      ticketId,
      eventType,
      error: err.message,
    });
    return null;
  }
}

async function upsertConversationFact({
  tenantId,
  ticketId,
  factKey,
  factValue,
  confidence = null,
  source = 'heuristic',
  sourceMessageId = null,
  metadata = {},
}) {
  if (!tenantId || !ticketId || !factKey || !factValue) return null;

  try {
    const Model = typeof ConversationFact === 'function' ? ConversationFact() : ConversationFact;
    if (!Model) return null;

    const where = {
      tenant_key: String(tenantId),
      ticket_id: String(ticketId),
      fact_key: String(factKey),
    };

    const existing = await Model.findOne({ where });
    const payload = {
      fact_value: String(factValue),
      confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : null,
      source: String(source || 'heuristic'),
      source_message_id: sourceMessageId ? String(sourceMessageId) : null,
      metadata_json: metadata && typeof metadata === 'object' ? metadata : {},
    };

    if (existing) {
      await existing.update(payload);
      return existing;
    }

    const created = await Model.create({
      id: newId('cfct'),
      tenant_key: String(tenantId),
      ticket_id: String(ticketId),
      fact_key: String(factKey),
      ...payload,
    });

    return created;
  } catch (err) {
    logger.debug('[ConversationContext] Falha ao registrar fato (best-effort)', {
      tenantId,
      ticketId,
      factKey,
      error: err.message,
    });
    return null;
  }
}

function buildCacheKey(tenantId, ticketId) {
  return `convctx:prompt:${String(tenantId)}:${String(ticketId)}`;
}

async function getCachedPromptContext({ tenantId, ticketId }) {
  const redis = getRedisClientOrNull();
  if (!redis) return null;
  const key = buildCacheKey(tenantId, ticketId);
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    const parsed = parseJsonSafe(raw, null);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

async function setCachedPromptContext({ tenantId, ticketId, payload, ttlSeconds = 45 }) {
  const redis = getRedisClientOrNull();
  if (!redis) return;
  const key = buildCacheKey(tenantId, ticketId);
  try {
    await redis.set(key, JSON.stringify(payload || {}), 'EX', ttlSeconds);
  } catch (_) {}
}

async function buildConversationContext({
  tenantId,
  ticket,
  messages = [],
  userPrompt = '',
}) {
  if (!tenantId || !ticket?.id) {
    return {
      enabled: false,
      reason: 'missing_ticket_or_tenant',
      context: null,
      promptPrefix: '',
    };
  }

  const enabled = await isContextReconstructionEnabled(tenantId);
  if (!enabled) {
    return {
      enabled: false,
      reason: 'feature_disabled',
      context: null,
      promptPrefix: '',
    };
  }

  const cached = await getCachedPromptContext({ tenantId, ticketId: ticket.id });
  if (cached && cached.ticketUpdatedAt === ticket.updatedAt && cached.promptPrefix) {
    return {
      enabled: true,
      reason: 'cache_hit',
      context: cached.context || null,
      promptPrefix: String(cached.promptPrefix || ''),
    };
  }

  const summaryModel = typeof ConversationSummary === 'function' ? ConversationSummary() : ConversationSummary;
  const factModel = typeof ConversationFact === 'function' ? ConversationFact() : ConversationFact;
  const eventModel = typeof ConversationEvent === 'function' ? ConversationEvent() : ConversationEvent;

  const [latestSummary, factsRows, eventRows, memories] = await Promise.all([
    summaryModel ? summaryModel.findOne({
      where: {
        tenant_key: String(tenantId),
        ticket_id: String(ticket.id),
      },
      order: [['created_at', 'DESC']],
    }) : null,
    factModel ? factModel.findAll({
      where: {
        tenant_key: String(tenantId),
        ticket_id: String(ticket.id),
      },
      order: [['updated_at', 'DESC']],
      limit: 20,
    }) : [],
    eventModel ? eventModel.findAll({
      where: {
        tenant_key: String(tenantId),
        ticket_id: String(ticket.id),
      },
      order: [['occurred_at', 'DESC']],
      limit: 25,
    }) : [],
    searchRelevantMemories({
      tenantId,
      ticketId: ticket.id,
      conversationId: ticket.conversationId || null,
      queryText: userPrompt || ticket.lastUserMessage || '',
      topK: 5,
    }),
  ]);

  const recentMessages = (Array.isArray(messages) ? messages : []).slice(-8).map((m) => {
    const sender = m.sender === 'user' ? 'cliente' : (m.sender === 'agent' ? 'atendente' : 'sistema');
    return `[${sender}] ${String(m.text || '').slice(0, 400)}`;
  });

  const facts = (factsRows || []).map((row) => {
    const item = row.toJSON ? row.toJSON() : row;
    return {
      key: item.fact_key,
      value: item.fact_value,
      confidence: Number(item.confidence || 0),
      source: item.source,
      updatedAt: item.updated_at || item.updatedAt || null,
    };
  });

  const events = (eventRows || []).slice(0, 10).map((row) => {
    const item = row.toJSON ? row.toJSON() : row;
    const payload = parseJsonSafe(item.payload_json, {});
    return {
      type: item.event_type,
      direction: item.direction,
      happenedAt: item.occurred_at || item.created_at || null,
      preview: String(payload?.text || payload?.message || payload?.summary || '').slice(0, 160),
    };
  });

  const summaryText = latestSummary
    ? String((latestSummary.toJSON ? latestSummary.toJSON() : latestSummary).summary_text || '')
    : '';

  const memoryRows = (memories || []).slice(0, 5).map((m) => `- (${Math.round((m.score || 0) * 100)}%) ${String(m.content || '').slice(0, 240)}`);

  const context = {
    summary: summaryText,
    facts,
    events,
    recentMessages,
    memories: memories || [],
  };

  const promptBlocks = [];
  promptBlocks.push('## Contexto Reconstruído da Conversa');
  if (summaryText) {
    promptBlocks.push('### Resumo acumulado');
    promptBlocks.push(summaryText);
  }
  if (facts.length > 0) {
    promptBlocks.push('### Fatos estruturados');
    for (const fact of facts.slice(0, 12)) {
      promptBlocks.push(`- ${fact.key}: ${fact.value}`);
    }
  }
  if (events.length > 0) {
    promptBlocks.push('### Eventos relevantes');
    for (const event of events.slice(0, 8)) {
      const suffix = event.preview ? ` | ${event.preview}` : '';
      promptBlocks.push(`- ${event.type}${suffix}`);
    }
  }
  if (memoryRows.length > 0) {
    promptBlocks.push('### Memórias semânticas');
    promptBlocks.push(...memoryRows);
  }
  if (recentMessages.length > 0) {
    promptBlocks.push('### Janela recente');
    promptBlocks.push(...recentMessages);
  }

  promptBlocks.push('### Regras de prioridade');
  promptBlocks.push('- O estado oficial do sistema e dados operacionais atuais têm prioridade sobre inferências.');
  promptBlocks.push('- Se houver conflito entre memória antiga e estado atual, prefira o estado atual.');
  promptBlocks.push('- Não invente fatos ausentes no contexto reconstruído.');

  const promptPrefix = promptBlocks.join('\n');

  await setCachedPromptContext({
    tenantId,
    ticketId: ticket.id,
    payload: {
      ticketUpdatedAt: ticket.updatedAt,
      promptPrefix,
      context,
    },
    ttlSeconds: 45,
  });

  return {
    enabled: true,
    reason: 'rebuilt',
    context,
    promptPrefix,
  };
}

function buildEventPayloadFromMessage(message = {}) {
  return {
    text: String(message.text || ''),
    sender: message.sender || null,
    type: message.type || 'text',
    messageId: message.externalMessageId || message.clientMessageId || message.id || null,
    timestamp: message.timestamp || null,
  };
}

async function appendMessageEvent({ tenantId, ticket, message = {}, eventType = null }) {
  if (!tenantId || !ticket?.id || !message) return null;
  return appendConversationEvent({
    tenantId,
    ticketId: ticket.id,
    conversationId: ticket.conversationId || null,
    eventType: eventType || (message.sender === 'agent' ? 'message.outbound' : 'message.inbound'),
    direction: normalizeEventDirection(message),
    messageId: message.externalMessageId || message.clientMessageId || message.id || null,
    payload: buildEventPayloadFromMessage(message),
    occurredAt: message.timestamp ? new Date(message.timestamp) : new Date(),
  });
}

module.exports = {
  FEATURE_KEY,
  isContextReconstructionEnabled,
  appendConversationEvent,
  upsertConversationFact,
  appendMessageEvent,
  buildConversationContext,
};
