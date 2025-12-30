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

  const query = params.toString();
  const url = `/tickets${query ? `?${query}` : ''}`;

  return fetchJson(url, {
    method: 'GET',
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

  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/close`, {
    method: 'POST',
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
 * Envia mensagem do atendente para o usuário via WhatsApp.
 *
 * @param {string} ticketId
 * @param {string} message - Texto da mensagem
 * @returns {Promise<any>}
 */
export function sendTicketMessage(ticketId, message) {
  if (!ticketId) {
    return Promise.reject(new Error('sendTicketMessage: ticketId é obrigatório'));
  }
  if (!message || message.trim() === '') {
    return Promise.reject(new Error('sendTicketMessage: message é obrigatório'));
  }

  logger.info('Enviando mensagem do atendente', { ticketId, messageLength: message.length });

  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/message`, {
    method: 'POST',
    body: JSON.stringify({ message }),
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

