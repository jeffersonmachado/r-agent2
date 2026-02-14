jest.mock('../services/aiProviderService', () => ({
  generateAiResponse: jest.fn(),
}));

jest.mock('../../engine/ai/flowGenerator', () => ({
  // Obs.: jest.config.cjs usa resetMocks=true, então implementações em factory são resetadas.
  // Definimos mockImplementation dentro do teste.
  generateChatbotFlowCore: jest.fn(),
  generateRpaTestCore: jest.fn(),
}));

const { generateChatbotViaCore } = require('../services/aiWrappersAdapter');

describe('aiWrappersAdapter - overflow → sumariza → retry', () => {
  it('faz 1 retry com RAG sumarizado e indicador quando provider estoura contexto', async () => {
    const { generateAiResponse } = require('../services/aiProviderService');
    const { generateChatbotFlowCore } = require('../../engine/ai/flowGenerator');

    generateChatbotFlowCore.mockImplementation(async ({ tenantId, deps }) => {
      // Prompt sintético com bloco RAG + descrição, para acionar extração e retry.
      const prompt = [
        'BASE_PROMPT',
        '',
        '## Conhecimento Interno (RAG) - Execution ID: N/A',
        '- linha 1',
        '- linha 2',
        '',
        '## Descrição do Usuário',
        'objetivo',
      ].join('\n');

      await deps.callModel(prompt, { tenantId, domain: 'chatbot_flow' });

      return {
        success: true,
        flowDefinition: {
          tenantId,
          id: 'flow-1',
          name: 'x',
          version: 1,
          nodes: [
            { id: 'start', type: 'start', next: 'end' },
            { id: 'end', type: 'end' },
          ],
          metadata: {},
        },
        validation: { valid: true, errors: [], warnings: [], qualityScore: 100, riskFlags: [] },
        envelope: null,
        promptVersion: 'test',
      };
    });

    let call = 0;
    generateAiResponse.mockImplementation(async (prompt) => {
      call += 1;

      // 1) Primeira tentativa: provider rejeita por contexto.
      if (call === 1) {
        const e = new Error('context length exceeded');
        e.code = 'context_length_exceeded';
        e.status = 400;
        throw e;
      }

      // 2) Chamada curta para sumarização do bloco RAG.
      if (String(prompt).includes('-----BEGIN_RAG_CONTEXT-----')) {
        return {
          text: [
            '- [Serviços]',
            '- Exemplo de serviço',
            '- [Contatos]',
            '- (11) 99999-9999',
          ].join('\n'),
          usage: null,
        };
      }

      // 3) Retry: prompt deve conter indicador e RAG sumarizado.
      expect(String(prompt)).toContain('## Indicador de Prompt');
      expect(String(prompt)).toContain('PROMPT_SUMMARY_MODE=1');
      expect(String(prompt)).toContain('reason=PROVIDER_CONTEXT_OVERFLOW');
      expect(String(prompt)).toContain('## Conhecimento Interno (RAG) — SUMARIZADO');
      expect(String(prompt)).toContain('## Descrição do Usuário');

      return {
        text: '{"ok":true}',
        usage: null,
      };
    });

    const res = await generateChatbotViaCore('objetivo', { tenantId: 'tenant-test' }, { endpoint: '/flows/generate' });
    expect(res).toBeTruthy();
    expect(generateAiResponse).toHaveBeenCalledTimes(3);
  });
});

