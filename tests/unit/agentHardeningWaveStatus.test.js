'use strict';

/**
 * Regressão: runQaWaveValidation retornava status 'executing' para sempre.
 *
 * Falha observada (sondagem 2026-07-27): a validação de agentes enfileirava a
 * Wave na QA Mesh mas nunca lia o resultado final — `validateAndPublishAgent`
 * decidia GO/NO_GO sobre um status 'executing' perpétuo, tornando a validação
 * impossível de concluir corretamente. A Wave precisa aguardar o veredito real
 * da execução (GO/NO_GO) ou falhar como NO_GO em timeout.
 */

jest.mock('../../api/services/qaWavesScenarioService', () => ({
  saveScenario: jest.fn(({ scenario }) => ({ scenario })),
  upsertScenarioStore: jest.fn((scenario) => ({ scenario })),
  runScenarioExecution: jest.fn(() => ({ executionId: 'exec-qa-1' })),
}));

const mockGetExecutionById = jest.fn();
jest.mock('../../api/services/qaMeshService', () => ({
  getExecutionById: (...args) => mockGetExecutionById(...args),
}));

jest.mock('../../api/modules/agent-registry/service', () => ({}));
jest.mock('../../api/modules/ai-governance/service', () => ({}));

const {
  runQaWaveValidation,
} = require('../../api/modules/agent-os/services/agent-hardening-service');

const agent = {
  id: 'agent-1',
  slug: 'qa-agent',
  name: 'QA Agent',
  governance: { riskLevel: 'low' },
};

describe('runQaWaveValidation — aguarda veredito real da QA Mesh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('execução concluída com GO retorna status GO', async () => {
    mockGetExecutionById.mockReturnValue({
      status: 'completed',
      summary: { goNoGo: 'GO' },
    });
    const result = await runQaWaveValidation({ agent, tenantId: 'system', maxWaitMs: 2000 });
    expect(result.status).toBe('GO');
    expect(result.executionId).toBe('exec-qa-1');
  });

  test('execução concluída com NO_GO retorna status NO_GO', async () => {
    mockGetExecutionById.mockReturnValue({
      status: 'completed',
      summary: { goNoGo: 'NO_GO', reasons: ['scenario failed'] },
    });
    const result = await runQaWaveValidation({ agent, tenantId: 'system', maxWaitMs: 2000 });
    expect(result.status).toBe('NO_GO');
  });

  test('execução que nunca conclui estoura timeout como NO_GO (nunca "executing")', async () => {
    mockGetExecutionById.mockReturnValue({ status: 'running' });
    const result = await runQaWaveValidation({ agent, tenantId: 'system', maxWaitMs: 300, pollIntervalMs: 50 });
    expect(result.status).toBe('NO_GO');
    expect(String(result.error || '')).toMatch(/timeout/i);
  }, 15000);
});
