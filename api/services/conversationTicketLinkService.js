/**
 * Serviço: Conversation ↔ Ticket Link (Blip-like)
 *
 * Objetivo (Fase 2):
 * - Garantir unificação 1:1 consistente entre conversa omnichannel e ticket.
 * - Ser idempotente: não criar tickets duplicados para a mesma conversa.
 * - Hard multi-tenant: tenantId é obrigatório em toda operação.
 *
 * Observação:
 * - Este projeto já possui persistência omnichannel em:
 *   - channel_conversations (unique: tenant_key + channel_type + external_id)
 *   - channel_messages (unique: tenant_key + external_message_id)
 * - O ticket atual é mantido em memória (queueService) e persistido best-effort no Postgres.
 */
/* eslint-disable no-use-before-define */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../utils/config');
const { getSequelize } = require('../db/sequelize');
const { ChannelConversation, Ticket: TicketGetter } = require('../db/models');
const queueService = require('./queueService');
const { checkLimit } = require('./planLimitsService');

// ---------------------------------------------------------------------------
// Concurrency guard (best-effort)
//
// Em cenários omnichannel (WhatsApp Cloud + QR / retries / UI), dois handlers
// podem chamar "resolveOrCreateTicketFromIncomingMessage" praticamente ao mesmo
// tempo para a MESMA conversa. Sem uma trava, isso pode criar dois tickets
// (ou dois fluxos) para a mesma chave externa, dando a impressão de "2 tickets
// com o mesmo número".
//
// Aqui serializamos por (tenantId + channelType + externalConversationId).
// É uma trava em memória (por processo) – suficiente para evitar duplicidade
// dentro do mesmo worker/API. A consistência forte entre processos fica por
// conta do banco (quando disponível).
// ---------------------------------------------------------------------------

const _inflightByConvKey = new Map(); // key -> Promise

function _convKey(tenantId, channelType, externalConversationId) {
  return `${String(tenantId || '').trim()}::${String(channelType || '').trim()}::${String(externalConversationId || '').trim()}`;
}

async function _withInflightLock(key, fn) {
  const existing = _inflightByConvKey.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      return await fn();
    } finally {
      _inflightByConvKey.delete(key);
    }
  })();

  _inflightByConvKey.set(key, p);
  return p;
}

function dbAvailable() {
  return !!getSequelize();
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Normaliza telefone para E.164 (best-effort).
 * - Aceita: "+5511999999999", "5511999999999", "(11) 99999-9999", etc.
 * - Retorna: "+<digits>" ou null
 */
function normalizePhone(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  if (!raw) return null;

  // Mantém apenas dígitos e '+'
  let cleaned = raw.replace(/\s+/g, '').replace(/[^\d+]/g, '');

  // Se houver '+' no meio, remove
  if (cleaned.includes('+') && !cleaned.startsWith('+')) {
    cleaned = `+${cleaned.replace(/\+/g, '')}`;
  }

  // Se não começa com '+', assume que já está em formato internacional sem '+'
  if (!cleaned.startsWith('+')) {
    cleaned = `+${cleaned.replace(/^\+/, '')}`;
  }

  // Validação mínima E.164: +[1-9]\d{10,14}
  if (!/^\+[1-9]\d{10,14}$/.test(cleaned)) return null;
  return cleaned;
}

function ensureTenantId(tenantId) {
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId é obrigatório');
  }
  return tenantId.trim();
}

function normalizeContactName(name) {
  if (name === null || name === undefined) return null;
  const value = String(name).trim();
  return value || null;
}

function isGenericContactName(name, phoneDigits = null) {
  const value = normalizeContactName(name);
  if (!value) return true;
  const low = value.toLowerCase();
  if (low.startsWith('contato ') || low.startsWith('cliente ')) return true;
  if (phoneDigits && value.replace(/\D/g, '') === String(phoneDigits).replace(/\D/g, '')) return true;
  return false;
}

function shouldPromoteContactName({ incomingName, existingName, phoneDigits }) {
  const nextName = normalizeContactName(incomingName);
  if (!nextName) return false;
  if (isGenericContactName(nextName, phoneDigits)) return false;

  const currName = normalizeContactName(existingName);
  if (!currName) return true;
  if (currName === nextName) return false;
  return isGenericContactName(currName, phoneDigits);
}

