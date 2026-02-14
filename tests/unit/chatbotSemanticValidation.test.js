const fs = require('fs');
const path = require('path');
const { validateGeneratedPlan } = require('../../engine/ai/validateGeneratedPlan');

describe('Chatbot - Validação semântica reforçada (IA)', () => {
  test('deve falhar se não existir nó fallback', () => {
    const flowPath = path.join(__dirname, '../fixtures/ai/chatbot.noFallback.json');
    const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));

    const result = validateGeneratedPlan(flow, 'chatbot');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.type === 'MISSING_FALLBACK_NODE')).toBe(true);
  });

  test('deve falhar se existir nó api (external calls) em fluxo gerado por IA', () => {
    const flowPath = path.join(__dirname, '../fixtures/ai/chatbot.withApiNode.json');
    const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));

    const result = validateGeneratedPlan(flow, 'chatbot');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.type === 'API_NODE_NOT_ALLOWED')).toBe(true);
    expect(Array.isArray(result.riskFlags)).toBe(true);
    expect(result.riskFlags).toEqual(expect.arrayContaining(['EXTERNAL_CALLS']));
  });
});

