/**
 * Ticket Insight Service
 * - Resumo IA (best-effort) para console operacional.
 */

'use strict';

const logger = require('../utils/logger');
const { getTicket, getTicketMessages, updateTicket } = require('./queueService');
const { generateAiResponse } = require('./aiProviderService');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function buildPrompt(ticket, messages) {
  const vars = ticket?.context?.variables && typeof ticket.context.variables === 'object'
    ? ticket.context.variables
    : {};

  const lastMsgs = (messages || []).slice(-12).map((m) => {
    const who = m.sender === 'user' ? 'cliente' : (m.sender === 'agent' ? 'atendente' : 'sistema');
    return `[${who}] ${m.text || ''}`;
  }).join('\n');

  return `Você é um assistente de atendimento. Gere um resumo curto e objetivo do ticket.

Regras:
- Use português do Brasil
- Máximo 6 bullets
- Destaque: intenção do cliente, dados relevantes, status atual, próximos passos sugeridos
- Não invente informações

Contexto do ticket:
- id: ${ticket.id}
- fila: ${ticket.queue}
- status: ${ticket.status}
- modo: ${ticket.mode || 'não informado'}
- telefone: ${ticket.phoneNumber}
- tags: ${(ticket.tags || []).join(', ')}
- variáveis: ${JSON.stringify(vars)}

Últimas mensagens:
${lastMsgs}

Retorne APENAS o texto do resumo (sem markdown de título).`;
}

async function generateAiSummary({ ticketId, tenantId }) {
  const ticket = getTicket(ticketId);
  if (!ticket) return { success: false, error: 'ticket_not_found' };
  const messages = getTicketMessages(ticketId) || [];

  const prompt = buildPrompt(ticket, messages);
  const result = await generateAiResponse(prompt, tenantId, { purpose: 'ticket_ai_summary', ticketId });
  const text = result?.text || '';
  if (!text) {
    logger.error('[TicketInsight] IA retornou resumo vazio. Heuristic fallback removido.', { ticketId });
    return { success: false, error: 'ai_summary_empty', message: 'IA retornou resposta vazia. Heuristic fallback removido — o sistema requer IA funcional.' };
  }

  const summary = {
    text,
    generatedAt: new Date().toISOString(),
    generatedBy: { id: 'ai-summary-service', username: 'IA' },
  };

  updateTicket(ticketId, {
    context: {
      ...(ticket.context || {}),
      aiSummary: summary,
    },
  });

  return { success: true, summary };
}

function getAiSummary(ticketId) {
  const ticket = getTicket(ticketId);
  if (!ticket) return { success: false, error: 'ticket_not_found' };
  return { success: true, summary: ticket?.context?.aiSummary || null };
}

module.exports = {
  generateAiSummary,
  getAiSummary,
};
