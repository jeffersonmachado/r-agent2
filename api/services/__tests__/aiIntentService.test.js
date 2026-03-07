'use strict';

jest.mock('../nlpService', () => ({
  analyzeText: jest.fn(),
}));

jest.mock('../ragContextBuilder', () => ({
  buildDiverseRagContext: jest.fn(),
}));

const nlpService = require('../nlpService');
const { buildDiverseRagContext } = require('../ragContextBuilder');
const { classifyIncomingMessage } = require('../aiIntentService');

describe('aiIntentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('mapeia intencao NLP para department binding com aliases', async () => {
    buildDiverseRagContext.mockResolvedValue({ ragContext: '', contextSources: [], contextSummary: null });
    nlpService.analyzeText.mockResolvedValue({
      intent: 'agendamento de pilates',
      secondaryIntent: 'pilates',
      confidence: 0.91,
      entities: { service: 'pilates' },
    });

    const out = await classifyIncomingMessage({
      tenantId: 'tenant-1',
      text: 'quero marcar pilates',
      config: {
        departmentBindings: [
          { departmentId: 'dept-fit', enabled: true, menuLabel: 'Fitness', aliases: ['pilates', 'yoga'] },
        ],
      },
      departments: [
        { id: 'dept-fit', name: 'Fitness', queueNames: ['fitness'] },
      ],
      ticket: { context: {} },
    });

    expect(out.ok).toBe(true);
    expect(out.departmentId).toBe('dept-fit');
    expect(out.confidence).toBeGreaterThanOrEqual(0.91);
    expect(out.entities).toEqual(expect.objectContaining({ service: 'pilates' }));
    expect(out.secondaryIntent).toBe('pilates');
    expect(out.explanation).toMatch(/Decisao baseada em/i);
    expect(out.providerStatus).toBe('disabled');
    expect(out.contextUsed).toEqual(expect.objectContaining({ ragReady: true, ragUsed: false, providerStatus: 'disabled' }));
  });

  test('faz fallback heuristico quando NLP falha', async () => {
    buildDiverseRagContext.mockResolvedValue({ ragContext: '', contextSources: [], contextSummary: null });
    nlpService.analyzeText.mockRejectedValue(new Error('offline'));

    const out = await classifyIncomingMessage({
      tenantId: 'tenant-1',
      text: 'preciso falar com financeiro sobre boleto',
      config: {
        departmentBindings: [
          { departmentId: 'dept-fin', enabled: true, menuLabel: 'Financeiro', aliases: ['boleto', 'financeiro'] },
        ],
      },
      departments: [
        { id: 'dept-fin', name: 'Financeiro', queueNames: ['finance'] },
      ],
      ticket: { context: {} },
    });

    expect(out.ok).toBe(true);
    expect(out.source).toBe('fallback');
    expect(out.departmentId).toBe('dept-fin');
    expect(out.confidence).toBeGreaterThan(0.2);
    expect(out.providerStatus).toBe('disabled');
  });

  test('usa historico curto e entidades do ticket para enriquecer classificacao', async () => {
    buildDiverseRagContext.mockResolvedValue({ ragContext: '', contextSources: [], contextSummary: null });
    nlpService.analyzeText.mockResolvedValue({
      intent: 'quero agendar',
      confidence: 0.74,
      entities: {},
    });

    const out = await classifyIncomingMessage({
      tenantId: 'tenant-1',
      text: 'tem horario amanha?',
      history: ['quero pilates', 'qual horario livre?'],
      config: {
        departmentBindings: [
          { departmentId: 'dept-fit', enabled: true, menuLabel: 'Fitness', aliases: ['pilates'] },
        ],
      },
      departments: [
        { id: 'dept-fit', name: 'Fitness', queueNames: ['fitness'] },
      ],
      ticket: {
        subject: 'Agendamento',
        context: {
          metadata: {
            tags: ['fitness'],
            entities: { activity: { value: 'pilates' } },
          },
          whatsappIvr: { departmentName: 'Fitness' },
        },
      },
    });

    expect(out.departmentId).toBe('dept-fit');
    expect(out.secondaryIntent).toBe('pilates');
    expect(out.entities).toEqual(expect.objectContaining({ activity: 'pilates' }));
    expect(out.providerStatus).toBe('disabled');
  });

  test('usa contexto RAG quando habilitado e registra contexto resumido', async () => {
    buildDiverseRagContext.mockResolvedValue({
      ragContext: '[FONTES: WEB SCRAPING]\n- (https://example.com/pilates) score=0.92',
      contextSources: [{ sourceType: 'web_scraping', sourceId: 'https://example.com/pilates', score: 0.92 }],
      contextSummary: { total: 1, web: 1, uploaded: 0 },
    });
    nlpService.analyzeText.mockResolvedValue({
      intent: 'agendamento',
      confidence: 0.88,
      entities: { service: 'pilates' },
    });

    const out = await classifyIncomingMessage({
      tenantId: 'tenant-1',
      text: 'quero pilates',
      config: {
        aiContextRagEnabled: true,
        departmentBindings: [
          { departmentId: 'dept-fit', enabled: true, menuLabel: 'Fitness', aliases: ['pilates'] },
        ],
      },
      departments: [
        { id: 'dept-fit', name: 'Fitness', queueNames: ['fitness'] },
      ],
      ticket: { context: {} },
    });

    expect(buildDiverseRagContext).toHaveBeenCalled();
    expect(out.ragUsed).toBe(true);
    expect(out.providerStatus).toBe('used');
    expect(out.contextUsed).toEqual(expect.objectContaining({
      ragUsed: true,
      providerStatus: 'used',
      ragSources: [expect.objectContaining({ sourceType: 'web_scraping' })],
    }));
  });

  test('falha do provider de contexto nao quebra fallback da classificacao', async () => {
    buildDiverseRagContext.mockRejectedValue(new Error('rag offline'));
    nlpService.analyzeText.mockResolvedValue({
      intent: 'financeiro',
      confidence: 0.84,
      entities: { topic: 'boleto' },
    });

    const out = await classifyIncomingMessage({
      tenantId: 'tenant-1',
      text: 'boleto',
      config: {
        aiContextRagEnabled: true,
        departmentBindings: [
          { departmentId: 'dept-fin', enabled: true, menuLabel: 'Financeiro', aliases: ['boleto'] },
        ],
      },
      departments: [
        { id: 'dept-fin', name: 'Financeiro', queueNames: ['finance'] },
      ],
      ticket: { context: {} },
    });

    expect(out.ok).toBe(true);
    expect(out.departmentId).toBe('dept-fin');
    expect(out.ragUsed).toBe(false);
    expect(out.providerStatus).toBe('error');
    expect(out.contextUsed).toEqual(expect.objectContaining({ ragUsed: false, providerStatus: 'error' }));
  });

  test('timeout do provider de contexto retorna status auditavel sem quebrar classificacao', async () => {
    const timeoutError = new Error('rag_context_timeout');
    timeoutError.code = 'rag_context_timeout';
    buildDiverseRagContext.mockRejectedValue(timeoutError);
    nlpService.analyzeText.mockResolvedValue({
      intent: 'agendamento',
      confidence: 0.82,
      entities: { service: 'pilates' },
    });

    const out = await classifyIncomingMessage({
      tenantId: 'tenant-1',
      text: 'quero agendar pilates',
      config: {
        aiContextRagEnabled: true,
        departmentBindings: [
          { departmentId: 'dept-fit', enabled: true, menuLabel: 'Fitness', aliases: ['pilates'] },
        ],
      },
      departments: [
        { id: 'dept-fit', name: 'Fitness', queueNames: ['fitness'] },
      ],
      ticket: { context: {} },
    });

    expect(out.ok).toBe(true);
    expect(out.departmentId).toBe('dept-fit');
    expect(out.providerStatus).toBe('timeout');
    expect(out.contextUsed).toEqual(expect.objectContaining({ providerStatus: 'timeout' }));
  });
});
