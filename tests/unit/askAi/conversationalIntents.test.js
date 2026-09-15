'use strict';

/**
 * MISSÃO ASK_AI_AGENT — T-A7 (prova das intenções conversacionais).
 *
 * Cobre as intenções resolvidas pelo ESTADO (tela atual / turno anterior),
 * introduzidas na fatia conversacional do copiloto:
 *   - SCREEN_CONTEXT              ("em que tela estou?")
 *   - ASSISTANT_KNOWLEDGE_SCOPE   ("o que você sabe?")
 *   - ASSISTANT_SOURCE_FOLLOWUP   ("qual foi a fonte?")
 *   - ASSISTANT_PRIOR_PROVENANCE  ("por que você respondeu isso?")
 *
 * Garantias fixadas:
 *   - nenhuma delas consome RAG nem dado vivo;
 *   - SCREEN_CONTEXT nunca expõe rota, UUID, id de entidade ou tenant;
 *   - SOURCE_FOLLOWUP devolve EXATAMENTE as fontes do turno anterior (sem
 *     re-RAG) e, fora da conversa original, não atribui fonte errada;
 *   - PRIOR_PROVENANCE explica com evidências, sem prompt de sistema, cadeia
 *     de raciocínio ou mecânica de ferramenta.
 */

jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const {
  classifyIntent,
  needsKnowledge,
  needsOperationalData,
  isConversationalIntent,
  INTENTS,
} = require('../../../api/services/askAi/intentRouter');
const {
  buildScreenContextAnswer,
  buildAssistantSelfDescription,
} = require('../../../api/services/askAi/assistantSelfDescription');
const { runAskAiTurn } = require('../../../api/services/askAi/orchestrator');

const ACTOR = { id: 'u1', username: 'op', role: 'operator', tenantId: 'tenant-x' };

/** Store conversacional com a mesma semântica do real (persistência por conversa). */
function buildStore() {
  const conversations = new Map();
  return {
    conversations,
    openConversation: async ({ conversationId, tenantId, actor, context }) => {
      const key = `${tenantId}::${actor.id}::${conversationId || 'nova'}`;
      if (conversationId) {
        const existing = conversations.get(key);
        if (!existing) {
          const error = new Error('Conversa não encontrada');
          error.code = 'NOT_FOUND';
          throw error;
        }
        return existing;
      }
      const conversation = {
        id: `conv_${conversations.size + 1}`,
        messages: [],
        summary: null,
        context: context || {},
        turnCount: 0,
      };
      conversations.set(`${tenantId}::${actor.id}::${conversation.id}`, conversation);
      return conversation;
    },
    appendTurn: async ({ conversation, question, answer, sources = [], facts = [], intent = null, toolCalls = [] }) => {
      conversation.messages.push(
        { role: 'user', content: question },
        {
          role: 'assistant', content: answer, sources, facts, intent, toolCalls,
          answerId: `ans_${conversation.turnCount + 1}`,
        },
      );
      conversation.turnCount += 1;
      return { conversation, window: conversation.messages, summary: null };
    },
  };
}

function buildRagSpy(sources = []) {
  return {
    queryRag: jest.fn(async () => ({
      success: true,
      response: 'A renovação segue a jornada documentada.',
      sources,
    })),
  };
}

// ── SCREEN_CONTEXT ──────────────────────────────────────────────────────────

describe('T-A7 SCREEN_CONTEXT', () => {
  it.each([
    'Em que tela estou?',
    'Onde eu estou?',
    'Você sabe em que página eu estou?',
  ])('classifica "%s" como SCREEN_CONTEXT', (question) => {
    const { intent } = classifyIntent({ question, classification: 'PRODUCTION' });
    expect(intent).toBe(INTENTS.SCREEN_CONTEXT);
    expect(isConversationalIntent(intent)).toBe(true);
    expect(needsKnowledge(intent)).toBe(false);
    expect(needsOperationalData(intent)).toBe(false);
  });

  it('com contexto responde o rótulo humano da tela', () => {
    const { answer, grounded } = buildScreenContextAnswer({
      context: { module: 'inbox', pageType: 'list', route: '/inbox' },
    });
    expect(grounded).toBe(true);
    expect(answer).toContain('atendimento (caixa de entrada)');
  });

  it('sem contexto diz que não tem — nunca inventa a tela', () => {
    const { answer, grounded } = buildScreenContextAnswer({ context: {} });
    expect(grounded).toBe(false);
    expect(answer).toMatch(/não tenho contexto suficiente/i);
  });

  it('contexto hostil não vaza rota, UUID, id de entidade nem tenant', () => {
    const hostile = {
      module: 'inbox',
      pageType: 'detail',
      route: '/dev/qa-waves?tenant=tenant-secreto',
      entityType: 'CONVERSATION',
      entityId: '550e8400-e29b-41d4-a716-446655440000',
      workspaceEntityId: 'we-99',
    };
    const { answer } = buildScreenContextAnswer({ context: hostile });
    expect(answer).not.toContain('/dev');
    expect(answer).not.toContain('/inbox');
    expect(answer).not.toContain('550e8400');
    expect(answer).not.toContain('we-99');
    expect(answer).not.toMatch(/tenant-secreto|tenantid/i);
    expect(answer).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });

  it('no turno orquestrado, SCREEN_CONTEXT não aciona RAG', async () => {
    const ragService = buildRagSpy();
    const store = buildStore();
    const turn = await runAskAiTurn({
      payload: { question: 'Em que tela estou?', context: { module: 'inbox', pageType: 'list' } },
      tenantId: 'tenant-x',
      actor: ACTOR,
      deps: { ragService, ...store },
    });
    expect(turn.intent).toBe(INTENTS.SCREEN_CONTEXT);
    expect(ragService.queryRag).not.toHaveBeenCalled();
    expect(turn.answer).toContain('atendimento');
  });
});

