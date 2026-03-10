'use strict';

const logger = require('../utils/logger');
const { buildConversationContext } = require('./conversationContextService');
const { buildPromptWithReconstructedContext } = require('./conversationPromptBuilder');
const { extractConversationFacts } = require('./conversationFactExtractor');
const { upsertConversationFact, appendMessageEvent, isContextReconstructionEnabled } = require('./conversationContextService');
const { indexMemoryEntry } = require('./conversationMemoryService');
const { refreshRollingSummary } = require('./conversationCompressionService');

function normalizeTicketMessage(message = {}) {
  return {
    id: message.id || null,
    text: String(message.text || ''),
    sender: message.sender || 'system',
    timestamp: message.timestamp || new Date().toISOString(),
    type: message.type || 'text',
    externalMessageId: message.externalMessageId || null,
    clientMessageId: message.clientMessageId || null,
  };
}

async function trackTicketMessage({ tenantId, ticket, message }) {
  if (!tenantId || !ticket?.id || !message) return;
  const enabled = await isContextReconstructionEnabled(tenantId);
  if (!enabled) return;

  const normalized = normalizeTicketMessage(message);

  try {
    await appendMessageEvent({ tenantId, ticket, message: normalized });
  } catch (_) {}

  try {
    const facts = extractConversationFacts({ text: normalized.text, message: normalized });
    for (const fact of facts) {
      // eslint-disable-next-line no-await-in-loop
      await upsertConversationFact({
        tenantId,
        ticketId: ticket.id,
        factKey: fact.key,
        factValue: fact.value,
        confidence: fact.confidence,
        source: fact.source,
        sourceMessageId: normalized.externalMessageId || normalized.clientMessageId || normalized.id || null,
        metadata: {
          sender: normalized.sender,
          messageType: normalized.type,
        },
      });
    }
  } catch (_) {}

  try {
    await indexMemoryEntry({
      tenantId,
      ticketId: ticket.id,
      conversationId: ticket.conversationId || null,
      sourceType: normalized.sender === 'agent' ? 'agent_message' : (normalized.sender === 'user' ? 'user_message' : 'system_message'),
      sourceId: normalized.externalMessageId || normalized.clientMessageId || normalized.id || null,
      content: normalized.text,
      metadata: {
        sender: normalized.sender,
        messageType: normalized.type,
        timestamp: normalized.timestamp,
      },
    });
  } catch (_) {}
}

async function runCompressionIfNeeded({ tenantId, ticket, messages = [] }) {
  if (!tenantId || !ticket?.id) return;
  const enabled = await isContextReconstructionEnabled(tenantId);
  if (!enabled) return;
  try {
    await refreshRollingSummary({
      tenantId,
      ticketId: ticket.id,
      conversationId: ticket.conversationId || null,
      messages,
    });
  } catch (err) {
    logger.debug('[ContextReconstructionTracker] Falha ao comprimir contexto (best-effort)', {
      tenantId,
      ticketId: ticket.id,
      error: err.message,
    });
  }
}

async function buildPromptWithContext({ tenantId, ticket, messages = [], prompt }) {
  if (!tenantId || !ticket?.id) {
    return { prompt: String(prompt || ''), contextMeta: { enabled: false, reason: 'missing_ticket' } };
  }

  const rebuilt = await buildConversationContext({
    tenantId,
    ticket,
    messages,
    userPrompt: prompt,
  });

  if (!rebuilt.enabled || !rebuilt.promptPrefix) {
    return {
      prompt: String(prompt || ''),
      contextMeta: {
        enabled: false,
        reason: rebuilt.reason || 'disabled',
      },
    };
  }

  return {
    prompt: buildPromptWithReconstructedContext(prompt, rebuilt.promptPrefix),
    contextMeta: {
      enabled: true,
      reason: rebuilt.reason,
      context: rebuilt.context,
    },
  };
}

module.exports = {
  trackTicketMessage,
  runCompressionIfNeeded,
  buildPromptWithContext,
};
