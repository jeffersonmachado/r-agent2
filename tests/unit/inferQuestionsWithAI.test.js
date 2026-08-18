'use strict';

const mockGenerateAiResponse = jest.fn();

jest.mock('../../api/services/aiProviderService', () => ({
  generateAiResponse: (...args) => mockGenerateAiResponse(...args),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { inferQuestionsWithAI, buildPrompt } = require('../../api/utils/inferQuestionsWithAI');

describe('inferQuestionsWithAI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.FAQ_INFERENTIAL_MAX_QUESTIONS;
  });

  test('retorna perguntas válidas do JSON da IA', async () => {
    mockGenerateAiResponse.mockResolvedValue({
      text: '["Como funciona o agendamento?", "Posso remarcar meu horário?"]',
    });

    const out = await inferQuestionsWithAI({
      tenantId: 't1',
      contextText: 'Salão de beleza com agendamento online de cortes e manicure.',
      anchor: 'capacidades: scheduling, crm_update',
    });

    expect(out).toEqual(['Como funciona o agendamento?', 'Posso remarcar meu horário?']);
    const prompt = mockGenerateAiResponse.mock.calls[0][0];
    expect(prompt).toContain('Responda APENAS com JSON');
    expect(prompt).toContain('NUNCA afirme fatos');
    expect(prompt).toContain('ÂNCORA DE NEGÓCIO');
  });

  test('filtra perguntas sem "?", fora do tamanho e duplicadas (inclusive contra existentes)', async () => {
    mockGenerateAiResponse.mockResolvedValue({
      text: JSON.stringify([
        'Curta?',
        'Afirmação sem pergunta',
        'Como funciona o agendamento?',
        'como funciona o agendamento?',
        'Pergunta válida sobre prazos de entrega?',
        `Longa ${'x'.repeat(200)}?`,
      ]),
    });

    const out = await inferQuestionsWithAI({
      tenantId: 't1',
      contextText: 'contexto suficiente',
      existingQuestions: ['Como funciona o agendamento?'],
    });

    expect(out).toEqual(['Pergunta válida sobre prazos de entrega?']);
  });

  test('JSON inválido ou sem array retorna lista vazia (sem exceção)', async () => {
    mockGenerateAiResponse.mockResolvedValueOnce({ text: 'não é json' });
    await expect(inferQuestionsWithAI({ tenantId: 't1', contextText: 'x'.repeat(60) })).resolves.toEqual([]);

    mockGenerateAiResponse.mockResolvedValueOnce({ text: '{"a": 1}' });
    await expect(inferQuestionsWithAI({ tenantId: 't1', contextText: 'x'.repeat(60) })).resolves.toEqual([]);
  });

  test('respeita o teto via FAQ_INFERENTIAL_MAX_QUESTIONS', async () => {
    process.env.FAQ_INFERENTIAL_MAX_QUESTIONS = '3';
    mockGenerateAiResponse.mockResolvedValue({
      text: JSON.stringify(Array.from({ length: 10 }, (_, i) => `Pergunta número ${i} sobre o serviço?`)),
    });

    const out = await inferQuestionsWithAI({ tenantId: 't1', contextText: 'x'.repeat(60) });
    expect(out).toHaveLength(3);
  });

  test('erro da IA propaga para o chamador reportar ai_unavailable', async () => {
    mockGenerateAiResponse.mockRejectedValue(new Error('provider down'));
    await expect(inferQuestionsWithAI({ tenantId: 't1', contextText: 'x'.repeat(60) }))
      .rejects.toThrow('provider down');
  });

  test('buildPrompt inclui extraInstructions e limita existentes no prompt', () => {
    const existing = Array.from({ length: 60 }, (_, i) => `Pergunta ${i}?`);
    const prompt = buildPrompt({
      contextText: 'ctx',
      anchor: 'anchor',
      existingQuestions: existing,
      extraInstructions: 'cubra os gaps: pagamento',
      limit: 5,
    });
    expect(prompt).toContain('cubra os gaps: pagamento');
    expect(prompt).toContain('No máximo 5 perguntas');
    expect(prompt).toContain('Pergunta 39?');
    expect(prompt).not.toContain('Pergunta 40?');
  });
});
