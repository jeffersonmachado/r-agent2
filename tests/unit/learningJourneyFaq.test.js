'use strict';

const mockFindAll = jest.fn();
const mockFindOne = jest.fn();
const mockCreate = jest.fn();
const mockInfer = jest.fn();
const mockQueryRag = jest.fn();

jest.mock('../../api/utils/inferQuestionsWithAI', () => ({
  inferQuestionsWithAI: (...args) => mockInfer(...args),
}));

jest.mock('../../api/services/ragService', () => ({
  queryRag: (...args) => mockQueryRag(...args),
}));

jest.mock('../../api/db/models/LearningJourneyFaq', () => () => ({
  findAll: (...args) => mockFindAll(...args),
  findOne: (...args) => mockFindOne(...args),
  create: (...args) => mockCreate(...args),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  buildJourneyFaqItems,
  generateJourneyFaq,
  listJourneyFaq,
  listJourneyFaqSummary,
  setJourneyFaqStatus,
  findCuratedFaqForRoute,
  resolveJourneysForRoute,
} = require('../../api/modules/learning-core/journeyFaqService');

describe('journeyFaqService — geração determinística (fontes governadas)', () => {
  test('gera itens de support_ticket_flow a partir dos contratos/cenários reais', () => {
    const items = buildJourneyFaqItems('support_ticket_flow');
    const categories = items.map((item) => item.category);

    expect(categories).toContain('visao_geral');
    expect(categories).toContain('execucao');
    expect(categories).toContain('pre_condicoes');
    expect(categories).toContain('capacidades');
    expect(categories).toContain('regra_negocio');

    const pre = items.find((item) => item.category === 'pre_condicoes');
    expect(pre.answer).toContain('authenticated_agent');
    expect(pre.sources).toContain('config/journey-preconditions.json');

    const exec = items.find((item) => item.category === 'execucao');
    expect(exec.answer).toMatch(/1\. /);
    expect(exec.sources).toContain('qa/qa-waves/scenario-store.json');

    const caps = items.find((item) => item.category === 'capacidades');
    expect(caps.answer).toContain('support_ticket_flow');

    // toda pergunta tem fingerprint estável e fonte citada
    for (const item of items) {
      expect(item.fingerprint).toMatch(/^[a-f0-9]{16}$/);
      expect(item.sources.length).toBeGreaterThan(0);
    }
  });

  test('jornada inexistente nos contratos gera NOT_FOUND', () => {
    expect(() => buildJourneyFaqItems('jornada_que_nao_existe')).toThrow('Jornada nao encontrada');
  });

  test('determinístico: mesma jornada gera mesmas perguntas e fingerprints', () => {
    const a = buildJourneyFaqItems('support_ticket_flow');
    const b = buildJourneyFaqItems('support_ticket_flow');
    expect(a.map((i) => i.fingerprint)).toEqual(b.map((i) => i.fingerprint));
  });
});

describe('journeyFaqService — persistência e curadoria', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('generate cria itens como suggested e preserva curadoria em regeneração', async () => {
    mockFindAll.mockResolvedValueOnce([]);
    mockCreate.mockImplementation(async (values) => ({ id: `id-${values.fingerprint}`, ...values }));
    // segunda chamada: lista fresca após upsert
    mockFindAll.mockImplementation(async () => mockCreate.mock.calls.map((call) => ({
      id: `id-${call[0].fingerprint}`,
      createdAt: '2026-07-24T00:00:00Z',
      ...call[0],
    })));

    const result = await generateJourneyFaq({ tenantId: 'system', journeyKey: 'support_ticket_flow', createdBy: 'admin' });
    expect(result.created).toBe(result.generated);
    expect(result.items.every((item) => item.status === 'suggested')).toBe(true);

    // regeneração com um item já curado: status preservado
    const curatedRow = {
      fingerprint: mockCreate.mock.calls[0][0].fingerprint,
      status: 'included',
      curatedBy: 'admin',
      current: true,
      update: jest.fn(async () => {}),
    };
    mockFindAll.mockReset();
    mockFindAll
      .mockResolvedValueOnce([curatedRow]) // existentes
      .mockResolvedValueOnce([{ ...curatedRow, id: 'id-x', createdAt: '2026-07-24T00:00:00Z' }]); // fresh
    mockCreate.mockClear();

    const second = await generateJourneyFaq({ tenantId: 'system', journeyKey: 'support_ticket_flow' });
    expect(curatedRow.update).toHaveBeenCalledWith(expect.objectContaining({ current: true }));
    expect(curatedRow.update.mock.calls[0][0].status).toBeUndefined(); // status não é tocado
    expect(second.preserved).toBe(1);
    expect(second.created).toBe(second.generated - 1);
  });

  test('generate rejeita journeyKey inválido e jornada desconhecida', async () => {
    await expect(generateJourneyFaq({ tenantId: 't', journeyKey: '../etc' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(generateJourneyFaq({ tenantId: 't', journeyKey: 'nao_existe' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('list filtra por status (usuário comum vê apenas included)', async () => {
    mockFindAll.mockResolvedValue([
      { id: '1', journeyKey: 'j', category: 'execucao', question: 'q1', answer: 'a1', status: 'included', current: true, createdAt: '1' },
      { id: '2', journeyKey: 'j', category: 'execucao', question: 'q2', answer: 'a2', status: 'excluded', current: true, createdAt: '2' },
      { id: '3', journeyKey: 'j', category: 'execucao', question: 'q3', answer: 'a3', status: 'suggested', current: true, createdAt: '3' },
    ]);

    const all = await listJourneyFaq({ tenantId: 't', journeyKey: 'j' });
    expect(all).toHaveLength(3);

    const includedOnly = await listJourneyFaq({ tenantId: 't', journeyKey: 'j', statuses: ['included'] });
    expect(includedOnly).toHaveLength(1);
    expect(includedOnly[0].id).toBe('1');
  });

  test('summary agrega por jornada e inclui jornadas sem FAQ', async () => {
    mockFindAll.mockResolvedValue([
      { journeyKey: 'support_ticket_flow', status: 'included' },
      { journeyKey: 'support_ticket_flow', status: 'suggested' },
    ]);
    const summary = await listJourneyFaqSummary({ tenantId: 't' });
    const support = summary.find((entry) => entry.journeyKey === 'support_ticket_flow');
    expect(support).toMatchObject({ total: 2, included: 1, suggested: 1 });
    expect(summary.some((entry) => entry.journeyKey === 'booking_flow' && entry.total === 0)).toBe(true);
  });

  test('setStatus valida status, escopo de tenant e registra curador', async () => {
    await expect(setJourneyFaqStatus({ tenantId: 't', id: '1', status: 'talvez' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });

    mockFindOne.mockResolvedValueOnce(null);
    await expect(setJourneyFaqStatus({ tenantId: 't', id: '1', status: 'included' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });

    const row = { id: '1', journeyKey: 'j', status: 'suggested', update: jest.fn(async () => {}) };
    mockFindOne.mockResolvedValueOnce(row);
    const result = await setJourneyFaqStatus({ tenantId: 't', id: '1', status: 'excluded', curatedBy: 'admin' });
    expect(row.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'excluded', curatedBy: 'admin' }));
    expect(mockFindOne.mock.calls[1][0].where.tenant_id).toBe('t');
    expect(result.status).toBe('suggested'); // serialize lê o objeto original; update foi aplicado via ORM
  });
});

describe('journeyFaqService — inferência e cobertura de necessidades', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const setupModelCapture = () => {
    mockFindAll.mockResolvedValueOnce([]);
    mockCreate.mockImplementation(async (values) => ({ id: `id-${values.fingerprint}`, ...values }));
    mockFindAll.mockImplementation(async () => mockCreate.mock.calls.map((call) => ({
      id: `id-${call[0].fingerprint}`,
      createdAt: '2026-07-24T00:00:00Z',
      ...call[0],
    })));
  };

  test('inference:true cria item inferido vinculado, respondido via RAG, como suggested', async () => {
    setupModelCapture();
    // pergunta vinculada: o passo 3 do cenário ("Usuário escreve a nota interna")
    // compartilha os tokens "nota"/"interna" com a pergunta
    mockInfer.mockResolvedValue(['Como editar uma nota interna salva?']);
    mockQueryRag.mockResolvedValue({
      success: true,
      response: 'Para editar uma nota interna salva, abra o ticket na Caixa de Entrada e clique na nota.',
    });

    const result = await generateJourneyFaq({
      tenantId: 'system',
      journeyKey: 'support_ticket_flow',
      inference: true,
      createdBy: 'admin',
    });

    const inferredCall = mockCreate.mock.calls.find((call) => call[0].category === 'inferida');
    expect(inferredCall).toBeDefined();
    expect(inferredCall[0].question).toBe('Como editar uma nota interna salva?');
    expect(inferredCall[0].sources).toEqual(['ai-inference', 'rag']);
    expect(inferredCall[0].status).toBe('suggested');
    expect(result.meta.inference).toMatchObject({
      requested: true,
      status: 'ok',
      questionsInferred: 1,
      linked: 1,
      answersUnavailable: 0,
    });
  });

  test('pergunta inferida fora do escopo de negócio é descartada antes da resposta', async () => {
    setupModelCapture();
    mockInfer.mockResolvedValue(['Qual a previsão do tempo para amanhã?']);

    const result = await generateJourneyFaq({
      tenantId: 'system',
      journeyKey: 'support_ticket_flow',
      inference: true,
    });

    expect(mockCreate.mock.calls.every((call) => call[0].category !== 'inferida')).toBe(true);
    expect(mockQueryRag).not.toHaveBeenCalled();
    expect(result.meta.inference).toMatchObject({ status: 'ok', questionsInferred: 1, linked: 0 });
  });

  test('sem resposta RAG utilizável a candidata é descartada (answersUnavailable)', async () => {
    setupModelCapture();
    mockInfer.mockResolvedValue(['Como editar uma nota interna salva?']);
    mockQueryRag.mockResolvedValue({ success: false, error: 'rag indisponível' });

    const result = await generateJourneyFaq({
      tenantId: 'system',
      journeyKey: 'support_ticket_flow',
      inference: true,
    });

    expect(mockCreate.mock.calls.every((call) => call[0].category !== 'inferida')).toBe(true);
    expect(result.meta.inference).toMatchObject({ linked: 1, answersUnavailable: 1 });
  });

  test('falha da IA é explícita (ai_unavailable) e não bloqueia a geração determinística', async () => {
    setupModelCapture();
    mockInfer.mockRejectedValue(new Error('provider indisponível'));

    const result = await generateJourneyFaq({
      tenantId: 'system',
      journeyKey: 'support_ticket_flow',
      inference: true,
    });

    expect(result.meta.inference.status).toBe('ai_unavailable');
    expect(result.created).toBeGreaterThan(0); // itens determinísticos continuam gerados
  });

  test('sem inference, meta.inference é not_requested e a IA não é chamada', async () => {
    setupModelCapture();

    const result = await generateJourneyFaq({ tenantId: 'system', journeyKey: 'support_ticket_flow' });

    expect(result.meta.inference).toEqual({ requested: false, status: 'not_requested' });
    expect(mockInfer).not.toHaveBeenCalled();
    expect(mockQueryRag).not.toHaveBeenCalled();
  });

  test('meta.businessNeedsCoverage expõe buckets por tipo com uncovered rastreável', async () => {
    setupModelCapture();

    const result = await generateJourneyFaq({ tenantId: 'system', journeyKey: 'support_ticket_flow' });
    const coverage = result.meta.businessNeedsCoverage;

    expect(coverage).toBeDefined();
    expect(coverage.capability.total).toBeGreaterThan(0);
    expect(coverage.precondicao.total).toBeGreaterThan(0);
    expect(coverage.passo.total).toBe(5); // 5 passos do cenário aprovado
    expect(coverage.regra.total).toBe(1);
    for (const bucket of Object.values(coverage)) {
      expect(bucket.covered).toBeLessThanOrEqual(bucket.total);
      expect(Array.isArray(bucket.uncovered)).toBe(true);
      expect(bucket.uncovered.length).toBe(bucket.total - bucket.covered);
    }
  });
});

describe('journeyFaqService — consumo pelo Tutor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolveJourneysForRoute mapeia /support para support_ticket_flow', () => {
    const journeys = resolveJourneysForRoute('/support');
    expect(journeys).toContain('support_ticket_flow');
    expect(resolveJourneysForRoute('/rota-sem-jornada-xyz')).toEqual([]);
  });

  test('findCuratedFaqForRoute encontra match acima do limiar', async () => {
    mockFindAll.mockResolvedValue([{
      id: 'f1',
      journeyKey: 'support_ticket_flow',
      category: 'pre_condicoes',
      question: 'Quais pré-condições são necessárias para executar a jornada?',
      answer: 'Obrigatórias: authenticated_agent, tenant_loaded.',
      status: 'included',
      current: true,
      createdAt: '1',
    }]);

    const result = await findCuratedFaqForRoute({
      tenantId: 't',
      route: '/support',
      question: 'quais são as pré-condições da jornada?',
    });
    expect(result).not.toBeNull();
    expect(result.match.id).toBe('f1');
    expect(result.score).toBeGreaterThanOrEqual(0.5);
  });

  test('findCuratedFaqForRoute retorna null sem match ou sem itens incluídos', async () => {
    mockFindAll.mockResolvedValue([{
      id: 'f1',
      journeyKey: 'support_ticket_flow',
      category: 'execucao',
      question: 'Quais são os passos para executar a jornada?',
      answer: '1. Abrir inbox.',
      status: 'included',
      current: true,
      createdAt: '1',
    }]);

    const noMatch = await findCuratedFaqForRoute({
      tenantId: 't',
      route: '/support',
      question: 'relatório financeiro trimestral consolidado',
    });
    expect(noMatch).toBeNull();

    mockFindAll.mockResolvedValue([]);
    const empty = await findCuratedFaqForRoute({ tenantId: 't', route: '/support', question: 'passos' });
    expect(empty).toBeNull();
  });

  test('desempate favorece a jornada dona da capability da rota', async () => {
    // /support mapeia para support_ticket_flow (dona) e booking_flow (só
    // exige a capability support_ticket_flow). Com score idêntico, a dona vence.
    const item = (id, journeyKey) => ({
      id,
      journeyKey,
      category: 'execucao',
      question: `Quais são os passos para executar a jornada "${journeyKey.replace(/_/g, ' ')}"?`,
      answer: '1. Abrir a tela.',
      status: 'included',
      current: true,
      createdAt: '1',
    });
    mockFindAll.mockResolvedValue([
      item('f-booking', 'booking_flow'),
      item('f-support', 'support_ticket_flow'),
    ]);

    const result = await findCuratedFaqForRoute({
      tenantId: 't',
      route: '/support',
      question: 'quais são os passos para executar a jornada?',
    });
    expect(result).not.toBeNull();
    expect(result.match.id).toBe('f-support');
  });
});
