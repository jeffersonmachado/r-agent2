import { fetchJson } from './client';
import logger from '../utils/logger';

/**
 * API do Inbox (conversas/tickets unificados).
 */

export function listInboxConversations(options = {}) {
  const params = new URLSearchParams();
  if (options.status) {
    params.append('status', options.status);
  }
  if (options.queue) {
    params.append('queue', options.queue);
  }
  if (options.assignedTo) {
    params.append('assignedTo', options.assignedTo);
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

export function assignInboxConversation(conversationId, assignedTo) {
  if (!conversationId) {
    return Promise.reject(new Error('assignInboxConversation: conversationId é obrigatório'));
  }

  logger.info('Atribuindo conversa (inbox)', { conversationId, assignedTo });

  return fetchJson(`/inbox/conversations/${encodeURIComponent(conversationId)}/assign`, {
    method: 'POST',
    body: JSON.stringify(assignedTo ? { assignedTo } : {}),
  });
}

export function transferInboxConversation(conversationId, { queue, assignedTo } = {}) {
  if (!conversationId) {
    return Promise.reject(new Error('transferInboxConversation: conversationId é obrigatório'));
  }
  if (!queue) {
    return Promise.reject(new Error('transferInboxConversation: queue é obrigatório'));
  }

  logger.info('Transferindo conversa (inbox)', { conversationId, queue, assignedTo });

  const body = { queue };
  if (assignedTo !== undefined) {
    body.assignedTo = assignedTo;
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
