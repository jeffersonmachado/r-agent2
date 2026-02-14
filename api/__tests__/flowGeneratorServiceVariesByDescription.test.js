describe('flowGeneratorService - variação por descrição', () => {
  test('generateFlowFromDescription deve refletir descrições diferentes (via adapter)', async () => {
    jest.resetModules();

    const adapterPath = require.resolve('../services/aiWrappersAdapter');
    jest.doMock(adapterPath, () => ({
      generateChatbotViaCore: async (description) => {
        const d = String(description || '');
        const isSales = /venda|orçamento|orcamento|preço|preco/i.test(d);
        return {
          success: true,
          flowDefinition: {
            id: 'flow-mock',
            tenantId: 'tenant-demo',
            name: isSales ? 'Fluxo Vendas' : 'Fluxo Suporte',
            version: 1,
            nodes: isSales
              ? [
                { id: 'start', type: 'start', next: 'sales' },
                { id: 'sales', type: 'message', config: { text: 'Vendas' }, next: 'end' },
                { id: 'end', type: 'end' },
              ]
              : [
                { id: 'start', type: 'start', next: 'support' },
                { id: 'support', type: 'message', config: { text: 'Suporte' }, next: 'end' },
                { id: 'end', type: 'end' },
              ],
            metadata: { generated: true },
          },
          validation: { valid: true, errors: [], warnings: [], domain: 'chatbot' },
          envelope: { output: { metadata: { name: 'Mock' }, nodes: [] } },
          promptVersion: 'test',
        };
      },
    }));

    // eslint-disable-next-line global-require
    const { generateFlowFromDescription } = require('../services/flowGeneratorService');

    const flowA = await generateFlowFromDescription('Quero um fluxo de suporte', {
      tenantId: 'tenant-demo',
      flowId: 'flow-a',
      flowName: 'A',
      useRag: false,
      useWebScraping: false,
      includeQuestions: false,
    });
    const flowB = await generateFlowFromDescription('Quero um fluxo de vendas e orçamento', {
      tenantId: 'tenant-demo',
      flowId: 'flow-b',
      flowName: 'B',
      useRag: false,
      useWebScraping: false,
      includeQuestions: false,
    });

    const msgA = flowA.nodes.find((n) => n && n.type === 'message')?.config?.text;
    const msgB = flowB.nodes.find((n) => n && n.type === 'message')?.config?.text;

    expect(msgA).toBe('Suporte');
    expect(msgB).toBe('Vendas');
  });
});

