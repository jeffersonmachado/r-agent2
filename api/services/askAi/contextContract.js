'use strict';

/**
 * Contrato de contexto do "Perguntar à IA".
 *
 * GAP CONFIRMADO (auditoria 2026-09-11): `POST /api/ask-ai` lia apenas
 * `body.question`. O campo `context` documentado no cabeçalho da rota era
 * simplesmente ignorado — nenhuma tela conseguia informar em que entidade o
 * usuário estava, e o frontend mantinha histórico só visualmente.
 *
 * Este módulo é a barreira de validação do payload: nada arbitrário entra no
 * orquestrador. O contexto de tela é SEMPRE tratado como dica não confiável
 * (ver `@see entity context validation` no orchestrator) — aqui garantimos
 * apenas forma, tamanho e vocabulário.
 */

const MAX_QUESTION_LENGTH = 2000;
const MAX_FIELD_LENGTH = 200;
const MAX_CONVERSATION_ID_LENGTH = 64;
const MAX_HISTORY_MESSAGES = 20;

const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

// Tipos de entidade reconhecidos pelo copiloto. Um tipo desconhecido NÃO é
// aceito: preferimos perder contexto a deixar o cliente escolher vocabulário.
const ENTITY_TYPES = Object.freeze({
  FITNESS_STUDENT: 'FITNESS_STUDENT',
  CUSTOMER: 'CUSTOMER',
  CASE: 'CASE',
  CONVERSATION: 'CONVERSATION',
  CAMPAIGN: 'CAMPAIGN',
  TICKET: 'TICKET',
  ORDER: 'ORDER',
  BOOKING: 'BOOKING',
});

const CONTEXT_FIELDS = Object.freeze({
  route: { maxLength: MAX_FIELD_LENGTH, pattern: /^\/[A-Za-z0-9\-._~/?=&%]*$/ },
  module: { maxLength: 64, pattern: /^[A-Za-z0-9._-]{1,64}$/ },
  pageType: { maxLength: 64, pattern: /^[A-Za-z0-9._-]{1,64}$/ },
  actionContext: { maxLength: MAX_FIELD_LENGTH, pattern: /^[A-Za-z0-9._-]{1,200}$/ },
  entityId: { maxLength: MAX_FIELD_LENGTH, pattern: SAFE_ID_PATTERN },
  workspaceEntityId: { maxLength: MAX_FIELD_LENGTH, pattern: SAFE_ID_PATTERN },
});

const ENTITY_TYPE_FIELD = 'entityType';

function fail(error, message) {
  return { ok: false, error, message };
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

/**
 * Valida o contexto de tela enviado pelo cliente.
 *
 * @returns {{ok: true, value: Object} | {ok: false, error: string, message: string}}
 */
function normalizeContext(rawContext) {
  if (rawContext === undefined || rawContext === null) {
    return { ok: true, value: {} };
  }
  if (typeof rawContext !== 'object' || Array.isArray(rawContext)) {
    return fail('invalid_context', 'Campo "context" deve ser um objeto');
  }

  const value = {};
  for (const [key, raw] of Object.entries(rawContext)) {
    if (key === ENTITY_TYPE_FIELD) {
      const entityType = normalizeOptionalString(raw);
      if (!entityType) continue;
      if (!Object.prototype.hasOwnProperty.call(ENTITY_TYPES, entityType.toUpperCase())) {
        return fail('invalid_entity_type', `entityType não reconhecido: ${entityType}`);
      }
      value.entityType = entityType.toUpperCase();
      continue;
    }

    const rules = CONTEXT_FIELDS[key];
    if (!rules) {
      // Payload arbitrário não é aceito: chave desconhecida invalida o pedido.
      return fail('invalid_context_field', `Campo de contexto não suportado: ${key}`);
    }

    const text = normalizeOptionalString(raw);
    if (text === null) continue;
    if (text.length > rules.maxLength) {
      return fail('invalid_context_field', `Campo de contexto "${key}" excede ${rules.maxLength} caracteres`);
    }
    if (!rules.pattern.test(text)) {
      return fail('invalid_context_field', `Campo de contexto "${key}" tem formato inválido`);
    }
    value[key] = text;
  }

  // entityId sem entityType não é utilizável (e não deve ser inferido).
  if (value.entityId && !value.entityType) {
    return fail('invalid_context', 'entityId exige entityType declarado');
  }

  return { ok: true, value };
}

/**
 * Valida a janela de histórico conversacional enviada pelo cliente.
 * O histórico é sempre reenviado pelo servidor a partir do estado persistido;
 * o cliente pode enviar apenas a pergunta atual. Aceitamos a janela apenas para
 * compatibilidade de transporte — o conteúdo é descartado em favor do estado
 * persistido (nunca confiar em histórico do cliente).
 */
function normalizeHistory(rawHistory) {
  if (rawHistory === undefined || rawHistory === null) return [];
  if (!Array.isArray(rawHistory)) return [];
  return rawHistory.slice(-MAX_HISTORY_MESSAGES);
}

/**
 * Valida o payload completo do endpoint.
 *
 * @param {Object} body
 * @returns {{ok: true, value: {question, conversationId, context}} | {ok: false, error, message}}
 */
function normalizeAskAiPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('invalid_body', 'Corpo da requisição deve ser um objeto JSON');
  }

  if (typeof body.question !== 'string') {
    return fail('invalid_question', 'Campo "question" é obrigatório e deve ser uma string');
  }
  const question = body.question.trim();
  if (!question) {
    return fail('invalid_question', 'Campo "question" é obrigatório e deve ser uma string não vazia');
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return fail('invalid_question', `Pergunta muito longa (máximo ${MAX_QUESTION_LENGTH} caracteres)`);
  }

  let conversationId = null;
  if (body.conversationId !== undefined && body.conversationId !== null) {
    const raw = String(body.conversationId).trim();
    if (raw.length > MAX_CONVERSATION_ID_LENGTH || !CONVERSATION_ID_PATTERN.test(raw)) {
      return fail('invalid_conversation_id', 'conversationId tem formato inválido');
    }
    conversationId = raw;
  }

  const contextResult = normalizeContext(body.context);
  if (!contextResult.ok) return contextResult;

  return {
    ok: true,
    value: {
      question,
      conversationId,
      context: contextResult.value,
      // Transportado mas nunca autoritativo.
      clientHistory: normalizeHistory(body.history),
      resetConversation: body.resetConversation === true,
    },
  };
}

module.exports = {
  MAX_QUESTION_LENGTH,
  MAX_FIELD_LENGTH,
  MAX_CONVERSATION_ID_LENGTH,
  MAX_HISTORY_MESSAGES,
  CONVERSATION_ID_PATTERN,
  ENTITY_TYPES,
  CONTEXT_FIELDS,
  normalizeContext,
  normalizeAskAiPayload,
};
