'use strict';

const mockHintFindOne = jest.fn();
const mockHintCreate = jest.fn();
const mockQueryRag = jest.fn();
const mockEmitEvent = jest.fn();

jest.mock('../../api/db/models/LearningTutorHint', () => () => ({
  findOne: (...args) => mockHintFindOne(...args),
  create: (...args) => mockHintCreate(...args),
}));

jest.mock('../../api/services/ragService', () => ({
  queryRag: (...args) => mockQueryRag(...args),
}));

jest.mock('../../api/services/websocketService', () => ({
  emitEvent: (...args) => mockEmitEvent(...args),
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

const {
  detectDifficulty,
  evaluateAndMaybeHint,
} = require('../../api/modules/learning-core/tutorService');

function apiErrorEvent(route, clientEventId, status = 500) {
  return {
    type: 'learning.interaction.api_call',
    clientEventId,
    payload: { route, status: String(status), errorCode: `http_${status}` },
  };
}

const baseArgs = () => ({
  tenantId: 'system',
  agentId: 42,
  sessionId: 'sess-1',
  events: [
    apiErrorEvent('/inbox', 'e1'),
    apiErrorEvent('/inbox', 'e2', 404),
    { type: 'learning.interaction.navigation', clientEventId: 'e3', payload: { route: '/inbox' } },
  ],
});

describe('learning-core tutorService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHintFindOne.mockResolvedValue(null);
    mockHintCreate.mockImplementation(async (values) => ({ id: 'hint-1', createdAt: new Date(), ...values }));
    mockQueryRag.mockResolvedValue({ success: true, response: 'Use a caixa de entrada assim.' });
    mockFindCuratedFaq.mockResolvedValue(null);
  });

  describe('detectDifficulty (nível 0)', () => {
    test('retorna null com menos de 2 erros na mesma rota', () => {
      const args = baseArgs();
      args.events = [apiErrorEvent('/inbox', 'e1'), { type: 'learning.interaction.navigation', clientEventId: 'e2', payload: { route: '/inbox' } }];
      expect(detectDifficulty(args.events)).toBeNull();
    });

    test('detecta rota com >= 2 erros (api_call >= 400)', () => {
      const result = detectDifficulty(baseArgs().events);
      expect(result.route).toBe('/inbox');
      expect(result.errorEvents).toHaveLength(2);
    });

    test('conta flow_abandoned e error como erro; ignora api_call 200', () => {
      const events = [
        { type: 'learning.interaction.flow_abandoned', clientEventId: 'a', payload: { route: '/flows' } },
        { type: 'learning.interaction.error', clientEventId: 'b', payload: { route: '/flows' } },
        { type: 'learning.interaction.api_call', clientEventId: 'c', payload: { route: '/flows', status: '200' } },
      ];
      const result = detectDifficulty(events);
      expect(result.route).toBe('/flows');
      expect(result.errorEvents).toHaveLength(2);
    });

    test('ignora erros sem rota', () => {
      const events = [apiErrorEvent(null, 'e1'), apiErrorEvent(null, 'e2')];
      expect(detectDifficulty(events)).toBeNull();
    });
  });

  describe('evaluateAndMaybeHint (nível 1)', () => {
    test('sem dificuldade nao emite hint', async () => {
      const args = baseArgs();
      args.events = [{ type: 'learning.interaction.navigation', clientEventId: 'e1', payload: { route: '/inbox' } }];
      const result = await evaluateAndMaybeHint(args);
      expect(result).toEqual({ hintEmitted: false, reason: 'no_difficulty' });
      expect(mockQueryRag).not.toHaveBeenCalled();
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    test('cooldown: hint recente para mesma rota/agente bloqueia novo', async () => {
      mockHintFindOne.mockResolvedValueOnce({ id: 'hint-recent' });
      const result = await evaluateAndMaybeHint(baseArgs());
      expect(result).toEqual({ hintEmitted: false, reason: 'cooldown' });
      expect(mockQueryRag).not.toHaveBeenCalled();
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    test('RAG indisponivel: nenhum hint, motivo ai_unavailable, log explicito', async () => {
      const logger = require('../../api/utils/logger');
      mockQueryRag.mockRejectedValueOnce(new Error('rag down'));
      const result = await evaluateAndMaybeHint(baseArgs());
      expect(result).toEqual({ hintEmitted: false, reason: 'ai_unavailable' });
      expect(mockHintCreate).not.toHaveBeenCalled();
      expect(mockEmitEvent).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('ai_unavailable'),
        expect.objectContaining({ route: '/inbox' }),
      );
    });

    test('reuso: hint de rota em cache (<24h) evita nova chamada RAG', async () => {
      mockHintFindOne
        .mockResolvedValueOnce(null) // cooldown do agente
        .mockResolvedValueOnce({ hintText: 'dica reutilizada', source: 'rag' }); // cache da rota

      const result = await evaluateAndMaybeHint(baseArgs());

      expect(result).toEqual({ hintEmitted: true });
      expect(mockQueryRag).not.toHaveBeenCalled();
      expect(mockHintCreate).toHaveBeenCalledWith(expect.objectContaining({
        hintText: 'dica reutilizada',
        source: 'rag_cache',
      }));
    });

    test('caminho feliz: persiste hint auditavel e emite tutor.hint apenas para o agente', async () => {
      const result = await evaluateAndMaybeHint(baseArgs());

      expect(result).toEqual({ hintEmitted: true });
      expect(mockQueryRag).toHaveBeenCalledTimes(1);
      expect(mockHintCreate).toHaveBeenCalledWith(expect.objectContaining({
        tenant_id: 'system',
        agentId: '42',
        sessionId: 'sess-1',
        route: '/inbox',
        level: 1,
        source: 'rag',
        evidenceRefs: ['e1', 'e2'],
      }));
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'tutor.hint',
        expect.objectContaining({ route: '/inbox', level: 1, hint: 'Use a caixa de entrada assim.' }),
        { agentId: 42 },
      );
    });

    test('FAQ curado casa com códigos de erro e evita RAG (source curated_faq)', async () => {
      mockFindCuratedFaq.mockResolvedValue({
        journeyKeys: ['support_ticket_flow'],
        match: {
          id: 'faq-9',
          question: 'Quais pré-condições são necessárias?',
          answer: 'Obrigatórias: authenticated_agent, tenant_loaded.',
        },
        score: 0.7,
      });

      const result = await evaluateAndMaybeHint(baseArgs());

      expect(result).toEqual({ hintEmitted: true });
      expect(mockFindCuratedFaq).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'system',
        route: '/inbox',
        question: 'http_500 http_404',
      }));
      expect(mockQueryRag).not.toHaveBeenCalled();
      expect(mockHintCreate).toHaveBeenCalledWith(expect.objectContaining({ source: 'curated_faq' }));
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'tutor.hint',
        expect.objectContaining({ source: 'curated_faq' }),
        { agentId: 42 },
      );
    });

    test('FAQ curado falhando não quebra o nível 1 (cai para RAG)', async () => {
      mockFindCuratedFaq.mockRejectedValue(new Error('db down'));

      const result = await evaluateAndMaybeHint(baseArgs());

      expect(result).toEqual({ hintEmitted: true });
      expect(mockQueryRag).toHaveBeenCalledTimes(1);
      expect(mockHintCreate).toHaveBeenCalledWith(expect.objectContaining({ source: 'rag' }));
    });
  });
});
