'use strict';

const { hasPermission, canAccessTicket } = require('../../services/rbacService');
const { getTicket } = require('../../services/queueService');
const { getDepartmentsByAgent, getDepartmentByQueue } = require('../../services/departmentsService');
const queueDefinitionService = require('../../services/queueDefinitionService');

const PRIVILEGED_SUPPORT_ROLES = new Set(['owner', 'admin', 'manager', 'supervisor']);

const SENSITIVE_ACTION_PERMISSION_GROUPS = {
  assign_team: [
    [{ resource: 'tickets', action: 'assign' }],
  ],
  create_campaign: [
    [{ resource: 'bulk_messaging', action: 'create' }],
  ],
  create_opportunity: [
    [{ resource: 'tickets', action: 'update' }],
  ],
  notify_supervisor: [
    [{ resource: 'tickets', action: 'update' }],
  ],
  review_schedule_policy: [
    [{ resource: 'config', action: 'update' }],
    [{ resource: 'autonomous_scheduling', action: 'update' }],
  ],
};

function safeString(value) {
  const normalized = value == null ? '' : String(value).trim();
  return normalized || null;
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (!role) return null;
  if (role === 'agent') return 'operator';
  return role;
}

function extractTicketContactId(ticket) {
  return safeString(
    ticket?.contactId
    || ticket?.context?.metadata?.contactId
    || ticket?.context?.variables?.contactId
  );
}

function buildError(status, code, message) {
  return {
    ok: false,
    status,
    error: {
      code,
      message,
    },
  };
}

function parseSupportContext(input) {
  const source = (input && typeof input === 'object') ? input : {};
  const ticketId = safeString(source.ticketId || source.ticket_id);
  const queueId = safeString(source.queueId || source.queue_id || source.queue || source.queueName);
  const departmentId = safeString(source.departmentId || source.department_id || source.department);
  return {
    ticketId,
    queueId,
    departmentId,
  };
}

function hasAnyContext(context) {
  return !!(context?.ticketId || context?.queueId || context?.departmentId);
}

function isPermissionGroupSatisfied(actor, group = []) {
  if (!Array.isArray(group) || group.length === 0) return true;
  return group.every((entry) => hasPermission(actor, entry.resource, entry.action));
}

function isSensitiveActionAllowed(actor, actionId) {
  const groups = SENSITIVE_ACTION_PERMISSION_GROUPS[String(actionId || '').trim()];
  if (!Array.isArray(groups) || groups.length === 0) return true;
  return groups.some((group) => isPermissionGroupSatisfied(actor, group));
}

class QuickActionContextGuard {
  constructor({
    getTicketById = getTicket,
    canAccessTicketFn = canAccessTicket,
    getDepartmentsByAgentFn = getDepartmentsByAgent,
    getDepartmentByQueueFn = getDepartmentByQueue,
    getQueueByNameFn = (tenantId, queueName) => {
      if (!tenantId || !queueName || !queueDefinitionService || typeof queueDefinitionService.getQueueByName !== 'function') {
        return null;
      }
      return queueDefinitionService.getQueueByName(tenantId, queueName);
    },
  } = {}) {
    this.getTicketById = getTicketById;
    this.canAccessTicketFn = canAccessTicketFn;
    this.getDepartmentsByAgentFn = getDepartmentsByAgentFn;
    this.getDepartmentByQueueFn = getDepartmentByQueueFn;
    this.getQueueByNameFn = getQueueByNameFn;
  }

  isPrivilegedActor(actor = {}) {
    if (actor?.isSuperAdmin) return true;
    const role = normalizeRole(actor?.role);
    return !!(role && PRIVILEGED_SUPPORT_ROLES.has(role));
  }

  resolveDepartmentIdForQueue({ tenantId, queueId }) {
    const queueKey = safeString(queueId);
    if (!queueKey) return null;

    const byDepartmentService = this.getDepartmentByQueueFn(queueKey);
    const directDepartmentId = safeString(byDepartmentService?.id || byDepartmentService?.departmentId);
    if (directDepartmentId) return directDepartmentId;

    const byQueueDefinition = this.getQueueByNameFn(tenantId, queueKey);
    return safeString(byQueueDefinition?.departmentId || byQueueDefinition?.department_id);
  }

  resolveActorDepartmentIds(actor = {}) {
    const ids = new Set();
    const actorId = safeString(actor?.id);
    const actorUsername = safeString(actor?.username);

    const append = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((department) => {
        const id = safeString(department?.id || department?.departmentId);
        if (id) ids.add(id);
      });
    };

