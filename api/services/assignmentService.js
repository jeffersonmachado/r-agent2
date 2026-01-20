/**
 * Serviço de atribuição (assignment) de tickets.
 *
 * Estratégias:
 * - manual: não auto-atribui
 * - round_robin: alterna agentes elegíveis
 * - least_busy: escolhe agente com menos tickets in_progress
 *
 * Observações:
 * - Multi-tenant: sempre filtra por tenantId
 * - Disponibilidade: preferir agentes online (WebSocket); fallback: todos elegíveis
 * - Não quebra compatibilidade: operações são best-effort e não mudam API legada
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { listAllTickets, getTicket, assignTicket } = require('./queueService');
const { listAgents } = require('./authService');
const departmentsService = require('./departmentsService');
const queueDefinitionService = require('./queueDefinitionService');
const { emitEvent, getOnlineAgentsByTenant, isAgentOnline } = require('./websocketService');
const { triggerWebhooks } = require('./webhookService');
const { logAction } = require('./auditService');
const { getSequelize } = require('../db/sequelize');
const { QueueAssignmentState } = require('../db/models');

/** @type {Map<string, number>} */
const rrCursor = new Map(); // key = `${tenantId}:${queueName}` => index

function normalizeStrategy(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'round_robin') return 'round_robin';
  if (v === 'least_busy') return 'least_busy';
  return 'manual';
}

function isEligibleAgent(agent) {
  if (!agent) return false;
  if (agent.active === false) return false;
  if (agent.status && agent.status !== 'active') return false;
  // Papéis permitidos para atendimento
  return agent.role === 'operator' || agent.role === 'manager' || agent.role === 'admin' || agent.role === 'owner';
}

function dbAvailable() {
  return !!getSequelize();
}

function newId(prefix = 'qas') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

