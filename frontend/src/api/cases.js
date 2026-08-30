import { fetchJson } from './client';

/**
 * API de Chamados (Case Management).
 * Contrato: GET /cases?status&limit&offset → { cases, total }
 */

export function listCases(options = {}) {
  const params = new URLSearchParams();
  if (options.status) {
    params.append('status', options.status);
  }
  if (options.limit !== undefined) {
    params.append('limit', String(options.limit));
  }
  if (options.offset !== undefined) {
    params.append('offset', String(options.offset));
  }

  const query = params.toString();
  const url = `/cases${query ? `?${query}` : ''}`;
  return fetchJson(url, { method: 'GET' });
}

export function getCase(caseId) {
  if (!caseId) {
    return Promise.reject(new Error('getCase: caseId é obrigatório'));
  }
  return fetchJson(`/cases/${encodeURIComponent(caseId)}`, { method: 'GET' });
}

export function linkConversationToCase(caseId, conversationId) {
  if (!caseId || !conversationId) {
    return Promise.reject(new Error('linkConversationToCase: caseId e conversationId são obrigatórios'));
  }
  return fetchJson(`/cases/${encodeURIComponent(caseId)}/conversations`, {
    method: 'POST',
    body: JSON.stringify({ conversationId }),
  });
}

export function unlinkConversationFromCase(caseId, conversationId) {
  if (!caseId || !conversationId) {
    return Promise.reject(new Error('unlinkConversationFromCase: caseId e conversationId são obrigatórios'));
  }
  return fetchJson(`/cases/${encodeURIComponent(caseId)}/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
  });
}
