const fs = require('fs');
const path = require('path');
const { buildAiEnvelope, validateAiEnvelopeOrThrow, validateByContract } = require('../../engine/ai/aiEnvelope');

describe('AI Output Envelope', () => {
  test('deve construir e validar envelope válido (chatbot_flow)', () => {
    const flowPath = path.join(__dirname, '../fixtures/ai/chatbot.validFlow.json');
    const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));

    // Validação por contrato do domínio (AJV) é obrigatória
    const contractRes = validateByContract('api/data/rag/chatbot/schema/flow.schema.json', flow);
    expect(contractRes.valid).toBe(true);

    const envelope = validateAiEnvelopeOrThrow(buildAiEnvelope(
      'chatbot_flow',
      flow,
      { valid: true, errors: [], warnings: [], qualityScore: 95, riskFlags: ['PENDING_REVIEW'] },
      {
        provider: { name: null, model: null, temperature: null },
        input: { prompt_summary: 'chatbot.generator.prompt.md', user_goal: 'Criar um fluxo simples', context: {} },
        audit: { request_id: 'req-1', seed: null, tenant_id: 'tenant-x', user_id: 'user-1' },
      }
    ));

    expect(envelope.envelope_version).toBe('1.0');
    expect(envelope.domain).toBe('chatbot_flow');
    expect(envelope.validation.valid).toBe(true);
  });

  test('deve falhar se domain for inválido (schema do envelope)', () => {
    expect(() => validateAiEnvelopeOrThrow(buildAiEnvelope(
      /** @type {any} */ ('chatbot'),
      {},
      { valid: false, errors: [], warnings: [], qualityScore: 0, riskFlags: [] },
      {
        provider: { name: null, model: null, temperature: null },
        input: { prompt_summary: null, user_goal: null, context: {} },
        audit: { request_id: null, seed: null, tenant_id: null, user_id: null },
      }
    ))).toThrow();
  });
});