async function getAndBumpRoundRobinCursorDb(tenantId, queueName) {
  if (!dbAvailable()) return null;
  try {
    const Model = typeof QueueAssignmentState === 'function' ? QueueAssignmentState() : QueueAssignmentState;
    const now = new Date();

    // Transação simples para reduzir colisões (best-effort)
    const sequelize = Model.sequelize;
    return await sequelize.transaction(async (t) => {
      const existing = await Model.findOne({
        where: { tenant_key: tenantId, queue_name: queueName },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!existing) {
        const created = await Model.create({
          id: newId('qas'),
          tenant_key: tenantId,
          queue_name: queueName,
          cursor: 0,
          updated_by: 'system',
          created_at: now,
          updated_at: now,
        }, { transaction: t });
        return Number(created.cursor) || 0;
      }

      const current = Number.isFinite(existing.cursor) ? existing.cursor : 0;
      await existing.update({ cursor: current + 1, updated_by: 'system', updated_at: now }, { transaction: t });
      return current;
    });
  } catch (err) {
    logger.debug('[Assignment] Falha ao obter cursor RR do DB (fallback para memória)', { tenantId, queueName, error: err.message });
    return null;
  }
}

async function pickRoundRobin(tenantId, queueName, agentIds) {
  if (agentIds.length === 0) return null;

  // Preferir DB (cluster-safe-ish). Fallback para memória.
  const dbIdx = await getAndBumpRoundRobinCursorDb(tenantId, queueName);
  if (Number.isFinite(dbIdx)) {
    return agentIds[dbIdx % agentIds.length] || null;
  }

  const key = `${tenantId}:${queueName}`;
  const idx = rrCursor.get(key) || 0;
  const next = agentIds[idx % agentIds.length] || null;
  rrCursor.set(key, (idx + 1) % agentIds.length);
  return next;
}

function pickLeastBusy(tenantId, agentIds) {
  const all = listAllTickets({ tenantId, status: 'in_progress', limit: 10000 }).tickets || [];
  const counts = new Map();
  for (const id of agentIds) counts.set(id, 0);
  for (const t of all) {
    if (t && t.assignedTo && counts.has(t.assignedTo)) {
      counts.set(t.assignedTo, (counts.get(t.assignedTo) || 0) + 1);
    }
  }
  let best = null;
  let bestCount = Infinity;
  for (const [id, c] of counts.entries()) {
    if (c < bestCount) {
      bestCount = c;
      best = id;
    }
  }
  return best;
}

async function resolveQueueStrategy(tenantId, queueName) {
  // tenta queue definitions
  try {
    const q = queueDefinitionService.getQueueByName(tenantId, queueName);
    if (q?.routingStrategy) return normalizeStrategy(q.routingStrategy);
  } catch (e) {}
  return 'manual';
}

async function resolveCandidateAgentIds(tenantId, queueName) {
  const agents = await listAgents(tenantId);
  const eligible = agents.filter(isEligibleAgent);

  // Preferência por departamento (se tiver queue definition com departmentId)
  let dept = null;
  const qDef = queueDefinitionService.getQueueByName(tenantId, queueName);
  if (qDef?.departmentId) {
    dept = departmentsService.getDepartment(qDef.departmentId);
  }
  if (!dept) {
    // fallback: departamento mapeado por queueNames (legacy)
    const allDepts = departmentsService.listDepartments({ tenantId });
    dept = allDepts.find(d => Array.isArray(d.queueNames) && d.queueNames.includes(queueName)) || null;
  }

  let candidateIds = eligible.map(a => a.id);

  if (dept && Array.isArray(dept.agentIds) && dept.agentIds.length > 0) {
    const set = new Set(dept.agentIds);
    candidateIds = candidateIds.filter(id => set.has(id));
  }

  // Preferir online, se existir pelo menos um online
  const online = new Set(getOnlineAgentsByTenant(tenantId));
  const onlineCandidates = candidateIds.filter(id => online.has(id));
  if (onlineCandidates.length > 0) return onlineCandidates.sort();

  return candidateIds.sort();
}

/**
 * Escolhe um agente para uma fila (sem efetivar assign).
 * Exportado para uso por routingService (evita duplicação).
 *
 * @param {{tenantId:string, queueName:string}} params
 * @returns {Promise<{agentId:string|null, strategy:'manual'|'round_robin'|'least_busy', candidateIds:string[]}>}
 */
async function chooseAgentForQueue({ tenantId, queueName }) {
  if (!tenantId || typeof tenantId !== 'string') throw new Error('tenantId é obrigatório');
  if (!queueName || typeof queueName !== 'string') throw new Error('queueName é obrigatório');

  const strategy = await resolveQueueStrategy(tenantId, queueName);
  const candidateIds = await resolveCandidateAgentIds(tenantId, queueName);
  if (strategy === 'manual') return { agentId: null, strategy, candidateIds };
  if (candidateIds.length === 0) return { agentId: null, strategy, candidateIds };

  let chosen = null;
  if (strategy === 'round_robin') {
    chosen = await pickRoundRobin(tenantId, queueName, candidateIds);
  } else if (strategy === 'least_busy') {
    chosen = pickLeastBusy(tenantId, candidateIds);
  }

  return { agentId: chosen || null, strategy, candidateIds };
}

async function autoAssign(ticketId) {
  const ticket = getTicket(ticketId);
  if (!ticket) return { success: false, error: 'ticket_not_found' };
  if (!ticket.tenantId) return { success: false, error: 'tenant_required' };
  if (ticket.status !== 'waiting') return { success: true, ticket, skipped: 'not_waiting' };
  if (ticket.assignedTo) return { success: true, ticket, skipped: 'already_assigned' };

  const tenantId = ticket.tenantId;
  const queueName = ticket.queue;
  const pick = await chooseAgentForQueue({ tenantId, queueName });
  const strategy = pick.strategy;
  if (strategy === 'manual') return { success: true, ticket, skipped: 'manual' };
  if (!pick.agentId) return { success: true, ticket, skipped: pick.candidateIds.length === 0 ? 'no_candidates' : 'no_choice' };
  const chosen = pick.agentId;

  const updated = assignTicket(ticketId, chosen);
  if (!updated) return { success: false, error: 'assign_failed' };

  // Webhooks + WS (best-effort)
  triggerWebhooks(tenantId, 'ticket.assigned', {
    ticketId: updated.id,
    queue: updated.queue,
    assignedTo: chosen,
  }).catch(() => {});

  emitEvent('ticket.assigned', {
    ticketId: updated.id,
    assignedTo: chosen,
    ticket: updated,
    auto: true,
    strategy,
  }, { tenantId, agentId: chosen });

  // Auditoria
  logAction({
    agentId: 'system',
    username: 'system',
    tenantId,
    action: 'ticket_auto_assigned',
    resource: 'ticket',
    resourceId: updated.id,
    details: { queue: updated.queue, assignedTo: chosen, strategy },
    ipAddress: 'system',
    userAgent: 'system',
  });

  return { success: true, ticket: updated, assignedTo: chosen, strategy };
}

async function reassignIfOffline(ticketId) {
  const ticket = getTicket(ticketId);
  if (!ticket) return { success: false, error: 'ticket_not_found' };
  if (!ticket.assignedTo) return { success: true, ticket, skipped: 'not_assigned' };
  if (ticket.status !== 'in_progress') return { success: true, ticket, skipped: 'not_in_progress' };

  // Se não conseguimos detectar online, não reatribui (evita churn)
  const online = isAgentOnline(ticket.assignedTo);
  if (online) return { success: true, ticket, skipped: 'agent_online' };

  // tenta escolher outro agente
  const tenantId = ticket.tenantId;
  const queueName = ticket.queue;
  const strategy = await resolveQueueStrategy(tenantId, queueName);
  if (strategy === 'manual') return { success: true, ticket, skipped: 'manual' };

  const candidateIds = (await resolveCandidateAgentIds(tenantId, queueName)).filter(id => id !== ticket.assignedTo);
  if (candidateIds.length === 0) return { success: true, ticket, skipped: 'no_candidates' };

  const chosen = strategy === 'least_busy'
    ? pickLeastBusy(tenantId, candidateIds)
    : pickRoundRobin(tenantId, queueName, candidateIds);

  if (!chosen) return { success: true, ticket, skipped: 'no_choice' };

  const updated = assignTicket(ticketId, chosen);
  if (!updated) return { success: false, error: 'assign_failed' };

  emitEvent('ticket.assigned', {
    ticketId: updated.id,
    assignedTo: chosen,
    ticket: updated,
    auto: true,
    strategy,
    reason: 'agent_offline',
  }, { tenantId, agentId: chosen });

  logAction({
    agentId: 'system',
    username: 'system',
    tenantId,
    action: 'ticket_reassigned_offline',
    resource: 'ticket',
    resourceId: updated.id,
    details: { previous: ticket.assignedTo, assignedTo: chosen, strategy },
    ipAddress: 'system',
    userAgent: 'system',
  });

  return { success: true, ticket: updated, reassignedTo: chosen, strategy };
}

async function reassignOfflineTicketsForTenant(tenantId) {
  const inProgress = listAllTickets({ tenantId, status: 'in_progress', limit: 10000 }).tickets || [];
  let changed = 0;
  for (const t of inProgress) {
    if (!t?.assignedTo) continue;
    // eslint-disable-next-line no-await-in-loop
    const res = await reassignIfOffline(t.id);
    if (res?.reassignedTo) changed++;
  }
  return { changed };
}

let worker = null;

function startAssignmentWorker({ intervalMs = 15000 } = {}) {
  if (worker) return;
  worker = setInterval(() => {
    try {
      // best-effort: varre por tenant, baseado em tickets em memória
      const all = listAllTickets({ limit: 10000 }).tickets || [];
      const tenants = new Set(all.map(t => t?.tenantId).filter(Boolean));
      for (const tenantId of tenants) {
        reassignOfflineTicketsForTenant(tenantId).catch(() => {});
      }
    } catch (err) {
      logger.debug('[Assignment] worker erro (ignorado)', { error: err.message });
    }
  }, intervalMs);
  if (worker.unref) worker.unref();
  logger.info('[Assignment] Worker iniciado', { intervalMs });
}

function stopAssignmentWorker() {
  if (!worker) return;
  clearInterval(worker);
  worker = null;
  logger.info('[Assignment] Worker parado');
}

module.exports = {
  chooseAgentForQueue,
  autoAssign,
  reassignIfOffline,
  reassignOfflineTicketsForTenant,
  startAssignmentWorker,
  stopAssignmentWorker,
};

