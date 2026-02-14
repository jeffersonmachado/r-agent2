// Garante que FLOW_* bloqueia a geração (falha fatal).

jest.mock('../../engine/ai/flowGenerator', () => ({
  generateChatbotFlowCore: jest.fn(),
  generateRpaTestCore: jest.fn(),
}));

describe('aiWrappersAdapter - FLOW_* fatal', () => {
  test('generateChatbotViaCore lança em FLOW_DISCONNECTED', async () => {
    const { generateChatbotFlowCore } = require('../../engine/ai/flowGenerator');
    const { generateChatbotViaCore } = require('../services/aiWrappersAdapter');

    // Fluxo com nó órfão => FLOW_DISCONNECTED no FlowPreValidator.
    generateChatbotFlowCore.mockResolvedValue({
      success: true,
      flowDefinition: {
        tenantId: 'tenant-demo',
        id: 'flow-test',
        name: 'Flow Test',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'a' },
          { id: 'a', type: 'message', next: 'end' },
          { id: 'end', type: 'end' },
          { id: 'orphan', type: 'message', next: 'end' }, // inalcançável
        ],
      },
      validation: { valid: false, errors: [], warnings: [] },
      envelope: null,
      promptVersion: 'core',
    });

    await expect(
      generateChatbotViaCore('descrição', { tenantId: 'tenant-demo' }, { endpoint: '/flows/generate' })
    ).rejects.toMatchObject({ code: 'FLOW_DISCONNECTED' });
  });
});

