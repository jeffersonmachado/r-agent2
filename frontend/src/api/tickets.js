import { fetchJson } from './client';
import logger from '../utils/logger';

/**
 * Funções para trabalhar com tickets e filas de atendimento.
 */

/**
 * Lista todas as filas disponíveis.
 *
 * @returns {Promise<string[]>}
 */
export function listQueues() {
  return fetchJson('/queues', {
    method: 'GET',
  });
}

/**
 * Lista tickets de uma fila específica.
 *
 * @param {string} queue - Nome da fila
 * @param {Object} [options]
 * @param {string} [options.status] - Filtrar por status
 * @returns {Promise<any[]>}
 */
export function listQueueTickets(queue, options = {}) {
  if (!queue) {
    return Promise.reject(new Error('listQueueTickets: queue é obrigatório'));
  }

  const params = new URLSearchParams();
  if (options.status) {
    params.append('status', options.status);
  }

  const query = params.toString();
  const url = `/queues/${encodeURIComponent(queue)}/tickets${query ? `?${query}` : ''}`;

  return fetchJson(url, {
    method: 'GET',
  });
}

/**
 * Lista todos os tickets (com filtros opcionais e paginação).
 *
 * @param {Object} [options]
 * @param {string} [options.status] - Filtrar por status
 * @param {string} [options.queue] - Filtrar por fila
 * @param {number} [options.limit] - Limite de resultados (padrão: 1000)
 * @param {number} [options.offset] - Offset para paginação (padrão: 0)
 * @returns {Promise<{tickets: any[], total: number, limit: number, offset: number}>}
 */
export function listAllTickets(options = {}) {
  const params = new URLSearchParams();
  if (options.status) {
    params.append('status', options.status);
  }
  if (options.queue) {
    params.append('queue', options.queue);
  }
  if (options.limit !== undefined) {
    params.append('limit', String(options.limit));
  }
  if (options.offset !== undefined) {
    params.append('offset', String(options.offset));
  }
  if (options.contactId) {
    params.append('contactId', String(options.contactId));
  }
  if (options.phoneNumber) {
    params.append('phoneNumber', String(options.phoneNumber));
  }

  const query = params.toString();
  const url = `/tickets${query ? `?${query}` : ''}`;

  return fetchJson(url, {
    method: 'GET',
  }).then((response) => {
    if (Array.isArray(response)) {
      return {
        tickets: response,
        total: response.length,
        limit: response.length,
        offset: 0,
      };
    }
    return response;
  });
}

/**
 * Lista tickets com paginação por cursor e busca backend.
 * Compatível com retorno legado em array.
 *
 * @param {Object} [options]
 * @param {string|string[]} [options.status]
 * @param {number} [options.limit]
 * @param {string} [options.cursor]
 * @param {string} [options.q]
 * @returns {Promise<{items: any[], nextCursor: string|null, hasMore: boolean}>}
 */
export function listTicketsPaged(options = {}) {
  const params = new URLSearchParams();
  const status = Array.isArray(options.status)
    ? options.status.join(',')
    : options.status;
  if (status) params.append('status', status);
  if (options.limit !== undefined && options.limit !== null) {
    params.append('limit', String(options.limit));
  }
  if (options.cursor) {
    params.append('cursor', String(options.cursor));
  }
  if (options.q) {
    params.append('q', String(options.q));
  }
  if (options.queue) {
    params.append('queue', String(options.queue));
  }
  if (options.contactId) {
    params.append('contactId', String(options.contactId));
  }
  if (options.phoneNumber) {
    params.append('phoneNumber', String(options.phoneNumber));
  }

  const query = params.toString();
  const url = `/tickets${query ? `?${query}` : ''}`;

  return fetchJson(url, { method: 'GET' }).then((response) => {
    if (Array.isArray(response)) {
      return {
        items: response,
        nextCursor: null,
        hasMore: false,
      };
    }
    return {
      items: Array.isArray(response?.items) ? response.items : [],
      nextCursor: response?.nextCursor || null,
      hasMore: Boolean(response?.hasMore),
    };
  });
}

