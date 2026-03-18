'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('answers.service coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('tenantId hostil nao estoura String() e retorna erro de validacao', async () => {
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({ text: 'ok' })),
    }));

    const { generateAnswers } = require('../../api/services/answers.service');
    const hostile = { toString() { throw new Error('boom-tenant'); } };

    await expect(generateAnswers(hostile, ['Pergunta?'], 'contexto')).rejects.toThrow(/tenantId/i);
  });

  test('ragContext hostil usa fallback sem quebrar', async () => {
    const generateAiResponse = jest.fn(async () => ({ text: 'Resposta valida' }));
    jest.doMock('../../api/services/aiProviderService', () => ({ generateAiResponse }));

    const { generateAnswers } = require('../../api/services/answers.service');
    const hostile = { toString() { throw new Error('boom-ctx'); } };

    const out = await generateAnswers('tenant-1', ['Qual o horario?'], hostile);
    expect(out).toEqual(['Resposta valida']);
    expect(generateAiResponse).toHaveBeenCalledTimes(1);
  });

  test('questions com objetos hostis sao filtradas sem excecao', async () => {
    const generateAiResponse = jest.fn(async () => ({ text: 'nao deve chamar' }));
    jest.doMock('../../api/services/aiProviderService', () => ({ generateAiResponse }));

    const { generateAnswers } = require('../../api/services/answers.service');
    const hostile = { toString() { throw new Error('boom-question'); } };

    const out = await generateAnswers('tenant-1', [hostile, null, undefined], 'contexto');
    expect(out).toEqual([]);
    expect(generateAiResponse).not.toHaveBeenCalled();
  });

  test('ai.text hostil cai para mensagem padrao sem quebrar', async () => {
    const hostileText = { toString() { throw new Error('boom-ai-text'); } };
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({ text: hostileText })),
    }));

    const { generateAnswers } = require('../../api/services/answers.service');
    const out = await generateAnswers('tenant-1', ['Pergunta?'], 'contexto');

    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/material fornecido/i);
  });
});
