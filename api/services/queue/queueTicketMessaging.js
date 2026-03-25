'use strict';

const {
  safeToString,
  safeTrim,
  safeTrimLower,
} = require('../../utils/defensiveCoercion');

function createMessageId(prefix = 'msg') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function ensureMessagesArray(ticket) {
  if (!Array.isArray(ticket.messages)) {
    ticket.messages = [];
  }
}

function appendUserMessage(ticket, { message, externalMessageId = null, timestampOverride = null, mediaUrl = null, mediaType = null, mimeType = null, fileName = null } = {}) {
  ticket.lastUserMessage = message;
  ticket.updatedAt = new Date().toISOString();
  ensureMessagesArray(ticket);

  if (externalMessageId) {
    const already = ticket.messages.some((m) => m && m.externalMessageId && m.externalMessageId === externalMessageId);
    if (already) {
      return { changed: false };
    }
  }

  ticket.messages.push({
    id: createMessageId('msg'),
    text: message,
    sender: 'user',
    timestamp: timestampOverride || new Date().toISOString(),
    externalMessageId: externalMessageId || undefined,
    type: mediaType || undefined,
    mediaUrl: mediaUrl || undefined,
    mimeType: mimeType || undefined,
    fileName: fileName || undefined,
  });

  if (ticket.status === 'in_progress' && ticket.assignedTo) {
    ticket.unreadCount = (ticket.unreadCount || 0) + 1;
  }

  return { changed: true };
}

function appendAgentMessage(ticket, { message, agentId = null, options = {} } = {}) {
  ensureMessagesArray(ticket);

  const clientMessageId = options && options.clientMessageId ? safeToString(options.clientMessageId) : null;
  const externalMessageId = options && options.externalMessageId ? safeToString(options.externalMessageId) : null;
  const deliveryStatus = options && options.deliveryStatus ? safeToString(options.deliveryStatus) : null;
  const mediaType = options && options.mediaType ? safeTrimLower(options.mediaType) : null;
  const mediaUrl = options && options.mediaUrl ? safeTrim(options.mediaUrl) : null;
  const mediaKind = options && options.mediaKind ? safeTrimLower(options.mediaKind) : null;
  const documentId = options && options.documentId ? safeTrim(options.documentId) : null;
  const fileName = options && options.fileName ? safeTrim(options.fileName) : null;
  const mimeType = options && options.mimeType ? safeTrim(options.mimeType) : null;
  const sizeBytes = Number.isFinite(options && options.sizeBytes) ? Number(options.sizeBytes) : null;

  const messageObj = {
    id: createMessageId('msg'),
    text: message,
    sender: 'agent',
    agentId: agentId || ticket.assignedTo || 'unknown',
    timestamp: new Date().toISOString(),
    clientMessageId: clientMessageId || undefined,
    externalMessageId: externalMessageId || undefined,
    deliveryStatus: deliveryStatus || undefined,
    mediaKind: mediaKind || undefined,
    documentId: documentId || undefined,
    mediaUrl: mediaUrl || undefined,
    fileName: fileName || undefined,
    mimeType: mimeType || undefined,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined,
    type: mediaType || undefined,
    media: (mediaUrl || documentId)
      ? {
        ...(mediaType ? { type: mediaType } : {}),
        ...(mediaUrl ? { url: mediaUrl } : {}),
        ...(fileName ? { fileName } : {}),
        ...(mimeType ? { mimeType } : {}),
        ...(Number.isFinite(sizeBytes) ? { sizeBytes } : {}),
        ...(mediaKind ? { kind: mediaKind } : {}),
        ...(documentId ? { documentId } : {}),
      }
      : undefined,
  };

  ticket.messages.push(messageObj);
  ticket.updatedAt = new Date().toISOString();

  if (!ticket.firstResponseAt) {
    ticket.firstResponseAt = messageObj.timestamp;
    const createdAt = ticket.createdAt ? new Date(ticket.createdAt) : null;
    const first = new Date(ticket.firstResponseAt);
    if (createdAt && !Number.isNaN(createdAt.getTime()) && !Number.isNaN(first.getTime())) {
      ticket.waitingTimeSeconds = Math.max(0, Math.round((first - createdAt) / 1000));
    }
  }

  return { changed: true };
}

