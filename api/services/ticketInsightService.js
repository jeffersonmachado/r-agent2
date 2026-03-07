/**
 * Ticket Insight Service
 * - Resumo IA (best-effort) para console operacional.
 */

'use strict';

const logger = require('../utils/logger');
const config = require('../utils/config');
const { getTicket, getTicketMessages, updateTicket } = require('./queueService');
const { generateAiResponse } = require('./aiProviderService');

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
- modo: ${ticket.mode || 'bot'}
- telefone: ${ticket.phoneNumber}
- tags: ${(ticket.tags || []).join(', ')}
- variáveis: ${JSON.stringify(vars)}

Últimas mensagens:
${lastMsgs}

Retorne APENAS o texto do resumo (sem markdown de título).`;
}

function heuristicSummary(ticket, messages) {
  const vars = ticket?.context?.variables && typeof ticket.context.variables === 'object'
    ? ticket.context.variables
    : {};
  const lastUser = ticket?.lastUserMessage || (messages || []).slice().reverse().find(m => m.sender === 'user')?.text || '';
  const keys = Object.keys(vars).slice(0, 8);
  const parts = [];
  if (lastUser) parts.push(`- Última mensagem do cliente: ${lastUser}`);
  if ((ticket.tags || []).length) parts.push(`- Tags: ${(ticket.tags || []).join(', ')}`);
  if (keys.length) parts.push(`- Variáveis: ${keys.map(k => `${k}=${JSON.stringify(vars[k])}`).join(', ')}`);
  parts.push(`- Status: ${ticket.status} • Fila: ${ticket.queue}`);
  return parts.join('\n');
}

async function generateAiSummary({ ticketId, tenantId, agent }) {
  const ticket = getTicket(ticketId);
  if (!ticket) return { success: false, error: 'ticket_not_found' };
  const messages = getTicketMessages(ticketId) || [];

  let text = '';
  let confidence = null;
  try {
    const prompt = buildPrompt(ticket, messages);
    const result = await generateAiResponse(prompt, tenantId, { purpose: 'ticket_ai_summary', ticketId });
    text = result?.text || '';
    confidence = Number.isFinite(Number(result?.confidence)) ? Number(result.confidence) : null;
  } catch (err) {
    const allowHeuristicFallback = config.get('fallbacks.ticketInsightHeuristic', false) === true;
    if (!allowHeuristicFallback) {
      logger.warn('[TicketInsight] Falha ao gerar resumo por IA (sem fallback heurístico)', { error: err.message });
      return { success: false, error: 'ai_summary_failed', message: err.message };
    }
    logger.warn('[TicketInsight] Falha ao gerar resumo por IA (fallback heurístico)', { error: err.message });
    text = heuristicSummary(ticket, messages);
    confidence = 0;
  }

  const summary = {
    text,
    confidence,
    generatedAt: new Date().toISOString(),
    generatedBy: agent ? { id: agent.id, username: agent.username } : null,
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
