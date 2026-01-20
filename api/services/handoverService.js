/**
 * Serviço de handover bot <-> humano (padrão Blip).
 *
 * Regras:
 * - Se ticket.mode = 'human', engine NÃO deve responder automaticamente.
 * - Se ticket.mode = 'bot', mensagens seguem para engine e o humano pode acompanhar.
 *
 * Este service atualiza o ticket, registra histórico e sincroniza status na tabela
 * channel_conversations (best-effort).
 */

'use strict';

const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { ChannelConversation } = require('../db/models');
const { getTicket, setTicketMode } = require('./queueService');
const { emitEvent } = require('./websocketService');

function dbAvailable() {
  return !!getSequelize();
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
    logger.debug('[Handover] Falha ao atualizar status da conversa (ignorado)', { error: err.message });
  }
}

async function takeOver(ticketId, agent, reason = 'agent_takeover') {
  const ticket = getTicket(ticketId);
  if (!ticket) return { success: false, error: 'ticket_not_found' };

  // Se já está em humano, idempotente
  if ((ticket.mode || 'bot') === 'human') {
    // Mesmo idempotente, sincroniza status da conversa (best-effort)
    await updateConversationStatusBestEffort(ticket);
    return { success: true, ticket };
  }

  // Atualiza modo e registra histórico
  const updated = setTicketMode(ticketId, {
    mode: 'human',
    pauseReason: reason || 'agent_takeover',
    actorId: agent?.id || null,
    actorUsername: agent?.username || null,
  });

  // Best-effort: sincroniza conversa omnichannel
  await updateConversationStatusBestEffort(updated);

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

  // Se já está em bot, idempotente
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

  emitEvent('ticket.updated', {
    ticketId: updated.id,
    ticket: updated,
    change: { type: 'handover', mode: 'paused', reason: updated.pauseReason || null },
  }, { tenantId: updated.tenantId, agentId: updated.assignedTo || agent?.id });

  return { success: true, ticket: updated };
}

let autoReturnTimer = null;

function startAutoReturnToBot({ inactivityMinutes = 30, intervalMs = 15000 } = {}) {
  if (autoReturnTimer) return;
  const thresholdMs = Math.max(1, Number(inactivityMinutes) || 30) * 60 * 1000;

  autoReturnTimer = setInterval(async () => {
    try {
      // Varre tickets em memória via queueService (fonte do runtime)
      // Import local para evitar ciclo em load inicial
      // eslint-disable-next-line global-require
      const { listAllTickets } = require('./queueService');
      const { tickets } = listAllTickets({ limit: 10000 }) || { tickets: [] };

      const now = Date.now();
      for (const t of tickets) {
        if (!t || t.status === 'closed') continue;
        if ((t.mode || 'bot') !== 'human') continue;

        const last = new Date(t.updatedAt || t.createdAt || 0).getTime();
        if (!last) continue;
        if (now - last < thresholdMs) continue;

        // eslint-disable-next-line no-await-in-loop
        await returnToBot(t.id, { id: 'system', username: 'system' }, 'inactivity');
      }
    } catch (err) {
      logger.debug('[Handover] autoReturnToBot erro (ignorado)', { error: err.message });
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
  startAutoReturnToBot,
  stopAutoReturnToBot,
};

