'use strict';

/**
 * Escopo de CONHECIMENTO do copiloto — Global/Tenant RAG + isolamento SYSTEM.
 *
 * Os testes do Knowledge Plane provam o roteador PURO; este teste prova a
 * LIGAÇÃO do copiloto a ele (o que a função pura sozinha não prova):
 *
 *   - o orquestrador pede recuperação ao `ragService` com o tenant da SESSÃO e
 *     NUNCA declara domínio/scope — o payload do chamador não amplia escopo;
 *   - toda intenção que exige conhecimento resolve para OPERATIONAL, e o
 *     escopo OPERATIONAL une o conhecimento global (`RAG_GLOBAL_OPERATIONAL_TENANT`)
 *     ao do tenant atual;
 *   - o domínio SYSTEM é inalcançável pelo copiloto: PRODUCTION é bloqueado
 *     antes do RAG e um pedido técnico de SUPPORT/DEVELOPMENT não consulta
 *     conhecimento nem dados vivos.
 *
 * Sem banco: a conversa é injetada e os runners de domínio não são acionados
 * (nenhuma pergunta deste teste tem entidade).
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { runAskAiTurn } = require('../../api/services/askAi/orchestrator');
const { classifyIntent, needsKnowledge, INTENTS } = require('../../api/services/askAi/intentRouter');
const {
  resolveKnowledgeContext,
  resolveRetrievalTenantKeys,
  getGlobalOperationalTenant,
} = require('../../src/core/knowledge-plane');

const TENANT = 'academia-a';
const OTHER_TENANT = 'academia-b';
const GLOBAL_TENANT = getGlobalOperationalTenant();

const QUESTION_PROCEDURE = 'Como configuro uma campanha?';
const QUESTION_SYSTEM = 'Como está o replay da última QA Wave?';

const ACTOR_PRODUCTION = { id: 'u-prod', username: 'gestor', role: 'admin', tenantId: TENANT };
const ACTOR_SUPPORT = { id: 'u-sup', username: 'sup', role: 'agent', tenantId: TENANT, platformRole: 'support_n2' };
const ACTOR_DEVELOPMENT = { id: 'u-dev', username: 'dev', role: 'agent', tenantId: TENANT, platformRole: 'engineer' };

/** Store conversacional fake (o real é Postgres; aqui só a semântica do turno). */
function buildConversationHarness() {
  let counter = 0;
  const openConversation = jest.fn(async ({ context }) => ({
    id: `conv_${(counter += 1)}`,
    context: context || {},
    messages: [],
    summary: null,
  }));
  const appendTurn = jest.fn(async ({ conversation, question, answer }) => {
    conversation.messages = [
      ...conversation.messages,
      { role: 'user', content: question },
      { role: 'assistant', content: answer },
    ];
    return { conversation, window: conversation.messages, summary: conversation.summary };
  });
  return { openConversation, appendTurn };
}

function buildRag() {
  return {
    queryRag: jest.fn(async () => ({
      success: true,
      response: 'Roteiro operacional: contato ativo e oferta de reagendamento.',
      sources: [{ documentId: 'doc-1', title: 'Jornada de matrícula', score: 0.8 }],
    })),
  };
}

