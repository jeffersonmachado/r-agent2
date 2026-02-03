/**
 * Testes do core injetável em engine/ai/flowGenerator.
 * Sem dependência de API/DB: tudo via deps mockadas.
 */

describe('engine/ai/flowGenerator core', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('generateChatbotFlowCore retorna flowDefinition + validationWarnings', async () => {
    const { generateChatbotFlowCore } = require('../../engine/ai/flowGenerator');

    const deps = {
      loadPrompt: async () => 'PROMPT',
      callModel: async () =>
        JSON.stringify({
          action: 'create_flow',
          metadata: { name: 'N', description: 'D' },
          nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }],
          edges: [],
        }),
      validateFlowDraft: () => true,
      validateGeneratedPlan: async () => ({ valid: true, errors: [], warnings: [], qualityScore: 100, riskFlags: [] }),
      validateByContract: async () => ({ valid: true, errors: [] }),
      validateFlow: async () => ({ valid: true, errors: [] }),
    };

    const res = await generateChatbotFlowCore({
      description: 'crie um fluxo',
      tenantId: 't1',
      options: { flowId: 'f1', flowName: 'F' },
      deps,
    });

    expect(res.success).toBe(true);
    expect(res.flowDefinition).toBeDefined();
    expect(res.flowDefinition.tenantId).toBe('t1');
    expect(res.validationWarnings).toBeDefined();
    expect(res.validationWarnings.valid).toBe(true);
  });

  test('generateRpaTestCore retorna rpaTest + validationWarnings', async () => {
    const { generateRpaTestCore } = require('../../engine/ai/flowGenerator');

    const deps = {
      loadPrompt: async () => 'PROMPT',
      callModel: async () =>
        JSON.stringify({
          id: 'test-1',
          name: 'RPA',
          version: '1.0',
          type: 'rpa_test_plan',
          metadata: { generatedBy: 'ai', status: 'draft', requiresReview: true },
          context: { application: 'chatbot', mode: 'test-only' },
          steps: [{ action: 'navigate', target: 'http://x', value: '', timeout: 1000 }],
          assertions: [{ type: 'visible', selector: 'body', value: 'true' }],
        }),
      validateGeneratedPlan: async () => ({ valid: true, errors: [], warnings: [], qualityScore: 100, riskFlags: [] }),
      validateByContract: async () => ({ valid: true, errors: [] }),
    };

    const res = await generateRpaTestCore({
      description: 'gere um teste',
      tenantId: 't1',
      options: {},
      deps,
    });

    expect(res.success).toBe(true);
    expect(res.rpaTest).toBeDefined();
    expect(res.validationWarnings.valid).toBe(true);
  });
});

