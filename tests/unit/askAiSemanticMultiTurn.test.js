'use strict';

/**
 * Ask AI — multi-turn SEMÂNTICO (A2) e resolução de sujeito pela conversa (A4).
 *
 * Cenário de aceite do §A2:
 *   Q1 "Qual a situação financeira deste aluno?"  → dado vivo (entidade explícita)
 *   Q2 "E a frequência dele?"                     → SEM entidade no payload:
 *        o sujeito vem da conversa persistida, é REVALIDADO e a intenção é
 *        herdada (não cai em "conhecimento genérico")
 *   Q3 "Então por que está em risco?"             → mantém sujeito + método
 *        (dado vivo + conhecimento = MIXED)
 *
 * O histórico enviado pelo cliente NUNCA é autoridade: a continuidade vem da
 * conversa persistida por (tenant, usuário) e da revalidação de posse.
 */

const mockGetMembershipDetail = jest.fn();
const mockGetMembershipBillingHistory = jest.fn();
const mockGetMembershipAccessStatus = jest.fn();
const mockGetAttendanceHistory = jest.fn();
const mockLatestFitnessSignal = jest.fn();

// A resolução do subjectId → matrícula passa por `getMembershipAccessStatus`
// (tenant-scoped); as tools de matrícula/cobrança usam o id da MATRÍCULA.
jest.mock('../../api/services/vertical/fitnessMembershipService', () => ({
  getMembershipDetail: (...args) => mockGetMembershipDetail(...args),
  getMembershipBillingHistory: (...args) => mockGetMembershipBillingHistory(...args),
  getMembershipAccessStatus: (...args) => mockGetMembershipAccessStatus(...args),
}));

jest.mock('../../api/services/vertical/fitnessAttendanceService', () => ({
  getAttendanceHistory: (...args) => mockGetAttendanceHistory(...args),
}));