describe('Ask AI — recuperação OPERATIONAL (global ∪ tenant)', () => {
  test('pede ao ragService o tenant da SESSÃO e nunca declara domínio/scope', async () => {
    const { openConversation, appendTurn } = buildConversationHarness();
    const rag = buildRag();

    await runAskAiTurn({
      payload: {
        question: QUESTION_PROCEDURE,
        context: { route: '/campaigns', module: 'campaigns', pageType: 'index' },
      },
      tenantId: TENANT,
      actor: ACTOR_PRODUCTION,
      deps: { ragService: rag, openConversation, appendTurn },
    });

    expect(rag.queryRag).toHaveBeenCalledTimes(1);
    const [query, tenantId, context, filters] = rag.queryRag.mock.calls[0];
    // O tenant vem da SESSÃO (autoridade), nunca do payload.
    expect(tenantId).toBe(TENANT);
    expect(context).toEqual(expect.objectContaining({ source: 'ask-ai' }));
    // Escopo é derivado no servidor: o copiloto não pede domínio nem scope.
    expect(filters.domain).toBeUndefined();
    expect(filters.scope).toBeUndefined();
    expect(String(query)).toMatch(/campanha/i);
  });

  test('o escopo derivado dessa recuperação é OPERATIONAL e une o conhecimento global', () => {
    const { scope } = resolveKnowledgeContext({ principal: { classification: 'PRODUCTION' } });
    expect(scope.domain).toBe('OPERATIONAL');

    const keys = resolveRetrievalTenantKeys({ scope, tenantId: TENANT });
    expect(keys).toEqual([TENANT, GLOBAL_TENANT]);
    expect(keys).not.toContain(OTHER_TENANT);
  });

  test('classificação permissiva (SUPPORT/DEVELOPMENT) continua em OPERATIONAL', async () => {
    for (const actor of [ACTOR_SUPPORT, ACTOR_DEVELOPMENT]) {
      const { openConversation, appendTurn } = buildConversationHarness();
      const rag = buildRag();

      await runAskAiTurn({
        payload: { question: QUESTION_PROCEDURE, context: {} },
        tenantId: TENANT,
        actor,
        deps: { ragService: rag, openConversation, appendTurn },
      });

      const filters = rag.queryRag.mock.calls[0][3];
      expect(filters.domain).toBeUndefined();
      expect(filters.scope).toBeUndefined();

      const { scope } = resolveKnowledgeContext({ principal: { classification: actor.platformRole === 'engineer' ? 'DEVELOPMENT' : 'SUPPORT' } });
      expect(scope.domain).toBe('OPERATIONAL');
      expect(resolveRetrievalTenantKeys({ scope, tenantId: TENANT })).toEqual([TENANT, GLOBAL_TENANT]);
    }
  });
});

describe('Ask AI — isolamento do domínio SYSTEM', () => {
  test('PRODUCTION não alcança o domínio SYSTEM: bloqueio ANTES de qualquer RAG', async () => {
    const { openConversation, appendTurn } = buildConversationHarness();
    const rag = buildRag();

    const turn = await runAskAiTurn({
      payload: { question: QUESTION_SYSTEM, context: {} },
      tenantId: TENANT,
      actor: ACTOR_PRODUCTION,
      deps: { ragService: rag, openConversation, appendTurn },
    });

    expect(turn.blocked).toBe(true);
    expect(turn.intent).toBe(INTENTS.SYSTEM_INTERNAL);
    expect(rag.queryRag).not.toHaveBeenCalled();
    expect(turn.sources).toEqual([]);
    expect(turn.facts).toEqual([]);
  });

  test('SUPPORT/DEVELOPMENT: pedido técnico não consulta conhecimento nem dados', async () => {
    for (const actor of [ACTOR_SUPPORT, ACTOR_DEVELOPMENT]) {
      const { openConversation, appendTurn } = buildConversationHarness();
      const rag = buildRag();

      const turn = await runAskAiTurn({
        payload: { question: QUESTION_SYSTEM, context: {} },
        tenantId: TENANT,
        actor,
        deps: { ragService: rag, openConversation, appendTurn },
      });

      expect(turn.intent).toBe(INTENTS.SYSTEM_INTERNAL);
      expect(turn.blocked).toBe(false);
      expect(rag.queryRag).not.toHaveBeenCalled();
      expect(turn.facts).toEqual([]);
      expect(turn.answer).toMatch(/Não consegui encontrar informação/);
    }
  });

  test('SYSTEM nunca recebe a chave global e jamais é derivado pelo copiloto', () => {
    // O domínio SYSTEM nunca une o conhecimento global (segregação entre tenants).
    expect(resolveRetrievalTenantKeys({ scope: { domain: 'SYSTEM' }, tenantId: TENANT }))
      .toEqual([TENANT]);

    // Nenhuma intenção que exige conhecimento resolve para SYSTEM, porque o
    // copiloto não declara domínio — o roteador deriva OPERATIONAL.
    const questions = [
      'Como faço uma matrícula?',
      'Onde encontro a ficha do aluno?',
      'Por que este aluno está em risco?',
      'Explique a política de cancelamento.',
    ];
    for (const question of questions) {
      const { intent } = classifyIntent({ question, context: {}, classification: 'DEVELOPMENT' });
      if (!needsKnowledge(intent)) continue;
      const { scope } = resolveKnowledgeContext({ principal: { classification: 'DEVELOPMENT' } });
      expect(scope.domain).toBe('OPERATIONAL');
    }

    // SYSTEM explícito é negado a PRODUCTION (fail-closed).
    const denied = resolveKnowledgeContext({
      principal: { classification: 'PRODUCTION' },
      requestedDomain: 'SYSTEM',
    });
    expect(denied.allowed).toBe(false);
  });
});
