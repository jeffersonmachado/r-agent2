/**
 * Testes unitários: Cognitive Core — Intent Engine.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { createIntentEngine, INTENTS } = require('../../src/core/cognitive/intent-engine');

describe('Cognitive Core — Intent Engine', () => {
  const engine = createIntentEngine({ llmEnabled: false });

  test('exige tenantId', async () => {
    await expect(engine.classify({ message: 'oi' })).rejects.toThrow('cognitive_intent_tenant_required');
  });

  test.each([
    ['quero remarcar minha consulta', 'remarcar_agendamento'],
    ['preciso cancelar meu agendamento de amanhã', 'cancelar_agendamento'],
    ['quero marcar uma consulta para segunda às 14h', 'agendar'],
    ['quero falar com um atendente', 'transferir_humano'],
    ['quero abrir um chamado sobre o sistema', 'abrir_ticket'],
    ['pode me enviar uma proposta?', 'enviar_proposta'],
    ['vamos iniciar uma campanha de natal', 'iniciar_campanha'],
    ['me mostra o relatório de vendas', 'consultar_metricas'],
    ['qual o status do meu pedido?', 'consultar_status'],
    ['precisamos qualificar o lead João', 'qualificar_lead'],
    ['quero cadastrar um cliente', 'criar_lead'],
  ])('classifica deterministicamente "%s" → %s', async (message, expected) => {
    const result = await engine.classify({ tenantId: 't1', message });
    expect(result.intent).toBe(expected);
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
    expect(result.source).toBe('rules');
    expect(result.rationale).toBeTruthy();
    expect(result.fallback).toBe(false);
  });

  test('extrai entities (telefone, data, hora)', async () => {
    const result = await engine.classify({
      tenantId: 't1',
      message: 'quero marcar uma consulta amanhã às 14:30, meu telefone é 11 99999-8888',
    });
    expect(result.intent).toBe('agendar');
    expect(result.entities.date).toBeTruthy();
    expect(result.entities.time).toBeTruthy();
    expect(result.entities.phone).toBeTruthy();
  });

  test('baixa confiança gera fallback seguro com handoff humano e justificativa', async () => {
    const result = await engine.classify({ tenantId: 't1', message: 'xyzzy plugh foo' });
    expect(result.intent).toBe('transferir_humano');
    expect(result.fallback).toBe(true);
    expect(result.humanHandoff).toBe(true);
    expect(result.rationale).toContain('handoff humano');
  });

  test('intent explícito no payload tem precedência (confiança 1)', async () => {
    const result = await engine.classify({
      tenantId: 't1',
      eventType: 'automation.trigger',
      payload: { intent: 'iniciar_campanha' },
    });
    expect(result.intent).toBe('iniciar_campanha');
    expect(result.confidence).toBe(1);
    expect(result.source).toBe('explicit');
  });

  test('usa LLM quando regras são inconclusivas', async () => {
    const generateAiResponse = jest.fn(async () => ({ text: '{"intent":"agendar","confidence":0.8}' }));
    const llmEngine = createIntentEngine({ llmEnabled: true, generateAiResponse });
    const result = await llmEngine.classify({ tenantId: 't1', message: 'tem como encaixar a gente aí semana que vem?' });
    expect(generateAiResponse).toHaveBeenCalledTimes(1);
    expect(result.intent).toBe('agendar');
    expect(result.source).toBe('llm');
  });

  test('falha do LLM não quebra: cai em fallback seguro', async () => {
    const generateAiResponse = jest.fn(async () => { throw new Error('provider indisponível'); });
    const llmEngine = createIntentEngine({ llmEnabled: true, generateAiResponse });
    const result = await llmEngine.classify({ tenantId: 't1', message: 'mensagem totalmente ambígua' });
    expect(result.intent).toBe('transferir_humano');
    expect(result.fallback).toBe(true);
  });

  test('resposta de LLM com intent fora da taxonomia é descartada', async () => {
    const generateAiResponse = jest.fn(async () => ({ text: '{"intent":"hackear_sistema","confidence":0.99}' }));
    const llmEngine = createIntentEngine({ llmEnabled: true, generateAiResponse });
    const result = await llmEngine.classify({ tenantId: 't1', message: 'blá blá blá' });
    expect(result.intent).toBe('transferir_humano');
    expect(result.fallback).toBe(true);
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
