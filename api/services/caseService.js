/**
 * Case Service — conceito "Case/Chamado" sobre a persistência legada de Ticket.
 *
 * Decisões:
 * - NÃO renomeia tabela: um case é um ticket (queueService + tickets no Postgres).
 * - Link N:N case ↔ conversas em case_conversations (persistência dedicada,
 *   sem fallback em memória).
 * - Isolamento de tenant obrigatório (tenant_key) em TODAS as queries;
 *   cross-tenant → 404 fail-closed.
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { CaseConversation, Ticket } = require('../db/models');
const queueService = require('./queueService');
const channelConversationService = require('./channelConversationService');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeErrorMessage(err, fallback = '') {
  try {
    const message = err && typeof err === 'object' ? err.message : null;
    return safeToString(message) || safeToString(err, fallback);
  } catch (_) {
    return safeToString(err, fallback);
  }
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function persistenceRequiredError() {
  const err = new Error('persistence_required: sequelize indisponível para case management');
  err.code = 'persistence_required';
  return err;
}

function dbAvailable() {
  return !!getSequelize();
}

function resolveModel(getter) {
  return typeof getter === 'function' ? getter() : getter;
}

function mapTicketToCase(ticket) {
  if (!ticket) return null;
  const json = typeof ticket.toJSON === 'function' ? ticket.toJSON() : ticket;
  const context = json.context && typeof json.context === 'object' ? json.context : {};
  const metadata = context.metadata && typeof context.metadata === 'object' ? context.metadata : {};
  return {
    id: json.id,
    tenantId: json.tenant_key || json.tenantId || null,
    subject: metadata.subject || json.last_user_message || null,
    status: json.status || null,
    priority: metadata.priority || json.priority || null,
    queue: json.queue || null,
    assignedTo: json.assigned_to || json.assignedTo || null,
    conversationId: json.conversation_id || json.conversationId || null,
    channelType: json.channel_type || json.channelType || null,
    sla: json.sla || metadata.sla || null,
    createdAt: json.created_at ? new Date(json.created_at).toISOString() : (json.createdAt || null),
    updatedAt: json.updated_at ? new Date(json.updated_at).toISOString() : (json.updatedAt || null),
  };
}

async function findCaseRow({ tenantKey, caseId }) {
  const TicketModel = resolveModel(Ticket);
  return TicketModel.findOne({
    where: { tenant_key: safeToString(tenantKey), id: safeToString(caseId) },
  });
}

async function linkExists({ tenantKey, caseId, conversationId }) {
  const LinkModel = resolveModel(CaseConversation);
  return LinkModel.findOne({
    where: {
      tenant_key: safeToString(tenantKey),
      case_id: safeToString(caseId),
      conversation_id: safeToString(conversationId),
    },
  });
}

async function createLink({ tenantKey, caseId, conversationId, metadata = {} }) {
  const LinkModel = resolveModel(CaseConversation);
  const now = new Date();
  const row = await LinkModel.create({
    id: newId('caselink'),
    tenant_key: safeToString(tenantKey),
    case_id: safeToString(caseId),
    conversation_id: safeToString(conversationId),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    created_at: now,
    updated_at: now,
  });
  return row;
}

/**
 * Cria um case a partir de uma conversa do inbox:
 * ticket (queueService) + link em case_conversations + current_ticket_id na conversa.
 * Idempotente: se a conversa já aponta para um case aberto, retorna o case existente.
 */
async function createCaseFromConversation({ tenantKey, conversationId, subject = null, priority = null, createdBy = null } = {}) {
  const tenant = safeToString(tenantKey).trim();
  if (!tenant) throw new Error('tenantKey é obrigatório');
  if (!conversationId) throw new Error('conversationId é obrigatório');
  if (!dbAvailable()) throw persistenceRequiredError();

  const conversation = await channelConversationService.getConversation({ tenantId: tenant, conversationId });
  if (!conversation) {
    return { ok: false, status: 404, error: 'conversation_not_found' };
  }

  // Idempotência: conversa já vinculada a um case aberto → retorna o existente.
  if (conversation.currentTicketId) {
    const existingRow = await findCaseRow({ tenantKey: tenant, caseId: conversation.currentTicketId });
    if (existingRow && existingRow.status !== 'closed') {
      const existingLink = await linkExists({ tenantKey: tenant, caseId: existingRow.id, conversationId });
      if (!existingLink) {
        await createLink({ tenantKey: tenant, caseId: existingRow.id, conversationId, metadata: { source: 'inbox' } });
      }
      return { ok: true, status: 200, case: mapTicketToCase(existingRow), alreadyExisted: true };
    }
  }

  const ticket = queueService.createTicket({
    tenantId: tenant,
    sessionId: `case_${conversation.channelType}_${conversation.externalId}`,
    queue: 'cases',
    lastUserMessage: subject || null,
    context: {
      channelType: conversation.channelType,
      conversationId: conversation.id,
      mode: 'human',
      metadata: {
        source: 'inbox_case',
        ...(subject ? { subject: safeToString(subject) } : {}),
        ...(priority ? { priority: safeToString(priority) } : {}),
        ...(createdBy ? { createdBy: safeToString(createdBy) } : {}),
      },
    },
    category: 'case',
  });

  await createLink({
    tenantKey: tenant,
    caseId: ticket.id,
    conversationId: conversation.id,
    metadata: { source: 'inbox' },
  });

  await channelConversationService.updateConversation({
    tenantId: tenant,
    conversationId: conversation.id,
    patch: { current_ticket_id: ticket.id, status: 'human' },
  });

  logger.info('[CaseService] Case criado a partir de conversa', {
    tenantKey: tenant,
    caseId: ticket.id,
    conversationId: conversation.id,
  });

  const row = await findCaseRow({ tenantKey: tenant, caseId: ticket.id });
  return { ok: true, status: 201, case: mapTicketToCase(row || ticket) };
}