function maybeUpdateTicketContactName(ticket, contactName, phoneDigits = null) {
  if (!ticket) return ticket;
  const incomingName = normalizeContactName(contactName);
  if (!incomingName) return ticket;

  const currentContext = ticket.context && typeof ticket.context === 'object'
    ? ticket.context
    : {};
  const currentMetadata = currentContext.metadata && typeof currentContext.metadata === 'object'
    ? currentContext.metadata
    : {};
  const existingName = normalizeContactName(currentContext.customer_name) || normalizeContactName(currentMetadata.contactName);

  if (!shouldPromoteContactName({ incomingName, existingName, phoneDigits })) return ticket;

  const updated = queueService.updateTicket(ticket.id, {
    context: {
      ...currentContext,
      metadata: {
        ...currentMetadata,
        contactName: incomingName,
      },
      customer_name: incomingName,
    },
  });
  return updated || ticket;
}

async function touchConversation({ tenantId, conversationId, status = null } = {}) {
  if (!dbAvailable()) return;
  if (!tenantId || !conversationId) return;
  try {
    const ConversationModel = typeof ChannelConversation === 'function' ? ChannelConversation() : ChannelConversation;
    if (!ConversationModel) return;
    const patch = {
      last_message_at: new Date(),
      updated_at: new Date(),
    };
    if (status) patch.status = String(status);
    await ConversationModel.update(patch, {
      where: { tenant_key: String(tenantId), id: String(conversationId) },
    });
  } catch (err) {
    logger.debug('[ConversationTicketLink] Falha ao atualizar conversation (ignorado)', {
      tenantId,
      conversationId,
      error: err.message,
    });
  }
}

/**
 * Resolve ou cria a conversa (ChannelConversation) e garante um ticket aberto associado.
 *
 * @param {string} tenantId
 * @param {'whatsapp'|'instagram'|'webchat'} channelType
 * @param {string} externalConversationId - ID externo da conversa/contato no canal (ex: phone/userId)
 * @param {object} contactRef - referência do contato (ex: { phone, contactId })
 * @returns {Promise<{conversation: any, ticket: any, createdTicket: boolean}>}
 */
