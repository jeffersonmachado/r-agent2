describe('flowGeneratorService - migração de router.contains (deprecated)', () => {
  test('generateFlowFromDescription migra contains -> ai_task + equals (sem contains)', async () => {
    jest.resetModules();

    const adapterPath = require.resolve('../services/aiWrappersAdapter');
    jest.doMock(adapterPath, () => ({
      generateChatbotViaCore: async () => ({
        success: true,
        flowDefinition: {
          id: 'flow-test-migrate-contains',
          tenantId: 'tenant-demo',
          name: 'Mock Flow',
          version: 1,
          nodes: [
            { id: 'start', type: 'start', next: 'ui' },
            { id: 'ui', type: 'user_input', config: { variable: 'detalhe_completo' }, next: 'router1' },
            {
              id: 'router1',
              type: 'router',
              config: {
                rules: [
                  { condition: { op: 'contains', var: 'detalhe_completo', value: 'pag' }, next: 'n_pay' },
                  { condition: { op: 'contains', var: 'detalhe_completo', value: 'matr' }, next: 'n_matr' },
                  { condition: { op: 'contains', var: 'detalhe_completo', value: 'cad' }, next: 'n_cad' },
                  { condition: { op: 'always' }, next: 'n_fallback' },
                ],
              },
              next: 'n_fallback',
            },
            { id: 'n_pay', type: 'message', config: { text: 'Pagamento' }, next: 'end' },
            { id: 'n_matr', type: 'message', config: { text: 'Matrícula' }, next: 'end' },
            { id: 'n_cad', type: 'message', config: { text: 'Cadastro' }, next: 'end' },
            { id: 'n_fallback', type: 'message', config: { text: 'Fallback' }, next: 'end' },
            { id: 'end', type: 'end' },
          ],
          metadata: { generated: true },
        },
        validation: { valid: true, errors: [], warnings: [], domain: 'chatbot' },
        envelope: { output: { metadata: { name: 'Mock Flow' }, nodes: [] } },
        promptVersion: 'test',
      }),
    }));

    // eslint-disable-next-line global-require
    const { generateFlowFromDescription } = require('../services/flowGeneratorService');

    const flow = await generateFlowFromDescription('Descrição qualquer', {
      tenantId: 'tenant-demo',
      flowId: 'flow-test-migrate-contains',
      flowName: 'Flow Test Migrate Contains',
      useRag: false,
      useWebScraping: false,
      includeQuestions: false,
    });

    expect(flow).toHaveProperty('nodes');
    expect(Array.isArray(flow.nodes)).toBe(true);

    const router = flow.nodes.find((n) => n && n.id === 'router1');
    expect(router).toBeTruthy();
    expect(router.config).toBeTruthy();
    expect(Array.isArray(router.config.rules)).toBe(true);

    // ✅ nenhum contains deve permanecer
    expect(router.config.rules.some((r) => r?.condition?.op === 'contains')).toBe(false);

    // ✅ ai_task deve ter sido inserido antes do router e o user_input renomeado para user_input
    const ui = flow.nodes.find((n) => n && n.id === 'ui');
    expect(ui).toBeTruthy();
    expect(ui.type).toBe('user_input');
    expect(ui.config.variable).toBe('user_input');

    const aiTask = flow.nodes.find((n) => n && n.type === 'ai_task' && n.next === 'router1');
    expect(aiTask).toBeTruthy();
    expect(aiTask.config).toBeTruthy();
    expect(aiTask.config.task).toBe('intent_classification');

    // ✅ regras migradas usam equals comparando ai.<ai_task_id>.value
    const migrated = router.config.rules.filter((r) => r?.condition?.op === 'equals');
    expect(migrated.length).toBeGreaterThanOrEqual(1);
    for (const r of migrated) {
      expect(r.condition.var).toBe(`ai.${aiTask.id}.value`);
      expect(typeof r.condition.value).toBe('string');
      expect(r.condition.value.length).toBeGreaterThan(0);
    }
  });

  test('engine router aceita var com ponto (ai.<id>.value) e roteia por equals', async () => {
    const { routerNodeHandler } = require('../../engine/nodes/basicNodes');

    const state = {
      sessionId: 's-router-dot-var',
      flowId: 'flow-router-dot-var',
      currentNodeId: 'router1',
      variables: {
        'ai.ai_task_router1.value': 'pag',
      },
      history: [],
      metadata: {},
    };

    const node = {
      id: 'router1',
      type: 'router',
      config: {
        rules: [
          { condition: { op: 'equals', var: 'ai.ai_task_router1.value', value: 'pag' }, next: 'n_pay' },
          { condition: { op: 'always' }, next: 'n_fallback' },
        ],
      },
      next: 'n_fallback',
    };

    const out = await routerNodeHandler(node, state);
    expect(out.output).toEqual({ type: 'router', chosenNext: 'n_pay' });
  });
});

