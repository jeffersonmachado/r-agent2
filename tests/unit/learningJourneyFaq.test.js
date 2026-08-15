'use strict';

const mockFindAll = jest.fn();
const mockFindOne = jest.fn();
const mockCreate = jest.fn();

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
});
