/**
 * Outbox offline do Inbox (PWA hardened).
 *
 * Quando o operador responde uma conversa sem conexão, a resposta entra numa
 * fila persistente (localStorage) e é reenviada automaticamente quando a rede
 * volta (evento `online`). Nada aqui cria Case/Ticket — é apenas a fila de
 * respostas da conversa (Conversation-first preservado).
 */

const STORAGE_KEY = 'rap_inbox_outbox';

function hasStorage() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch (_err) {
    return false;
  }
}

export function listPending() {
  if (!hasStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function writeQueue(items) {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (_err) {
    // Quota cheia ou storage bloqueado: falha silenciosa — a UI continua
    // mostrando o toast de pendência e o operador pode reenviar manualmente.
  }
}

/**
 * Enfileira uma resposta pendente. Dedup por (conversationId, body) para
 * evitar duplicidade em double-click/retry do operador.
 */
export function enqueueReply({ conversationId, body }) {
  const queue = listPending();
  const existing = queue.find(
    (item) => item.conversationId === conversationId && item.body === body,
  );
  if (existing) return existing;
  const entry = {
    id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId,
    body,
    queuedAt: new Date().toISOString(),
  };
  queue.push(entry);
  writeQueue(queue);
  return entry;
}

export function pendingCount() {
  return listPending().length;
}

export function clearOutbox() {
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_err) {
    // noop
  }
}

/**
 * Reenvia as respostas pendentes usando a função real de reply da API
 * (`replyInboxConversation(conversationId, body)`). Para no primeiro erro —
 * se a rede ainda está fora, todas as demais falhariam igual.
 *
 * @returns {{ sent: number, remaining: number }}
 */
export async function flushOutbox(replyFn) {
  const queue = listPending();
  if (queue.length === 0) return { sent: 0, remaining: 0 };

  const remaining = [...queue];
  let sent = 0;
  while (remaining.length > 0) {
    const entry = remaining[0];
    try {
      // eslint-disable-next-line no-await-in-loop
      await replyFn(entry.conversationId, entry.body);
      remaining.shift();
      sent += 1;
    } catch (_err) {
      break;
    }
  }
  writeQueue(remaining);
  return { sent, remaining: remaining.length };
}