    if (actorId) append(this.getDepartmentsByAgentFn(actorId));
    if (actorUsername && actorUsername !== actorId) append(this.getDepartmentsByAgentFn(actorUsername));

    return ids;
  }

  async validate({
    mode = 'admin',
    operation = 'list',
    actor = {},
    tenantId = null,
    contactId = null,
    actionId = null,
    supportContext = null,
  } = {}) {
    const scopeMode = String(mode || 'admin').trim().toLowerCase();
    const op = String(operation || 'list').trim().toLowerCase();
    const actionKey = safeString(actionId);
    const tenantKey = safeString(tenantId);
    const contactKey = safeString(contactId);
    const context = parseSupportContext(supportContext);
    const privilegedActor = this.isPrivilegedActor(actor);

    if (actionKey && op === 'execute' && !actor?.isSuperAdmin && !isSensitiveActionAllowed(actor, actionKey)) {
      return buildError(403, 'action_forbidden_by_permission', 'Permissão insuficiente para executar esta quick action sensível');
    }

    const requiresStrictSupportContext = scopeMode === 'contact' && op === 'execute' && !privilegedActor;
    if (requiresStrictSupportContext && !hasAnyContext(context)) {
      return buildError(422, 'support_context_required', 'Contexto de suporte é obrigatório para executar quick action neste escopo');
    }

    let resolvedQueueId = context.queueId;
    let resolvedDepartmentId = context.departmentId;

    if (context.ticketId) {
      const ticket = this.getTicketById(context.ticketId);
      if (!ticket) {
        return buildError(404, 'support_ticket_not_found', 'Ticket de suporte não encontrado para validar contexto operacional');
      }

      const ticketTenantId = safeString(ticket?.tenantId);
      if (tenantKey && ticketTenantId && ticketTenantId !== tenantKey) {
        return buildError(404, 'support_ticket_not_found', 'Ticket de suporte não encontrado no tenant atual');
      }

      if (!privilegedActor && !this.canAccessTicketFn(actor, ticket)) {
        return buildError(403, 'support_ticket_forbidden', 'Sem permissão para operar quick actions no ticket de suporte informado');
      }

      const ticketContactId = extractTicketContactId(ticket);
      if (contactKey && ticketContactId && ticketContactId !== contactKey) {
        return buildError(422, 'support_context_contact_mismatch', 'Ticket informado não pertence ao contato da quick action');
      }

      const ticketQueueId = safeString(ticket?.queue);
      if (resolvedQueueId && ticketQueueId && resolvedQueueId !== ticketQueueId) {
        return buildError(422, 'support_context_queue_mismatch', 'Fila informada não corresponde ao ticket de suporte');
      }

      resolvedQueueId = resolvedQueueId || ticketQueueId;
      const ticketDepartmentId = this.resolveDepartmentIdForQueue({ tenantId: tenantKey || ticketTenantId, queueId: ticketQueueId });

      if (resolvedDepartmentId && ticketDepartmentId && resolvedDepartmentId !== ticketDepartmentId) {
        return buildError(422, 'support_context_department_mismatch', 'Departamento informado não corresponde ao ticket/fila de suporte');
      }

      resolvedDepartmentId = resolvedDepartmentId || ticketDepartmentId;
    }

    if (!privilegedActor && scopeMode === 'contact' && op === 'execute' && !context.ticketId && (resolvedQueueId || resolvedDepartmentId)) {
      return buildError(422, 'support_ticket_required', 'Ticket de suporte é obrigatório para validar o escopo operacional da quick action');
    }

    if (resolvedQueueId && !resolvedDepartmentId) {
      resolvedDepartmentId = this.resolveDepartmentIdForQueue({ tenantId: tenantKey, queueId: resolvedQueueId });
    }

    if (!privilegedActor && resolvedDepartmentId) {
      const actorDepartmentIds = this.resolveActorDepartmentIds(actor);
      if (actorDepartmentIds.size > 0 && !actorDepartmentIds.has(resolvedDepartmentId)) {
        return buildError(403, 'support_department_forbidden', 'Operação fora do escopo de departamento do agente');
      }
    }

    return {
      ok: true,
      context: {
        ticketId: context.ticketId,
        queueId: resolvedQueueId,
        departmentId: resolvedDepartmentId,
      },
    };
  }
}

const quickActionContextGuard = new QuickActionContextGuard();

module.exports = {
  QuickActionContextGuard,
  quickActionContextGuard,
  PRIVILEGED_SUPPORT_ROLES,
  SENSITIVE_ACTION_PERMISSION_GROUPS,
};