// ── ASSISTANT_KNOWLEDGE_SCOPE ───────────────────────────────────────────────

describe('T-A7 ASSISTANT_KNOWLEDGE_SCOPE', () => {
  it('"o que você sabe?" é escopo de conhecimento, NÃO capacidades', () => {
    const scope = classifyIntent({ question: 'O que você sabe?', classification: 'PRODUCTION' });
    expect(scope.intent).toBe(INTENTS.ASSISTANT_KNOWLEDGE_SCOPE);

    const capabilities = classifyIntent({ question: 'O que você pode fazer?', classification: 'PRODUCTION' });
    expect(capabilities.intent).toBe(INTENTS.ASSISTANT_CAPABILITIES);
  });

  it('as respostas das duas intenções são distintas', () => {
    const scope = buildAssistantSelfDescription({
      intent: INTENTS.ASSISTANT_KNOWLEDGE_SCOPE,
      availableTools: ['Frequência'],
      classification: 'PRODUCTION',
    });
    const capabilities = buildAssistantSelfDescription({
      intent: INTENTS.ASSISTANT_CAPABILITIES,
      availableTools: ['Frequência'],
      classification: 'PRODUCTION',
    });
    expect(scope.answer).not.toBe(capabilities.answer);
    expect(scope.answer).toMatch(/sobre o que eu sei/i);
  });

  it('ator PRODUCTION não ouve nada de superfície de engenharia', () => {
    const { answer } = buildAssistantSelfDescription({
      intent: INTENTS.ASSISTANT_KNOWLEDGE_SCOPE,
      classification: 'PRODUCTION',
    });
    expect(answer).not.toMatch(/engenharia|qa waves|replay|benchmark|validação de release/i);
  });

  it('ator privilegiado ouve o escopo adicional de engenharia', () => {
    const { answer } = buildAssistantSelfDescription({
      intent: INTENTS.ASSISTANT_KNOWLEDGE_SCOPE,
      classification: 'DEVELOPMENT',
    });
    expect(answer).toMatch(/documentação de engenharia/i);
  });
});

// ── ASSISTANT_SOURCE_FOLLOWUP ───────────────────────────────────────────────

describe('T-A7 ASSISTANT_SOURCE_FOLLOWUP', () => {
  const RAG_SOURCES = [
    { documentId: 'src-docs-roteiros-jornada-fitness-renovacao-md', title: 'Chunk 15', score: 0.71 },
  ];

  it('classifica "Qual foi a fonte da resposta?" como acompanhamento de fonte', () => {
    const { intent } = classifyIntent({
      question: 'Qual foi a fonte da resposta?',
      classification: 'PRODUCTION',
    });
    expect(intent).toBe(INTENTS.ASSISTANT_SOURCE_FOLLOWUP);
    expect(needsKnowledge(intent)).toBe(false);
  });

  it('Q1 com fontes → Q2 devolve EXATAMENTE as fontes do turno anterior, sem re-RAG', async () => {
    const ragService = buildRagSpy(RAG_SOURCES);
    const store = buildStore();

    const q1 = await runAskAiTurn({
      payload: { question: 'O que diz o roteiro de renovação?', context: {} },
      tenantId: 'tenant-x',
      actor: ACTOR,
      deps: { ragService, ...store },
    });
    expect(q1.sources.length).toBe(1);
    expect(ragService.queryRag).toHaveBeenCalledTimes(1);

    const q2 = await runAskAiTurn({
      payload: { question: 'Qual foi a fonte?', conversationId: q1.conversationId, context: {} },
      tenantId: 'tenant-x',
      actor: ACTOR,
      deps: { ragService, ...store },
    });

    expect(q2.intent).toBe(INTENTS.ASSISTANT_SOURCE_FOLLOWUP);
    // Sem re-RAG: a fonte vem do estado persistido, não de nova recuperação.
    expect(ragService.queryRag).toHaveBeenCalledTimes(1);
    expect(q2.sources).toEqual(q1.sources);
    expect(q2.answer).toContain(q1.sources[0].label);
  });

  it('fora da conversa original NÃO atribui fonte que não usou', async () => {
    const ragService = buildRagSpy(RAG_SOURCES);
    const store = buildStore();

    await runAskAiTurn({
      payload: { question: 'O que diz o roteiro de renovação?', context: {} },
      tenantId: 'tenant-x',
      actor: ACTOR,
      deps: { ragService, ...store },
    });

    // Conversa NOVA (sem conversationId): não há turno anterior para citar.
    const outra = await runAskAiTurn({
      payload: { question: 'Qual foi a fonte?', context: {} },
      tenantId: 'tenant-x',
      actor: ACTOR,
      deps: { ragService, ...store },
    });

    expect(outra.intent).toBe(INTENTS.ASSISTANT_SOURCE_FOLLOWUP);
    expect(outra.sources).toEqual([]);
    expect(outra.answer).toMatch(/não tenho uma resposta anterior/i);
  });

  it('turno anterior de dado vivo declara que não há documento citável', async () => {
    const store = buildStore();
    // Semeia a conversa com um turno de dado vivo (fatos, sem fontes).
    const conversation = await store.openConversation({
      tenantId: 'tenant-x', actor: ACTOR, context: {},
    });
    await store.appendTurn({
      conversation,
      question: 'Qual foi a última visita deste aluno?',
      answer: 'Última visita: 2026-09-01.',
      sources: [],
      facts: [{ key: 'lastVisit', label: 'Última visita', value: '2026-09-01' }],
      intent: 'OPERATIONAL_DATA',
      toolCalls: [{ label: 'Frequência', status: 'ok' }],
    });

    const turn = await runAskAiTurn({
      payload: { question: 'Qual foi a fonte?', conversationId: conversation.id, context: {} },
      tenantId: 'tenant-x',
      actor: ACTOR,
      deps: { ...store },
    });

    expect(turn.sources).toEqual([]);
    expect(turn.answer).toMatch(/dados vivos/i);
    expect(turn.answer).toMatch(/não veio de um documento/i);
  });
});

