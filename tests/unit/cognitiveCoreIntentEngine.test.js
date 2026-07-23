/**
 * Testes unitários: Cognitive Core — Intent Engine (contrato AI-first).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { createIntentEngine, INTENTS } = require('../../src/core/cognitive/intent-engine');

describe('Cognitive Core — Intent Engine', () => {
  test('exige tenantId', async () => {
    const engine = createIntentEngine({ llmEnabled: false });
    await expect(engine.classify({ message: 'oi' })).rejects.toThrow('cognitive_intent_tenant_required');
  });

  test('classifica via LLM (AI-first) com rationale', async () => {
    const generateAiResponse = jest.fn(async () => ({ text: '{"intent":"agendar","confidence":0.87}' }));
    const engine = createIntentEngine({ llmEnabled: true, generateAiResponse });

    const result = await engine.classify({ tenantId: 't1', message: 'quero marcar uma consulta para segunda às 14h' });

    expect(generateAiResponse).toHaveBeenCalledTimes(1);
    const prompt = generateAiResponse.mock.calls[0][0];
    expect(prompt).toContain('atendimento');
    expect(prompt).toContain(INTENTS.join(', '));
    expect(result.intent).toBe('agendar');
    expect(result.confidence).toBe(0.87);
    expect(result.source).toBe('llm');
    expect(result.rationale).toBeTruthy();
    expect(result.fallback).toBe(false);
    expect(result.humanHandoff).toBe(false);
  });

  test('extrai entities (telefone, data, hora) junto à classificação da IA', async () => {
    const generateAiResponse = jest.fn(async () => ({ text: '{"intent":"agendar","confidence":0.9}' }));
    const engine = createIntentEngine({ llmEnabled: true, generateAiResponse });

    const result = await engine.classify({
      tenantId: 't1',
      message: 'quero marcar uma consulta amanhã às 14:30, meu telefone é 11 99999-8888',
    });

    expect(result.intent).toBe('agendar');
    expect(result.entities.date).toBeTruthy();
    expect(result.entities.time).toBeTruthy();
    expect(result.entities.phone).toBeTruthy();
  });

  test('intent explícito no payload tem precedência e não chama a IA (confiança 1)', async () => {
    const generateAiResponse = jest.fn();
    const engine = createIntentEngine({ llmEnabled: true, generateAiResponse });

    const result = await engine.classify({
      tenantId: 't1',
      eventType: 'automation.trigger',
      payload: { intent: 'iniciar_campanha' },
    });

    expect(generateAiResponse).not.toHaveBeenCalled();
    expect(result.intent).toBe('iniciar_campanha');
    expect(result.confidence).toBe(1);
    expect(result.source).toBe('explicit');
  });

  test('falha do LLM → handoff humano com source ai_unavailable (sem fallback heurístico)', async () => {
    const generateAiResponse = jest.fn(async () => { throw new Error('provider indisponível'); });
    const engine = createIntentEngine({ llmEnabled: true, generateAiResponse });

    const result = await engine.classify({ tenantId: 't1', message: 'quero remarcar minha consulta' });

    expect(result.intent).toBe('transferir_humano');
    expect(result.source).toBe('ai_unavailable');
    expect(result.fallback).toBe(true);
    expect(result.humanHandoff).toBe(true);
    expect(result.rationale).toContain('handoff humano');
  });

  test('resposta de LLM com intent fora da taxonomia é descartada → handoff humano', async () => {
    const generateAiResponse = jest.fn(async () => ({ text: '{"intent":"hackear_sistema","confidence":0.99}' }));
    const engine = createIntentEngine({ llmEnabled: true, generateAiResponse });

    const result = await engine.classify({ tenantId: 't1', message: 'blá blá blá' });

    expect(result.intent).toBe('transferir_humano');
    expect(result.fallback).toBe(true);
  });

  test('confiança abaixo do limiar → handoff humano com justificativa', async () => {
    const generateAiResponse = jest.fn(async () => ({ text: '{"intent":"consultar_status","confidence":0.3}' }));
    const engine = createIntentEngine({ llmEnabled: true, generateAiResponse });

    const result = await engine.classify({ tenantId: 't1', message: 'mensagem ambígua qualquer' });

    expect(result.intent).toBe('transferir_humano');
    expect(result.confidence).toBe(0.3);
    expect(result.fallback).toBe(true);
    expect(result.rationale).toContain('handoff humano');
  });

  test('llmEnabled=false → handoff humano explícito (source ai_disabled)', async () => {
    const engine = createIntentEngine({ llmEnabled: false });

    const result = await engine.classify({ tenantId: 't1', message: 'quero cancelar meu agendamento' });

    expect(result.intent).toBe('transferir_humano');
    expect(result.source).toBe('ai_disabled');
    expect(result.humanHandoff).toBe(true);
  });

  test('não existe classificação por regras/keywords (heurística removida)', async () => {
    const generateAiResponse = jest.fn(async () => ({ text: '{"intent":"cancelar_agendamento","confidence":0.91}' }));
    const engine = createIntentEngine({ llmEnabled: true, generateAiResponse });

    // Mensagem que a antiga regra determinística resolveria sozinha: agora
    // obrigatoriamente passa pela IA.
    const result = await engine.classify({ tenantId: 't1', message: 'preciso cancelar meu agendamento de amanhã' });

    expect(generateAiResponse).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('llm');
    expect(result.intent).toBe('cancelar_agendamento');
  });

  test('taxonomia contém as 11 intenções mínimas', () => {
    expect(INTENTS).toEqual(expect.arrayContaining([
      'criar_lead', 'qualificar_lead', 'agendar', 'remarcar_agendamento',
      'cancelar_agendamento', 'consultar_status', 'abrir_ticket',
      'transferir_humano', 'enviar_proposta', 'iniciar_campanha', 'consultar_metricas',
    ]));
    expect(INTENTS).toHaveLength(11);
  });
});