/**
 * Obtém um ticket específico por ID.
 *
 * @param {string} ticketId
 * @returns {Promise<any>}
 */
export function getTicket(ticketId) {
  if (!ticketId) {
    return Promise.reject(new Error('getTicket: ticketId é obrigatório'));
  }
  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}`, {
    method: 'GET',
  });
}

/**
 * Obtém ticket ativo de uma sessão.
 *
 * @param {string} sessionId
 * @returns {Promise<any>}
 */
export function getTicketBySession(sessionId) {
  if (!sessionId) {
    return Promise.reject(new Error('getTicketBySession: sessionId é obrigatório'));
  }
  return fetchJson(`/tickets/session/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
  });
}

/**
 * Atribui um ticket para um atendente.
 *
 * @param {string} ticketId
 * @param {string} assignedTo - ID/nome do atendente
 * @returns {Promise<any>}
 */
export function assignTicket(ticketId, assignedTo) {
  if (!ticketId) {
    return Promise.reject(new Error('assignTicket: ticketId é obrigatório'));
  }
  if (!assignedTo) {
    return Promise.reject(new Error('assignTicket: assignedTo é obrigatório'));
  }

  logger.info('Atribuindo ticket', { ticketId, assignedTo });

  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/assign`, {
    method: 'POST',
    body: JSON.stringify({ assignedTo }),
  }).then(
    (ticket) => {
      logger.info('Ticket atribuído com sucesso', { ticketId, assignedTo });
      return ticket;
    },
    (error) => {
      logger.error('Erro ao atribuir ticket', { ticketId, assignedTo, error });
      throw error;
    }
  );
}

/**
 * Fecha um ticket.
 *
 * @param {string} ticketId
 * @returns {Promise<any>}
 */
export function closeTicket(ticketId) {
  if (!ticketId) {
    return Promise.reject(new Error('closeTicket: ticketId é obrigatório'));
  }

  logger.info('Fechando ticket', { ticketId });

  // Compatível: se não houver options, mantém request sem body
  const options = arguments.length > 1 ? (arguments[1] || {}) : {};

  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/close`, {
    method: 'POST',
    ...(options && (options.closeReasonId || options.closeReasonName || (Array.isArray(options.tags) && options.tags.length > 0))
      ? {
        body: JSON.stringify({
          closeReasonId: options.closeReasonId,
          closeReasonName: options.closeReasonName,
          tags: Array.isArray(options.tags) ? options.tags : undefined,
        }),
      }
      : {}),
  }).then(
    (ticket) => {
      logger.info('Ticket fechado com sucesso', { ticketId });
      return ticket;
    },
    (error) => {
      logger.error('Erro ao fechar ticket', { ticketId, error });
      throw error;
    }
  );
}

/**
 * Assumir atendimento humano (handover bot -> humano).
 *
 * @param {string} ticketId
 * @param {string} [reason]
 * @returns {Promise<any>}
 */
