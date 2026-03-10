'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { ConversationSummary } = require('../db/models');

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function buildRollingSummary(messages = []) {
  const rows = Array.isArray(messages) ? messages : [];
  if (rows.length === 0) return '';

  const lastUser = rows.slice().reverse().find((m) => m && m.sender === 'user' && m.text);
  const lastAgent = rows.slice().reverse().find((m) => m && m.sender === 'agent' && m.text);
  const lastSystem = rows.slice().reverse().find((m) => m && m.sender === 'system' && m.text);

  const topics = new Set();
  for (const msg of rows.slice(-20)) {
    const text = String(msg?.text || '').toLowerCase();
    if (!text) continue;
    if (/agend|horario|consulta/.test(text)) topics.add('agendamento');
    if (/pag|pix|boleto|cartao/.test(text)) topics.add('pagamento');
    if (/cancel|desmarcar/.test(text)) topics.add('cancelamento');
    if (/problema|erro|falha/.test(text)) topics.add('suporte');
  }

  const bullets = [];
  if (lastUser?.text) bullets.push(`- Última solicitação do cliente: ${String(lastUser.text).slice(0, 220)}`);
  if (lastAgent?.text) bullets.push(`- Última resposta enviada: ${String(lastAgent.text).slice(0, 220)}`);
  if (lastSystem?.text) bullets.push(`- Último evento operacional: ${String(lastSystem.text).slice(0, 180)}`);
  if (topics.size > 0) bullets.push(`- Tópicos recorrentes: ${Array.from(topics).join(', ')}`);
  bullets.push(`- Volume recente: ${rows.length} mensagem(ns) registradas no ticket`);

  return bullets.join('\n');
}

async function refreshRollingSummary({ tenantId, ticketId, conversationId = null, messages = [] }) {
  if (!tenantId || !ticketId) return null;
  const rows = Array.isArray(messages) ? messages : [];
  if (rows.length < 8) return null;

  const text = buildRollingSummary(rows);
  if (!text) return null;

  try {
    const Model = typeof ConversationSummary === 'function' ? ConversationSummary() : ConversationSummary;
    if (!Model) return null;

    const latest = await Model.findOne({
      where: {
        tenant_key: String(tenantId),
        ticket_id: String(ticketId),
        summary_kind: 'rolling',
      },
      order: [['created_at', 'DESC']],
    });

    if (latest && Number(latest.message_count || 0) === rows.length) {
      return latest;
    }

    const firstTs = rows[0]?.timestamp ? new Date(rows[0].timestamp) : null;
    const lastTs = rows[rows.length - 1]?.timestamp ? new Date(rows[rows.length - 1].timestamp) : null;

    const created = await Model.create({
      id: newId('csum'),
      tenant_key: String(tenantId),
      ticket_id: String(ticketId),
      conversation_id: conversationId ? String(conversationId) : null,
      summary_kind: 'rolling',
      summary_text: text,
      window_start_at: firstTs && !Number.isNaN(firstTs.getTime()) ? firstTs : null,
      window_end_at: lastTs && !Number.isNaN(lastTs.getTime()) ? lastTs : null,
      message_count: rows.length,
      metadata_json: {
        strategy: 'heuristic_rolling_summary',
      },
    });

    return created;
  } catch (err) {
    logger.debug('[ConversationCompression] Falha ao atualizar resumo (best-effort)', {
      tenantId,
      ticketId,
      error: err.message,
    });
    return null;
  }
}

module.exports = {
  refreshRollingSummary,
  buildRollingSummary,
};
