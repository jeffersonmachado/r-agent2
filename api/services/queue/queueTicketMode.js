'use strict';

function buildModeConversationPatch({ mode, ticketId }) {
  return {
    status: mode === 'human' ? 'human' : (mode === 'bot' ? 'bot' : 'paused'),
    current_ticket_id: mode === 'human' ? ticketId : (mode === 'bot' ? ticketId : ticketId),
    last_message_at: new Date(),
  };
}

function applyTicketMode(ticket, params = {}) {
  const mode = (params.mode === 'bot' || params.mode === 'human' || params.mode === 'paused')
    ? params.mode
    : 'human';
  const pauseReason = params.pauseReason || null;

  ticket.mode = mode;
  ticket.pauseReason = pauseReason;
  const nowIso = new Date().toISOString();
  ticket.updatedAt = nowIso;

  if (mode === 'human') {
    ticket.takeoverAt = nowIso;
    ticket.takeoverReason = pauseReason;
  } else if (mode === 'bot') {
    ticket.returnToBotAt = nowIso;
    ticket.returnReason = pauseReason;
  }

  if (!ticket.context) ticket.context = {};
  if (!Array.isArray(ticket.context.handoverHistory)) ticket.context.handoverHistory = [];

  ticket.context.handoverHistory.push({
    type: mode === 'human' ? 'takeover' : (mode === 'bot' ? 'return_to_bot' : 'paused'),
    mode,
    reason: pauseReason,
    actorId: params.actorId || null,
    actorUsername: params.actorUsername || null,
    timestamp: nowIso,
  });

  if (!Array.isArray(ticket.messages)) ticket.messages = [];
  ticket.messages.push({
    id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text: mode === 'human'
      ? `Atendimento assumido por humano${pauseReason ? ` (${pauseReason})` : ''}.`
      : (mode === 'bot'
        ? `Atendimento devolvido ao bot${pauseReason ? ` (${pauseReason})` : ''}.`
        : `Atendimento pausado${pauseReason ? ` (${pauseReason})` : ''}.`),
    sender: 'system',
    timestamp: nowIso,
  });

  return {
    mode,
    conversationPatch: buildModeConversationPatch({ mode, ticketId: ticket.id }),
  };
}

module.exports = {
  applyTicketMode,
};