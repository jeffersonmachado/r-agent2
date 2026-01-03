import { fetchJson } from './client';

export async function suggestResponse(userMessage, conversationHistory = [], ticketId, tenantId) {
  return fetchJson('/ai/suggest-response', {
    method: 'POST',
    body: JSON.stringify({
      userMessage,
      conversationHistory,
      ticketId,
      tenantId,
    }),
  });
}

export async function rewriteMessage(message, tone = 'professional', context = '', tenantId) {
  return fetchJson('/ai/rewrite-message', {
    method: 'POST',
    body: JSON.stringify({
      message,
      tone,
      context,
      tenantId,
    }),
  });
}

export async function rewriteMultipleMessages(messages, tone = 'professional', tenantId) {
  return fetchJson('/ai/rewrite-multiple', {
    method: 'POST',
    body: JSON.stringify({
      messages,
      tone,
      tenantId,
    }),
  });
}
