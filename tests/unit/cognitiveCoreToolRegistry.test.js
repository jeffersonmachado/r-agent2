/**
 * Testes unitários: Cognitive Core — Tool Registry, visibility e permissionamento.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { createToolRegistry, registerDefaultTools } = require('../../src/core/cognitive/tool-registry');
const { OPERATIONAL_FORBIDDEN_PATTERN } = require('../../src/core/cognitive/visibility');

function stubTool(overrides = {}) {
  return {
    id: 'stubTool',
    visibility: 'PRODUCTION',
    permissions: [],
    description: 'tool de teste',
    execute: jest.fn(async (input, context) => ({ ok: true, tenantId: context.tenantId })),
    ...overrides,
  };
}

describe('Cognitive Core — Tool Registry', () => {
  test('valida contrato CognitiveTool no registro', () => {
    const registry = createToolRegistry();
    expect(() => registry.register({ id: 'x' })).toThrow('cognitive_tool_invalid');
    expect(() => registry.register(stubTool({ visibility: 'PUBLIC' }))).toThrow('visibility');
    expect(() => registry.register(stubTool({ execute: null }))).toThrow('execute');
    expect(() => registry.register(stubTool({ permissions: 'crm.read' }))).toThrow('permissions');
  });

  test('rejeita registro duplicado', () => {
    const registry = createToolRegistry();
    registry.register(stubTool());
    expect(() => registry.register(stubTool())).toThrow('cognitive_tool_duplicate');
  });

  test('execução exige tenant', async () => {
    const registry = createToolRegistry();
    registry.register(stubTool());
    await expect(registry.execute('stubTool', {}, {})).rejects.toThrow('cognitive_tool_tenant_required');
  });

  test('nenhuma execução direta: tool desconhecida falha explicitamente', async () => {
    const registry = createToolRegistry();
    await expect(registry.execute('naoExiste', {}, { tenantId: 't1' })).rejects.toThrow('cognitive_tool_not_found');
  });

  test('visibility: ator PRODUCTION não executa tool SUPPORT nem DEVELOPMENT', async () => {
    const registry = createToolRegistry();
    registry.register(stubTool({ id: 'supportTool', visibility: 'SUPPORT' }));
    registry.register(stubTool({ id: 'devTool', visibility: 'DEVELOPMENT' }));
    const context = { tenantId: 't1', actor: { classification: 'PRODUCTION', permissions: ['*'] } };
    await expect(registry.execute('supportTool', {}, context)).rejects.toThrow('cognitive_tool_visibility_denied');
    await expect(registry.execute('devTool', {}, context)).rejects.toThrow('cognitive_tool_visibility_denied');
  });

  test('visibility: SUPPORT executa PRODUCTION+SUPPORT; DEVELOPMENT executa tudo', async () => {
    const registry = createToolRegistry();
    registry.register(stubTool({ id: 'prodTool', visibility: 'PRODUCTION' }));
    registry.register(stubTool({ id: 'supportTool', visibility: 'SUPPORT' }));
    registry.register(stubTool({ id: 'devTool', visibility: 'DEVELOPMENT' }));

    const support = { tenantId: 't1', actor: { classification: 'SUPPORT', permissions: ['*'] } };
    await expect(registry.execute('prodTool', {}, support)).resolves.toMatchObject({ success: true });
    await expect(registry.execute('supportTool', {}, support)).resolves.toMatchObject({ success: true });
    await expect(registry.execute('devTool', {}, support)).rejects.toThrow('cognitive_tool_visibility_denied');

    const dev = { tenantId: 't1', actor: { classification: 'DEVELOPMENT', permissions: ['*'] } };
    await expect(registry.execute('devTool', {}, dev)).resolves.toMatchObject({ success: true });
  });

  test('permissionamento: nega execução sem permissão exigida', async () => {
    const registry = createToolRegistry();
    registry.register(stubTool({ id: 'guarded', permissions: ['crm.write'] }));
    const noPerm = { tenantId: 't1', actor: { classification: 'PRODUCTION', permissions: ['crm.read'] } };
    await expect(registry.execute('guarded', {}, noPerm)).rejects.toThrow('cognitive_tool_permission_denied');
    const withPerm = { tenantId: 't1', actor: { classification: 'PRODUCTION', permissions: ['crm.write'] } };
    await expect(registry.execute('guarded', {}, withPerm)).resolves.toMatchObject({ success: true });
  });

  test('list para ator PRODUCTION oculta tools SUPPORT e DEVELOPMENT', () => {
    const registry = createToolRegistry();
    registry.register(stubTool({ id: 'prodTool', visibility: 'PRODUCTION' }));
    registry.register(stubTool({ id: 'replayDiag', visibility: 'SUPPORT' }));
    registry.register(stubTool({ id: 'qaWaveRunner', visibility: 'DEVELOPMENT' }));

    const visible = registry.list({ classification: 'PRODUCTION' }).map((t) => t.id);
    expect(visible).toEqual(['prodTool']);

    const supportVisible = registry.list({ classification: 'SUPPORT' }).map((t) => t.id);
    expect(supportVisible).toEqual(expect.arrayContaining(['prodTool', 'replayDiag']));
    expect(supportVisible).not.toContain('qaWaveRunner');
  });

  describe('tools padrão (delegação a serviços reais)', () => {
    test('registra as 13 tools de negócio, todas PRODUCTION', () => {
      const registry = registerDefaultTools(createToolRegistry());
      const tools = registry.list({ classification: 'PRODUCTION' });
      const ids = tools.map((t) => t.id);
      expect(ids).toEqual(expect.arrayContaining([
        'searchCustomer', 'createLead', 'updateLead', 'createOpportunity',
        'createAppointment', 'rescheduleAppointment', 'cancelAppointment',
        'sendWhatsappMessage', 'createTicket', 'transferConversation',
        'originateCall', 'createCampaign', 'generateInsight',
      ]));
      expect(tools).toHaveLength(13);
      expect(tools.every((t) => t.visibility === 'PRODUCTION')).toBe(true);
    });

    test('ocultação: nenhuma tool operacional expõe QA Waves, Replay, Seeds, Mesh ou RPA', () => {
      const registry = registerDefaultTools(createToolRegistry());
      for (const tool of registry.list({ classification: 'PRODUCTION' })) {
        expect(`${tool.id} ${tool.description}`).not.toMatch(OPERATIONAL_FORBIDDEN_PATTERN);
      }
    });

    test('createLead delega a marketingService.upsertLead com tenant isolado', async () => {
      const marketingService = {
        upsertLead: jest.fn(async ({ tenantId, name }) => ({ ok: true, lead: { id: 'l1', tenantId, name } })),
      };
      const registry = registerDefaultTools(createToolRegistry(), { marketingService });
      const result = await registry.execute('createLead', { name: 'Maria' }, {
        tenantId: 'tenant-a',
        actor: { classification: 'PRODUCTION', permissions: ['*'] },
      });
      expect(marketingService.upsertLead).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', name: 'Maria' }));
      expect(result.success).toBe(true);
    });

    test('searchCustomer filtra leads do tenant pela query', async () => {
      const marketingService = {
        listLeads: jest.fn(async ({ tenantId }) => ({
          total: 2,
          items: [
            { id: 'l1', name: 'Maria Silva', phone: '11999998888', email: 'maria@x.com', tenant: tenantId },
            { id: 'l2', name: 'João Souza', phone: '11888887777', email: 'joao@x.com', tenant: tenantId },
          ],
        })),
        getLeadById: jest.fn(),
      };
      const registry = registerDefaultTools(createToolRegistry(), { marketingService });
      const result = await registry.execute('searchCustomer', { query: 'maria' }, {
        tenantId: 'tenant-a',
        actor: { classification: 'PRODUCTION', permissions: ['*'] },
      });
      expect(marketingService.listLeads).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a' }));
      expect(result.output.customers).toHaveLength(1);
      expect(result.output.customers[0].id).toBe('l1');
    });

    test('createOpportunity sem service layer falha explicitamente (sem simulação)', async () => {
      const registry = registerDefaultTools(createToolRegistry());
      await expect(registry.execute('createOpportunity', { name: 'Deal' }, {
        tenantId: 'tenant-a',
        actor: { classification: 'PRODUCTION', permissions: ['*'] },
      })).rejects.toThrow('cognitive_tool_unavailable');
    });
  });
});