// ── ASSISTANT_PRIOR_PROVENANCE ──────────────────────────────────────────────

describe('T-A7 ASSISTANT_PRIOR_PROVENANCE', () => {
  it('classifica "Por que você respondeu isso?" como proveniência da resposta anterior', () => {
    const { intent } = classifyIntent({
      question: 'Por que você respondeu isso?',
      classification: 'PRODUCTION',
    });
    expect(intent).toBe(INTENTS.ASSISTANT_PRIOR_PROVENANCE);
    expect(needsKnowledge(intent)).toBe(false);
    expect(needsOperationalData(intent)).toBe(false);
  });

  it('explica com as evidências usadas: base, dados consultados e fontes', async () => {
    const ragService = buildRagSpy([
      { documentId: 'src-docs-roteiros-jornada-fitness-renovacao-md', title: 'Chunk 15', score: 0.71 },
    ]);
    const store = buildStore();

    const q1 = await runAskAiTurn({
      payload: { question: 'O que diz o roteiro de renovação?', context: {} },
      tenantId: 'tenant-x',
      actor: ACTOR,
      deps: { ragService, ...store },
    });

    const q2 = await runAskAiTurn({
      payload: { question: 'Por que você respondeu isso?', conversationId: q1.conversationId, context: {} },
      tenantId: 'tenant-x',
      actor: ACTOR,
      deps: { ragService, ...store },
    });

    expect(q2.intent).toBe(INTENTS.ASSISTANT_PRIOR_PROVENANCE);
    expect(q2.answer).toMatch(/foi montada a partir de/i);
    expect(q2.answer).toContain(q1.sources[0].label);
    // As fontes citadas são as do turno anterior — sem nova recuperação.
    expect(q2.sources).toEqual(q1.sources);
    expect(ragService.queryRag).toHaveBeenCalledTimes(1);
  });

  it('nunca expõe prompt de sistema, cadeia de raciocínio ou mecânica de tool', async () => {
    const ragService = buildRagSpy([
      { documentId: 'src-docs-roteiros-jornada-fitness-renovacao-md', title: 'Chunk 15', score: 0.71 },
    ]);
    const store = buildStore();
    const q1 = await runAskAiTurn({
      payload: { question: 'O que diz o roteiro de renovação?', context: {} },
      tenantId: 'tenant-x',
      actor: ACTOR,
      deps: { ragService, ...store },
    });
    const q2 = await runAskAiTurn({
      payload: { question: 'No que você se baseou?', conversationId: q1.conversationId, context: {} },
      tenantId: 'tenant-x',
      actor: ACTOR,
      deps: { ragService, ...store },
    });

    expect(q2.answer).not.toMatch(/prompt de sistema|system prompt|cadeia de raciocínio|chain.of.thought/i);
    expect(q2.answer).not.toMatch(/askai\.|toolId|queryRag|embedding|vetor/i);
  });

  it('sem turno anterior, declara que não há resposta para justificar', async () => {
    const store = buildStore();
    const turn = await runAskAiTurn({
      payload: { question: 'Por que você respondeu isso?', context: {} },
      tenantId: 'tenant-x',
      actor: ACTOR,
      deps: { ...store },
    });
    expect(turn.intent).toBe(INTENTS.ASSISTANT_PRIOR_PROVENANCE);
    expect(turn.answer).toMatch(/não tenho uma resposta anterior/i);
    expect(turn.sources).toEqual([]);
  });
});