function appendTicketNote(ticket, { note, author = null } = {}) {
  const text = note != null ? safeTrim(note) : '';
  if (!text) return { changed: false };

  ensureMessagesArray(ticket);

  const authorId = author && typeof author === 'object' ? (author.id || author.username || null) : null;
  const authorName = author && typeof author === 'object'
    ? (author.username || author.name || author.id || 'system')
    : (author ? safeToString(author, 'system') : 'system');

  ticket.messages.push({
    id: createMessageId('note'),
    text,
    sender: 'note',
    authorId: authorId || undefined,
    authorName: authorName || undefined,
    timestamp: new Date().toISOString(),
  });

  ticket.updatedAt = new Date().toISOString();
  return { changed: true };
}

function applyOutboundMessageMeta(ticket, patch = {}) {
  if (!Array.isArray(ticket.messages) || ticket.messages.length === 0) return { changed: false };

  const clientMessageId = patch.clientMessageId ? safeToString(patch.clientMessageId) : null;
  const externalMessageId = patch.externalMessageId ? safeToString(patch.externalMessageId) : null;
  const deliveryStatus = patch.deliveryStatus ? safeToString(patch.deliveryStatus) : null;
  const reasonCode = patch.reasonCode ? safeToString(patch.reasonCode) : null;
  const lastError = patch.lastError ? safeToString(patch.lastError) : null;
  const errorCode = patch.errorCode ? safeToString(patch.errorCode) : null;
  const errorType = patch.errorType ? safeToString(patch.errorType) : null;
  const failedAt = patch.failedAt ? safeToString(patch.failedAt) : null;
  const attempts = Number.isFinite(patch.attempts) ? Number(patch.attempts) : null;

  let changed = false;

  for (let i = ticket.messages.length - 1; i >= 0; i--) {
    const m = ticket.messages[i];
    if (!m || m.sender !== 'agent') continue;

    const matchClient = clientMessageId && m.clientMessageId && m.clientMessageId === clientMessageId;
    const matchExternal = externalMessageId && m.externalMessageId && m.externalMessageId === externalMessageId;
    if (!matchClient && !matchExternal) continue;

    if (externalMessageId && !m.externalMessageId) {
      m.externalMessageId = externalMessageId;
      changed = true;
    }
    if (deliveryStatus && m.deliveryStatus !== deliveryStatus) {
      m.deliveryStatus = deliveryStatus;
      changed = true;
    }

    if (reasonCode && m.reasonCode !== reasonCode) {
      m.reasonCode = reasonCode;
      changed = true;
    }
    if (lastError && m.lastError !== lastError) {
      m.lastError = lastError;
      changed = true;
    }
    if (errorCode && m.errorCode !== errorCode) {
      m.errorCode = errorCode;
      changed = true;
    }
    if (errorType && m.errorType !== errorType) {
      m.errorType = errorType;
      changed = true;
    }
    if (failedAt && m.failedAt !== failedAt) {
      m.failedAt = failedAt;
      changed = true;
    }
    if (Number.isFinite(attempts) && m.attempts !== attempts) {
      m.attempts = attempts;
      changed = true;
    }

    if (deliveryStatus && deliveryStatus !== 'failed') {
      // Limpa metadados de erro quando a mensagem avança para estado não-falho.
      if (m.reasonCode) { m.reasonCode = undefined; changed = true; }
      if (m.lastError) { m.lastError = undefined; changed = true; }
      if (m.errorCode) { m.errorCode = undefined; changed = true; }
      if (m.errorType) { m.errorType = undefined; changed = true; }
      if (m.failedAt) { m.failedAt = undefined; changed = true; }
      if (m.attempts !== undefined) { m.attempts = undefined; changed = true; }
    }
    break;
  }

  if (changed) {
    ticket.updatedAt = new Date().toISOString();
  }

  return { changed };
}

function resetUnreadCount(ticket) {
  ticket.unreadCount = 0;
  ticket.updatedAt = new Date().toISOString();
  return { changed: true };
}

module.exports = {
  appendUserMessage,
  appendAgentMessage,
  appendTicketNote,
  applyOutboundMessageMeta,
  resetUnreadCount,
};