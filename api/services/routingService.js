'use strict';
/**
 * Routing Service (Blip-like)
 *
 * Objetivo:
 * - Expor uma interface estável para roteamento/auto-assign sem duplicar lógica.
 * - Delegar para assignmentService + queueDefinitionService.
 */

const assignmentService = require('./assignmentService');
const queueDefinitionService = require('./queueDefinitionService');

function normalizeQueueNameFromQueueId(queueId, tenantId) {
  const raw = queueId ? String(queueId).trim() : '';
  if (!raw) return null;

  // Se for um ID de QueueDefinition, resolve para name (no tenant)
  try {
    const byId = queueDefinitionService.getQueueById(raw);
    if (byId && (!tenantId || byId.tenantId === tenantId) && byId.name) return byId.name;
  } catch (_) {}

  // Caso contrário, assume que já é o nome da fila (legado)
  return raw;
}

/**
 * Escolhe um agente para a fila (não efetiva assign).
 *
 * @param {string} queueId - id da fila OU nome legado
 * @param {string} tenantId
 * @returns {Promise<string|null>}
 */
async function chooseAgent(queueId, tenantId) {
  if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
    throw new Error('tenantId é obrigatório');
  }
  const queueName = normalizeQueueNameFromQueueId(queueId, tenantId.trim());
  if (!queueName) throw new Error('queueId é obrigatório');

  const res = await assignmentService.chooseAgentForQueue({ tenantId: tenantId.trim(), queueName });
  return res.agentId || null;
}

/**
 * Efetiva auto-assign em um ticket.
 * @param {string} ticketId
 */
async function autoAssignTicket(ticketId) {
  return assignmentService.autoAssign(ticketId);
}

/**
 * Reatribui ticket se agente atual estiver offline (best-effort).
 * @param {string} ticketId
 */
async function reassign(ticketId) {
  return assignmentService.reassignIfOffline(ticketId);
}

module.exports = {
  chooseAgent,
  autoAssignTicket,
  reassign,
};

