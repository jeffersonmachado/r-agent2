const path = require('path');

// Mocka o provider para capturar o prompt enviado.
jest.mock('../services/aiProviderService', () => ({
  generateAiResponse: jest.fn(async () => ({ text: '{"ok":true}' })),
}));

// Mocka o core para NÃO depender de parsing/validação; só queremos inspecionar o prompt carregado.
const flowGeneratorAbsPath = path.resolve(__dirname, '../../engine/ai/flowGenerator');
jest.doMock(flowGeneratorAbsPath, () => ({
  generateChatbotFlowCore: async ({ deps = {} }) => {
    const prompt = deps.loadPrompt ? await deps.loadPrompt('chatbot_flow') : '';
    await deps.callModel(prompt, { tenantId: 'tenant-test' });
    return {
      success: true,
      flowDefinition: { tenantId: 'tenant-test', id: 'flow-1', name: 'X', version: 1, nodes: [] },
      validation: { valid: true, errors: [], warnings: [] },
      validationWarnings: null,
      envelope: null,
      ragUsed: false,
      ragExecutionId: null,
      ragSources: [],
    };
  },
  generateRpaTestCore: async () => ({ success: true }),
}));

// Importa DEPOIS dos mocks
const { generateChatbotViaCore } = require('../services/aiWrappersAdapter');

describe('aiWrappersAdapter - prompt chatbot inclui RAG_CHATBOT', () => {
  it('inclui flow.schema.json, node.types.json e connection.rules.json no prompt enviado ao provider', async () => {
    const { generateAiResponse } = require('../services/aiProviderService');

    await generateChatbotViaCore('Descrição qualquer', { tenantId: 'tenant-test' }, { endpoint: '/flows/generate' });

    expect(generateAiResponse).toHaveBeenCalled();
    const [prompt] = generateAiResponse.mock.calls[0];

    expect(String(prompt)).toContain('## Designer Schema (RAG_CHATBOT)');
    expect(String(prompt)).toContain('### flow.schema.json');
    expect(String(prompt)).toContain('### node.types.json');
    expect(String(prompt)).toContain('### connection.rules.json');
  });
});

