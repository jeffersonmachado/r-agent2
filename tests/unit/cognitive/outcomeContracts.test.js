'use strict';

/**
 * Testes unitários: Business Outcome Contracts obrigatórios (INVARIANTE 4 —
 * NO EXPLICIT BUSINESS OUTCOME → NO BUSINESS SUCCESS).
 *
 * Cobre:
 *  - planner rejeita plano de MUTATION que invoca tool sideEffects sem contrato
 *    (`outcome_contract_required`);
 *  - intents READ_ONLY/INFORMATIONAL seguem sem contrato e têm steps com
 *    sideEffects negados explicitamente (intents informativas nunca mutam);
 *  - evidência do contrato vem exclusivamente do step que executou a
 *    requiredAction (nunca de merge flat de outputs);
 *  - campo morto `failureIfDenied` removido; contrato órfão `messaging.send`
 *    removido.
 */

jest.mock('../../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { createActionPlanner } = require('../../../src/core/cognitive/action-planner');
const {
  OUTCOME_CONTRACTS,
  INTENT_CLASSES,
  getOutcomeContract,
  getIntentClass,
  validateBusinessOutcome,
} = require('../../../src/core/cognitive/outcome');

const ACTOR = { userId: 'u1', classification: 'PRODUCTION', permissions: ['*'] };
const CONTEXT = { tenantId: 't1' };

function buildRegistry(tools) {
  const registry = createToolRegistry();
  for (const tool of tools) {
    registry.register({
      visibility: 'PRODUCTION',
      permissions: [],
      description: `stub ${tool.id}`,
      sideEffects: false,
      execute: jest.fn(async () => ({ ok: true })),
      ...tool,
    });
  }
  return registry;
}

describe('Outcome Contracts — planner exige contrato para side effects', () => {
  test('MUTATION sem contrato invocando tool sideEffects → outcome_contract_required', () => {
    const registry = buildRegistry([
      { id: 'billing.charge', sideEffects: true },
    ]);
    const planner = createActionPlanner({
      toolRegistry: registry,
      planTemplates: {
        cobrar_cliente: [{ id: 'charge', toolId: 'billing.charge', required: true }],
      },
    });

    let thrown = null;
    try {
      planner.plan({ intent: 'cobrar_cliente', context: CONTEXT, actor: ACTOR });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeTruthy();
    expect(thrown.code).toBe('outcome_contract_required');
    expect(thrown.message).toContain('outcome_contract_required');
    expect(thrown.toolId).toBe('billing.charge');
  });

  test('MUTATION sem contrato sem tools sideEffects → plano permitido', () => {
    const registry = buildRegistry([
      { id: 'knowledge.searchOperational', sideEffects: false },
    ]);
    const planner = createActionPlanner({
      toolRegistry: registry,
      planTemplates: {
        pesquisar_conhecimento: [{ id: 'search', toolId: 'knowledge.searchOperational', required: true }],
      },
    });

    const plan = planner.plan({ intent: 'pesquisar_conhecimento', context: CONTEXT, actor: ACTOR });
    expect(plan.steps.map((s) => s.id)).toEqual(['search']);
  });

  test('INFORMATIONAL (consultar_metricas): step sideEffects é negado, plano segue sem mutação', () => {
    const registry = buildRegistry([
      { id: 'generateInsight', sideEffects: true },
    ]);
    const planner = createActionPlanner({ toolRegistry: registry });

    const plan = planner.plan({ intent: 'consultar_metricas', context: CONTEXT, actor: ACTOR });
    expect(plan.steps.map((s) => s.id)).toEqual(['collect_metrics']);
    expect(plan.denied).toEqual([
      { step: 'generate_insight', reason: 'side_effect_denied_in_informational_intent: generateInsight' },
    ]);
  });

  test('READ_ONLY (consultar_status) segue sem contrato quando não há sideEffects', () => {
    const registry = buildRegistry([
      { id: 'searchCustomer', sideEffects: false },
    ]);
    const planner = createActionPlanner({ toolRegistry: registry });

    const plan = planner.plan({ intent: 'consultar_status', context: CONTEXT, actor: ACTOR });
    expect(plan.steps.map((s) => s.id)).toEqual(['find_customer', 'collect_status']);
    expect(plan.denied).toEqual([]);
  });

  test('intents com contrato e sideEffects continuam planejando normalmente', () => {
    const registry = buildRegistry([
      { id: 'searchCustomer', sideEffects: false },
      { id: 'schedule.findAvailability', sideEffects: false },
      { id: 'createAppointment', sideEffects: true },
      { id: 'sendWhatsappMessage', sideEffects: true },
    ]);
    const planner = createActionPlanner({ toolRegistry: registry });

    const plan = planner.plan({ intent: 'agendar', context: CONTEXT, actor: ACTOR });
    expect(plan.steps.map((s) => s.id)).toContain('create_appointment');
    expect(plan.denied).toEqual([]);
  });
});

describe('Outcome Contracts — classificação de intents', () => {
  test('consultar_status é READ_ONLY, consultar_metricas é INFORMATIONAL, default é MUTATION', () => {
    expect(getIntentClass('consultar_status')).toBe(INTENT_CLASSES.READ_ONLY);
    expect(getIntentClass('consultar_metricas')).toBe(INTENT_CLASSES.INFORMATIONAL);
    expect(getIntentClass('agendar')).toBe(INTENT_CLASSES.MUTATION);
    expect(getIntentClass('intent_desconhecida')).toBe(INTENT_CLASSES.MUTATION);
  });
});

describe('Outcome Contracts — evidência vem do step da requiredAction', () => {
  test('campo homônimo em outro step NÃO satisfaz o contrato', () => {
    const result = validateBusinessOutcome({
      intent: 'agendar',
      execution: {
        status: 'completed',
        steps: [
          // Step de busca com campo homônimo — não é a requiredAction.
          { id: 'find_customer', toolId: 'searchCustomer', status: 'executed', output: { appointment: { id: 'apt-fake' } } },
          // A requiredAction executou, mas sem gerar agendamento real.
          { id: 'create_appointment', toolId: 'createAppointment', status: 'executed', output: { ok: true } },
        ],
        toolsExecuted: ['searchCustomer', 'createAppointment'],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.outcome).toBe('outcome_not_achieved');
    expect(result.failures).toContain('required_evidence_missing: appointment.id');
  });

  test('"agendamento realizado" sem mutation real → businessOutcome inválido', () => {
    const result = validateBusinessOutcome({
      intent: 'agendar',
      execution: {
        status: 'completed',
        steps: [
          { id: 'send_confirmation', toolId: 'sendWhatsappMessage', status: 'executed', output: { messageId: 'msg-1' } },
        ],
        toolsExecuted: ['sendWhatsappMessage'],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.failures).toContain('required_action_not_executed: createAppointment');
  });

  test('evidência do step da requiredAction satisfaz o contrato', () => {
    const result = validateBusinessOutcome({
      intent: 'agendar',
      execution: {
        status: 'completed',
        steps: [
          { id: 'find_customer', toolId: 'searchCustomer', status: 'executed', output: { customers: [] } },
          { id: 'create_appointment', toolId: 'createAppointment', status: 'executed', output: { appointment: { id: 'apt-1' } } },
        ],
        toolsExecuted: ['searchCustomer', 'createAppointment'],
      },
    });
    expect(result.valid).toBe(true);
    expect(result.outcome).toBe('appointment_created');
    expect(result.evidence['appointment.id']).toBe('apt-1');
  });

  test('fallback de campo top-level na execução não satisfaz mais o contrato', () => {
    const result = validateBusinessOutcome({
      intent: 'agendar',
      execution: {
        status: 'completed',
        appointment: { id: 'apt-top-level' },
        steps: [
          { id: 'create_appointment', toolId: 'createAppointment', status: 'executed', output: { ok: true } },
        ],
        toolsExecuted: ['createAppointment'],
      },
    });
    expect(result.valid).toBe(false);
  });
});

describe('Outcome Contracts — schema higienizado', () => {
  test('campo morto failureIfDenied removido dos contratos', () => {
    for (const [key, contract] of Object.entries(OUTCOME_CONTRACTS)) {
      expect(contract.failureIfDenied).toBeUndefined();
      expect(contract.requiredAction).toBeTruthy();
      expect(contract.requiredOutcome).toBeTruthy();
      expect(Array.isArray(contract.requiredEvidence)).toBe(true);
      void key;
    }
    expect(getOutcomeContract('agendar').failureIfDenied).toBeUndefined();
  });

  test('contrato órfão messaging.send removido', () => {
    expect(OUTCOME_CONTRACTS['messaging.send']).toBeUndefined();
  });
});
