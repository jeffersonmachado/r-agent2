'use strict';

/**
 * Estado conversacional do "Perguntar à IA".
 *
 * Requisitos:
 *  - multi-turn real: a segunda pergunta entende a primeira (janela persistida);
 *  - isolamento por tenant E por usuário (nunca cross-tenant/cross-user);
 *  - janela limitada + sumário quando a janela estoura (token budget);
 *  - expiração por política de retenção;
 *  - persistência obrigatória: sem fallback em memória (falha de DB →
 *    `persistence_required`);
 *  - o histórico enviado pelo cliente é IGNORADO (não é autoridade).
 */

const crypto = require('crypto');

const logger = require('../../utils/logger');
const getAskAiConversationModel = require('../../db/models/AskAiConversation');
const { getSequelize } = require('../../db/sequelize');

const MAX_HISTORY_MESSAGES = 12;       // 6 turnos (user+assistant)
const MAX_HISTORY_CHARS = 8000;        // orçamento de caracteres da janela
const MAX_MESSAGE_CHARS = 2000;        // mesma política da pergunta
const DEFAULT_RETENTION_DAYS = 30;

function getRetentionDays() {
  const raw = Number.parseInt(String(process.env.ASK_AI_CONVERSATION_RETENTION_DAYS || ''), 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_RETENTION_DAYS;
}

function persistenceError(message) {
  const error = new Error(message || 'ask_ai_conversation_persistence_required');
  error.code = 'PERSISTENCE_REQUIRED';
  return error;
}

function requireModel() {
  if (!getSequelize()) {
    throw persistenceError('Banco indisponível para o estado conversacional do Ask AI');
  }
  return getAskAiConversationModel();
}

function generateConversationId() {
  return `conv_${crypto.randomBytes(12).toString('hex')}`;
}

function userKeyFor(actor) {
  const key = String(actor?.id || actor?.username || '').trim();
  return key || null;
}

function expiryFrom(now = new Date()) {
  return new Date(now.getTime() + getRetentionDays() * 86400000);
}

function truncate(text, max = MAX_MESSAGE_CHARS) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Abre (ou reutiliza) uma conversa do ator.
 *
 * @returns {Promise<Object>} instância do model
 * @throws {Error} PERSISTENCE_REQUIRED | BAD_REQUEST
 */
async function openConversation({ conversationId = null, tenantId, actor, context = {} }) {
  const Model = requireModel();
  const userKey = userKeyFor(actor);
  if (!tenantId || !userKey) {
    const error = new Error('tenant e usuário são obrigatórios para abrir conversa');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  if (conversationId) {
    const existing = await Model.findOne({
      where: { id: conversationId, tenantKey: tenantId, userKey },
    });
    if (existing) {
      if (existing.status !== 'active') {
        const error = new Error('conversation_archived');
        error.code = 'NOT_FOUND';
        throw error;
      }
      return existing;
    }
    // conversationId de outro tenant/usuário não existe para este ator:
    // comportamento idêntico a id inexistente (não vaza existência).
    const error = new Error(`Conversa não encontrada: ${conversationId}`);
    error.code = 'NOT_FOUND';
    throw error;
  }

  return Model.create({
    id: generateConversationId(),
    tenantKey: tenantId,
    userKey,
    agentId: actor?.id ? String(actor.id) : null,
    username: actor?.username ? String(actor.username) : null,
    status: 'active',
    context: context || {},
    messages: [],
    summary: null,
    turnCount: 0,
    lastActivityAt: new Date(),
    expiresAt: expiryFrom(),
  });
}

/**
 * Aplica orçamento de janela: mantém os últimos N turnos dentro do orçamento
 * de caracteres e consolida o excedente em sumário textual.
 */
function applyWindow(messages, existingSummary = null) {
  const list = Array.isArray(messages) ? messages : [];
  let start = Math.max(0, list.length - MAX_HISTORY_MESSAGES);
  let window = list.slice(start);

  let totalChars = window.reduce((sum, message) => sum + String(message.content || '').length, 0);
  while (window.length > 2 && totalChars > MAX_HISTORY_CHARS) {
    const dropped = window.shift();
    start += 1;
    totalChars -= String(dropped.content || '').length;
  }

  const dropped = list.slice(0, start);
  let summary = existingSummary || null;
  if (dropped.length > 0) {
    const previous = summary ? `${summary}\n` : '';
    // Sumário determinístico e compacto: quem disse o quê, sem paráfrase LLM.
    const digest = dropped
      .map((message) => `${message.role === 'user' ? 'Usuário' : 'IA'}: ${truncate(message.content, 200)}`)
      .join('\n');
    summary = `${previous}${digest}`.slice(-4000);
  }

  return { window, summary };
}

/**
 * Registra um turno completo (pergunta do usuário + resposta da IA).
 *
 * @returns {Promise<{conversation: Object, window: Array, summary: string|null}>}
 */
async function appendTurn({
  conversation,
  question,
  answer,
  sources = [],
  facts = [],
  intent = null,
  context = null,
}) {
  if (!conversation) throw persistenceError('Conversa não carregada');

  const now = new Date().toISOString();
  const appended = [
    ...(Array.isArray(conversation.messages) ? conversation.messages : []),
    { role: 'user', content: truncate(question), createdAt: now },
    {
      role: 'assistant',
      content: truncate(answer),
      sources: Array.isArray(sources) ? sources.slice(0, 6) : [],
      // Provenance resumida: apenas chaves/labels, nunca valores sensíveis.
      facts: Array.isArray(facts)
        ? facts.slice(0, 12).map((fact) => ({ key: fact.key, label: fact.label, value: fact.value }))
        : [],
      intent: intent || null,
      createdAt: now,
    },
  ];

  const { window, summary } = applyWindow(appended, conversation.summary);

  conversation.messages = window;
  conversation.summary = summary;
  conversation.turnCount = (Number(conversation.turnCount) || 0) + 1;
  conversation.lastActivityAt = new Date();
  conversation.expiresAt = expiryFrom();
  if (context && typeof context === 'object') {
    conversation.context = context;
  }
  conversation.changed('messages', true);
  conversation.changed('context', true);
  await conversation.save();

  return { conversation, window, summary };
}

/**
 * Janela pronta para o prompt: sumário + turnos recentes.
 * Nunca inclui o histórico enviado pelo cliente.
 *
 * A projeção preserva `intent` do turno assistente: é o que permite a
 * CONTINUIDADE multi-turno (herdar a família de intenção de um acompanhamento
 * curto) sem reinterpretar a pergunta isolada. `sources`/`facts` não entram —
 * o prompt precisa do texto, não da proveniência.
 */
function buildPromptHistory(conversation) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  return {
    summary: conversation?.summary || null,
    messages: messages.map((message) => ({
      role: message.role,
      content: String(message.content || ''),
      intent: message.intent || null,
    })),
  };
}

/**
 * Marca a conversa como encerrada. Não altera dados de negócio.
 */
async function closeConversation({ conversationId, tenantId, actor }) {
  const Model = requireModel();
  const userKey = userKeyFor(actor);
  if (!conversationId || !tenantId || !userKey) {
    const error = new Error('conversationId, tenant e usuário são obrigatórios');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  const [updated] = await Model.update(
    { status: 'archived', lastActivityAt: new Date() },
    { where: { id: conversationId, tenantKey: tenantId, userKey } },
  );
  return { closed: updated > 0 };
}

/**
 * Remove conversas expiradas do tenant (retenção).
 * Executado sob demanda — nunca em background implícito.
 */
async function purgeExpired({ tenantId = null } = {}) {
  const Model = requireModel();
  const { Op } = require('sequelize');
  const where = { expiresAt: { [Op.lt]: new Date() } };
  if (tenantId) where.tenantKey = tenantId;
  const removed = await Model.destroy({ where });
  if (removed > 0) {
    logger.info('[ask-ai] Conversas expiradas removidas', { tenantId, removed });
  }
  return { removed };
}

module.exports = {
  MAX_HISTORY_MESSAGES,
  MAX_HISTORY_CHARS,
  DEFAULT_RETENTION_DAYS,
  getRetentionDays,
  generateConversationId,
  openConversation,
  appendTurn,
  applyWindow,
  buildPromptHistory,
  closeConversation,
  purgeExpired,
};
