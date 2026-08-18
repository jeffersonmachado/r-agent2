'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockInferQuestionsWithAI = jest.fn();

function buildMocks() {
  jest.doMock('../../api/services/contextSourceResolver', () => ({
    resolveContextSources: jest.fn(async () => ({
      used: 'inline',
      contextSources: [{ sourceType: 'inline', text: 'Salão de beleza com agendamento online, corte, manicure e coloração. Atendimento de terça a sábado. '.repeat(4) }],
    })),
  }));
  jest.doMock('../../api/services/exclusions.service', () => ({
    sanitizeContext: jest.fn((x) => String(x || '')),
    getFinalExclusions: jest.fn(async () => ({ finalExclusions: [] })),
    augmentExclusions: jest.fn(() => []),
    filterQuestions: jest.fn((qs) => qs),
  }));
  jest.doMock('../../api/services/questionGenerationRules.service', () => ({
    deriveQuestionGenerationRulesFromContext: jest.fn(() => ({})),
  }));
  jest.doMock('../../api/services/ragService', () => ({
    generateEmbeddingsBatch: jest.fn(async () => ({ success: false })),
  }));
  jest.doMock('../../api/services/semanticContextService', () => ({
    extractSemanticContext: jest.fn(async () => null),
    detectBusinessType: jest.fn(() => 'physical'),
  }));
  jest.doMock('../../api/services/aiProviderService', () => ({
    generateAiResponse: jest.fn(async () => ({ text: '[]' })),
  }));
  jest.doMock('../../api/utils/inferQuestionsWithAI', () => ({
    inferQuestionsWithAI: (...args) => mockInferQuestionsWithAI(...args),
  }));
  jest.doMock('../../api/utils/ragQuestionGenerator', () => ({
    getDefaultQuestionGenerationRules: jest.fn(() => ({})),
    generateQuestionsFromContent: jest.fn(() => ['Qual o horário de atendimento?']),
    mergeUniqueQuestions: jest.fn((a, b, _max) => [...new Set([...(a || []), ...(b || [])])]),
    generateQuestionsFromContext: jest.fn(() => []),
  }));
  jest.doMock('../../api/utils/contentNormalization', () => ({
    normalizeEmbedding: jest.fn((e) => e),
  }));
}

describe('faqGeneratorService — questionMode inferential', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('default (extractive) não chama a inferência e reporta not_requested', async () => {
    buildMocks();
    const { generateFaq } = require('../../api/services/faqGeneratorService');

    const out = await generateFaq({ tenantId: 'tenant-1', name: 'Salão X' });

    expect(mockInferQuestionsWithAI).not.toHaveBeenCalled();
    expect(out.meta.questionMode).toBe('extractive');
    expect(out.meta.inference.status).toBe('not_requested');
  });

  test('inferential: perguntas da IA entram no pipeline e no meta', async () => {
    buildMocks();
    mockInferQuestionsWithAI.mockResolvedValue(['Posso remarcar meu horário?']);
    const { generateFaq } = require('../../api/services/faqGeneratorService');

    const out = await generateFaq({ tenantId: 'tenant-1', name: 'Salão X', questionMode: 'inferential' });

    expect(mockInferQuestionsWithAI).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      existingQuestions: expect.any(Array),
    }));
    expect(out.meta.questionMode).toBe('inferential');
    expect(out.meta.inference).toEqual(expect.objectContaining({ status: 'ok', questionsInferred: 1 }));
    expect(out.flatQuestions).toContain('Posso remarcar meu horário?');
    expect(out.inferredQuestions).toEqual(['Posso remarcar meu horário?']);
  });

  test('IA fora do ar: status ai_unavailable explícito e extrativo preservado', async () => {
    buildMocks();
    mockInferQuestionsWithAI.mockRejectedValue(new Error('provider down'));
    const { generateFaq } = require('../../api/services/faqGeneratorService');

    const out = await generateFaq({ tenantId: 'tenant-1', name: 'Salão X', questionMode: 'inferential' });

    expect(out.meta.inference).toEqual(expect.objectContaining({ status: 'ai_unavailable', reason: 'provider down' }));
    expect(out.flatQuestions).toContain('Qual o horário de atendimento?');
  });

  test('sem contexto suficiente: insufficient_context, sem chamada à IA', async () => {
    buildMocks();
    jest.doMock('../../api/services/contextSourceResolver', () => ({
      resolveContextSources: jest.fn(async () => ({ used: 'inline', contextSources: [] })),
    }));
    const { generateFaq } = require('../../api/services/faqGeneratorService');

    const out = await generateFaq({ tenantId: 'tenant-1', questionMode: 'inferential' });

    expect(mockInferQuestionsWithAI).not.toHaveBeenCalled();
    expect(out.meta.inference.status).toBe('insufficient_context');
  });
});