async function resolveOrCreateTicketFromIncomingMessage(tenantId, channelType, externalConversationId, contactRef = {}) {
  // Serializa chamadas concorrentes para a mesma conversa.
  // Isso evita criação dupla em race conditions (ex.: webhook retry + QR runner + UI).
  const lockKey = _convKey(tenantId, channelType, externalConversationId);
  return _withInflightLock(lockKey, async () => {
    const effectiveTenantId = ensureTenantId(tenantId);
    if (!channelType || typeof channelType !== 'string') throw new Error('channelType é obrigatório');
    if (!externalConversationId || typeof externalConversationId !== 'string') throw new Error('externalConversationId é obrigatório');

  // Compatibilidade / rollout seguro:
  // - por padrão, NÃO cria ticket automaticamente para todo inbound (evita inundar a UI atual)
  // - quando habilitado, cria ticket "bot" e vincula à conversa.
  // Blip-like: por padrão cria ticket no inbound, mas permite desligar via config.
  // Mantém compatibilidade via flag, mas evita "sistema sem tickets" quando não configurado.
  const createOnInbound = config.get('tickets.createOnInbound', true) === true;

  const ConversationModel = typeof ChannelConversation === 'function' ? ChannelConversation() : ChannelConversation;
  const now = new Date();

  // Resolve conversa por unique (tenant + channel + external)
  let conversation = null;
  if (dbAvailable()) {
    conversation = await ConversationModel.findOne({
      where: {
        tenant_key: effectiveTenantId,
        channel_type: String(channelType),
        external_id: String(externalConversationId),
      },
    });
  }

  const normalizedPhone = normalizePhone(contactRef.phone || externalConversationId);
  const contactId = contactRef.contactId ? String(contactRef.contactId) : (normalizedPhone ? normalizedPhone.replace(/^\+/, '') : null);
  const contactName = normalizeContactName(contactRef.name);

  if (!conversation && dbAvailable()) {
    conversation = await ConversationModel.create({
      id: newId('conv'),
      tenant_key: effectiveTenantId,
      channel_type: String(channelType),
      external_id: String(externalConversationId),
      contact_id: contactId,
      status: 'bot',
      current_ticket_id: null,
      last_message_at: now,
      created_at: now,
      updated_at: now,
    });
  }

  // Sem DB, seguimos com comportamento best-effort: cria ticket por sessionId (whatsapp) e sem conversationId
  if (!conversation) {
    if (!createOnInbound) {
      return { conversation: null, ticket: null, createdTicket: false };
    }

    const sessionId = channelType === 'whatsapp'
      ? `whatsapp_${String(externalConversationId).replace(/^\+/, '')}`
      : `${channelType}_${String(externalConversationId).replace(/^\+/, '')}`;

    const existing = queueService.getTicketBySession(sessionId, effectiveTenantId);
    if (existing && existing.status !== 'closed') {
      return { conversation: null, ticket: existing, createdTicket: false };
    }

    // Quota mensal (best-effort): evita explosão de tickets quando createOnInbound está ligado.
    try {
      const limitCheck = await checkLimit(effectiveTenantId, 'max_conversas_mes', 1);
      if (!limitCheck.allowed) {
        logger.warn('[ConversationTicketLink] Quota excedida; não criando ticket (sem DB)', {
          tenantId: effectiveTenantId,
          resource: 'max_conversas_mes',
          limit: limitCheck.limit,
          current: limitCheck.current,
        });
        return { conversation: null, ticket: null, createdTicket: false };
      }
    } catch (_) {}

    const defaultQueue = config.get('flows.defaultQueue', 'default');
    const ticket = queueService.createTicket({
      tenantId: effectiveTenantId,
      sessionId,
      queue: defaultQueue,
      lastUserMessage: null,
      context: {
        channelType,
        conversationId: null,
        mode: 'bot',
        metadata: {
          externalConversationId,
          contactId,
        },
        // Nome do contato para integração CRM
        customer_name: contactName,
      },
    });
    return { conversation: null, ticket, createdTicket: true };
  }

  // 1) Tenta achar ticket em memória pelo conversationId
  const existingInMemory = queueService.getTicketByConversationId(conversation.id, effectiveTenantId);
  if (existingInMemory && existingInMemory.status !== 'closed') {
    // Best-effort: mantém conversa apontando para o ticket atual
    if (dbAvailable() && existingInMemory.id && conversation.current_ticket_id !== existingInMemory.id) {
      await conversation.update({
        current_ticket_id: existingInMemory.id,
        status: existingInMemory.mode === 'human' ? 'human' : 'bot',
        last_message_at: now,
        updated_at: now,
      }).catch(() => null);
    }
    const updatedTicket = maybeUpdateTicketContactName(existingInMemory, contactName, normalizedPhone || externalConversationId);
    return { conversation, ticket: updatedTicket, createdTicket: false };
  }

  // 2) Tenta achar ticket no DB por conversation_id (ticket aberto)
  let existingDbTicket = null;
  if (dbAvailable()) {
    try {
      const TicketModel = typeof TicketGetter === 'function' ? TicketGetter() : TicketGetter;
      const sequelize = TicketModel.sequelize;
      const Op = sequelize.constructor.Op;
      const row = await TicketModel.findOne({
        where: {
          tenant_key: effectiveTenantId,
          conversation_id: conversation.id,
          status: { [Op.ne]: 'closed' },
        },
        order: [['created_at', 'DESC']],
      });
      if (row) {
        // Insere no cache runtime do queueService (fonte operacional)
        existingDbTicket = queueService._upsertTicketFromDbRow(row);
      }
    } catch (err) {
      logger.debug('[ConversationTicketLink] Falha ao buscar ticket no DB (ignorado)', { error: err.message });
    }
  }

  if (existingDbTicket && existingDbTicket.status !== 'closed') {
    // Best-effort sync channel_conversation
    await conversation.update({
      current_ticket_id: existingDbTicket.id,
      status: existingDbTicket.mode === 'human' ? 'human' : 'bot',
      last_message_at: now,
      updated_at: now,
    }).catch(() => null);
    const updatedTicket = maybeUpdateTicketContactName(existingDbTicket, contactName, normalizedPhone || externalConversationId);
    return { conversation, ticket: updatedTicket, createdTicket: false };
  }

  // 3) Cria ticket novo (modo BOT por padrão)
  if (!createOnInbound) {
    return { conversation, ticket: null, createdTicket: false };
  }

  // Quota mensal (best-effort): limita criação de tickets/“conversas” por mês.
  try {
    const limitCheck = await checkLimit(effectiveTenantId, 'max_conversas_mes', 1);
    if (!limitCheck.allowed) {
      logger.warn('[ConversationTicketLink] Quota excedida; não criando ticket (DB)', {
        tenantId: effectiveTenantId,
        resource: 'max_conversas_mes',
        limit: limitCheck.limit,
        current: limitCheck.current,
      });
      return { conversation, ticket: null, createdTicket: false };
    }
  } catch (_) {}

  const defaultQueue = config.get('flows.defaultQueue', 'default');
  const sessionId = channelType === 'whatsapp'
    ? `whatsapp_${String(externalConversationId).replace(/^\+/, '')}`
    : `${channelType}_${String(externalConversationId).replace(/^\+/, '')}`;

  const ticket = queueService.createTicket({
    tenantId: effectiveTenantId,
    sessionId,
    queue: defaultQueue,
    lastUserMessage: null,
    context: {
      channelType,
      conversationId: conversation.id,
      mode: 'bot',
      metadata: {
        externalConversationId,
        contactId,
        contactName,
      },
      // Nome do contato para integração CRM
      customer_name: contactName,
    },
  });


  // Best-effort: aponta conversa para o ticket atual
  await conversation.update({
    current_ticket_id: ticket.id,
    status: 'bot',
    last_message_at: now,
    updated_at: now,
  }).catch(() => null);

    return { conversation, ticket, createdTicket: true };
  });
}

