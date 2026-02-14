// Garante que o helper de preview do prompt NÃO chama o provedor de IA.
jest.mock('../services/aiProviderService', () => ({
  generateAiResponse: jest.fn(async () => ({ text: '{"ok":true}' })),
}));

const { buildChatbotFinalPrompt } = require('../services/aiWrappersAdapter');

describe('aiWrappersAdapter - buildChatbotFinalPrompt', () => {
  it('monta finalPrompt com RAG do ragContext e não chama provider', async () => {
    const { generateAiResponse } = require('../services/aiProviderService');

    const res = await buildChatbotFinalPrompt('Quero um fluxo de atendimento', {
      tenantId: 'tenant-test',
      useRag: true,
      ragSources: ['docs'],
      ragContext: {
        enabled: true,
        executionId: 'exec-123',
        chunks: [
          { content: 'Conteúdo do chunk 1', sourceFile: 'doc1.md' },
          { content: 'Conteúdo do chunk 2', sourceFile: 'doc2.md' },
        ],
        sources: [{ documentId: 'doc1', chunksCount: 1 }],
      },
    });

    expect(generateAiResponse).not.toHaveBeenCalled();
    expect(res).toBeTruthy();
    expect(String(res.promptSummary)).toBe('chatbot.generator.prompt.md');
    expect(String(res.finalPrompt)).toContain('## Designer Schema (RAG_CHATBOT)');
    expect(String(res.finalPrompt)).toContain('## Conhecimento Interno (RAG) - Execution ID: exec-123');
    expect(String(res.finalPrompt)).toContain('Conteúdo do chunk 1');
    expect(String(res.finalPrompt)).toContain('## Descrição do Usuário');
    expect(String(res.finalPrompt)).toContain('Quero um fluxo de atendimento');
  });
});

