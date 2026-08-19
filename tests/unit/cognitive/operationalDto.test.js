'use strict';

/**
 * Testes unitários: DTO operacional do endpoint /api/cognitive/process
 * (HARD-014 / INVARIANTE 9 — PRODUCTION nunca recebe internals de execução).
 */

jest.mock('../../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { handleCognitiveRoutes, _internal } = require('../../../api/modules/cognitive/routes');

const FULL_RESULT = {
  executionId: 'e1',
  tenantId: 'tenant-a',
  status: 'completed',
  intent: 'agendar',
  confidence: 0.95,
  humanHandoff: false,
  fallback: false,
  requiresConfirmation: false,
  businessOutcome: 'appointment_created',
  businessEvidence: { 'appointment.id': 'apt-1' },
  businessFailures: [],
  outputs: [{ step: 'create_appointment', output: { appointment: { id: 'apt-1' } } }],
  latencyMs: 42,
};

function buildDeps(overrides = {}) {
  const sent = [];
  const deps = {
    requireAuth: jest.fn(() => ({ valid: true })),
    requirePermission: jest.fn(() => ({ allowed: true })),
    sendJson: jest.fn((res, code, data) => sent.push({ code, data })),
    badRequest: jest.fn((res, message) => sent.push({ code: 400, data: { error: message } })),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({ message: 'quero agendar' })),
    cognitiveOrchestrator: {
      process: jest.fn(async () => ({ ...FULL_RESULT })),
      toolRegistry: { list: jest.fn(() => []) },
    },
    ...overrides,
  };
  return { deps, sent };
}

function buildCtx({ agent, deps }) {
  return {
    req: { agent, tenant_id: 'tenant-a' },
    res: { writableEnded: true },
    method: 'POST',
    pathname: '/api/cognitive/process',
    deps,
  };
}

describe('Cognitive DTO — /api/cognitive/process segregado por classificação', () => {
  test('PRODUCTION (role operacional) não recebe outputs nem internals', async () => {
    const { deps, sent } = buildDeps();
    await handleCognitiveRoutes(buildCtx({ agent: { id: 'u1', role: 'operator', tenantId: 'tenant-a' }, deps }));

    expect(sent[0].code).toBe(200);
    const result = sent[0].data.result;
    expect(result.outputs).toBeUndefined();
    expect(result.businessFailures).toBeUndefined();
    expect(result.status).toBe('completed');
    expect(result.outcome).toBe('appointment_created');
    expect(result.data).toEqual({ evidence: { 'appointment.id': 'apt-1' } });
    expect(result.message).toBeNull();
  });

  test('SUPPORT (auditor) recebe outputs para diagnóstico', async () => {
    const { deps, sent } = buildDeps();
    await handleCognitiveRoutes(buildCtx({ agent: { id: 'u2', role: 'auditor', tenantId: 'tenant-a' }, deps }));

    const result = sent[0].data.result;
    expect(result.outputs).toEqual(FULL_RESULT.outputs);
    expect(result.businessFailures).toEqual([]);
    expect(result.outcome).toBe('appointment_created');
  });

  test('DEVELOPMENT (super_admin) recebe outputs para diagnóstico', async () => {
    const { deps, sent } = buildDeps();
    await handleCognitiveRoutes(buildCtx({ agent: { id: 'u3', role: 'super_admin', tenantId: 'tenant-a' }, deps }));

    const result = sent[0].data.result;
    expect(result.outputs).toEqual(FULL_RESULT.outputs);
  });

  test('classificação deriva do principal autenticado, nunca do payload', async () => {
    const { deps, sent } = buildDeps({
      parseJsonBody: jest.fn(async () => ({
        message: 'quero agendar',
        payload: { classification: 'DEVELOPMENT', role: 'super_admin' },
      })),
    });
    await handleCognitiveRoutes(buildCtx({ agent: { id: 'u1', role: 'operator', tenantId: 'tenant-a' }, deps }));

    const result = sent[0].data.result;
    expect(result.outputs).toBeUndefined();
    expect(deps.cognitiveOrchestrator.process).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({ classification: 'PRODUCTION' }),
    }));
  });

  test('handoff gera mensagem operacional no DTO', async () => {
    const { deps, sent } = buildDeps({
      cognitiveOrchestrator: {
        process: jest.fn(async () => ({
          ...FULL_RESULT,
          status: 'human_handoff_requested',
          humanHandoff: true,
          businessOutcome: 'outcome_not_achieved',
          outputs: [],
        })),
        toolRegistry: { list: jest.fn(() => []) },
      },
    });
    await handleCognitiveRoutes(buildCtx({ agent: { id: 'u1', role: 'operator', tenantId: 'tenant-a' }, deps }));

    const result = sent[0].data.result;
    expect(result.status).toBe('human_handoff_requested');
    expect(result.message).toBe('Solicitação encaminhada para atendimento humano.');
    expect(result.outputs).toBeUndefined();
  });
});

describe('Cognitive DTO — buildBusinessResultDTO (helper puro)', () => {
  const { buildBusinessResultDTO } = _internal;

  test('PRODUCTION: shape de negócio sem internals', () => {
    const dto = buildBusinessResultDTO(FULL_RESULT, 'PRODUCTION');
    expect(Object.keys(dto).sort()).toEqual([
      'confidence', 'data', 'executionId', 'fallback', 'humanHandoff',
      'intent', 'latencyMs', 'message', 'outcome', 'requiresConfirmation',
      'status', 'tenantId',
    ]);
  });

  test('SUPPORT/DEVELOPMENT: inclui businessFailures e outputs', () => {
    for (const classification of ['SUPPORT', 'DEVELOPMENT']) {
      const dto = buildBusinessResultDTO(FULL_RESULT, classification);
      expect(dto.outputs).toEqual(FULL_RESULT.outputs);
      expect(dto.businessFailures).toEqual([]);
    }
  });

  test('outcome_not_achieved gera mensagem de não conclusão', () => {
    const dto = buildBusinessResultDTO({ ...FULL_RESULT, businessOutcome: 'outcome_not_achieved' }, 'PRODUCTION');
    expect(dto.message).toBe('A ação solicitada não foi concluída.');
  });
});
