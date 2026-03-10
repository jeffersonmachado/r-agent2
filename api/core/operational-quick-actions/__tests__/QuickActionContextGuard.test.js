'use strict';

const { QuickActionContextGuard } = require('../QuickActionContextGuard');

describe('QuickActionContextGuard', () => {
  function createGuard({
    tickets = {},
    ticketAccess = true,
    departmentsByAgent = {},
    departmentsByQueue = {},
    queueDefinitionsByName = {},
  } = {}) {
    return new QuickActionContextGuard({
      getTicketById: (id) => tickets[String(id)] || null,
      canAccessTicketFn: () => ticketAccess,
      getDepartmentsByAgentFn: (agentId) => departmentsByAgent[String(agentId)] || [],
      getDepartmentByQueueFn: (queueId) => departmentsByQueue[String(queueId)] || null,
      getQueueByNameFn: (tenantId, queueName) => {
        const key = `${String(tenantId || '')}:${String(queueName || '')}`;
        return queueDefinitionsByName[key] || null;
      },
    });
  }

  test('exige suporte contextual para operador em execução contact-scoped', async () => {
    const guard = createGuard();

    const out = await guard.validate({
      mode: 'contact',
      operation: 'execute',
      actor: { role: 'operator', id: 'agent-1' },
      tenantId: 'tenant-A',
      contactId: 'contact-1',
      actionId: 'open_followup',
      supportContext: null,
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe(422);
    expect(out.error.code).toBe('support_context_required');
  });

  test('bloqueia ticket fora do escopo de acesso do agente', async () => {
    const guard = createGuard({
      tickets: {
        'ticket-1': {
          id: 'ticket-1',
          tenantId: 'tenant-A',
          queue: 'billing',
          context: { metadata: { contactId: 'contact-1' } },
        },
      },
      ticketAccess: false,
    });

    const out = await guard.validate({
      mode: 'contact',
      operation: 'execute',
      actor: { role: 'operator', id: 'agent-1' },
      tenantId: 'tenant-A',
      contactId: 'contact-1',
      actionId: 'open_followup',
      supportContext: { ticketId: 'ticket-1' },
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(out.error.code).toBe('support_ticket_forbidden');
  });

  test('aplica RBAC fino para ação sensível', async () => {
    const guard = createGuard({
      tickets: {
        'ticket-1': {
          id: 'ticket-1',
          tenantId: 'tenant-A',
          queue: 'sales',
          context: { metadata: { contactId: 'contact-1' } },
        },
      },
      ticketAccess: true,
    });

    const out = await guard.validate({
      mode: 'contact',
      operation: 'execute',
      actor: { role: 'operator', id: 'agent-1' },
      tenantId: 'tenant-A',
      contactId: 'contact-1',
      actionId: 'create_campaign',
      supportContext: { ticketId: 'ticket-1' },
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(out.error.code).toBe('action_forbidden_by_permission');
  });

  test('permite execução quando ticket/contexto e escopo batem', async () => {
    const guard = createGuard({
      tickets: {
        'ticket-1': {
          id: 'ticket-1',
          tenantId: 'tenant-A',
          queue: 'support-l2',
          context: { metadata: { contactId: 'contact-1' } },
        },
      },
      ticketAccess: true,
      departmentsByQueue: {
        'support-l2': { id: 'dept-1' },
      },
      departmentsByAgent: {
        'agent-1': [{ id: 'dept-1' }],
      },
    });

    const out = await guard.validate({
      mode: 'contact',
      operation: 'execute',
      actor: { role: 'operator', id: 'agent-1' },
      tenantId: 'tenant-A',
      contactId: 'contact-1',
      actionId: 'open_followup',
      supportContext: { ticketId: 'ticket-1' },
    });

    expect(out.ok).toBe(true);
    expect(out.context).toEqual({
      ticketId: 'ticket-1',
      queueId: 'support-l2',
      departmentId: 'dept-1',
    });
  });
});
