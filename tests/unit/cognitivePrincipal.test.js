'use strict';

/**
 * Regressão (gap 3.4): o Cognitive Orchestrator aplicava
 * `actor || { ..., permissions: ['*'] }` — wildcard implícito inadequado para
 * um runtime autônomo governado. O default deve ser fail-closed: principal
 * restrito, sem permissões, e nenhuma execução com side effect recebe '*'
 * automaticamente.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const {
  createCognitiveOrchestrator,
  createContextEngine,
  createIntentEngine,
  createActionPlanner,
  createExecutionEngine,
  createValidationEngine,
  createLearningEngine,
  createToolRegistry,
} = require('../../src/core/cognitive');

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function buildOrchestrator(toolRegistry) {
  const registry = toolRegistry || createToolRegistry({ logger: silent });
  return createCognitiveOrchestrator({
    logger: silent,
    toolRegistry: registry,
    agentSupervisor: null,
    contextEngine: createContextEngine({ logger: silent }),
    intentEngine: {
      classify: async () => ({
        intent: 'agendar', confidence: 0.99, entities: {}, source: 'explicit', rationale: 'test',
      }),
    },
    actionPlanner: createActionPlanner({ toolRegistry: registry, logger: silent }),
    executionEngine: createExecutionEngine({ toolRegistry: registry, logger: silent }),
    validationEngine: createValidationEngine({ logger: silent }),
    learningEngine: createLearningEngine({ logger: silent }),
  });
}

describe('Cognitive Orchestrator — principal fail-closed', () => {
  test('process sem actor não recebe wildcard de permissões', async () => {
    const registry = createToolRegistry({ logger: silent });
    let capturedActor = null;
    registry.register({
      id: 'createAppointment',
      visibility: 'PRODUCTION',
      permissions: ['agenda.write'],
      description: 'tool com side effect',
      execute: async () => ({}),
    });
    const orchestrator = buildOrchestrator(registry);
    const planner = orchestrator._engines.actionPlanner;
    const originalPlan = planner.plan.bind(planner);

    // Intercepta o actor recebido pelo planner via execução real:
    // sem permissão agenda.write, o passo create_appointment deve ser negado.
    const result = await orchestrator.process({
      tenantId: 't1',
      message: 'quero agendar amanhã às 10h',
    });

    // fail-closed: sem actor explícito, nenhuma tool com permissão executa.
    const executed = result.outputs.map((o) => o.step);
    expect(executed).not.toContain('create_appointment');
    expect(['failed', 'completed']).toContain(result.status);
  });

  test('ator sem permissão para ação obrigatória tem plano rejeitado (P0: falso sucesso)', async () => {
    const registry = createToolRegistry({ logger: silent });
    const executeMock = jest.fn(async () => ({ ok: true }));
    registry.register({
      id: 'searchCustomer',
      visibility: 'PRODUCTION',
      permissions: ['crm.read'],
      description: 'busca',
      execute: executeMock,
    });
    registry.register({
      id: 'createAppointment',
      visibility: 'PRODUCTION',
      permissions: ['agenda.write'],
      description: 'agenda',
      execute: jest.fn(async () => ({})),
    });
    const orchestrator = buildOrchestrator(registry);

    const result = await orchestrator.process({
      tenantId: 't1',
      message: 'agendar',
      actor: { userId: 'u1', classification: 'PRODUCTION', permissions: ['crm.read'] },
    });

    // P0: agenda.write ausente → createAppointment é ação obrigatória.
    // O plano INTEIRO é rejeitado (não executa parcialmente).
    // Status deve ser 'failed', NUNCA 'completed'.
    expect(result.status).toBe('failed');
    expect(result.businessOutcome).toBe('outcome_not_achieved');
    // Nenhuma tool pode ser executada se a ação obrigatória é negada.
    expect(executeMock).not.toHaveBeenCalled();
  });

  test('módulo de principal expõe identidade explícita sem wildcard automático', () => {
    const principal = require('../../src/core/cognitive/principal');
    const p = principal.buildPrincipal({ userId: 'u1', tenantId: 't1' });
    expect(p.permissions).not.toContain('*');
    expect(p.principalType).toBeDefined();
    expect(p.classification).toBe('PRODUCTION');

    const anon = principal.defaultRestrictedPrincipal();
    expect(anon.permissions).toEqual([]);
    expect(anon.classification).toBe('PRODUCTION');

    // service principal com privilégio amplo exige declaração explícita auditável.
    const svc = principal.buildServicePrincipal({
      serviceId: 'cognitive-entry',
      tenantId: 't1',
      permissions: ['agenda.write'],
    });
    expect(svc.principalType).toBe('service');
    expect(svc.permissions).toEqual(['agenda.write']);
    expect(() => principal.buildServicePrincipal({ serviceId: 'x', tenantId: 't1', permissions: ['*'] }))
      .toThrow(/wildcard/i);
  });
});