/**
 * Adiciona mensagem ao histórico do ticket (JSONB) de forma idempotente por externalMessageId.
 *
 * Observação:
 * - Isso é um "ledger" operacional para a UI atual (SupportPage).
 * - A persistência omnichannel e idempotência forte por externalMessageId permanece em channel_messages.
 *
 * @param {string} ticketId
 * @param {{direction:'in'|'out', text?:string, externalMessageId?:string|null, timestamp?:string|null}} normalizedMessage
 * @returns {any|null} ticket atualizado (runtime)
 */
function appendTicketMessage(ticketId, normalizedMessage = {}) {
  if (!ticketId || typeof ticketId !== 'string') throw new Error('ticketId é obrigatório');
  const dir = normalizedMessage.direction === 'out' ? 'out' : 'in';
  const text = normalizedMessage.text ? String(normalizedMessage.text) : '';
  const externalMessageId = normalizedMessage.externalMessageId ? String(normalizedMessage.externalMessageId) : null;
  const timestamp = normalizedMessage.timestamp ? String(normalizedMessage.timestamp) : null;

  const ticket = queueService.getTicket(ticketId);
  if (!ticket) return null;

  // Idempotência por externalMessageId no ledger do ticket
  if (externalMessageId && Array.isArray(ticket.messages)) {
    const already = ticket.messages.some((m) => m && m.externalMessageId && m.externalMessageId === externalMessageId);
    if (already) return ticket;
  }

  if (dir === 'in') {
    const updated = queueService.updateLastMessage(ticketId, text, externalMessageId, timestamp);
    touchConversation({ tenantId: ticket.tenantId, conversationId: ticket.conversationId }).catch(() => {});
    return updated;
  }

  // Outbound: mantém compatibilidade; registra como "agent" no histórico do ticket
  // (o status/idempotência completa para outbound ficará em channel_messages/outbound_queue).
  if (!Array.isArray(ticket.messages)) ticket.messages = [];
  ticket.messages.push({
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text,
    sender: 'agent',
    timestamp: timestamp || new Date().toISOString(),
    externalMessageId: externalMessageId || undefined,
  });
  ticket.updatedAt = new Date().toISOString();
  // Persist best-effort via updateTicket
  const updated = queueService.updateTicket(ticketId, { messages: ticket.messages });
  touchConversation({ tenantId: ticket.tenantId, conversationId: ticket.conversationId }).catch(() => {});
  return updated;
}

module.exports = {
  normalizePhone,
  resolveOrCreateTicketFromIncomingMessage,
  appendTicketMessage,
};