export function takeOverTicket(ticketId, reason = 'agent_takeover') {
  if (!ticketId) {
    return Promise.reject(new Error('takeOverTicket: ticketId é obrigatório'));
  }

  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/takeover`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * Devolver atendimento ao bot (handover humano -> bot).
 *
 * @param {string} ticketId
 * @param {string} [reason]
 * @returns {Promise<any>}
 */
export function returnToBotTicket(ticketId, reason = 'user_request') {
  if (!ticketId) {
    return Promise.reject(new Error('returnToBotTicket: ticketId é obrigatório'));
  }

  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/return-to-bot`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * Pausar atendimento (modo paused).
 *
 * @param {string} ticketId
 * @param {string} [reason]
 * @returns {Promise<any>}
 */
export function pauseTicket(ticketId, reason = 'outside_window') {
  if (!ticketId) {
    return Promise.reject(new Error('pauseTicket: ticketId é obrigatório'));
  }
  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/pause`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * Retomar atendimento humano (remove paused).
 *
 * @param {string} ticketId
 * @param {string} [reason]
 * @returns {Promise<any>}
 */
export function resumeTicket(ticketId, reason = 'resume') {
  if (!ticketId) {
    return Promise.reject(new Error('resumeTicket: ticketId é obrigatório'));
  }
  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/resume`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * Lista falhas de entrega do ticket (outbound_queue + channel_messages failed).
 *
 * @param {string} ticketId
 * @returns {Promise<{ticketId: string, conversationId: string|null, outboundQueue: any[], channelMessages: any[]}>}
 */
export function getTicketDeliveryFailures(ticketId) {
  if (!ticketId) {
    return Promise.reject(new Error('getTicketDeliveryFailures: ticketId é obrigatório'));
  }
  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/delivery-failures`, {
    method: 'GET',
  });
}

/**
 * Debug: extrai entidades usando o backend (mesmas regras do runtime).
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {string} [options.tenantId]
 * @param {string} [options.channel]
 * @param {string[]} [options.keywords]
 * @param {string[]} [options.tenantKeywords]
 * @returns {Promise<any>}
 */
export function debugExtractEntities(text, options = {}) {
  const payload = {
    text: String(text || ''),
    tenant_id: options.tenantId ? String(options.tenantId) : undefined,
    channel: options.channel ? String(options.channel) : 'whatsapp',
    keywords: Array.isArray(options.keywords) ? options.keywords : undefined,
    tenantKeywords: Array.isArray(options.tenantKeywords) ? options.tenantKeywords : undefined,
  };
  return fetchJson('/api/debug/entities/extract', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Debug: sugere tags usando o backend (mesmas regras do runtime).
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {Record<string, string[]>} [options.tenantKeywords]
 * @returns {Promise<any>}
 */
export function suggestSupportTags(text, options = {}) {
  const payload = {
    text: String(text || ''),
    tenantKeywords: (options.tenantKeywords && typeof options.tenantKeywords === 'object')
      ? options.tenantKeywords
      : undefined,
  };
  return fetchJson('/api/support/tags/suggest', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Debug: sugere sentimento/intenção usando IA (NLP) com fallback heurístico.
 *
 * @param {string} text
 * @returns {Promise<any>}
 */
export function suggestSupportSentiment(text) {
  const payload = { text: String(text || '') };
  return fetchJson('/api/support/sentiment/suggest', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Envia mensagem do atendente para o usuário via WhatsApp.
 *
 * @param {string} ticketId
 * @param {string} message - Texto da mensagem
 * @param {{mediaType?: 'image'|'video'|'audio'|'document', mediaUrl?: string, fileName?: string, mimeType?: string}} [options]
 * @returns {Promise<any>}
 */
export function sendTicketMessage(ticketId, message, options = {}) {
  if (!ticketId) {
    return Promise.reject(new Error('sendTicketMessage: ticketId é obrigatório'));
  }
  const text = typeof message === 'string' ? message : '';
  const hasText = text.trim() !== '';
  const mediaKind = options?.mediaKind ? String(options.mediaKind).trim().toLowerCase() : '';
  const isRagMedia = mediaKind === 'rag';
  const hasMediaUrl = !!(options && typeof options.mediaUrl === 'string' && options.mediaUrl.trim() !== '');
  const hasRagMedia = isRagMedia && !!String(options?.documentId || '').trim();
  const hasMedia = hasMediaUrl || hasRagMedia;
  if (!hasText && !hasMedia) {
    return Promise.reject(new Error('sendTicketMessage: message ou media é obrigatório'));
  }

  logger.info('Enviando mensagem do atendente', {
    ticketId,
    messageLength: text.length,
    hasMedia,
    mediaType: options?.mediaType || null,
  });

  const body = {
    message: hasText ? text : '',
  };
  if (hasMedia) {
    if (isRagMedia) {
      body.media = {
        kind: 'rag',
        documentId: String(options.documentId || '').trim(),
        fileName: options.fileName ? String(options.fileName) : null,
        mimeType: options.mimeType ? String(options.mimeType) : null,
        sizeBytes: Number.isFinite(options?.sizeBytes) ? Number(options.sizeBytes) : null,
        type: String(options.mediaType || 'document'),
      };
    } else {
      body.media = {
        type: String(options.mediaType || 'document'),
        url: String(options.mediaUrl || ''),
        fileName: options.fileName ? String(options.fileName) : null,
        mimeType: options.mimeType ? String(options.mimeType) : null,
      };
    }
  }
  if (options?.replyTo && typeof options.replyTo === 'object') {
    const raw = options.replyTo;
    const replyTo = {
      messageId: raw?.messageId ? String(raw.messageId).trim() : undefined,
      externalMessageId: raw?.externalMessageId ? String(raw.externalMessageId).trim() : undefined,
      clientMessageId: raw?.clientMessageId ? String(raw.clientMessageId).trim() : undefined,
      sender: raw?.sender ? String(raw.sender).trim().toLowerCase() : undefined,
      text: raw?.text ? String(raw.text).trim().slice(0, 500) : undefined,
      timestamp: raw?.timestamp ? String(raw.timestamp).trim() : undefined,
    };
    if (replyTo.messageId || replyTo.externalMessageId || replyTo.clientMessageId || replyTo.text) {
      body.replyTo = replyTo;
    }
  }

  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/message`, {
    method: 'POST',
    body: JSON.stringify(body),
  }).then(
    (result) => {
      logger.info('Mensagem enviada com sucesso', { ticketId });
      return result;
    },
    (error) => {
      logger.error('Erro ao enviar mensagem', { ticketId, error });
      throw error;
    }
  );
}

/**
 * Faz upload de mídia/arquivo para envio no chat de suporte.
 *
 * @param {File} file
 * @returns {Promise<{url: string, fileName: string, mimeType: string, sizeBytes: number}>}
 */
export function uploadSupportMedia(file) {
  if (!file) {
    return Promise.reject(new Error('uploadSupportMedia: file é obrigatório'));
  }
  const formData = new FormData();
  formData.append('file', file);

  return fetchJson('/tickets/media/upload', {
    method: 'POST',
    body: formData,
  });
}

/**
 * Obtém resumo IA do ticket (cache).
 *
 * @param {string} ticketId
 * @returns {Promise<{summary: any}>}
 */
export function getTicketAiSummary(ticketId) {
  if (!ticketId) {
    return Promise.reject(new Error('getTicketAiSummary: ticketId é obrigatório'));
  }
  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/ai-summary`);
}

/**
 * Gera/atualiza resumo IA do ticket.
 *
 * @param {string} ticketId
 * @returns {Promise<{summary: any}>}
 */
export function generateTicketAiSummary(ticketId) {
  if (!ticketId) {
    return Promise.reject(new Error('generateTicketAiSummary: ticketId é obrigatório'));
  }
  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/ai-summary`, { method: 'POST' });
}

