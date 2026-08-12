'use strict';

/**
 * Integration Smoke Tests — cenários de negócio fim-a-fim.
 *
 * Cobrem:
 *  - Scheduling success (cognitive → outcome → evidência)
 *  - Scheduling denied (sem permissão → cannot_complete)
 *  - SYSTEM diagnosis (SUPPORT → Knowledge Router → SYSTEM)
 *  - Production isolation (PRODUCTION → SYSTEM denied)
 *  - Event semantics (cannot_complete ≠ completed)
 *  - Knowledge Plane segregation
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { createCognitiveOrchestrator } = require('../../src/core/cognitive/cognitive-orchestrator');
const { createToolRegistry, registerDefaultTools } = require('../../src/core/cognitive/tool-registry');
const { createContextEngine } = require('../../src/core/cognitive/context-engine');
const { createIntentEngine } = require('../../src/core/cognitive/intent-engine');
const { createActionPlanner } = require('../../src/core/cognitive/action-planner');
const { createExecutionEngine } = require('../../src/core/cognitive/execution-engine');
const { createExecutionRouter } = require('../../src/core/cognitive/execution-router');
const { createAgentSupervisor } = require('../../src/core/cognitive/agent-supervisor');
const { createCapabilityRegistry } = require('../../src/core/cognitive/capability-registry');
const { createValidationEngine } = require('../../src/core/cognitive/validation-engine');
const { createLearningEngine } = require('../../src/core/cognitive/learning-engine');
const { canAccess } = require('../../src/core/cognitive/visibility');
const { resolveKnowledgeContext } = require('../../src/core/knowledge-plane');
const { buildDurableEvidence } = require('../../src/core/cognitive/execution-router/durable-evidence-adapter');
const { getOutcomeContract, validateBusinessOutcome } = require('../../src/core/cognitive/outcome');

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function buildStubRegistry({ onExecute } = {}) {
  const registry = createToolRegistry();
  const toolIds = [
    'searchCustomer', 'schedule.findAvailability', 'schedule.listAppointments',
    'createAppointment', 'rescheduleAppointment', 'cancelAppointment',
    'sendWhatsappMessage', 'createTicket', 'transferConversation',
    'createLead', 'updateLead', 'createOpportunity', 'createCampaign', 'generateInsight',
    'knowledge.searchOperational', 'knowledge.searchSystem',
  ];
  for (const id of toolIds) {
    registry.register({
      id,
      visibility: id.includes('knowledge') ? (id.includes('System') ? 'SUPPORT' : 'PRODUCTION') : 'PRODUCTION',
      permissions: id.includes('knowledge') ? ['knowledge.read'] : [],
      description: `stub ${id}`,
      execute: jest.fn(async (input, context) => ({
        ok: true,
        toolId: id,
        tenantId: context.tenantId,
        // Retorna output realista para outcome validation
        ...(id === 'createAppointment' ? { appointment: { id: 'apt-001', startAt: input.startAt || '2026-01-01T10:00:00Z' } } : {}),
        ...(id === 'schedule.findAvailability' ? { available: true, conflictsCount: 0, existingAppointments: 2 } : {}),
        ...(id === 'searchCustomer' ? { customers: [{ id: 'c1', name: 'Maria' }] } : {}),
        ...(id === 'createLead' ? { lead: { id: 'lead-001' } } : {}),
        ...(id === 'createTicket' ? { ticket: { id: 'tkt-001' } } : {}),
        ...(id === 'sendWhatsappMessage' ? { messageId: 'msg-001', sent: true } : {}),
      })),
    });
  }
  return registry;
}

function buildOrchestrator(registry) {
  return createCognitiveOrchestrator({
    logger: silent,
    toolRegistry: registry,
    agentSupervisor: null,
    contextEngine: createContextEngine({ logger: silent }),
    intentEngine: createIntentEngine({ logger: silent, llmEnabled: false }),
    actionPlanner: createActionPlanner({ toolRegistry: registry, logger: silent }),
    executionEngine: createExecutionEngine({ toolRegistry: registry, logger: silent }),
    executionRouter: createExecutionRouter({
      executionEngine: createExecutionEngine({ toolRegistry: registry, logger: silent }),
      toolRegistry: registry,
      logger: silent,
    }),
    validationEngine: createValidationEngine({ logger: silent }),
    learningEngine: createLearningEngine({ logger: silent }),
  });
}

describe('Integration Smoke — Scheduling Success', () => {
  test('agendar com permissão → completed + businessOutcome + evidence', async () => {
    const registry = buildStubRegistry();
    const orchestrator = buildOrchestrator(registry);

    const result = await orchestrator.process({
      tenantId: 't1',
      channel: 'whatsapp',
      message: 'quero agendar',
      payload: { intent: 'agendar' },
      actor: { userId: 'u1', classification: 'PRODUCTION', permissions: ['*'] },
    });

    expect(result.status).toBe('completed');
    expect(result.businessOutcome).toBe('appointment_created');
    expect(result.businessEvidence['appointment.id']).toBe('apt-001');
    expect(result.businessFailures).toEqual([]);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  test('agendar sem agenda.write → cannot_complete (P0)', async () => {
    const registry = createToolRegistry();
    registry.register({ id: 'searchCustomer', visibility: 'PRODUCTION', permissions: [], description: 'stub', execute: async () => ({ customers: [] }) });
    registry.register({ id: 'schedule.findAvailability', visibility: 'PRODUCTION', permissions: [], description: 'stub', execute: async () => ({ available: true }) });
    registry.register({ id: 'createAppointment', visibility: 'PRODUCTION', permissions: ['agenda.write'], description: 'stub', execute: async () => ({ appointment: { id: 'apt-1' } }) });
    registry.register({ id: 'sendWhatsappMessage', visibility: 'PRODUCTION', permissions: [], description: 'stub', execute: async () => ({ sent: true }) });

    const orchestrator = buildOrchestrator(registry);

    const result = await orchestrator.process({
      tenantId: 't1',
      channel: 'whatsapp',
      message: 'quero agendar',
      payload: { intent: 'agendar' },
      actor: { userId: 'u1', classification: 'PRODUCTION', permissions: ['crm.read'] },
    });

    // P0: Sem permissão para ação obrigatória → cannot_complete.
    expect(result.status).toBe('failed');
    expect(result.businessOutcome).toBe('outcome_not_achieved');
  });
});

describe('Integration Smoke — Outcome Validation', () => {
  test('outcome contract validates real tool outputs', () => {
    const contract = getOutcomeContract('agendar');
    expect(contract.requiredAction).toBe('createAppointment');

    // Simula execução real: tool retorna { appointment: { id: 'apt-1' } }
    const result = validateBusinessOutcome({
      intent: 'agendar',
      execution: {
        status: 'completed',
        steps: [
          { id: 'create_appointment', status: 'executed', output: { appointment: { id: 'apt-1' } } },
        ],
        toolsExecuted: ['createAppointment'],
      },
    });
    expect(result.valid).toBe(true);
    expect(result.evidence['appointment.id']).toBe('apt-1');
  });

  test('lead output yields valid evidence', () => {
    const result = validateBusinessOutcome({
      intent: 'criar_lead',
      execution: {
        status: 'completed',
        steps: [
          { id: 'create_lead', status: 'executed', output: { lead: { id: 'lead-1' } } },
        ],
        toolsExecuted: ['createLead'],
      },
    });
    expect(result.valid).toBe(true);
    expect(result.evidence['lead.id']).toBe('lead-1');
  });
});

describe('Integration Smoke — Knowledge Plane', () => {
  test('PRODUCTION → OPERATIONAL works', () => {
    const result = resolveKnowledgeContext({
      principal: { classification: 'PRODUCTION' },
    });
    expect(result.allowed).toBe(true);
    expect(result.scope.domain).toBe('OPERATIONAL');
  });

  test('PRODUCTION → SYSTEM denied', () => {
    const result = resolveKnowledgeContext({
      principal: { classification: 'PRODUCTION' },
      requestedDomain: 'SYSTEM',
    });
    expect(result.allowed).toBe(false);
  });

  test('SUPPORT → SYSTEM works', () => {
    const result = resolveKnowledgeContext({
      principal: { classification: 'SUPPORT' },
      requestedDomain: 'SYSTEM',
    });
    expect(result.allowed).toBe(true);
    expect(result.scope.domain).toBe('SYSTEM');
  });

  test('unknown classification → restricted default', () => {
    const result = resolveKnowledgeContext({
      principal: { classification: 'INVALID' },
    });
    expect(result.scope.domain).toBe('OPERATIONAL');
    expect(result.scope.classifications).toEqual(['PRODUCTION']);
  });
});

describe('Integration Smoke — Event Semantics', () => {
  test('completed emits business.outcome.validated', async () => {
    const events = [];
    const registry = buildStubRegistry();
    const orchestrator = createCognitiveOrchestrator({
      logger: silent,
      toolRegistry: registry,
      agentSupervisor: null,
      contextEngine: createContextEngine({ logger: silent }),
      intentEngine: createIntentEngine({ logger: silent, llmEnabled: false }),
      actionPlanner: createActionPlanner({ toolRegistry: registry, logger: silent }),
      executionEngine: createExecutionEngine({ toolRegistry: registry, logger: silent }),
      validationEngine: createValidationEngine({ logger: silent }),
      learningEngine: createLearningEngine({ logger: silent }),
      eventEmitter: async (event) => { events.push(event); },
    });

    await orchestrator.process({
      tenantId: 't1',
      channel: 'whatsapp',
      message: 'quero agendar',
      payload: { intent: 'agendar' },
      actor: { userId: 'u1', classification: 'PRODUCTION', permissions: ['*'] },
    });

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('agent.execution.started');
    expect(eventTypes).toContain('business.outcome.validated');
  });

  test('cannot_complete emits business.outcome.failed', async () => {
    const events = [];
    const registry = createToolRegistry();
    // createAppointment exige agenda.write — ator sem essa permissão.
    registry.register({
      id: 'searchCustomer', visibility: 'PRODUCTION', permissions: [],
      description: 'stub', execute: async () => ({ customers: [] }),
    });
    registry.register({
      id: 'schedule.findAvailability', visibility: 'PRODUCTION', permissions: [],
      description: 'stub', execute: async () => ({ available: true }),
    });
    registry.register({
      id: 'createAppointment', visibility: 'PRODUCTION', permissions: ['agenda.write'],
      description: 'stub', execute: async () => ({ appointment: { id: 'apt-1' } }),
    });
    registry.register({
      id: 'sendWhatsappMessage', visibility: 'PRODUCTION', permissions: [],
      description: 'stub', execute: async () => ({ sent: true }),
    });

    const orchestrator = createCognitiveOrchestrator({
      logger: silent,
      toolRegistry: registry,
      agentSupervisor: null,
      contextEngine: createContextEngine({ logger: silent }),
      intentEngine: createIntentEngine({ logger: silent, llmEnabled: false }),
      actionPlanner: createActionPlanner({ toolRegistry: registry, logger: silent }),
      executionEngine: createExecutionEngine({ toolRegistry: registry, logger: silent }),
      validationEngine: createValidationEngine({ logger: silent }),
      learningEngine: createLearningEngine({ logger: silent }),
      eventEmitter: async (event) => { events.push(event); },
    });

    await orchestrator.process({
      tenantId: 't1',
      channel: 'whatsapp',
      message: 'quero agendar',
      payload: { intent: 'agendar' },
      // Sem agenda.write → createAppointment negado → plano rejeitado.
      actor: { userId: 'u1', classification: 'PRODUCTION', permissions: ['crm.read'] },
    });

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('agent.execution.failed');
    expect(eventTypes).toContain('business.outcome.failed');
  });
});

describe('Integration Smoke — Durable Evidence', () => {
  test('buildDurableEvidence extrai steps de eventos do processo', () => {
    const processResult = {
      instanceId: 'proc-1',
      status: 'completed',
      events: [
        { nodeId: 'step_0_find_customer', type: 'node.enter' },
        { nodeId: 'step_0_find_customer', type: 'node.complete', toolId: 'searchCustomer', output: { customers: [] } },
        { nodeId: 'step_1_check_availability', type: 'node.enter' },
        { nodeId: 'step_1_check_availability', type: 'node.complete', toolId: 'schedule.findAvailability', output: { available: true } },
      ],
      nodeResults: [],
    };

    const evidence = buildDurableEvidence(processResult);
    expect(evidence.toolsExecuted).toContain('searchCustomer');
    expect(evidence.toolsExecuted).toContain('schedule.findAvailability');
    expect(evidence.steps.length).toBe(2);
    expect(evidence.status).toBe('completed');
  });

  test('buildDurableEvidence handles empty process result', () => {
    const evidence = buildDurableEvidence({});
    expect(evidence.steps).toEqual([]);
    expect(evidence.toolsExecuted).toEqual([]);
    expect(evidence.status).toBe('no_evidence');
  });
});
