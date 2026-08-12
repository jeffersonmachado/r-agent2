'use strict';

/**
 * Execution Router — separação ATOMIC vs DURABLE e integração com o
 * Cognitive Orchestrator + Agent Supervisor.
 * Cobre os testes obrigatórios 24, 26 e 27 da especificação.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const {
  createExecutionRouter,
  decideExecutionMode,
  planToCanonicalProcessDefinition,
} = require('../../src/core/cognitive/execution-router');
const { createExecutionEngine } = require('../../src/core/cognitive/execution-engine');
const { createToolRegistry } = require('../../src/core/cognitive/tool-registry');
const { createCognitiveOrchestrator } = require('../../src/core/cognitive/cognitive-orchestrator');

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const ACTOR = { classification: 'PRODUCTION', permissions: ['*'] };

function registryWithTool(tool = {}) {
  const registry = createToolRegistry({ logger: silent });
  registry.register({
    id: 'crm.searchCustomer',
    aliases: ['searchCustomer'],
    visibility: 'PRODUCTION',
    permissions: [],
    description: 'stub',
    execute: jest.fn(async () => ({ customers: [] })),
    ...tool,
  });
  return registry;
}

describe('Execution Router', () => {
  test('decisão atomic por default; durable por flag, wait ou executionMode da tool', () => {
    const plan = { planId: 'p1', intent: 'agendar', steps: [{ id: 's1', toolId: 'crm.searchCustomer' }] };
    expect(decideExecutionMode({ plan }).mode).toBe('atomic');
    expect(decideExecutionMode({ plan, payload: { durable: true } }).mode).toBe('durable');
    expect(decideExecutionMode({ plan, payload: { waitForEvent: 'payment.confirmed' } }).mode).toBe('durable');
    expect(decideExecutionMode({ plan: { ...plan, steps: [{ id: 's1', toolId: 'x', waiting: true }] } }).mode).toBe('durable');

    const registry = registryWithTool({ executionMode: 'durable' });
    expect(decideExecutionMode({ plan, toolRegistry: registry }).mode).toBe('durable');
  });

  test('27. atomic plan não cria processo (Process Runtime nunca é tocado)', async () => {
    const registry = registryWithTool();
    const engine = createExecutionEngine({ toolRegistry: registry, logger: silent });
    const processRuntime = { startProcess: jest.fn() };
    const router = createExecutionRouter({
      executionEngine: engine, toolRegistry: registry, processRuntime, logger: silent,
    });

    const result = await router.execute({
      plan: { planId: 'p1', tenantId: 't1', intent: 'consultar_status', steps: [{ id: 's1', toolId: 'crm.searchCustomer' }] },
      context: { tenantId: 't1' },
      actor: ACTOR,
    });

    expect(result.executionMode).toBe('atomic');
    expect(result.processInstanceId).toBeNull();
    expect(processRuntime.startProcess).not.toHaveBeenCalled();
  });

  test('26. plano durable é delegado ao Process Runtime existente', async () => {
    const registry = registryWithTool();
    const engine = createExecutionEngine({ toolRegistry: registry, logger: silent });
    const processRuntime = {
      startProcess: jest.fn(async (definition, input) => {
        // Definição canônica gerada a partir do plano.
        expect(definition.nodes.some((n) => n.type === 'task.service')).toBe(true);
        expect(input.tenantId).toBe('t1');
        return { status: 'completed', executionId: 'proc-1' };
      }),
    };
    const router = createExecutionRouter({
      executionEngine: engine, toolRegistry: registry, processRuntime, logger: silent,
    });

    const result = await router.execute({
      plan: {
        planId: 'p1', tenantId: 't1', intent: 'agendar', durable: true,
        steps: [{ id: 's1', toolId: 'crm.searchCustomer' }],
      },
      context: { tenantId: 't1' },
      actor: ACTOR,
      payload: { durable: true },
    });

    expect(result.executionMode).toBe('durable');
    expect(result.processInstanceId).toBe('proc-1');
    expect(processRuntime.startProcess).toHaveBeenCalledTimes(1);
  });

  test('process runtime indisponível → falha explícita, nunca fake success', async () => {
    const registry = registryWithTool();
    const engine = createExecutionEngine({ toolRegistry: registry, logger: silent });
    const processRuntime = {
      startProcess: jest.fn(async () => { throw new Error('pg_connection_refused'); }),
    };
    const router = createExecutionRouter({
      executionEngine: engine, toolRegistry: registry, processRuntime, logger: silent,
    });

    await expect(router.execute({
      plan: { planId: 'p1', tenantId: 't1', intent: 'agendar', durable: true, steps: [] },
      context: { tenantId: 't1' },
      actor: ACTOR,
      payload: { durable: true },
    })).rejects.toThrow('process_runtime_execution_failed');
  });

  test('planToCanonicalProcessDefinition gera start → task.service → end', () => {
    const def = planToCanonicalProcessDefinition(
      { planId: 'p1', intent: 'agendar', steps: [{ id: 'find', toolId: 'crm.searchCustomer' }, { id: 'info', toolId: null }] },
      { tenantId: 't1' },
    );
    expect(def.nodes[0].type).toBe('start');
    expect(def.nodes[def.nodes.length - 1].type).toBe('end');
    expect(def.nodes.find((n) => n.config?.toolId === 'crm.searchCustomer')).toBeDefined();
    expect(def.metadata.tenantId).toBe('t1');
  });
});

describe('Cognitive Orchestrator — integração Supervisor (24)', () => {
  function buildOrchestrator({ supervisor } = {}) {
    const registry = registryWithTool();
    return createCognitiveOrchestrator({
      logger: silent,
      toolRegistry: registry,
      agentSupervisor: supervisor,
      contextEngine: {
        buildContext: jest.fn(async ({ tenantId }) => ({ tenantId, trace: [] })),
      },
      intentEngine: {
        classify: jest.fn(async () => ({
          intent: 'consultar_status', confidence: 0.99, entities: {}, source: 'explicit', rationale: 'test',
        })),
      },
      learningEngine: { record: jest.fn(async () => ({})) },
    });
  }

  test('24. pipeline passa pelo Supervisor entre Intent e Planning', async () => {
    const route = jest.fn(async () => ({
      status: 'routed',
      agentId: 'a1',
      agentSlug: 'crm-agent',
      classification: 'PRODUCTION',
      reason: 'test',
      confidence: 0.9,
      capabilities: ['crm.read'],
      allowedTools: ['crm.searchCustomer'],
      knowledgeScope: { domain: 'OPERATIONAL' },
    }));
    const orchestrator = buildOrchestrator({ supervisor: { route } });
    const result = await orchestrator.process({
      tenantId: 't1',
      message: 'qual o status do meu pedido?',
      actor: { userId: 'u1', classification: 'PRODUCTION', permissions: ['*'] },
    });

    expect(route).toHaveBeenCalledWith(expect.objectContaining({
      intent: 'consultar_status',
      tenantId: 't1',
    }));
    expect(result.status).toBe('completed');
    expect(result.outputs.map((o) => o.step)).toContain('find_customer');
  });

  test('plano é restrito ao escopo de tools do especialista roteado', async () => {
    // Especialista sem nenhuma tool do plano → passos de tool negados.
    const route = jest.fn(async () => ({
      status: 'routed',
      agentId: 'a1',
      agentSlug: 'narrow-agent',
      classification: 'PRODUCTION',
      reason: 'test',
      confidence: 0.9,
      capabilities: ['crm.read'],
      allowedTools: ['tool.inexistente'],
      knowledgeScope: { domain: 'OPERATIONAL' },
    }));
    const orchestrator = buildOrchestrator({ supervisor: { route } });
    const result = await orchestrator.process({
      tenantId: 't1',
      message: 'status?',
      actor: { userId: 'u1', classification: 'PRODUCTION', permissions: ['*'] },
    });
    expect(result.outputs.map((o) => o.step)).not.toContain('find_customer');
  });

  test('P0: sem especialista elegível o pipeline NÃO executa (fail closed)', async () => {
    const route = jest.fn(async () => ({
      status: 'no_specialist', reason: 'no_eligible_agent_covers_intent',
      agentId: null, agentSlug: null, capabilities: [], allowedTools: [],
      knowledgeScope: { domain: 'OPERATIONAL' },
    }));
    const orchestrator = buildOrchestrator({ supervisor: { route } });
    const result = await orchestrator.process({
      tenantId: 't1',
      message: 'status?',
      actor: { userId: 'u1', classification: 'PRODUCTION', permissions: ['*'] },
    });
    // P0: NO_SPECIALIST → cannot_complete (nunca executa plano genérico).
    expect(result.status).toBe('cannot_complete');
    expect(result.businessOutcome).toBe('outcome_not_achieved');
    expect(route).toHaveBeenCalled();
  });
});
