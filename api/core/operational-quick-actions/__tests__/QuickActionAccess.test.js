'use strict';

const { QuickActionAccess } = require('../QuickActionAccess');

describe('QuickActionAccess', () => {
  function createRegistryStub() {
    return {
      getActionsForSignal: jest.fn((signal) => {
        if (String(signal?.type || '') === 'customer_reactivation') {
          return [{ id: 'open_followup' }, { id: 'send_whatsapp_template' }];
        }
        return [];
      }),
      getActionsForRecommendation: jest.fn((recommendation) => {
        if (String(recommendation?.type || '') === 'support_backlog_risk') {
          return [{ id: 'assign_team' }];
        }
        return [];
      }),
      getActionById: jest.fn((actionId) => {
        const key = String(actionId || '');
        if (key === 'open_followup') return { id: 'open_followup' };
        if (key === 'assign_team') return { id: 'assign_team' };
        return null;
      }),
    };
  }

  function createServiceStub({ signals = [], recommendations = [] } = {}) {
    return {
      listTenantSignals: jest.fn(async () => ({ ok: true, items: signals })),
      listContactSignals: jest.fn(async ({ contactId }) => ({
        ok: true,
        items: signals.filter((item) => String(item.contact_id || '') === String(contactId || '')),
      })),
      listTenantRecommendations: jest.fn(async () => ({ ok: true, items: recommendations })),
      listContactRecommendations: jest.fn(async ({ contactId }) => ({
        ok: true,
        items: recommendations.filter((item) => String(item.contact_id || '') === String(contactId || '')),
      })),
    };
  }

  function createAccess({ signals = [], recommendations = [], contactExists = true } = {}) {
    const registry = createRegistryStub();
    const service = createServiceStub({ signals, recommendations });
    const contextGuard = {
      validate: jest.fn(async () => ({ ok: true, context: null })),
    };
    const contactModelFactory = () => ({
      findOne: jest.fn(async () => (contactExists ? { id: 'contact-1' } : null)),
    });

    const access = new QuickActionAccess({
      registry,
      contextGuard,
      createOperationalAgentService: () => service,
      contactModelFactory,
    });

    return { access, registry, service, contextGuard };
  }

  test('permite super admin em rota admin cross-tenant', async () => {
    const { access } = createAccess({
      signals: [{ id: 'sig-1', type: 'customer_reactivation', status: 'open', contact_id: 'contact-1' }],
    });

    const out = await access.resolveScope({
      mode: 'admin',
      operation: 'list',
      actor: { isSuperAdmin: true, canRead: true },
      routeTenantId: 'tenant-B',
      sourceType: 'signal',
      sourceId: 'sig-1',
    });

    expect(out.ok).toBe(true);
    expect(out.tenantId).toBe('tenant-B');
    expect((out.actions || []).map((item) => item.id)).toEqual(['open_followup', 'send_whatsapp_template']);
  });

  test('nega operador comum em rota admin', async () => {
    const { access } = createAccess({
      signals: [{ id: 'sig-1', type: 'customer_reactivation', status: 'open', contact_id: 'contact-1' }],
    });

    const out = await access.resolveScope({
      mode: 'admin',
      operation: 'list',
      actor: { isSuperAdmin: false, role: 'agent', canRead: true },
      actorTenantId: 'tenant-A',
      routeTenantId: 'tenant-A',
      sourceType: 'signal',
      sourceId: 'sig-1',
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(out.error.code).toBe('admin_scope_forbidden');
  });

  test('permite tenant manager em rota admin no mesmo tenant', async () => {
    const { access } = createAccess({
      signals: [{ id: 'sig-1', type: 'customer_reactivation', status: 'open', contact_id: 'contact-1' }],
    });

    const out = await access.resolveScope({
      mode: 'admin',
      operation: 'execute',
      actor: { isSuperAdmin: false, role: 'manager', canExecute: true },
      actorTenantId: 'tenant-A',
      routeTenantId: 'tenant-A',
      sourceType: 'signal',
      sourceId: 'sig-1',
      actionId: 'open_followup',
    });

    expect(out.ok).toBe(true);
    expect(out.source.id).toBe('sig-1');
  });

  test('bloqueia acesso cross-tenant para não super admin', async () => {
    const { access } = createAccess({
      signals: [{ id: 'sig-1', type: 'customer_reactivation', status: 'open', contact_id: 'contact-1' }],
    });

    const out = await access.resolveScope({
      mode: 'admin',
      operation: 'list',
      actor: { isSuperAdmin: false, role: 'admin', canRead: true },
      actorTenantId: 'tenant-A',
      routeTenantId: 'tenant-B',
      sourceType: 'signal',
      sourceId: 'sig-1',
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(out.error.code).toBe('cross_tenant_forbidden');
  });

  test('permite operador em rota contact-scoped com ownership válido', async () => {
    const { access } = createAccess({
      signals: [{ id: 'sig-1', type: 'customer_reactivation', status: 'open', contact_id: 'contact-1' }],
      contactExists: true,
    });

    const out = await access.resolveScope({
      mode: 'contact',
      operation: 'execute',
      actor: { isSuperAdmin: false, role: 'agent', canExecute: true },
      actorTenantId: 'tenant-A',
      contactId: 'contact-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
      actionId: 'open_followup',
    });

    expect(out.ok).toBe(true);
    expect(out.contactId).toBe('contact-1');
  });

  test('retorna 404 quando contato não pertence ao tenant', async () => {
    const { access } = createAccess({
      signals: [{ id: 'sig-1', type: 'customer_reactivation', status: 'open', contact_id: 'contact-1' }],
      contactExists: false,
    });

    const out = await access.resolveScope({
      mode: 'contact',
      operation: 'list',
      actor: { isSuperAdmin: false, role: 'agent', canRead: true },
      actorTenantId: 'tenant-A',
      contactId: 'contact-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe(404);
    expect(out.error.code).toBe('contact_not_found');
  });

  test('retorna 422 para action inválida no source', async () => {
    const { access } = createAccess({
      recommendations: [{ id: 'rec-1', type: 'support_backlog_risk', status: 'open', contact_id: 'contact-1' }],
      contactExists: true,
    });

    const out = await access.resolveScope({
      mode: 'contact',
      operation: 'execute',
      actor: { isSuperAdmin: false, role: 'manager', canExecute: true },
      actorTenantId: 'tenant-A',
      contactId: 'contact-1',
      sourceType: 'recommendation',
      sourceId: 'rec-1',
      actionId: 'open_followup',
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe(422);
    expect(out.error.code).toBe('action_not_valid_for_source');
  });

  test('retorna 422 quando source não está acionável', async () => {
    const { access } = createAccess({
      signals: [{ id: 'sig-1', type: 'customer_reactivation', status: 'resolved', contact_id: 'contact-1' }],
      contactExists: true,
    });

    const out = await access.resolveScope({
      mode: 'contact',
      operation: 'execute',
      actor: { isSuperAdmin: false, role: 'agent', canExecute: true },
      actorTenantId: 'tenant-A',
      contactId: 'contact-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
      actionId: 'open_followup',
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe(422);
    expect(out.error.code).toBe('source_not_actionable');
  });

  test('propaga erro quando guard contextual reprova a execução', async () => {
    const { access, contextGuard } = createAccess({
      signals: [{ id: 'sig-1', type: 'customer_reactivation', status: 'open', contact_id: 'contact-1' }],
      contactExists: true,
    });

    contextGuard.validate.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: {
        code: 'support_ticket_forbidden',
        message: 'Sem permissão para operar quick actions no ticket de suporte informado',
      },
    });

    const out = await access.resolveScope({
      mode: 'contact',
      operation: 'execute',
      actor: { isSuperAdmin: false, role: 'agent', canExecute: true },
      actorTenantId: 'tenant-A',
      contactId: 'contact-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
      actionId: 'open_followup',
      supportContext: { ticketId: 'ticket-1' },
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(out.error.code).toBe('support_ticket_forbidden');
  });
});
