'use strict';

/**
 * Queue admin operations: create, delete, and inspect queues.
 * All functions are stateless helpers; runtime Maps are injected as deps.
 */

/**
 * Cria uma nova fila vazia. Idempotente: se já existir, retorna sucesso.
 *
 * @param {string} queueName
 * @param {{queues: Map, ensureQueueIndex: Function, safeTrim: Function, logger: Object}} deps
 * @returns {{success: boolean, message: string, queueName: string|null}}
 */
function createQueue(queueName, { queues, ensureQueueIndex, safeTrim, logger }) {
  const normalizedName = safeTrim(queueName);
  if (!queueName || typeof queueName !== 'string' || normalizedName === '') {
    return {
      success: false,
      message: 'Nome da fila é obrigatório',
      queueName: null,
    };
  }

  if (normalizedName.length < 1 || normalizedName.length > 100) {
    return {
      success: false,
      message: 'Nome da fila deve ter entre 1 e 100 caracteres',
      queueName: null,
    };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(normalizedName)) {
    return {
      success: false,
      message: 'Nome da fila deve conter apenas letras, números, hífens e underscores',
      queueName: null,
    };
  }

  if (queues.has(normalizedName)) {
    return {
      success: true,
      message: 'Fila já existe',
      queueName: normalizedName,
      // `created:false` é o que permite ao chamador distinguir IDEMPOTÊNCIA de
      // CRIAÇÃO. Sem isso, uma falha de persistência em fila PREEXISTENTE
      // disparava rollback destrutivo (deleteQueue(force=true), que fecha
      // tickets ativos de terceiros) — defeito P0 medido em 2026-10-20.
      created: false,
    };
  }

  ensureQueueIndex(queues, normalizedName);
  logger.debug(`[QueueService] Fila criada: ${normalizedName}`);

  return {
    success: true,
    message: 'Fila criada com sucesso',
    queueName: normalizedName,
    created: true,
  };
}

/**
 * Exclui uma fila. Só exclui filas vazias a menos que force=true.
 *
 * @param {string} queueName
 * @param {boolean} force
 * @param {{queues: Map, tickets: Map, getQueueStats: Function, persistTicketBestEffort: Function, safeTrim: Function, logger: Object}} deps
 * @returns {{success: boolean, message: string, deletedTickets?: number, activeTickets?: number}}
 */
function deleteQueue(queueName, force, { queues, tickets, getQueueStats, persistTicketBestEffort, safeTrim, logger, tenantId = null }) {
  const normalizedName = safeTrim(queueName);
  if (!queueName || typeof queueName !== 'string' || normalizedName === '') {
    return { success: false, message: 'Nome da fila é obrigatório' };
  }

  if (!queues.has(normalizedName)) {
    return { success: false, message: 'Fila não encontrada' };
  }

  const { ticketIds, activeTickets } = getQueueStats({ tickets, queues, queueName: normalizedName, tenantId });

  if (activeTickets > 0 && !force) {
    return {
      success: false,
      message: `Não é possível excluir a fila. Existem ${activeTickets} ticket(s) ativo(s). Use force=true para forçar exclusão.`,
      activeTickets,
    };
  }

  let deletedTickets = 0;
  if (force && activeTickets > 0) {
    // `ticketIds` já vem ESCOPADO por tenant quando `tenantId` foi informado —
    // exclusão forçada de um tenant nunca fecha atendimento de outro.
    ticketIds.forEach((ticketId) => {
      const ticket = tickets.get(ticketId);
      if (ticket && ticket.status !== 'closed') {
        ticket.status = 'closed';
        ticket.updatedAt = new Date().toISOString();
        persistTicketBestEffort(ticket);
        deletedTickets++;
      }
    });
  }

  if (tenantId) {
    // Remove do índice SÓ os tickets deste tenant; a fila nominal continua
    // existindo para os demais.
    const queueSet = queues.get(normalizedName);
    if (queueSet) {
      ticketIds.forEach((ticketId) => queueSet.delete(ticketId));
      if (queueSet.size === 0) queues.delete(normalizedName);
    }
  } else {
    queues.delete(normalizedName);
  }
  logger.debug(`[QueueService] Fila excluída: ${normalizedName}${deletedTickets > 0 ? ` (${deletedTickets} ticket(s) fechado(s))` : ''}`);

  return {
    success: true,
    message: deletedTickets > 0
      ? `Fila excluída. ${deletedTickets} ticket(s) foram fechado(s).`
      : 'Fila excluída com sucesso',
    deletedTickets: force ? deletedTickets : 0,
  };
}

/**
 * Obtém estatísticas de uma fila.
 *
 * @param {string} queueName
 * @param {{queues: Map, tickets: Map, getQueueStats: Function, safeTrim: Function}} deps
 * @returns {{exists: boolean, ticketCount: number, activeTickets: number, closedTickets: number}|null}
 */
function getQueueInfo(queueName, { queues, tickets, getQueueStats, safeTrim, tenantId = null }) {
  if (!queueName || typeof queueName !== 'string') return null;

  const normalizedName = safeTrim(queueName);
  if (!queues.has(normalizedName)) {
    return { exists: false, ticketCount: 0, activeTickets: 0, closedTickets: 0 };
  }

  const { ticketCount, activeTickets, closedTickets } = getQueueStats({ tickets, queues, queueName: normalizedName, tenantId });
  return { exists: true, ticketCount, activeTickets, closedTickets };
}

module.exports = { createQueue, deleteQueue, getQueueInfo };
