import { fetchJson } from './client';
import logger from '../utils/logger';

/**
 * API do Inbox (conversas ChannelConversation-based).
 * Contrato: GET /inbox/conversations?status&channelType&limit&offset → { conversations, total }
 */

export function listInboxConversations(options = {}) {
  const params = new URLSearchParams();
  if (options.status) {
    params.append('status', options.status);
  }
  if (options.channelType) {
    params.append('channelType', options.channelType);
  }
  if (options.q) {
    params.append('q', options.q);
  }
  if (options.limit !== undefined) {
    params.append('limit', String(options.limit));
  }
  if (options.offset !== undefined) {
    params.append('offset', String(options.offset));
  }

  const query = params.toString();
  const url = `/inbox/conversations${query ? `?${query}` : ''}`;
  return fetchJson(url, { method: 'GET' });
}

export function getInboxConversation(conversationId) {
  if (!conversationId) {
    return Promise.reject(new Error('getInboxConversation: conversationId é obrigatório'));
  }
  return fetchJson(`/inbox/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'GET',
  });
}

export function replyInboxConversation(conversationId, body) {
  if (!conversationId) {
    return Promise.reject(new Error('replyInboxConversation: conversationId é obrigatório'));
  }
  const text = body != null ? String(body).trim() : '';
  if (!text) {
    return Promise.reject(new Error('replyInboxConversation: body é obrigatório'));
  }

  logger.info('Respondendo conversa (inbox)', { conversationId });

  return fetchJson(`/inbox/conversations/${encodeURIComponent(conversationId)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ body: text }),
  });
}

export function assignInboxConversation(conversationId, assigneeId) {
  if (!conversationId) {
    return Promise.reject(new Error('assignInboxConversation: conversationId é obrigatório'));
  }

  logger.info('Atribuindo conversa (inbox)', { conversationId, assigneeId });

  return fetchJson(`/inbox/conversations/${encodeURIComponent(conversationId)}/assign`, {
    method: 'POST',
    body: JSON.stringify(assigneeId ? { assigneeId } : {}),
  });
}

export function transferInboxConversation(conversationId, { queue, assigneeId } = {}) {
  if (!conversationId) {
    return Promise.reject(new Error('transferInboxConversation: conversationId é obrigatório'));
  }
  if (!queue && !assigneeId) {
    return Promise.reject(new Error('transferInboxConversation: informe queue ou assigneeId'));
  }

  logger.info('Transferindo conversa (inbox)', { conversationId, queue, assigneeId });

  const body = {};
  if (queue) {
    body.queue = queue;
  }
  if (assigneeId) {
    body.assigneeId = assigneeId;
  }

  return fetchJson(`/inbox/conversations/${encodeURIComponent(conversationId)}/transfer`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function addInboxNote(conversationId, note) {
  if (!conversationId) {
    return Promise.reject(new Error('addInboxNote: conversationId é obrigatório'));
  }
  const text = note != null ? String(note).trim() : '';
  if (!text) {
    return Promise.reject(new Error('addInboxNote: note é obrigatório'));
  }

  logger.info('Adicionando nota (inbox)', { conversationId });

  return fetchJson(`/inbox/conversations/${encodeURIComponent(conversationId)}/notes`, {
    method: 'POST',
    body: JSON.stringify({ note: text }),
  });
}

/**
 * Atualiza o status da conversa (open|pending|resolved|closed).
 * Resposta: { ok, conversation }.
 */
export function setInboxConversationStatus(conversationId, status) {
  if (!conversationId) {
    return Promise.reject(new Error('setInboxConversationStatus: conversationId é obrigatório'));
  }
  const normalized = status != null ? String(status).trim() : '';
  if (!normalized) {
    return Promise.reject(new Error('setInboxConversationStatus: status é obrigatório'));
  }

  logger.info('Atualizando status da conversa (inbox)', { conversationId, status: normalized });

  return fetchJson(`/inbox/conversations/${encodeURIComponent(conversationId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: normalized }),
  });
}

/**
 * Cria chamado a partir da conversa (requer capability caseManagement do tenant).
 * 403 { error: 'capability_disabled' } quando a capacidade está desligada.
 */
export function createCaseFromConversation(conversationId, { subject, priority } = {}) {
  if (!conversationId) {
    return Promise.reject(new Error('createCaseFromConversation: conversationId é obrigatório'));
  }

  logger.info('Criando chamado a partir da conversa (inbox)', { conversationId });

  const body = {};
  if (subject) {
    body.subject = subject;
  }
  if (priority) {
    body.priority = priority;
  }

  return fetchJson(`/inbox/conversations/${encodeURIComponent(conversationId)}/case`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
