'use strict';

/**
 * Capability Kernel — schemas, side effects, idempotência.
 * Cobre os testes obrigatórios 15–18 da especificação.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { createToolRegistry, registerDefaultTools } = require('../../src/core/cognitive/tool-registry');

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const ACTOR = { classification: 'PRODUCTION', permissions: ['*'] };

describe('Capability Kernel — validação e políticas', () => {
  test('15. input inválido falha ANTES de tocar o serviço', async () => {
    const executeSpy = jest.fn(async () => ({}));
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'crm.createLead',
      visibility: 'PRODUCTION',
      permissions: ['crm.write'],
      description: 'cria lead',
      sideEffects: true,
      idempotencyPolicy: 'required',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1 } },
      },
      execute: executeSpy,
    });

    await expect(registry.execute('crm.createLead', {}, {
      tenantId: 't1', actor: ACTOR, idempotencyKey: 'k1',
    })).rejects.toThrow('cognitive_tool_input_invalid');
    expect(executeSpy).not.toHaveBeenCalled();
  });

  test('16. output inválido é detectado (outputSchema)', async () => {
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'crm.searchCustomer',
      visibility: 'PRODUCTION',
      permissions: [],
      description: 'busca',
      outputSchema: {
        type: 'object',
        required: ['customers'],
        properties: { customers: { type: 'array' } },
      },
      execute: async () => ({ wrong: true }),
    });

    await expect(registry.execute('crm.searchCustomer', {}, { tenantId: 't1', actor: ACTOR }))
      .rejects.toThrow('cognitive_tool_output_invalid');
  });

  test('17. tool com side effect exige idempotencyKey quando política é required', async () => {
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'schedule.createAppointment',
      visibility: 'PRODUCTION',
      permissions: [],
      description: 'agenda',
      sideEffects: true,
      idempotencyPolicy: 'required',
      execute: async () => ({}),
    });

    await expect(registry.execute('schedule.createAppointment', {}, { tenantId: 't1', actor: ACTOR }))
      .rejects.toThrow('cognitive_tool_idempotency_key_required');

    await expect(registry.execute('schedule.createAppointment', {}, {
      tenantId: 't1', actor: ACTOR, idempotencyKey: 'exec-1:step-1',
    })).resolves.toMatchObject({ success: true });
  });

  test('18. idempotencyKey/correlationId são propagados até a tool', async () => {
    const registry = registerDefaultTools(createToolRegistry({ logger: silent }), {
      marketingService: {
        upsertLead: jest.fn(async () => ({ id: 'l1' })),
      },
    });
    let seenContext = null;
    const original = registry.get('crm.createLead');
    const wrapped = {
      ...original,
      execute: async (input, context) => { seenContext = context; return original.execute(input, context); },
    };
    // re-registra via registry novo para inspecionar o contexto
    const registry2 = createToolRegistry({ logger: silent });
    registry2.register(wrapped);

    await registry2.execute('crm.createLead', { name: 'Maria' }, {
      tenantId: 't1',
      actor: ACTOR,
      correlationId: 'corr-123',
      executionId: 'exec-9',
      idempotencyKey: 'exec-9:create_lead',
    });

    expect(seenContext.correlationId).toBe('corr-123');
    expect(seenContext.executionId).toBe('exec-9');
    expect(seenContext.idempotencyKey).toBe('exec-9:create_lead');
  });

  test('contrato estendido é validado no registro (riskLevel, policies, executionMode)', () => {
    const registry = createToolRegistry({ logger: silent });
    const base = {
      id: 'x', visibility: 'PRODUCTION', permissions: [], description: 'd', execute: async () => ({}),
    };
    expect(() => registry.register({ ...base, riskLevel: 'altissimo' })).toThrow('riskLevel');
    expect(() => registry.register({ ...base, confirmationPolicy: 'talvez' })).toThrow('confirmationPolicy');
    expect(() => registry.register({ ...base, idempotencyPolicy: 'as_vezes' })).toThrow('idempotencyPolicy');
    expect(() => registry.register({ ...base, executionMode: 'meio_duravel' })).toThrow('executionMode');
    expect(() => registry.register({
      ...base, id: 'ok',
      capability: 'crm.read', riskLevel: 'low', sideEffects: false,
      confirmationPolicy: 'autonomous', idempotencyPolicy: 'none', executionMode: 'atomic',
    })).not.toThrow();
  });
});
