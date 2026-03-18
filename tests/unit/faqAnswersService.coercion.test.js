'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('faqAnswersService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function mockDeps({ answers = ['ok'] } = {}) {
    const resolveContextSources = jest.fn(async () => ({
      contextSources: [{ text: 'Contexto valido para resposta' }],
      used: 'inline',
    }));

    const getFinalExclusions = jest.fn(async () => ({
      storedExclusions: [],
      inferredExclusions: ['ruido_ocr'],
      finalExclusions: ['ruido_ocr'],
    }));

    const augmentExclusions = jest.fn((finalExclusions) => finalExclusions || []);
    const sanitizeContext = jest.fn((s) => s || '');

    const generateAnswers = jest.fn(async () => answers);

    jest.doMock('../../api/services/contextSourceResolver', () => ({
      resolveContextSources,
    }));

    jest.doMock('../../api/services/exclusions.service', () => ({
      getFinalExclusions,
      augmentExclusions,
      sanitizeContext,
    }));

    jest.doMock('../../api/services/answers.service', () => ({
      generateAnswers,
    }));

    return {
      resolveContextSources,
      getFinalExclusions,
      augmentExclusions,
      sanitizeContext,
      generateAnswers,
    };
  }

  test('tenantId hostil nao estoura e falha com erro de validacao', async () => {
    mockDeps();
    const { generateFaqAnswers } = require('../../api/services/faqAnswersService');
    const hostile = { toString() { throw new Error('boom-tenant'); } };

    await expect(generateFaqAnswers({
      tenantId: hostile,
      questions: ['Pergunta valida'],
    })).rejects.toThrow(/tenantId/i);
  });

  test('questions hostis sao filtradas sem estourar', async () => {
    const { generateAnswers } = mockDeps({ answers: ['Resposta A'] });
    const { generateFaqAnswers } = require('../../api/services/faqAnswersService');
    const hostile = { toString() { throw new Error('boom-question'); } };

    const out = await generateFaqAnswers({
      tenantId: 'tenant-1',
      questions: [hostile, '  Pergunta A  ', hostile, null],
      chunks: [{ text: 'Trecho de contexto' }],
    });

    expect(out.questions).toEqual(['Pergunta A']);
    expect(out.answers).toEqual(['Resposta A']);
    expect(generateAnswers).toHaveBeenCalledWith(
      'tenant-1',
      ['Pergunta A'],
      expect.any(String),
      expect.objectContaining({ exclusions: expect.any(Array) })
    );
  });

  test('chunks com campos hostis nao quebram fluxo', async () => {
    mockDeps({ answers: ['Resposta B'] });
    const { generateFaqAnswers } = require('../../api/services/faqAnswersService');

    const hostile = { toString() { throw new Error('boom-chunk'); } };

    const out = await generateFaqAnswers({
      tenantId: 'tenant-1',
      questions: ['Pergunta B'],
      chunks: [
        { sourceType: hostile, sourceId: hostile, text: hostile, excerpt: hostile },
        { sourceType: 'uploaded_file', sourceId: 'file-1', text: 'Contexto suficiente para passar o corte minimo de tamanho com folga.' },
      ],
    });

    expect(out.answers).toEqual(['Resposta B']);
    expect(out.meta).toEqual(expect.objectContaining({
      usedContext: 'inline',
      contextMode: 'auto',
    }));
  });
});
