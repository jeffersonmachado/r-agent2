'use strict';

/**
 * Prova de posse da entidade de contexto do copiloto (A5).
 *
 * Gap real (achado exercitando o browser em 2026-09-12): a ficha do aluno
 * publica `subjectId`, mas o verificador consultava `getMembershipDetail({
 * membershipId })` — identificador errado — então a entidade nunca era
 * reconhecida e o copiloto negava todo dado vivo. `CUSTOMER` reusava o mesmo
 * lookup de membership.
 *
 * Este teste FIXA o contrato por tipo: cada tipo verificável só pode provar
 * posse pela consulta correta (tenant-scoped), e tipos sem mecanismo seguem
 * fail-closed.
 */

function loadResolvers(overrides = {}) {
  jest.resetModules();

  const calls = [];
  jest.doMock('../../api/services/vertical/fitnessMembershipService', () => ({
    getMembershipAccessStatus: jest.fn(async (args) => {
      calls.push({ fn: 'getMembershipAccessStatus', args });
      return overrides.fitnessStudent === undefined
        ? { membership: { id: 'm-1' } }
        : overrides.fitnessStudent;
    }),
    getMembershipDetail: jest.fn(async (args) => {
      calls.push({ fn: 'getMembershipDetail', args });
      return null;
    }),
  }));

  jest.doMock('../../api/services/workspace/WorkspaceEntityService', () => class {
    async getEntity(args) {
      calls.push({ fn: 'getEntity', args });
      return overrides.customer === undefined ? { id: 'e-1' } : overrides.customer;
    }
  });

  jest.doMock('../../api/services/channelConversationService', () => ({
    getConversation: jest.fn(async (args) => {
      calls.push({ fn: 'getConversation', args });
      return overrides.conversation === undefined ? { id: 'c-1' } : overrides.conversation;
    }),
  }));

  jest.doMock('../../api/services/orderService', () => ({
    getOrderById: jest.fn(async (args) => {
      calls.push({ fn: 'getOrderById', args });
      return overrides.order === undefined ? { id: 'o-1' } : overrides.order;
    }),
  }));

  jest.doMock('../../api/services/scheduleService', () => ({
    getSchedule: jest.fn((args) => {
      calls.push({ fn: 'getSchedule', args });
      return overrides.booking === undefined ? { id: 's-1' } : overrides.booking;
    }),
  }));

  // eslint-disable-next-line global-require
  const mod = require('../../api/services/askAi/entityResolvers');
  return { mod, calls };
}

describe('resolveEntityOwnership — tipo correto de consulta por entidade', () => {
  test('FITNESS_STUDENT resolve por subject_id (NÃO por membershipId)', async () => {
    const { mod, calls } = loadResolvers();
    const out = await mod.resolveEntityOwnership({
      entityType: 'FITNESS_STUDENT',
      entityId: 'student-42',
      tenantId: 'tenant-a',
    });

    expect(out).toEqual({ verifiable: true, owned: true, reason: null });
    expect(calls[0]).toEqual({
      fn: 'getMembershipAccessStatus',
      args: { tenantId: 'tenant-a', subjectId: 'student-42' },
    });
    expect(calls.some((c) => c.fn === 'getMembershipDetail')).toBe(false);
  });

  test('CUSTOMER resolve pela entidade do Workspace (tenant-scoped)', async () => {
    const { mod, calls } = loadResolvers();
    const out = await mod.resolveEntityOwnership({ entityType: 'CUSTOMER', entityId: 'ent-9', tenantId: 'tenant-a' });

    expect(out.owned).toBe(true);
    expect(calls[0]).toEqual({ fn: 'getEntity', args: { tenantId: 'tenant-a', entityId: 'ent-9' } });
  });

  test('CONVERSATION resolve pela conversa do canal', async () => {
    const { mod, calls } = loadResolvers();
    const out = await mod.resolveEntityOwnership({ entityType: 'CONVERSATION', entityId: 'conv-3', tenantId: 'tenant-a' });

    expect(out.owned).toBe(true);
    expect(calls[0].fn).toBe('getConversation');
    expect(calls[0].args).toMatchObject({ tenantId: 'tenant-a', conversationId: 'conv-3' });
  });

  test('ORDER resolve pelo pedido', async () => {
    const { mod, calls } = loadResolvers();
    const out = await mod.resolveEntityOwnership({ entityType: 'ORDER', entityId: 'ord-7', tenantId: 'tenant-a' });

    expect(out.owned).toBe(true);
    expect(calls[0].fn).toBe('getOrderById');
  });

  test('BOOKING resolve pelo agendamento', async () => {
    const { mod, calls } = loadResolvers();
    const out = await mod.resolveEntityOwnership({ entityType: 'BOOKING', entityId: 'sch-5', tenantId: 'tenant-a' });

    expect(out.owned).toBe(true);
    expect(calls[0].fn).toBe('getSchedule');
  });
});

describe('resolveEntityOwnership — fail-closed', () => {
  test('entidade de outro tenant (não encontrada) não é acessível', async () => {
    const { mod } = loadResolvers({ fitnessStudent: { membership: null } });
    const out = await mod.resolveEntityOwnership({
      entityType: 'FITNESS_STUDENT',
      entityId: 'student-de-outro-tenant',
      tenantId: 'tenant-a',
    });

    expect(out).toEqual({
      verifiable: true,
      owned: false,
      reason: 'entity_not_accessible',
    });
  });

  test('tipo sem mecanismo de verificação é recusado (nunca aceito por confiança)', async () => {
    const { mod, calls } = loadResolvers();
    const out = await mod.resolveEntityOwnership({ entityType: 'CASE', entityId: 'case-1', tenantId: 'tenant-a' });

    expect(out).toEqual({
      verifiable: false,
      owned: false,
      reason: 'entity_ownership_not_verifiable',
    });
    expect(calls).toHaveLength(0);
  });

  test('erro do resolver vira validation_failed (sem vazar o erro)', async () => {
    const { mod } = loadResolvers();
    jest.resetModules();
    jest.doMock('../../api/services/orderService', () => ({
      getOrderById: jest.fn(async () => { throw new Error('db down'); }),
    }));
    // eslint-disable-next-line global-require
    const fresh = require('../../api/services/askAi/entityResolvers');
    const out = await fresh.resolveEntityOwnership({ entityType: 'ORDER', entityId: 'o-1', tenantId: 'tenant-a' });

    expect(out).toEqual({ verifiable: true, owned: false, reason: 'entity_validation_failed' });
    void mod;
  });

  test('sem tenant ou sem id não há verificação', async () => {
    const { mod } = loadResolvers();
    await expect(mod.resolveEntityOwnership({ entityType: 'ORDER', entityId: 'o-1' }))
      .resolves.toMatchObject({ owned: false, verifiable: false });
    await expect(mod.resolveEntityOwnership({ entityType: 'ORDER', tenantId: 'tenant-a' }))
      .resolves.toMatchObject({ owned: false, verifiable: false });
  });

  test('lista de tipos verificáveis é a fonte única do contrato', () => {
    const { mod } = loadResolvers();
    expect(mod.VERIFIABLE_ENTITY_TYPES).toEqual([
      'FITNESS_STUDENT', 'CUSTOMER', 'CONVERSATION', 'ORDER', 'BOOKING',
    ]);
    expect(mod.VERIFIABLE_ENTITY_TYPES).not.toContain('CASE');
  });
});
