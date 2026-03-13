describe('generationOrchestrator - subflows', () => {
  test('orchestrateGeneration retorna subflows quando planner sugere', async () => {
    jest.resetModules();

    // Mock planner
    jest.doMock('../services/subflowPlannerService', () => ({
      planSubflows: async () => ([
        { name: 'Atendimento Humano', description: 'Fluxo para handover e triagem.', role: 'handover' },
        { name: 'Pagamentos', description: 'Fluxo para pagamentos e boletos.', role: 'billing' },
      ]),
    }));

    // Mock aiFlowGenerator (usado pelo orchestrator)
    const mockGenerate = jest.fn(async (desc, options) => {
      const isSub = !!options?.flowId && String(options.flowId).startsWith('flow-');
      const name = options?.flowName || 'Fluxo';
      const id = options?.flowId || 'main-flow';

      return {
        success: true,
        flowDefinition: {
          id,
          tenantId: options?.tenantId || 't1',
          name,
          version: 1,
          nodes: [
            { id: 'start', type: 'start', next: 'end' },
            { id: 'end', type: 'end' },
          ],
          metadata: {
            generated: true,
            generatedBy: 'ai',
            // só para diferenciar no teste
            isSubflow: isSub,
          },
        },
        validationWarnings: { valid: true, errors: [], codes: [] },
        envelope: null,
      };
    });
    jest.doMock('../services/aiFlowGenerator', () => ({
      generateFlowFromDescription: (...args) => mockGenerate(...args),
    }));

    // Mock validateFlow para não depender de regras internas
    jest.doMock('../../engine/validator', () => ({
      validateFlow: () => ({ valid: true, errors: [] }),
    }));

    const { orchestrateGeneration } = require('../services/generationOrchestrator');

    const res = await orchestrateGeneration({
      name: 'Fluxo Principal',
      description: 'Quero um fluxo completo para atendimento e pagamentos.',
      useRag: false,
      ragSources: [],
      useWebScraping: false,
      scrapingTargets: [],
      includeQuestions: false,
      questions: [],
      subflowMax: 2,
      maxFixAttempts: 1,
    }, { tenantId: 'tenant-demo' });

    expect(res).toBeTruthy();
    expect(res.success).toBe(true);
    expect(res.flowDefinition).toBeTruthy();
    expect(Array.isArray(res.subflows)).toBe(true);
    expect(res.subflows.length).toBe(2);
  });
});

