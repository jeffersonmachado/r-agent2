/**
 * Outbox offline do Inbox (PWA hardened).
 *
 * Quando o operador responde uma conversa sem conexão, a resposta entra numa
 * fila persistente (localStorage) e é reenviada automaticamente quando a rede
 * volta (evento `online`). Nada aqui cria Case/Ticket — é apenas a fila de
 * respostas da conversa (Conversation-first preservado).
 *
 * Cada entrada carrega um `clientMessageId` estável gerado no cliente: o
 * servidor deduplica por (tenant, clientMessageId), então retry após resposta
 * perdida, restart do PWA ou double-flush nunca duplica a mensagem.
 */

const STORAGE_KEY = 'rap_inbox_outbox';

// Após este número de tentativas, a entrada é marcada como `failed`
// (falha não-silenciosa: a UI mostra que a resposta não pôde ser enviada).
const MAX_ATTEMPTS = 5;

const VALID_STATUSES = ['pending', 'sending', 'sent', 'failed'];

function hasStorage() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch (_err) {
    return false;
  }
}

export function generateClientMessageId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_err) {
    // cai no fallback abaixo
  }
  return `cmsg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function newEntryId() {
  return `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Migração tolerante: entradas antigas (sem clientMessageId/createdAt/status)
 * ganham os campos novos; `sending` órfão de um crash volta para `pending`.
 */
function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const status = VALID_STATUSES.includes(raw.status) ? raw.status : 'pending';
  return {
    id: raw.id || newEntryId(),
    conversationId: raw.conversationId,
    body: raw.body,
    clientMessageId: raw.clientMessageId || generateClientMessageId(),
    createdAt: raw.createdAt || raw.queuedAt || new Date().toISOString(),
    attempts: Number.isInteger(raw.attempts) && raw.attempts >= 0 ? raw.attempts : 0,
    status: status === 'sending' || status === 'sent' ? 'pending' : status,
    lastAttemptAt: raw.lastAttemptAt || null,
    lastError: raw.lastError || null,
  };
}

function readQueue() {
  if (!hasStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed.map(normalizeEntry).filter(Boolean);
    // Persiste a migração apenas quando algo mudou (ex.: clientMessageId
    // atribuído a entry antiga), mantendo o id estável entre reloads.
    const needsMigration = parsed.some((raw) => !raw || typeof raw !== 'object'
      || !raw.id
      || !raw.clientMessageId
      || !raw.createdAt
      || !Number.isInteger(raw.attempts)
      || !VALID_STATUSES.includes(raw.status)
      || raw.status === 'sending'
      || raw.status === 'sent');
    if (needsMigration) {
      writeQueue(normalized);
    }
    return normalized;
  } catch (_err) {
    return [];
  }
}

export function listPending() {
  return readQueue();
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

function updateEntry(entry, patch) {
  const queue = readQueue();
  const index = queue.findIndex((item) => item.id === entry.id);
  if (index === -1) return;
  queue[index] = { ...queue[index], ...patch };
  writeQueue(queue);
}

/**
 * Enfileira uma resposta pendente. Dedup por clientMessageId (a chave de
 * idempotência): o mesmo body com ids diferentes são mensagens distintas.
 */
export function enqueueReply({ conversationId, body, clientMessageId }) {
  const queue = readQueue();
  const key = clientMessageId || generateClientMessageId();
  const existing = queue.find((item) => item.clientMessageId === key);
  if (existing) return existing;
  const entry = {
    id: newEntryId(),
    conversationId,
    body,
    clientMessageId: key,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    lastAttemptAt: null,
    lastError: null,
  };
  queue.push(entry);
  writeQueue(queue);
  return entry;
}

export function pendingCount() {
  return readQueue().filter((item) => item.status === 'pending' || item.status === 'sending').length;
}

export function failedCount() {
  return readQueue().filter((item) => item.status === 'failed').length;
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
 * (`replyInboxConversation(conversationId, body, clientMessageId)`). Para no
 * primeiro erro — se a rede ainda está fora, todas as demais falhariam igual.
 * Entradas `failed` (esgotaram as tentativas) não são reenviadas.
 *
 * @returns {{ sent: number, remaining: number, failed: number }}
 */
export async function flushOutbox(replyFn) {
  const queue = readQueue();
  const sendable = queue.filter((item) => item.status === 'pending');
  if (sendable.length === 0) {
    return { sent: 0, remaining: pendingCount(), failed: failedCount() };
  }

  let sent = 0;
  for (const entry of sendable) {
    updateEntry(entry, { status: 'sending' });
    try {
      // eslint-disable-next-line no-await-in-loop
      await replyFn(entry.conversationId, entry.body, entry.clientMessageId);
      // Enviada: poda a entrada (o servidor é a fonte da verdade da mensagem).
      const current = readQueue().filter((item) => item.id !== entry.id);
      writeQueue(current);
      sent += 1;
    } catch (err) {
      const attempts = entry.attempts + 1;
      updateEntry(entry, {
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts,
        lastAttemptAt: new Date().toISOString(),
        lastError: 'Não foi possível enviar',
      });
      break;
    }
  }
  return { sent, remaining: pendingCount(), failed: failedCount() };
}
