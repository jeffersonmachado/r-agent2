'use strict';

/**
 * MISSÃO ASK_AI_AGENT — T-A6 (proveniência do turno persistido).
 *
 * RED medido em 2026-09-15: `conversationStore.appendTurn` persistia o turno
 * assistente com sources/facts/intent, mas SEM `answerId` (nenhuma referência
 * determinística da resposta) e SEM `toolCalls` (nenhum registro exibível das
 * consultas executadas) — a trilha de auditoria do turno não conseguia
 * apontar "qual resposta" nem "quais consultas a sustentaram".
 *
 * Regras fixadas:
 *   - `answerId` é DETERMINÍSTICO (deriva de conversa + número do turno) e
 *     estável entre processos — nunca aleatório;
 *   - `toolCalls` carrega rótulo humano + status (`ok`/`failed`/`denied`),
 *     NUNCA o id da tool;
 *   - `buildPromptHistory` continua projetando apenas role/content/intent:
 *     answerId, toolCalls, sources e facts não entram no prompt;
 *   - `lastAssistantTurn` expõe answerId/toolCalls para a proveniência do
 *     turno seguinte.
 */

jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const conversationStore = require('../../../api/services/askAi/conversationStore');

function fakeConversation(id = 'conv_prov') {
  return {
    id,
    tenantKey: 'tenant-x',
    userKey: 'u1',
    messages: [],
    summary: null,
    turnCount: 0,
    context: {},
    changed: jest.fn(),
    save: jest.fn(async function save() { return this; }),
  };
}

function assistantMessages(conversation) {
  return conversation.messages.filter((message) => message.role === 'assistant');
}

describe('T-A6 — answerId determinístico', () => {
  it('todo turno assistente persistido ganha answerId estável', async () => {
    const conversation = fakeConversation();
    await conversationStore.appendTurn({ conversation, question: 'q1', answer: 'a1' });
    const [message] = assistantMessages(conversation);
    expect(typeof message.answerId).toBe('string');
    expect(message.answerId).toMatch(/^ans_[0-9a-f]{16}$/);
  });

  it('mesma conversa + mesmo turno → mesmo answerId (determinístico, não aleatório)', async () => {
    const first = fakeConversation('conv_estavel');
    const second = fakeConversation('conv_estavel');
    await conversationStore.appendTurn({ conversation: first, question: 'q', answer: 'a' });
    await conversationStore.appendTurn({ conversation: second, question: 'q', answer: 'a' });
    expect(assistantMessages(first)[0].answerId).toBe(assistantMessages(second)[0].answerId);
  });

  it('turnos diferentes da mesma conversa → answerIds diferentes', async () => {
    const conversation = fakeConversation();
    await conversationStore.appendTurn({ conversation, question: 'q1', answer: 'a1' });
    await conversationStore.appendTurn({ conversation, question: 'q2', answer: 'a2' });
    const ids = assistantMessages(conversation).map((message) => message.answerId);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('T-A6 — toolCalls com rótulos humanos e status', () => {
  it('persiste toolCalls sem NUNCA carregar id de tool', async () => {
    const conversation = fakeConversation();
    await conversationStore.appendTurn({
      conversation,
      question: 'q',
      answer: 'a',
      toolCalls: [
        { label: 'Frequência', status: 'ok', toolId: 'askai.fitness.attendanceSummary' },
        { label: 'Histórico financeiro', status: 'denied', toolId: 'askai.billing.membershipHistory' },
      ],
    });
    const [message] = assistantMessages(conversation);
    expect(message.toolCalls).toEqual([
      { label: 'Frequência', status: 'ok' },
      { label: 'Histórico financeiro', status: 'denied' },
    ]);
    expect(JSON.stringify(message)).not.toMatch(/askai\.|toolId/);
  });

  it('status fora do vocabulário vira registro conservador (fail-closed)', async () => {
    const conversation = fakeConversation();
    await conversationStore.appendTurn({
      conversation,
      question: 'q',
      answer: 'a',
      toolCalls: [{ label: 'Frequência', status: 'executed_as_root' }],
    });
    const [message] = assistantMessages(conversation);
    expect(['ok', 'failed', 'denied']).toContain(message.toolCalls[0].status);
  });
});

describe('T-A6 — projeções de leitura', () => {
  it('buildPromptHistory segue projetando apenas role/content/intent', async () => {
    const conversation = fakeConversation();
    await conversationStore.appendTurn({
      conversation,
      question: 'q',
      answer: 'a',
      sources: [{ sourceType: 'KNOWLEDGE_DOCUMENT', label: 'Manual', url: '/rag-documents?documentId=x' }],
      facts: [{ key: 'k', label: 'L', value: 'v' }],
      intent: 'KNOWLEDGE',
      toolCalls: [{ label: 'Frequência', status: 'ok' }],
    });
    const history = conversationStore.buildPromptHistory(conversation);
    for (const message of history.messages) {
      expect(Object.keys(message).sort()).toEqual(['content', 'intent', 'role']);
    }
  });

  it('lastAssistantTurn expõe answerId e toolCalls do turno persistido', async () => {
    const conversation = fakeConversation();
    await conversationStore.appendTurn({
      conversation,
      question: 'q',
      answer: 'a',
      toolCalls: [{ label: 'Frequência', status: 'ok' }],
    });
    const turn = conversationStore.lastAssistantTurn(conversation);
    expect(turn.answerId).toMatch(/^ans_[0-9a-f]{16}$/);
    expect(turn.toolCalls).toEqual([{ label: 'Frequência', status: 'ok' }]);
  });
});
