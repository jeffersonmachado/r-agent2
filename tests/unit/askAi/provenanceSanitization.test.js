'use strict';

/**
 * MISSÃO ASK_AI_AGENT — T-A2 (sanitização da proveniência no payload).
 *
 * RED medido em 2026-09-15 (orchestrator.js):
 *   - `provenance.liveData` expunha toolIds crus (`askai.fitness.attendanceSummary`);
 *   - `policy.deniedTools` expunha ids de tool (`askai.billing.membershipHistory`);
 *   - `provenance.knowledge` expunha `title`/`documentId` crus do produtor RAG
 *     ("Chunk 15", `src-docs-manual-verticals-beauty-html`);
 *   e a rota (`handleAskAiRoute.js`) repassava `provenance`/`policy` verbatim.
 *
 * Regra fixada: o payload da API carrega RÓTULOS HUMANOS. Identificador interno
 * (toolId, documentId fora da URL de fonte, chunkId, slug de arquivo) fica no
 * servidor/auditoria. A URL de fonte (`/rag-documents?documentId=...`) é o
 * único canal sancionado que carrega o identificador do documento — é o
 * contrato consumido pelo visualizador interno.
 */

const { runAskAiTurn, buildProvenance } = require('../../../api/services/askAi/orchestrator');

const CHUNKED_RAG_SOURCES = [
  { documentId: 'src-docs-manual-verticals-beauty-html', title: 'Chunk 15', score: 0.66 },
  { documentId: 'src-docs-roteiros-jornada-fitness-renovacao-md', title: 'Chunk 3', score: 0.61 },
];

function makeStore() {
  const conversations = new Map();
  return {
    conversations,
    openConversation: async ({ conversationId, context }) => {
      const id = conversationId || 'conv_sanitizacao';
      if (!conversations.has(id)) {
        conversations.set(id, { id, messages: [], summary: null, context: context || {}, turnCount: 0 });
      }
      return conversations.get(id);
    },
    appendTurn: async ({ conversation, question, answer, sources = [], facts = [], intent = null }) => {
      conversation.messages.push(
        { role: 'user', content: question, createdAt: '2026-09-15T00:00:00.000Z' },
        { role: 'assistant', content: answer, sources, facts, intent, createdAt: '2026-09-15T00:00:00.000Z' },
      );
      conversation.turnCount += 1;
      return { conversation, window: conversation.messages, summary: conversation.summary };
    },
  };
}

function makeRagService() {
  return {
    queryRag: async () => ({
      success: true,
      response: 'A renovação segue a jornada documentada.',
      sources: CHUNKED_RAG_SOURCES,
    }),
  };
}

/** Simula o envelope que a rota devolve ao widget (handleAskAiRoute). */
function routeEnvelope(turn, tenantId = 'tenant-x') {
  return {
    success: true,
    conversationId: turn.conversationId,
    answer: turn.answer,
    sources: turn.sources,
    facts: turn.facts,
    intent: turn.intent,
    confidence: turn.confidence,
    provenance: turn.provenance,
    context: { entityValidated: turn.policy?.entityValidated === true },
    tenantId,
  };
}

/** Serializa o payload REMOVENDO as URLs de fonte (canal sancionado do documentId). */
function serializedWithoutSourceUrls(envelope) {
  const clone = JSON.parse(JSON.stringify(envelope));
  clone.sources = (clone.sources || []).map((source) => ({ ...source, url: '<url>' }));
  return JSON.stringify(clone);
}

describe('T-A2 — provenance/policy sem identificadores internos', () => {
  it('policy.deniedTools expõe rótulos humanos, nunca ids de tool (turno meta)', async () => {
    const store = makeStore();
    const turn = await runAskAiTurn({
      payload: { question: 'O que você pode fazer?', context: {} },
      tenantId: 'tenant-x',
      actor: { id: 'u1', username: 'op', role: 'operator' },
      deps: { openConversation: store.openConversation, appendTurn: store.appendTurn },
    });

    expect(turn.policy.deniedTools.length).toBeGreaterThan(0);
    for (const entry of turn.policy.deniedTools) {
      expect(String(entry)).not.toMatch(/^askai\./);
      expect(String(entry)).not.toMatch(/toolId/i);
    }
    expect(turn.policy.deniedTools).toContain('Histórico financeiro');
  });

  it('provenance.knowledge expõe rótulos amigáveis, nunca "Chunk N" nem slug de documento', async () => {
    const store = makeStore();
    const turn = await runAskAiTurn({
      payload: { question: 'O que diz o manual sobre a vertical de beleza?' },
      tenantId: 'tenant-x',
      actor: { id: 'u1', username: 'op', role: 'operator' },
      deps: {
        ragService: makeRagService(),
        openConversation: store.openConversation,
        appendTurn: store.appendTurn,
      },
    });

    expect(turn.provenance.knowledge.length).toBeGreaterThan(0);
    for (const label of turn.provenance.knowledge) {
      expect(String(label)).not.toMatch(/^chunk\s+\d+/i);
      expect(String(label)).not.toMatch(/src-docs/i);
      expect(String(label)).not.toMatch(/\.(md|html|json)$/i);
    }
    expect(turn.provenance.knowledge).toContain('Manual Verticals Beauty');
  });

  it('buildProvenance expõe rótulos de ferramenta em liveData, nunca toolId', () => {
    const provenance = buildProvenance({
      toolResults: [
        { toolId: 'askai.fitness.attendanceSummary', label: 'Frequência', found: true, failed: false },
        { toolId: 'askai.billing.membershipHistory', label: 'Histórico financeiro', found: true, failed: false },
        { toolId: 'askai.churn.latestSignal', label: 'Sinais de risco', found: false, failed: true },
      ],
      knowledgeSources: CHUNKED_RAG_SOURCES,
      synthesis: { provenance: { items: [], inference: null, recommendation: 'none' } },
    });

    expect(provenance.liveData).toEqual(['Frequência', 'Histórico financeiro']);
    expect(JSON.stringify(provenance)).not.toMatch(/askai\./);
    expect(JSON.stringify(provenance.knowledge)).not.toMatch(/chunk\s+\d+|src-docs/i);
  });

  it('payload serializado da rota não carrega toolId/documentId/chunkId fora da URL de fonte', async () => {
    const store = makeStore();
    const adversarialRag = {
      queryRag: async () => ({
        success: true,
        response: 'Resposta documental.',
        sources: [
          ...CHUNKED_RAG_SOURCES,
          // Tentativa de contrabandear identificadores pelos campos da fonte.
          { documentId: 'src-docs-x-md', title: 'toolId=askai.x chunkId=42', score: 0.5 },
        ],
      }),
    };
    const turn = await runAskAiTurn({
      payload: { question: 'O que diz o manual sobre a vertical de beleza?' },
      tenantId: 'tenant-x',
      actor: { id: 'u1', username: 'op', role: 'operator' },
      deps: {
        ragService: adversarialRag,
        openConversation: store.openConversation,
        appendTurn: store.appendTurn,
      },
    });

    const serialized = serializedWithoutSourceUrls(routeEnvelope(turn));
    expect(serialized).not.toMatch(/askai\./);
    expect(serialized).not.toMatch(/"toolId"/);
    expect(serialized).not.toMatch(/"documentId"/);
    expect(serialized).not.toMatch(/"chunkId"/);
    expect(serialized).not.toMatch(/chunk\s*\d+/i);
    expect(serialized).not.toMatch(/src-docs/i);
  });
});
