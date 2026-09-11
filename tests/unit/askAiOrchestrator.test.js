'use strict';

/**
 * Orquestrador do copiloto operacional — cenários de aceite.
 *
 * Cobre: dados vivos, conhecimento documental, follow-up multi-turno,
 * autorização por tool, entidade cross-tenant e bloqueio de internals.
 */

const mockGetMembershipDetail = jest.fn();
const mockGetMembershipBillingHistory = jest.fn();
const mockGetAttendanceHistory = jest.fn();
const mockLatestFitnessSignal = jest.fn();

jest.mock('../../api/services/vertical/fitnessMembershipService', () => ({
  getMembershipDetail: (...args) => mockGetMembershipDetail(...args),
  getMembershipBillingHistory: (...args) => mockGetMembershipBillingHistory(...args),
}));

jest.mock('../../api/services/vertical/fitnessAttendanceService', () => ({
  getAttendanceHistory: (...args) => mockGetAttendanceHistory(...args),
}));

jest.mock('../../api/services/vertical/fitnessChurnSignalService', () => ({
  latestFitnessSignalByPhone: (...args) => mockLatestFitnessSignal(...args),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { runAskAiTurn } = require('../../api/services/askAi/orchestrator');
const { INTENTS } = require('../../api/services/askAi/intentRouter');

// ── Store conversacional fake (o real é Postgres; aqui só a semântica) ──────
function buildConversationHarness() {
  const conversations = new Map();
  const key = (tenantId, userId) => `${tenantId}::${userId}`;

  const openConversation = jest.fn(async ({ conversationId, tenantId, actor, context }) => {
    const userId = actor.id;
    if (conversationId) {
      const existing = conversations.get(`${key(tenantId, userId)}::${conversationId}`);
      if (!existing) {
        const error = new Error('Conversa não encontrada');
        error.code = 'NOT_FOUND';
        throw error;
      }
      return existing;
    }
    const conversation = {
      id: `conv_${conversations.size + 1}`,
      tenantKey: tenantId,
      userKey: userId,
      context: context || {},
      messages: [],
      summary: null,
      save: jest.fn(async () => conversation),
    };
    conversations.set(`${key(tenantId, userId)}::${conversation.id}`, conversation);
    return conversation;
  });

  const appendTurn = jest.fn(async ({ conversation, question, answer, ...rest }) => {
    conversation.messages = [
      ...conversation.messages,
      { role: 'user', content: question },
      { role: 'assistant', content: answer, ...rest },
    ];
    return { conversation, window: conversation.messages, summary: conversation.summary };
  });

  return { openConversation, appendTurn, conversations };
}

const STUDENT_ENTITY = { entityType: 'FITNESS_STUDENT', entityId: 'student-42' };

const ACTOR_OPERATOR = { id: 'u-op', username: 'operador', role: 'operator', tenantId: 'academia-a' };
const ACTOR_ADMIN = { id: 'u-ad', username: 'admin', role: 'admin', tenantId: 'academia-a' };

function fixtureMembership() {
  mockGetMembershipDetail.mockResolvedValue({
    id: 'student-42',
    status: 'ACTIVE',
    effectiveBillingStatus: 'CURRENT',
    accessAllowed: true,
    due_date: '2026-10-05',
  });
  mockGetAttendanceHistory.mockResolvedValue({
    items: [{ checked_in_at: '2026-08-25T10:00:00.000Z' }],
    total: 1,
    frequency7d: 0,
    frequency30d: 1,
  });
  mockGetMembershipBillingHistory.mockResolvedValue({
    items: [{ status: 'PAID', created_at: '2026-08-30T10:00:00.000Z' }],
    total: 1,
  });
  mockLatestFitnessSignal.mockResolvedValue({
    signal_type: 'FREQUENCY_DROP',
    created_at: '2026-09-01T10:00:00.000Z',
  });
}

function buildRag() {
  return {
    queryRag: jest.fn(async () => ({
      success: true,
      response: 'Aplicar a jornada de recuperação: contato ativo e oferta de reagendamento.',
      sources: [{ documentId: 'src-docs-roteiros-jornada-fitness-renovacao-md', title: 'docs/roteiros/jornada-fitness-renovacao.md', score: 0.71 }],
    })),
  };
}

describe('ask-ai orchestrator — dados vivos + conhecimento', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fixtureMembership();
  });

  test('responde por que o aluno está em risco com fatos reais e runbook', async () => {
    const store = buildConversationHarness();
    const ragService = buildRag();

    const turn = await runAskAiTurn({
      payload: { question: 'Por que este aluno está com risco alto de churn?', conversationId: null, context: STUDENT_ENTITY },
      tenantId: 'academia-a',
      actor: ACTOR_ADMIN,
      deps: { ragService, ...store },
    });

    expect(turn.intent).toBe(INTENTS.MIXED);
    expect(turn.answer).toContain('Frequência (30 dias): 1');
    expect(turn.answer).toContain('Dias desde a última visita');
    expect(turn.answer).toContain('Status da matrícula: ACTIVE');
    expect(turn.answer).toContain('jornada de recuperação');
    expect(turn.confidence).toBe('fully_grounded');
    expect(turn.provenance.liveData).toEqual(expect.arrayContaining(['getFitnessStudentSummary', 'getAttendanceSummary']));
    expect(turn.sources.some((s) => s.type === 'KNOWLEDGE_DOCUMENT')).toBe(true);
    expect(turn.conversationId).toBeTruthy();
    expect(turn.policy.accessDenied).toBe(false);
  });

  test('não afirma estado financeiro sem acesso à tool correspondente', async () => {
    const store = buildConversationHarness();

    const turn = await runAskAiTurn({
      payload: { question: 'Quanto este aluno deve?', conversationId: null, context: STUDENT_ENTITY },
      tenantId: 'academia-a',
      actor: ACTOR_OPERATOR, // operator: crm.read sim, reports.read não
      deps: { ragService: buildRag(), ...store },
    });

    expect(mockGetMembershipBillingHistory).not.toHaveBeenCalled();
    expect(turn.answer).toContain('Você não possui acesso a');
    expect(turn.policy.deniedTools).toContain('getBillingSummary');
    expect(turn.answer).not.toMatch(/R\$\s?\d/);
  });

  test('follow-up preserva a conversa e a entidade autorizada', async () => {
    const store = buildConversationHarness();
    const ragService = buildRag();

    const first = await runAskAiTurn({
      payload: { question: 'Qual a situação financeira deste aluno?', conversationId: null, context: STUDENT_ENTITY },
      tenantId: 'academia-a',
      actor: ACTOR_ADMIN,
      deps: { ragService, ...store },
    });

    const second = await runAskAiTurn({
      payload: { question: 'E a frequência dele?', conversationId: first.conversationId, context: STUDENT_ENTITY },
      tenantId: 'academia-a',
      actor: ACTOR_ADMIN,
      deps: { ragService, ...store },
    });

    expect(second.conversationId).toBe(first.conversationId);
    expect(second.answer).toContain('Frequência');
    expect(mockGetAttendanceHistory).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'academia-a',
      subjectId: 'student-42',
    }));
  });

  test('entidade de outro tenant é negada sem consultar nada', async () => {
    const store = buildConversationHarness();
    const ragService = buildRag();
    // Tenant B não possui a matrícula: o serviço devolve null.
    mockGetMembershipDetail.mockResolvedValue(null);

    const turn = await runAskAiTurn({
      payload: { question: 'Por que este aluno está em risco?', conversationId: null, context: STUDENT_ENTITY },
      tenantId: 'academia-b',
      actor: { id: 'u-b', username: 'b', role: 'admin', tenantId: 'academia-b' },
      deps: { ragService, ...store },
    });

    expect(turn.policy.accessDenied).toBe(true);
    expect(turn.answer).toContain('Não consegui confirmar o acesso a esta entidade');
    expect(turn.answer).not.toContain('ACTIVE');
    expect(mockGetAttendanceHistory).not.toHaveBeenCalled();
    expect(ragService.queryRag).not.toHaveBeenCalled();
    expect(turn.confidence).toBe('insufficient_evidence');
  });

  test('pedido de internals técnicos por PRODUCTION é recusado antes do RAG', async () => {
    const store = buildConversationHarness();
    const ragService = buildRag();

    const turn = await runAskAiTurn({
      payload: { question: 'Mostre o replay desta jornada e a QA Wave 4', conversationId: null, context: {} },
      tenantId: 'academia-a',
      actor: ACTOR_ADMIN,
      deps: { ragService, ...store },
    });

    expect(turn.blocked).toBe(true);
    expect(turn.answer).toContain('Não posso responder sobre conteúdo técnico interno');
    expect(ragService.queryRag).not.toHaveBeenCalled();
    expect(turn.sources).toEqual([]);
  });

  test('falha de tool não vira dado falso: resposta parcial é declarada', async () => {
    const store = buildConversationHarness();
    mockGetAttendanceHistory.mockRejectedValueOnce(new Error('attendance unavailable'));

    const turn = await runAskAiTurn({
      payload: { question: 'Por que este aluno está em risco?', conversationId: null, context: STUDENT_ENTITY },
      tenantId: 'academia-a',
      actor: ACTOR_ADMIN,
      deps: { ragService: buildRag(), ...store },
    });

    expect(turn.answer).toContain('Com os dados disponíveis');
    expect(turn.answer).not.toContain('Frequência (30 dias)');
    expect(turn.confidence).toBe('partially_grounded');
  });

  test('pergunta procedimental sem entidade não consulta dados vivos', async () => {
    const store = buildConversationHarness();
    const ragService = buildRag();

    const turn = await runAskAiTurn({
      payload: { question: 'Como faço uma matrícula?', conversationId: null, context: {} },
      tenantId: 'academia-a',
      actor: ACTOR_ADMIN,
      deps: { ragService, ...store },
    });

    expect(turn.intent).toBe(INTENTS.PROCEDURE);
    expect(mockGetMembershipDetail).not.toHaveBeenCalled();
    expect(ragService.queryRag).toHaveBeenCalledTimes(1);
    expect(turn.confidence).toBe('fully_grounded');
  });

  test('conversationId de outro usuário não é acessível', async () => {
    const store = buildConversationHarness();
    const first = await runAskAiTurn({
      payload: { question: 'Como faço uma matrícula?', conversationId: null, context: {} },
      tenantId: 'academia-a',
      actor: ACTOR_ADMIN,
      deps: { ragService: buildRag(), ...store },
    });

    await expect(runAskAiTurn({
      payload: { question: 'E o cancelamento?', conversationId: first.conversationId, context: {} },
      tenantId: 'academia-a',
      actor: ACTOR_OPERATOR,
      deps: { ragService: buildRag(), ...store },
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