async function listCases({ tenantKey, status = null, limit = 100, offset = 0 } = {}) {
  const tenant = safeToString(tenantKey).trim();
  if (!tenant) throw new Error('tenantKey é obrigatório');
  if (!dbAvailable()) throw persistenceRequiredError();

  const TicketModel = resolveModel(Ticket);
  const where = { tenant_key: tenant };
  const statusValue = safeToString(status).trim();
  if (statusValue) where.status = statusValue;

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const { count, rows } = await TicketModel.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit: safeLimit,
    offset: safeOffset,
  });

  return { cases: rows.map(mapTicketToCase), total: count };
}

async function getCase({ tenantKey, caseId } = {}) {
  const tenant = safeToString(tenantKey).trim();
  if (!tenant) throw new Error('tenantKey é obrigatório');
  if (!caseId) throw new Error('caseId é obrigatório');
  if (!dbAvailable()) throw persistenceRequiredError();

  const row = await findCaseRow({ tenantKey: tenant, caseId });
  if (!row) return null;
  return mapTicketToCase(row);
}

/**
 * Vincula uma conversa a um case existente. Idempotente.
 * Cross-tenant (conversa ou case de outro tenant) → 404 fail-closed.
 */
async function linkConversationToCase({ tenantKey, caseId, conversationId } = {}) {
  const tenant = safeToString(tenantKey).trim();
  if (!tenant) throw new Error('tenantKey é obrigatório');
  if (!dbAvailable()) throw persistenceRequiredError();

  const caseRow = await findCaseRow({ tenantKey: tenant, caseId });
  if (!caseRow) {
    return { ok: false, status: 404, error: 'case_not_found' };
  }

  const conversation = await channelConversationService.getConversation({ tenantId: tenant, conversationId });
  if (!conversation) {
    // Fail-closed: não distingue "não existe" de "outro tenant".
    return { ok: false, status: 404, error: 'conversation_not_found' };
  }

  const existing = await linkExists({ tenantKey: tenant, caseId, conversationId });
  if (existing) {
    return { ok: true, status: 200, link: { caseId, conversationId }, alreadyExisted: true };
  }

  await createLink({ tenantKey: tenant, caseId, conversationId, metadata: { source: 'manual_link' } });

  // Best-effort: conversa passa a apontar para o case mais recente.
  try {
    await channelConversationService.updateConversation({
      tenantId: tenant,
      conversationId,
      patch: { current_ticket_id: safeToString(caseId) },
    });
  } catch (err) {
    logger.warn('[CaseService] Falha ao atualizar current_ticket_id da conversa (ignorado)', {
      tenantKey: tenant,
      caseId,
      conversationId,
      error: safeErrorMessage(err),
    });
  }

  return { ok: true, status: 201, link: { caseId, conversationId } };
}

async function unlinkConversation({ tenantKey, caseId, conversationId } = {}) {
  const tenant = safeToString(tenantKey).trim();
  if (!tenant) throw new Error('tenantKey é obrigatório');
  if (!dbAvailable()) throw persistenceRequiredError();

  const caseRow = await findCaseRow({ tenantKey: tenant, caseId });
  if (!caseRow) {
    return { ok: false, status: 404, error: 'case_not_found' };
  }

  const LinkModel = resolveModel(CaseConversation);
  const removed = await LinkModel.destroy({
    where: {
      tenant_key: tenant,
      case_id: safeToString(caseId),
      conversation_id: safeToString(conversationId),
    },
  });

  return { ok: true, status: 200, removed: removed > 0 };
}

async function listCaseConversations({ tenantKey, caseId } = {}) {
  const tenant = safeToString(tenantKey).trim();
  if (!tenant) throw new Error('tenantKey é obrigatório');
  if (!dbAvailable()) throw persistenceRequiredError();

  const LinkModel = resolveModel(CaseConversation);
  const links = await LinkModel.findAll({
    where: { tenant_key: tenant, case_id: safeToString(caseId) },
    order: [['created_at', 'ASC']],
  });

  const conversations = [];
  for (const link of links) {
    const json = typeof link.toJSON === 'function' ? link.toJSON() : link;
    try {
      // eslint-disable-next-line no-await-in-loop
      const conversation = await channelConversationService.getConversation({
        tenantId: tenant,
        conversationId: json.conversation_id,
      });
      if (conversation) conversations.push(conversation);
    } catch (err) {
      logger.warn('[CaseService] Falha ao carregar conversa vinculada (ignorado)', {
        tenantKey: tenant,
        caseId,
        conversationId: json.conversation_id,
        error: safeErrorMessage(err),
      });
    }
  }

  return conversations;
}

module.exports = {
  createCaseFromConversation,
  listCases,
  getCase,
  linkConversationToCase,
  unlinkConversation,
  listCaseConversations,
};
