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
    return { conversation, ticket: existingInMemory, createdTicket: false };
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
    return { conversation, ticket: existingDbTicket, createdTicket: false };
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
      },
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
    return queueService.updateLastMessage(ticketId, text, externalMessageId, timestamp);
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
  return queueService.updateTicket(ticketId, { messages: ticket.messages });
}

module.exports = {
  normalizePhone,
  resolveOrCreateTicketFromIncomingMessage,
  appendTicketMessage,
};