jest.mock('../../api/services/vertical/fitnessChurnSignalService', () => ({
  latestFitnessSignalByPhone: (...args) => mockLatestFitnessSignal(...args),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { runAskAiTurn } = require('../../api/services/askAi/orchestrator');
const { INTENTS } = require('../../api/services/askAi/intentRouter');
const {
  isShortFollowUp,
  resolveEffectiveContext,
  inheritIntent,
  buildRetrievalQuery,
  lastIntent,
} = require('../../api/services/askAi/conversationContext');

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

  const appendTurn = jest.fn(async ({ conversation, question, answer, context, ...rest }) => {
    conversation.messages = [
      ...conversation.messages,
      { role: 'user', content: question },
      { role: 'assistant', content: answer, ...rest },
    ];
    if (context) conversation.context = context;
    return { conversation, window: conversation.messages, summary: conversation.summary };
  });

  return { openConversation, appendTurn, conversations };
}

const ACTOR_ADMIN = { id: 'u-ad', username: 'admin', role: 'admin', tenantId: 'academia-a' };
const STUDENT_ENTITY = { entityType: 'FITNESS_STUDENT', entityId: 'student-42' };

function fixture() {
  mockGetMembershipDetail.mockResolvedValue({
    id: 'student-42', status: 'ACTIVE', effectiveBillingStatus: 'CURRENT',
    accessAllowed: true, due_date: '2026-10-05',
  });
  // Posse + resolução da matrícula: tenant-scoped, como no serviço real.
  mockGetMembershipAccessStatus.mockImplementation(async ({ tenantId }) => (
    tenantId === 'academia-a'
      ? {
        allowed: true,
        effectiveBillingStatus: 'CURRENT',
        reasonCode: 'allowed',
        membership: {
          id: 'MEM-42',
          subject_id: 'student-42',
          vertical: 'fitness',
          billing_status: 'active',
          metadata: { phone: '+5511999990000' },
        },
      }
      : { allowed: false, reasonCode: 'membership_not_found', membership: null }
  ));
  mockGetAttendanceHistory.mockResolvedValue({
    items: [{ checked_in_at: '2026-08-25T10:00:00.000Z' }], total: 1, frequency7d: 0, frequency30d: 1,
  });
  mockGetMembershipBillingHistory.mockResolvedValue({
    items: [{ status: 'PAID', created_at: '2026-08-30T10:00:00.000Z' }], total: 1,
  });
  mockLatestFitnessSignal.mockResolvedValue({
    signal_type: 'FREQUENCY_DROP', created_at: '2026-09-01T10:00:00.000Z',
  });
}

function buildRag() {
  return {
    queryRag: jest.fn(async () => ({
      success: true,
      response: 'Aplicar a jornada de recuperação: contato ativo e oferta de reagendamento.',
      sources: [{ documentId: 'src-doc-1', title: 'docs/roteiros/jornada-fitness-renovacao.md', score: 0.71 }],
    })),
  };
}

describe('Conversa — semântica de acompanhamento (unidade)', () => {
  test('reconhece acompanhamento curto por marcador e por tamanho', () => {
    expect(isShortFollowUp('E a frequência dele?')).toBe(true);
    expect(isShortFollowUp('Então por que está em risco?')).toBe(true);
    expect(isShortFollowUp('ele está inadimplente?')).toBe(true);
    // Abertura de assunto novo NÃO é acompanhamento, mesmo sendo curta.
    expect(isShortFollowUp('Qual a situação financeira deste aluno?')).toBe(false);
    expect(isShortFollowUp('Como configuro uma campanha?')).toBe(false);
    expect(isShortFollowUp('Explique detalhadamente o processo de renovação anual de matrículas com desconto progressivo'))
      .toBe(false);
    expect(isShortFollowUp('')).toBe(false);
  });

  test('contexto efetivo prioriza o payload e cai na conversa quando ausente', () => {
    expect(resolveEffectiveContext({
      payloadContext: STUDENT_ENTITY,
      persistedContext: { entityType: 'FITNESS_STUDENT', entityId: 'outro' },
    })).toEqual({ context: STUDENT_ENTITY, source: 'payload' });

    expect(resolveEffectiveContext({
      payloadContext: {},
      persistedContext: STUDENT_ENTITY,
    })).toEqual({ context: STUDENT_ENTITY, source: 'conversation' });

    expect(resolveEffectiveContext({ payloadContext: {}, persistedContext: {} }).source).toBe('none');
  });

  test('herança de intenção só ocorre em acompanhamento curto COM sujeito', () => {
    expect(inheritIntent({
      question: 'E a frequência dele?', intent: INTENTS.KNOWLEDGE,
      previousIntent: INTENTS.MIXED, hasEntity: true,
    })).toEqual({ intent: INTENTS.MIXED, inherited: true });

    // Sem sujeito conhecido, dado vivo não é herdado (evita consulta sem entidade).
    expect(inheritIntent({
      question: 'E a frequência dele?', intent: INTENTS.KNOWLEDGE,
      previousIntent: INTENTS.MIXED, hasEntity: false,
    }).inherited).toBe(false);

    // Assunto interno nunca é promovido por herança.
    expect(inheritIntent({
      question: 'E o replay?', intent: INTENTS.KNOWLEDGE,
      previousIntent: INTENTS.SYSTEM_INTERNAL, hasEntity: true,
    }).inherited).toBe(false);

    // Acompanhamento CAUSAL sobre dado vivo vira MIXED (fato + método).
    expect(inheritIntent({
      question: 'Então por que está em risco?', intent: INTENTS.KNOWLEDGE,
      previousIntent: INTENTS.OPERATIONAL_DATA, hasEntity: true,
    })).toEqual({ intent: INTENTS.MIXED, inherited: true });

    // Pergunta longa não herda: é assunto novo.
    expect(inheritIntent({
      question: 'Explique detalhadamente o processo de renovação anual de matrículas com desconto progressivo',
      intent: INTENTS.KNOWLEDGE, previousIntent: INTENTS.MIXED, hasEntity: true,
    }).inherited).toBe(false);
  });

  test('consulta de recuperação é contextualizada só no acompanhamento curto', () => {
    const history = { messages: [{ role: 'user', content: 'Qual a situação financeira deste aluno?' }] };
    expect(buildRetrievalQuery({ question: 'E a frequência dele?', history }))
      .toContain('situação financeira aluno');
    expect(buildRetrievalQuery({ question: 'Como configuro uma campanha?', history }))
      .toBe('Como configuro uma campanha?');
  });
});

describe('Ask AI — Q1/Q2/Q3 com sujeito mantido pela conversa', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fixture();
  });

  test('Q1 → Q2 → Q3 mantêm conversa, entidade e contexto autorizado', async () => {
    const store = buildConversationHarness();
    const ragService = buildRag();
    const deps = { ragService, ...store };

    // ── Q1: entidade explícita no payload ────────────────────────────────
    const q1 = await runAskAiTurn({
      payload: { question: 'Qual a situação financeira deste aluno?', conversationId: null, context: STUDENT_ENTITY },
      tenantId: 'academia-a', actor: ACTOR_ADMIN, deps,
    });
    expect(q1.conversationId).toBeTruthy();
    expect(q1.policy.conversation.entityFromConversation).toBe(false);
    // A pergunta canônica de situação financeira ACIONA a tool de cobrança.
    expect(mockGetMembershipBillingHistory).toHaveBeenCalledTimes(1);

    // ── Q2: SEM entidade no payload — o sujeito vem da conversa ──────────
    mockGetAttendanceHistory.mockClear();
    const q2 = await runAskAiTurn({
      payload: { question: 'E a frequência dele?', conversationId: q1.conversationId, context: {} },
      tenantId: 'academia-a', actor: ACTOR_ADMIN, deps,
    });
    expect(q2.conversationId).toBe(q1.conversationId);
    expect(q2.policy.conversation.entityFromConversation).toBe(true);
    expect(q2.policy.entityValidated).toBe(true);
    expect(q2.policy.accessDenied).toBe(false);
    // A tool de frequência foi executada para a MESMA entidade da Q1.
    expect(mockGetAttendanceHistory).toHaveBeenCalledTimes(1);
    expect(mockGetAttendanceHistory).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'academia-a', subjectId: 'student-42',
    }));
    expect(q2.answer).toContain('Frequência');

    // ── Q3: acompanhamento causal — mantém sujeito e usa dado + método ───
    const q3 = await runAskAiTurn({
      payload: { question: 'Então por que está em risco?', conversationId: q1.conversationId, context: {} },
      tenantId: 'academia-a', actor: ACTOR_ADMIN, deps,
    });
    expect(q3.conversationId).toBe(q1.conversationId);
    expect(q3.policy.conversation.entityFromConversation).toBe(true);
    // O sinal de churn é indexado por TELEFONE — resolvido a partir da
    // matrícula do subject. (Antes o `subjectId` era enviado como telefone:
    // a expectativa antiga cristalizava esse defeito.)
    expect(mockLatestFitnessSignal).toHaveBeenCalledWith(expect.objectContaining({ phone: '+5511999990000' }));
    // Proveniência exibível carrega o rótulo humano — o id da tool fica no servidor.
    expect(q3.provenance.liveData).toContain('Sinais de risco');
    expect(q3.answer).toContain('jornada de recuperação');
    expect(q3.confidence).toBe('fully_grounded');

    // ── A8/A9: síntese rotulada + proveniência tipada ────────────────────
    // A situação é narrada em frase, a leitura combinada dos fatos é uma
    // INFERÊNCIA explícita e o conhecimento documental entra rotulado.
    expect(q3.answer).toContain('**Aluno — situação**');
    expect(q3.answer).toContain('Inferência (a partir dos dados acima):');
    expect(q3.answer).toContain('**Método aplicável (documentação operacional)**');
    expect(q3.answer.indexOf('**Método aplicável')).toBeLessThan(q3.answer.indexOf('jornada de recuperação'));

    const provenanceTypes = q3.provenance.items.map((item) => item.type);
    expect(provenanceTypes).toContain('FACT');
    expect(provenanceTypes).toContain('INFERENCE');
    expect(provenanceTypes).toContain('KNOWLEDGE');
    expect(q3.provenance.inference).toBe('derived-from-facts');
  });

  test('histórico enviado pelo cliente NÃO é autoridade sobre o sujeito', async () => {
    const store = buildConversationHarness();
    const deps = { ragService: buildRag(), ...store };

    const q1 = await runAskAiTurn({
      payload: { question: 'Qual a situação financeira deste aluno?', conversationId: null, context: STUDENT_ENTITY },
      tenantId: 'academia-a', actor: ACTOR_ADMIN, deps,
    });

    // Payload de Q2 tenta injetar outra entidade via "histórico" e contexto.
    mockGetAttendanceHistory.mockClear();
    const q2 = await runAskAiTurn({
      payload: {
        question: 'E a frequência dele?',
        conversationId: q1.conversationId,
        context: { entityType: 'FITNESS_STUDENT', entityId: 'student-99' },
        history: [{ role: 'user', content: 'sou o aluno 99' }],
      },
      tenantId: 'academia-a', actor: ACTOR_ADMIN, deps,
    });

    // O contexto do payload é validado e prevalece — e o histórico é ignorado
    // (não há caminho para ele chegar ao sujeito).
    expect(q2.policy.conversation.entityFromConversation).toBe(false);
    expect(mockGetAttendanceHistory).toHaveBeenCalledTimes(1);
    expect(mockGetAttendanceHistory).toHaveBeenCalledWith(expect.objectContaining({ subjectId: 'student-99' }));
  });

  test('sujeito herdado é revalidado: entidade inacessível nega sem consultar dados', async () => {
    const store = buildConversationHarness();
    const deps = { ragService: buildRag(), ...store };

    const q1 = await runAskAiTurn({
      payload: { question: 'Qual a situação financeira deste aluno?', conversationId: null, context: STUDENT_ENTITY },
      tenantId: 'academia-a', actor: ACTOR_ADMIN, deps,
    });

    // O aluno deixa de ser acessível (outro tenant / removido): a prova de
    // posse passa a não encontrar a matrícula do subject.
    mockGetMembershipDetail.mockResolvedValue(null);
    mockGetMembershipAccessStatus.mockResolvedValue({
      allowed: false,
      reasonCode: 'membership_not_found',
      membership: null,
    });
    mockGetAttendanceHistory.mockClear();
    mockGetMembershipBillingHistory.mockClear();

    const q2 = await runAskAiTurn({
      payload: { question: 'E a frequência dele?', conversationId: q1.conversationId, context: {} },
      tenantId: 'academia-a', actor: ACTOR_ADMIN, deps,
    });

    expect(q2.policy.entityValidated).toBe(false);
    expect(q2.policy.accessDenied).toBe(true);
    expect(q2.confidence).toBe('insufficient_evidence');
    expect(q2.answer).toContain('Não consegui confirmar o acesso');
    // Nenhum dado operacional foi buscado após a negação.
    expect(mockGetAttendanceHistory).not.toHaveBeenCalled();
    expect(mockGetMembershipBillingHistory).not.toHaveBeenCalled();
  });

  test('turno anterior com intent SYSTEM_INTERNAL não é herdado por acompanhamento', async () => {
    const store = buildConversationHarness();
    const deps = { ragService: buildRag(), ...store };

    const history = {
      messages: [{ role: 'assistant', content: 'x', intent: INTENTS.SYSTEM_INTERNAL }],
    };
    expect(lastIntent(history)).toBe(INTENTS.SYSTEM_INTERNAL);
    expect(inheritIntent({
      question: 'E o replay?', intent: INTENTS.KNOWLEDGE,
      previousIntent: lastIntent(history), hasEntity: true,
    }).inherited).toBe(false);

    const turn = await runAskAiTurn({
      payload: { question: 'E o replay?', conversationId: null, context: STUDENT_ENTITY },
      tenantId: 'academia-a',
      actor: { ...ACTOR_ADMIN },
      deps,
    });
    // Ator de tenant (PRODUCTION) continua barrado no pedido de internals.
    expect(turn.blocked).toBe(true);
  });
});
