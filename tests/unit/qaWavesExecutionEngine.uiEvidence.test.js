'use strict';

const { executeScenario } = require('../../api/services/qaWavesExecutionEngine');

describe('qaWavesExecutionEngine — contrato de evidência CLIENT_ACTION', () => {
  test('passo dirigido por UI (expected.page) aceita rastro de UI como evidência', () => {
    const result = executeScenario({
      semanticSteps: [
        {
          id: 'step_001',
          type: 'trigger_channel_event',
          category: 'CLIENT_ACTION',
          name: 'Usuário abre menu Construtor → Tarefas',
          expected: { page: '/tasks' },
        },
      ],
      runtimeSteps: [
        {
          success: true,
          actual: 'ok',
          selector: 'a[aria-label="Construtor"]',
          screenshotBefore: 'data:image/png;base64,abc',
          consoleLogs: [],
        },
      ],
    });

    expect(result.status).toBe('success');
    expect(result.errors).toHaveLength(0);
    expect(result.steps[0].status).toBe('success');
  });

  test('passo dirigido por UI sem rastro de UI continua falhando', () => {
    const result = executeScenario({
      semanticSteps: [
        {
          id: 'step_001',
          type: 'trigger_channel_event',
          category: 'CLIENT_ACTION',
          expected: { page: '/tasks' },
        },
      ],
      runtimeSteps: [{ success: true, actual: 'ok', consoleLogs: [] }],
    });

    expect(result.status).toBe('failed');
    expect(result.errors[0].code).toBe('missing_step_evidence');
  });

  test('passo de canal (sem expected de UI) continua exigindo payload', () => {
    const result = executeScenario({
      semanticSteps: [
        {
          id: 'step_001',
          type: 'trigger_channel_event',
          category: 'CLIENT_ACTION',
          expected: { message: 'quero agendar' },
        },
      ],
      runtimeSteps: [
        {
          success: true,
          actual: 'ok',
          selector: 'button',
          screenshotBefore: 'data:image/png;base64,abc',
          consoleLogs: [],
        },
      ],
    });

    expect(result.status).toBe('failed');
    expect(result.errors[0]).toMatchObject({
      code: 'missing_step_evidence',
      message: 'Evidência obrigatória ausente: payload',
    });
  });

  test('payload declarado (input) segue valendo como evidência de canal', () => {
    const result = executeScenario({
      semanticSteps: [
        {
          id: 'step_001',
          type: 'trigger_channel_event',
          category: 'CLIENT_ACTION',
          input: { message: 'quero agendar aula' },
        },
      ],
      runtimeSteps: [{ success: true, actual: 'message_sent', consoleLogs: [] }],
    });

    expect(result.status).toBe('success');
    expect(result.errors).toHaveLength(0);
  });
});