/**
 * Obtém métricas e estatísticas do sistema de filas.
 *
 * @returns {Promise<any>}
 */
export function getQueueMetrics() {
  return fetchJson('/metrics/queues', {
    method: 'GET',
  });
}

/**
 * Cria uma nova fila.
 *
 * @param {string} queueName - Nome da fila
 * @returns {Promise<{success: boolean, message: string, queueName: string}>}
 */
export function createQueue(queueName) {
  if (!queueName || queueName.trim() === '') {
    return Promise.reject(new Error('createQueue: queueName é obrigatório'));
  }

  logger.info('Criando fila', { queueName });

  return fetchJson('/queues', {
    method: 'POST',
    body: JSON.stringify({ name: queueName }),
  }).then(
    (result) => {
      logger.info('Fila criada com sucesso', { queueName });
      return result;
    },
    (error) => {
      logger.error('Erro ao criar fila', { queueName, error });
      throw error;
    }
  );
}

/**
 * Exclui uma fila.
 *
 * @param {string} queueName - Nome da fila
 * @param {boolean} [force=false] - Se true, exclui mesmo com tickets ativos
 * @returns {Promise<{success: boolean, message: string, deletedTickets?: number}>}
 */
export function deleteQueue(queueName, force = false) {
  if (!queueName || queueName.trim() === '') {
    return Promise.reject(new Error('deleteQueue: queueName é obrigatório'));
  }

  logger.info('Excluindo fila', { queueName, force });

  const url = `/queues/${encodeURIComponent(queueName)}${force ? '?force=true' : ''}`;

  return fetchJson(url, {
    method: 'DELETE',
  }).then(
    (result) => {
      logger.info('Fila excluída com sucesso', { queueName });
      return result;
    },
    (error) => {
      logger.error('Erro ao excluir fila', { queueName, error });
      throw error;
    }
  );
}

