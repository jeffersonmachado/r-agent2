import { fetchJson } from './client';
import logger from '../utils/logger';

/**
 * Lista mensagens persistidas do Channel Gateway para uma conversa.
 *
 * Backend: GET /conversations/:id/messages
 *
 * @param {string} conversationId
 * @param {Object} [options]
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 * @returns {Promise<{conversationId: string, messages: any[], total: number}>}
 */
export function getConversationMessages(conversationId, options = {}) {
  if (!conversationId) {
    return Promise.reject(new Error('getConversationMessages: conversationId é obrigatório'));
  }

  const params = new URLSearchParams();
  if (options.limit !== undefined) params.append('limit', String(options.limit));
  if (options.offset !== undefined) params.append('offset', String(options.offset));

  const query = params.toString();
  const url = `/conversations/${encodeURIComponent(conversationId)}/messages${query ? `?${query}` : ''}`;

  logger.info('Carregando mensagens da conversa (channels)', { conversationId, limit: options.limit, offset: options.offset });
  return fetchJson(url, { method: 'GET' });
}

