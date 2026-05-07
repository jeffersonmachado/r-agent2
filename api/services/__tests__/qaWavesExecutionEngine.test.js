'use strict';

const { executeScenario } = require('../qaWavesExecutionEngine');

describe('qaWavesExecutionEngine', () => {
  test('falha quando resposta de API retorna HTML', () => {
    const semanticSteps = [
      {
        id: 'step_001',
        type: 'validate_backend',
        category: 'API_CALL',
        actor: 'api',
        name: 'Validar backend',
        input: { test: true },
      },
    ];

    const runtimeSteps = [
      {
        success: true,
        startedAt: '2026-05-05T18:00:00.000Z',
        finishedAt: '2026-05-05T18:00:01.000Z',
        screenshotBefore: '/tmp/before.png',
        screenshotAfter: '/tmp/after.png',
        domSnapshot: '<div>ok</div>',
        consoleLogs: [],
        networkEvents: [
          {
            type: 'response',
            url: 'http://localhost:3001/workspace/entities?limit=60',
            status: 200,
            contentType: 'text/html; charset=utf-8',
            bodyPreview: '<!doctype html><html><body>fallback</body></html>',
          },
        ],
      },
    ];

    const result = executeScenario({ semanticSteps, runtimeSteps });

    expect(result.status).toBe('failed');
    expect(result.errors.some((e) => e.code === 'html_response_instead_of_json')).toBe(true);
    expect(result.steps[0].status).toBe('failed');
  });

  test('preserva actor/category e estrutura de evidência por step', () => {
    const semanticSteps = [
      {
        id: 'step_001',
        type: 'send_message',
        category: 'CLIENT_ACTION',
        actor: 'customer',
        name: 'Cliente envia mensagem',
        input: { text: 'Oi' },
      },
    ];

    const runtimeSteps = [
      {
        success: true,
        startedAt: '2026-05-05T18:00:00.000Z',
        finishedAt: '2026-05-05T18:00:01.000Z',
        screenshotBefore: '/tmp/before.png',
        screenshotAfter: '/tmp/after.png',
        domSnapshot: '<div>ok</div>',
        consoleLogs: [],
        networkEvents: [
          {
            type: 'response',
            url: 'http://localhost:3001/api/messages',
            status: 200,
            contentType: 'application/json',
            bodyPreview: '{"ok":true}',
          },
        ],
      },
    ];

    const result = executeScenario({ semanticSteps, runtimeSteps });

    expect(result.steps[0].actor).toBe('customer');
    expect(result.steps[0].category).toBe('CLIENT_ACTION');
    expect(result.steps[0].evidence).toHaveProperty('screenshotBefore');
    expect(result.steps[0].evidence).toHaveProperty('screenshotAfter');
    expect(result.steps[0].evidence).toHaveProperty('payload');
    expect(result.steps[0].evidence).toHaveProperty('apiResponse');
    expect(result.steps[0].evidence).toHaveProperty('domSnapshot');
    expect(result.steps[0].evidence).toHaveProperty('networkEvents');
    expect(result.steps[0].evidence).toHaveProperty('consoleErrors');
  });
});
