'use strict';

/**
 * Ask AI — geração degradada nunca pode virar "resposta fundamentada".
 *
 * Defeito medido em 2026-10-08: quando o rag-service não conseguia sintetizar
 * (provider de LLM em 429/sem crédito), ele devolvia um trecho CRU de chunk e o
 * orquestrador o rotulava como `confidence: fully_grounded` — a pergunta
 * ("Como faço uma matrícula?") recebia um texto sobre outro assunto com
 * aparência de resposta pronta.
 *
 * Contrato fixado aqui (nos dois sentidos):
 *  - `metadata.generated === false`  → `source_only` (evidência, não resposta);
 *  - geração normal (campo ausente/true) → `fully_grounded` (comportamento
 *    anterior preservado para não mascarar o caminho saudável).
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { runAskAiTurn } = require('../../api/services/askAi/orchestrator');
const { INTENTS } = require('../../api/services/askAi/intentRouter');

const ACTOR = { id: 'u-ad', username: 'admin', role: 'admin', tenantId: 'academia-a' };

// Store conversacional fake (o real é Postgres; aqui só a semântica).
function buildConversationHarness() {
  const conversations = new Map();

  const openConversation = jest.fn(async ({ conversationId, tenantId, actor }) => {
    const mapKey = `${tenantId}::${actor.id}::${conversationId}`;
    if (conversationId) {
      const existing = conversations.get(mapKey);
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
      userKey: actor.id,
      context: {},
      messages: [],
      summary: null,
      save: jest.fn(async () => conversation),
    };
    conversations.set(`${tenantId}::${actor.id}::${conversation.id}`, conversation);
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

  return { openConversation, appendTurn };
}

const TEXTO_DEGRADADO = [
  'Não foi possível gerar a resposta agora: a geração de linguagem está indisponível.',
  'Sem síntese, segue o trecho mais relevante recuperado:',
  'no modal de detalhe esses passos aparecem marcados e cada um mostra a ação executada...',
].join('\n\n');

function buildRagDegradado() {
  return {
    queryRag: jest.fn(async () => ({
      success: true,
      response: TEXTO_DEGRADADO,
      sources: [{ documentId: 'src-docs-manual-journeys-fitness-html', title: 'Chunk 3', score: 0.51 }],
      confidence: 0.51,
      metadata: { chunksFound: 3, generated: false, degradationReason: 'llm_unavailable' },
    })),
  };
}

function buildRagSaudavel() {
  return {
    queryRag: jest.fn(async () => ({
      success: true,
      response: 'Para matricular um aluno: cadastre os dados, registre o pagamento e libere o acesso.',
      sources: [{ documentId: 'src-docs-manual-journeys-fitness-html', title: 'Chunk 3', score: 0.71 }],
      confidence: 0.71,
      metadata: { chunksFound: 3, generated: true, degradationReason: null },
    })),
  };
}

describe('ask-ai — geração degradada não vira resposta fundamentada', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rag-service sem síntese → confidence source_only e texto declarado', async () => {
    const turn = await runAskAiTurn({
      payload: { question: 'Como faço uma matrícula?', conversationId: null },
      tenantId: 'academia-a',
      actor: ACTOR,
      deps: { ragService: buildRagDegradado(), ...buildConversationHarness() },
    });

    expect(turn.intent).toBe(INTENTS.PROCEDURE);
    expect(turn.confidence).toBe('source_only');
    expect(turn.confidence).not.toBe('fully_grounded');
    // A resposta mantém o aviso de que não houve síntese (nada de resposta fingida).
    expect(turn.answer).toContain('Não foi possível gerar a resposta agora');
    expect(turn.sources.some((s) => s.sourceType === 'KNOWLEDGE_DOCUMENT')).toBe(true);
  });

  test('geração normal continua fully_grounded (controle)', async () => {
    const turn = await runAskAiTurn({
      payload: { question: 'Como faço uma matrícula?', conversationId: null },
      tenantId: 'academia-a',
      actor: ACTOR,
      deps: { ragService: buildRagSaudavel(), ...buildConversationHarness() },
    });

    expect(turn.confidence).toBe('fully_grounded');
    expect(turn.answer).not.toContain('Não foi possível gerar a resposta agora');
  });
});
