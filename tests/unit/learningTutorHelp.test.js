'use strict';

const mockQueryRag = jest.fn();

jest.mock('../../api/services/ragService', () => ({
  queryRag: (...args) => mockQueryRag(...args),
}));

jest.mock('../../api/services/websocketService', () => ({
  emitEvent: jest.fn(),
}));

const mockHintFindOne = jest.fn();
const mockHintFindAll = jest.fn();
const mockHintCreate = jest.fn();

jest.mock('../../api/db/models/LearningTutorHint', () => () => ({
  findOne: (...args) => mockHintFindOne(...args),
  findAll: (...args) => mockHintFindAll(...args),
  create: (...args) => mockHintCreate(...args),
}));

const mockSimulationFindAll = jest.fn();

jest.mock('../../api/db/models/LearningSimulation', () => () => ({
  findAll: (...args) => mockSimulationFindAll(...args),
}));

const mockFindCuratedFaq = jest.fn();

jest.mock('../../api/modules/learning-core/journeyFaqService', () => ({
  findCuratedFaqForRoute: (...args) => mockFindCuratedFaq(...args),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { requestTutorHelp } = require('../../api/modules/learning-core/tutorService');

describe('learning tutorService — requestTutorHelp (níveis 2-4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHintCreate.mockImplementation(async (values) => ({ id: 'hint-1', ...values }));
    mockHintFindAll.mockResolvedValue([]);
    mockFindCuratedFaq.mockResolvedValue(null);
  });

  it('rejeita level inválido e route ausente', async () => {
    await expect(requestTutorHelp({ tenantId: 't1', agentId: 'a1', route: '/inbox', level: 1 }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(requestTutorHelp({ tenantId: 't1', agentId: 'a1', level: 2 }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('nível 2: explicação via RAG persistida com source rag_explain', async () => {
    mockQueryRag.mockResolvedValue({ success: true, response: 'Explicação detalhada da tela.' });

    const result = await requestTutorHelp({ tenantId: 't1', agentId: 'a1', route: '/inbox', level: 2 });

    expect(result.available).toBe(true);
    expect(result.content.text).toContain('Explicação detalhada');
    expect(result.source).toBe('rag_explain');
    expect(mockHintCreate).toHaveBeenCalledTimes(1);
    const persisted = mockHintCreate.mock.calls[0][0];
    expect(persisted.level).toBe(2);
    expect(persisted.trigger.explicit).toBe(true);
  });

  it('nível 3: guia passo a passo via RAG com source rag_guide', async () => {
    mockQueryRag.mockResolvedValue({ success: true, response: '1. Abra a tela. 2. Preencha.' });

    const result = await requestTutorHelp({ tenantId: 't1', agentId: 'a1', route: '/inbox', level: 3 });

    expect(result.available).toBe(true);
    expect(result.source).toBe('rag_guide');
    expect(mockHintCreate.mock.calls[0][0].level).toBe(3);
  });

  it('nível 2/3: RAG indisponível retorna ai_unavailable explícito (sem heurística)', async () => {
    mockQueryRag.mockRejectedValue(new Error('rag down'));

    const result = await requestTutorHelp({ tenantId: 't1', agentId: 'a1', route: '/inbox', level: 2 });

    expect(result.available).toBe(false);
    expect(result.reason).toBe('ai_unavailable');
    expect(mockHintCreate).not.toHaveBeenCalled();
  });

  it('nível 2: FAQ curado da jornada tem prioridade sobre o RAG (source curated_faq)', async () => {
    mockFindCuratedFaq.mockResolvedValue({
      journeyKeys: ['support_ticket_flow'],
      match: {
        id: 'faq-1',
        question: 'Quais pré-condições são necessárias para executar a jornada?',
        answer: 'Obrigatórias: authenticated_agent, tenant_loaded.',
      },
      score: 0.8,
    });

    const result = await requestTutorHelp({
      tenantId: 't1', agentId: 'a1', route: '/support', level: 2,
      question: 'quais pre-condicoes da jornada?',
    });

    expect(result.available).toBe(true);
    expect(result.source).toBe('curated_faq');
    expect(result.content.text).toContain('authenticated_agent');
    expect(mockQueryRag).not.toHaveBeenCalled();
    expect(mockHintCreate.mock.calls[0][0].source).toBe('curated_faq');
  });

  it('nível 2: FAQ curado lançando erro não quebra o fluxo (cai para RAG)', async () => {
    mockFindCuratedFaq.mockRejectedValue(new Error('db down'));
    mockQueryRag.mockResolvedValue({ success: true, response: 'Explicação via RAG.' });

    const result = await requestTutorHelp({ tenantId: 't1', agentId: 'a1', route: '/inbox', level: 2 });

    expect(result.available).toBe(true);
    expect(result.source).toBe('rag_explain');
  });

  it('nível 4: demonstração determinística com simulações sintéticas', async () => {
    mockSimulationFindAll.mockResolvedValue([
      {
        id: 'sim-1', journeyKey: 'booking', seedType: 'happy_path', personaKey: 'cliente_vip',
        scenario: { steps: [] }, createdAt: '2026-07-23T10:00:00Z',
      },
    ]);

    const result = await requestTutorHelp({ tenantId: 't1', agentId: 'a1', route: '/booking', level: 4 });

    expect(result.available).toBe(true);
    expect(result.content.demonstrations).toHaveLength(1);
    expect(result.content.demonstrations[0].seedType).toBe('happy_path');
    expect(mockQueryRag).not.toHaveBeenCalled();
    expect(mockHintCreate.mock.calls[0][0].source).toBe('simulation_engine');
  });

  it('nível 4 sem simulações retorna no_simulations explícito', async () => {
    mockSimulationFindAll.mockResolvedValue([]);

    const result = await requestTutorHelp({ tenantId: 't1', agentId: 'a1', route: '/booking', level: 4 });

    expect(result.available).toBe(false);
    expect(result.reason).toBe('no_simulations');
  });
});