/**
 * Obtém informações sobre uma fila específica.
 *
 * @param {string} queueName - Nome da fila
 * @returns {Promise<{exists: boolean, ticketCount: number, activeTickets: number, closedTickets: number}>}
 */
export function getQueueInfo(queueName) {
  if (!queueName || queueName.trim() === '') {
    return Promise.reject(new Error('getQueueInfo: queueName é obrigatório'));
  }

  return fetchJson(`/queues/${encodeURIComponent(queueName)}`, {
    method: 'GET',
  });
}

/**
 * Obtém histórico de mensagens de um ticket.
 *
 * @param {string} ticketId
 * @returns {Promise<{ticketId: string, messages: any[]}>}
 */
export function getTicketMessages(ticketId) {
  if (!ticketId) {
    return Promise.reject(new Error('getTicketMessages: ticketId é obrigatório'));
  }

  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: 'GET',
  });
}

/**
 * Marca mensagens de um ticket como lidas.
 *
 * @param {string} ticketId
 * @returns {Promise<{success: boolean, ticketId: string}>}
 */
export function markTicketAsRead(ticketId) {
  if (!ticketId) {
    return Promise.reject(new Error('markTicketAsRead: ticketId é obrigatório'));
  }

  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/mark-read`, {
    method: 'POST',
  });
}

/**
 * Cria um novo ticket manualmente (para conversas iniciadas por agente).
 *
 * @param {Object} params
 * @param {string} params.phoneNumber - Número de telefone do usuário (formato: +5511999999999 ou 5511999999999)
 * @param {string} params.queue - Nome da fila
 * @param {string} [params.initialMessage] - Mensagem inicial opcional
 * @param {string} [params.customerName] - Nome do cliente opcional
 * @returns {Promise<any>}
 */
export function createTicket({ phoneNumber, queue, initialMessage, customerName }) {
  if (!phoneNumber || phoneNumber.trim() === '') {
    return Promise.reject(new Error('createTicket: phoneNumber é obrigatório'));
  }
  if (!queue || queue.trim() === '') {
    return Promise.reject(new Error('createTicket: queue é obrigatório'));
  }

  logger.info('Criando ticket manualmente', { phoneNumber, queue, hasInitialMessage: !!initialMessage });

  const body = {
    phoneNumber: phoneNumber.trim(),
    queue: queue.trim(),
  };

  if (initialMessage && initialMessage.trim() !== '') {
    body.initialMessage = initialMessage.trim();
  }
  if (customerName && customerName.trim() !== '') {
    body.customerName = customerName.trim();
  }

  return fetchJson('/tickets', {
    method: 'POST',
    body: JSON.stringify(body),
  }).then(
    (ticket) => {
      logger.info('Ticket criado com sucesso', { ticketId: ticket.id, phoneNumber, queue });
      return ticket;
    },
    (error) => {
      logger.error('Erro ao criar ticket', { phoneNumber, queue, error });
      throw error;
    }
  );
}
