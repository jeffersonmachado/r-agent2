/**
 * Servi?o de handover bot <-> humano (padr?o Blip).
 *
 * Regras:
 * - Se ticket.mode = 'human', engine N?O deve responder automaticamente.
 * - Se ticket.mode = 'bot', mensagens seguem para engine e o humano pode acompanhar.
 *
 * Este service atualiza o ticket, registra hist?rico e sincroniza status na tabela
 * channel_conversations (best-effort).
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { ChannelConversation, TicketEvent } = require('../db/models');
const { getTicket, setTicketMode } = require('./queueService');
const { emitEvent } = require('./websocketService');
const { autoAssign } = require('./assignmentService');
const { logAction } = require('./auditService');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeErrorMessage(err, fallback = '') {
  if (err == null) return fallback;
  try { return String(err.message); } catch (_) { return safeToString(err, fallback); }
}

function dbAvailable() {
  return !!getSequelize();
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

async function createTicketEventBestEffort({ tenantId, ticketId, type, payload, createdBy = null } = {}) {
  if (!tenantId || !ticketId || !type) return;
  if (!dbAvailable()) return;
  try {
    const Model = typeof TicketEvent === 'function' ? TicketEvent() : TicketEvent;
    const now = new Date();
    await Model.create({
      id: newId('tev'),
      tenant_key: tenantId,
      ticket_id: ticketId,
      type: String(type),
      payload: payload && typeof payload === 'object' ? payload : {},
      created_by: createdBy ? String(createdBy) : null,
      created_at: now,
      updated_at: now,
    });
  } catch (err) {
    logger.debug('[Handover] Falha ao persistir ticket_event (ignorado)', { error: safeErrorMessage(err) });
  }
}

function auditBestEffort({ ticket, agent, action, reason }) {
  try {
    logAction({
      agentId: agent?.id || null,
      username: agent?.username || null,
      tenantId: ticket?.tenantId || null,
      action,
      resource: 'ticket',
      resourceId: ticket?.id || null,
      details: { reason: reason || null, mode: ticket?.mode || null },
      ipAddress: 'internal',
      userAgent: 'internal',
    });
  } catch (_) {}
}

async function updateConversationStatusBestEffort(ticket) {
  if (!dbAvailable()) return;
  if (!ticket?.tenantId || !ticket?.conversationId) return;

  try {
    const ConversationModel = typeof ChannelConversation === 'function' ? ChannelConversation() : ChannelConversation;
    const row = await ConversationModel.findOne({
      where: { tenant_key: ticket.tenantId, id: ticket.conversationId },
    });
    if (!row) return;

    await row.update({
      status: ticket.mode === 'human' ? 'human' : (ticket.mode === 'paused' ? 'paused' : 'bot'),
      current_ticket_id: ticket.id,
      last_message_at: new Date(),
      updated_at: new Date(),
    });
  } catch (err) {
    logger.debug('[Handover] Falha ao atualizar status da conversa (ignorado)', { error: safeErrorMessage(err) });
  }
}

async function takeOver(ticketId, agent, reason = 'agent_takeover') {
  const ticket = getTicket(ticketId);
  if (!ticket) return { success: false, error: 'ticket_not_found' };

  // Se j? est? em humano, idempotente
  if ((ticket.mode || 'bot') === 'human') {
    // Mesmo idempotente, sincroniza status da conversa (best-effort)
    await updateConversationStatusBestEffort(ticket);
    return { success: true, ticket };
  }

  // Atualiza modo e registra hist?rico
  const updated = setTicketMode(ticketId, {
    mode: 'human',
    pauseReason: reason || 'agent_takeover',
    actorId: agent?.id || null,
    actorUsername: agent?.username || null,
  });

  // Fase 3: quando entra em atendimento humano, tenta auto-assign (best-effort)
  // (apenas se status waiting e sem assignedTo; a pr?pria autoAssign cuida de validar).
  autoAssign(updated.id).catch(() => null);

  // Best-effort: sincroniza conversa omnichannel
  await updateConversationStatusBestEffort(updated);

  // Auditoria + TicketEvent (best-effort)
  auditBestEffort({ ticket: updated, agent, action: 'ticket_takeover', reason });
  await createTicketEventBestEffort({
    tenantId: updated.tenantId,
    ticketId: updated.id,
    type: 'handover.takeover',
    payload: { mode: 'human', reason: updated.pauseReason || reason || null, actorId: agent?.id || null, actorUsername: agent?.username || null },
    createdBy: agent?.id || null,
  });

  // Evento WebSocket para atualizar UI
  emitEvent('ticket.updated', {
    ticketId: updated.id,
    ticket: updated,
    change: { type: 'handover', mode: 'human', reason: updated.pauseReason || null },
  }, { tenantId: updated.tenantId, agentId: updated.assignedTo || agent?.id });

  return { success: true, ticket: updated };
}

async function returnToBot(ticketId, agent, reason = 'user_request') {
  const ticket = getTicket(ticketId);
  if (!ticket) return { success: false, error: 'ticket_not_found' };

  // Tickets criados manualmente para atendimento humano podem desabilitar
  // qualquer retorno ao bot via context.allowReturnToBot=false.
  if (ticket?.context?.allowReturnToBot === false) {
    return { success: false, error: 'return_to_bot_not_allowed' };
  }

  // Se j? est? em bot, idempotente
  if ((ticket.mode || 'bot') === 'bot') {
    await updateConversationStatusBestEffort(ticket);
    return { success: true, ticket };
  }

  const updated = setTicketMode(ticketId, {
    mode: 'bot',
    pauseReason: reason || 'user_request',
    actorId: agent?.id || null,
    actorUsername: agent?.username || null,
  });

  await updateConversationStatusBestEffort(updated);

  auditBestEffort({ ticket: updated, agent, action: 'ticket_return_to_bot', reason });
  await createTicketEventBestEffort({
    tenantId: updated.tenantId,
    ticketId: updated.id,
    type: 'handover.return_to_bot',
    payload: { mode: 'bot', reason: updated.pauseReason || reason || null, actorId: agent?.id || null, actorUsername: agent?.username || null },
    createdBy: agent?.id || null,
  });

  emitEvent('ticket.updated', {
    ticketId: updated.id,
    ticket: updated,
    change: { type: 'handover', mode: 'bot', reason: updated.pauseReason || null },
  }, { tenantId: updated.tenantId, agentId: updated.assignedTo || agent?.id });

  return { success: true, ticket: updated };
}

async function setPaused(ticketId, agent, reason = 'outside_window') {
  const ticket = getTicket(ticketId);
  if (!ticket) return { success: false, error: 'ticket_not_found' };

  // Idempotente
  if ((ticket.mode || 'bot') === 'paused') {
    await updateConversationStatusBestEffort(ticket);
    return { success: true, ticket };
  }

  const updated = setTicketMode(ticketId, {
    mode: 'paused',
    pauseReason: reason || 'outside_window',
    actorId: agent?.id || null,
    actorUsername: agent?.username || null,
  });

  await updateConversationStatusBestEffort(updated);

  auditBestEffort({ ticket: updated, agent, action: 'ticket_pause', reason });
  await createTicketEventBestEffort({
    tenantId: updated.tenantId,
    ticketId: updated.id,
    type: 'handover.pause',
    payload: { mode: 'paused', reason: updated.pauseReason || reason || null, actorId: agent?.id || null, actorUsername: agent?.username || null },
    createdBy: agent?.id || null,
  });

  emitEvent('ticket.updated', {
    ticketId: updated.id,
    ticket: updated,
    change: { type: 'handover', mode: 'paused', reason: updated.pauseReason || null },
  }, { tenantId: updated.tenantId, agentId: updated.assignedTo || agent?.id });

  return { success: true, ticket: updated };
}

async function resumeHuman(ticketId, agent, reason = 'resume') {
  const ticket = getTicket(ticketId);
  if (!ticket) return { success: false, error: 'ticket_not_found' };

  // Se j? est? em humano, idempotente
  if ((ticket.mode || 'bot') === 'human') {
    await updateConversationStatusBestEffort(ticket);
    return { success: true, ticket };
  }

  const updated = setTicketMode(ticketId, {
    mode: 'human',
    pauseReason: reason || 'resume',
    actorId: agent?.id || null,
    actorUsername: agent?.username || null,
  });

  // Ao retomar humano, tenta auto-assign (best-effort)
  autoAssign(updated.id).catch(() => null);

  await updateConversationStatusBestEffort(updated);

  auditBestEffort({ ticket: updated, agent, action: 'ticket_resume', reason });
  await createTicketEventBestEffort({
    tenantId: updated.tenantId,
    ticketId: updated.id,
    type: 'handover.resume',
    payload: { mode: 'human', reason: updated.pauseReason || reason || null, actorId: agent?.id || null, actorUsername: agent?.username || null },
    createdBy: agent?.id || null,
  });

  emitEvent('ticket.updated', {
    ticketId: updated.id,
    ticket: updated,
    change: { type: 'handover', mode: 'human', reason: updated.pauseReason || null },
  }, { tenantId: updated.tenantId, agentId: updated.assignedTo || agent?.id });

  return { success: true, ticket: updated };
}

let autoReturnTimer = null;

function startAutoReturnToBot({ inactivityMinutes = 30, intervalMs = 15000 } = {}) {
  if (autoReturnTimer) return;
  const thresholdMs = Math.max(1, Number(inactivityMinutes) || 30) * 60 * 1000;

  autoReturnTimer = setInterval(async () => {
    try {
      // Varre tickets em mem?ria via queueService (fonte do runtime)
      // Import local para evitar ciclo em load inicial
      // eslint-disable-next-line global-require
      const { listAllTickets } = require('./queueService');
      const { tickets } = listAllTickets({ limit: 10000 }) || { tickets: [] };

      const now = Date.now();
      for (const t of tickets) {
        if (!t || t.status === 'closed') continue;
        if ((t.mode || 'bot') !== 'human') continue;
        if (t?.context?.allowReturnToBot === false) continue;

        const last = new Date(t.updatedAt || t.createdAt || 0).getTime();
        if (!last) continue;
        if (now - last < thresholdMs) continue;

        // eslint-disable-next-line no-await-in-loop
        await returnToBot(t.id, { id: 'system', username: 'system' }, 'inactivity');
      }
    } catch (err) {
      logger.debug('[Handover] autoReturnToBot erro (ignorado)', { error: safeErrorMessage(err) });
    }
  }, intervalMs);

  if (autoReturnTimer.unref) autoReturnTimer.unref();
  logger.info('[Handover] autoReturnToBot iniciado', { inactivityMinutes, intervalMs });
}

function stopAutoReturnToBot() {
  if (!autoReturnTimer) return;
  clearInterval(autoReturnTimer);
  autoReturnTimer = null;
  logger.info('[Handover] autoReturnToBot parado');
}

module.exports = {
  takeOver,
  returnToBot,
  setPaused,
  resumeHuman,
  startAutoReturnToBot,
  stopAutoReturnToBot,
};

