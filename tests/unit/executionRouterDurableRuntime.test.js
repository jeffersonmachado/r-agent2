'use strict';

/**
 * Integração REAL: Execution Router → Durable Process Runtime (sem mocks de
 * negócio). Um plano durável do Cognitive Core é compilado para definição
 * canônica e executado pelo ProcessRuntimeService real, com os nós de serviço
 * passando pelo Canonical Tool Registry (bridge serviceExecutor).
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { createExecutionRouter } = require('../../src/core/cognitive/execution-router');
const { createExecutionEngine } = require('../../src/core/cognitive/execution-engine');
const { createToolRegistry } = require('../../src/core/cognitive/tool-registry');
const { ProcessRuntimeService } = require('../../api/core/process-runtime/processRuntimeService');

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

describe('Execution Router → Process Runtime real (durable E2E)', () => {
  test('plano durable executa tools via registry dentro do runtime e persiste instância', async () => {
    const executed = [];
    const toolRegistry = createToolRegistry({ logger: silent });
    toolRegistry.register({
      id: 'crm.searchCustomer',
      visibility: 'PRODUCTION',
      permissions: [],
      description: 'stub de leitura',
      execute: jest.fn(async (input, context) => {
        executed.push({ tool: 'crm.searchCustomer', tenantId: context.tenantId, idem: context.idempotencyKey });
        return { customers: [{ id: 'l1', name: 'Maria' }] };
      }),
    });
    toolRegistry.register({
      id: 'workspace.generateInsight',
      visibility: 'PRODUCTION',
      permissions: [],
      description: 'stub de escrita',
      sideEffects: true,
      idempotencyPolicy: 'required',
      execute: jest.fn(async (input, context) => {
        executed.push({ tool: 'workspace.generateInsight', tenantId: context.tenantId, idem: context.idempotencyKey });
        return { insight: { id: 'ins-1' } };
      }),
    });

    // Runtime REAL (stores caem em memória sem Sequelize — mesmo comportamento
    // dos testes existentes do process runtime).
    const processRuntime = new ProcessRuntimeService();
    const executionEngine = createExecutionEngine({ toolRegistry, logger: silent });
    const router = createExecutionRouter({
      executionEngine, toolRegistry, processRuntime, logger: silent,
    });

    const plan = {
      planId: 'plan-durable-1',
      tenantId: 'tenant-a',
      intent: 'consultar_metricas',
      durable: true,
      steps: [
        { id: 'collect', toolId: 'crm.searchCustomer' },
        { id: 'insight', toolId: 'workspace.generateInsight' },
      ],
    };

    const result = await router.execute({
      plan,
      context: { tenantId: 'tenant-a' },
      actor: { classification: 'PRODUCTION', permissions: ['*'] },
      input: { shared: { query: 'maria' } },
      payload: { durable: true },
      executionId: 'exec-durable-1',
    });

    expect(result.executionMode).toBe('durable');
    expect(result.processInstanceId).toBeTruthy();
    expect(result.processResult.ok).toBe(true);
    expect(result.processResult.status).toBe('completed');

    // As duas tools executaram dentro do runtime, via registry, com tenant e
    // idempotencyKey determinística por execução+nó.
    expect(executed.map((e) => e.tool)).toEqual(['crm.searchCustomer', 'workspace.generateInsight']);
    expect(executed.every((e) => e.tenantId === 'tenant-a')).toBe(true);
    expect(executed[1].idem).toContain('insight');

    // Instância durável persistida e inspecionável (estado sobrevive a consulta posterior).
    const instance = await processRuntime.instanceStore.loadInstance(result.processInstanceId);
    expect(instance).toBeTruthy();
    expect(String(instance.status)).toBe('completed');

    // Eventos do runtime registrados (observabilidade do caminho durável).
    const eventTypes = result.processResult.events.map((e) => e.eventType);
    expect(eventTypes).toEqual(expect.arrayContaining(['PROCESS_STARTED', 'PROCESS_COMPLETED']));
  }, 15000);
});
