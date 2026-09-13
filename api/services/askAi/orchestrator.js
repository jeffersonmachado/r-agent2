'use strict';

/**
 * Orquestrador do "Perguntar à IA" — copiloto operacional do RAP.
 *
 * ARQUITETURA ANTES (gap confirmado na auditoria de 2026-09-11):
 *   Pergunta → RAG estático → LLM → resposta
 *
 * ARQUITETURA ALVO:
 *   Pergunta
 *     ↓
 *   Conversation Context (persistido, janela limitada)
 *     + Screen Context (validado; nunca autoridade)
 *     + Entity Context (posse REVALIDADA no backend a cada turno)
 *     + Operational Data Tools (registro explícito, read-only, com RBAC)
 *     + Operational Knowledge (RAG OPERATIONAL: global ∪ tenant)
 *     ↓
 *   Answer Orchestrator (determinístico)
 *     ↓
 *   Resposta fundamentada + fontes + provenance + confidence
 *
 * Princípios não negociáveis:
 *  - O LLM nunca gera SQL nem escolhe consulta: tools são registradas.
 *  - Nenhuma tool é executada sem capabilidade do ator real.
 *  - Toda entrada não confiável (documento, campo de domínio) é neutralizada
 *    contra injeção e tem PII minimizada antes de compor a resposta.
 *  - Se não há fonte confirmando um estado, o copiloto NÃO afirma o estado.
 */

const { classifyIntent, needsKnowledge, needsOperationalData } = require('./intentRouter');
const { buildRegistry, executeTool } = require('./toolRegistry');
const { authorizeTools } = require('./toolAuthorization');
const { sanitizeUntrustedContent, detectInjection } = require('./injectionGuard');
const {
  resolveEffectiveContext,
  inheritIntent,
  lastIntent,
  buildRetrievalQuery,
  describeConversationUse,
} = require('./conversationContext');
const { buildGroundedSynthesis } = require('./synthesis');
const { resolveEntityOwnership, VERIFIABLE_ENTITY_TYPES } = require('./entityResolvers');
const { findAskAiTool } = require('./askAiToolCatalog');
const conversationStore = require('./conversationStore');
const { buildPromptHistory } = conversationStore;
const logger = require('../../utils/logger');
const { getClassificationForAgent } = require('../../modules/agent-os/experience-segregation');

const DEFAULT_MAX_TOOL_CALLS = 4;
const DEFAULT_MAX_RAG_QUERIES = 1;

// Mantido como alias do contrato de resolvers (fonte única em entityResolvers).
const ENTITY_TYPES_WITH_OWNERSHIP_CHECK = VERIFIABLE_ENTITY_TYPES;

// Marcadores de dado financeiro. O radical é flexível (`financeir\w*`) porque
// a forma natural do operador é o ADJETIVO ("situação financeira"), não o
// substantivo ("financeiro") — exigir fim de palavra depois de `financeir`
// deixava a pergunta canônica do copiloto sem consulta de cobrança.
const BILLING_MARKERS = /\b(?:inadimpl\w*|financeir\w*|quanto\s+(?:\w+\s+){0,3}?deve|fatura\w*|boleto|boletos|cobran[çc]a\w*|pagamento\w*|mensalidade\w*|pix|cart[ãa]o)\b/i;
const CHURN_MARKERS = /\b(?:churn|risco|evas[ãa]o|cancelamento|vai\s+(?:sair|embora))\b/i;

function intConfig(envName, fallback) {
  const raw = Number.parseInt(String(process.env[envName] || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function getToolBudget() {
  return intConfig('ASK_AI_MAX_TOOL_CALLS', DEFAULT_MAX_TOOL_CALLS);
}

function getRagBudget() {
  return intConfig('ASK_AI_MAX_RAG_QUERIES', DEFAULT_MAX_RAG_QUERIES);
}

// ---------------------------------------------------------------------------
// Seleção de tools (determinística, por intenção + entidade + marcadores)
// ---------------------------------------------------------------------------

/**
 * @returns {{required: Array<Object>, optionalDenied: boolean}}
 */
function selectTools({ intent, question, entity, registry }) {
  if (!entity || !needsOperationalData(intent)) {
    return { required: [] };
  }

  const required = [];
  const push = (tool) => {
    if (tool && !required.some((item) => item.id === tool.id)) required.push(tool);
  };

  push(registry.get('getFitnessStudentSummary'));
  push(registry.get('getAttendanceSummary'));

  if (BILLING_MARKERS.test(question)) push(registry.get('getBillingSummary'));
  if (CHURN_MARKERS.test(question)) push(registry.get('getChurnSignals'));

  return { required };
}

/**
 * Filtra as tools necessárias para as entidades suportadas.
 * Tools exigidas porém sem capabilidade do ator são reportadas — nunca
 * silenciosamente omitidas (senão o copiloto pareceria ignorar o pedido).
 */
function splitByAuthorization({ required, actor, deniedIds }) {
  const runnable = [];
  const denied = [];
  for (const tool of required) {
    if (deniedIds.has(tool.id)) {
      denied.push(tool);
    } else {
      runnable.push(tool);
    }
  }
  return { runnable, denied };
}

// ---------------------------------------------------------------------------
// Validação de posse da entidade (contexto do cliente não é autoridade)
// ---------------------------------------------------------------------------

/**
 * Revalida, no backend, que a entidade do contexto pertence ao tenant e é
 * acessível pelo ator. Um `entityId` de outro tenant é indistinguível de um
 * inexistente: nenhum dado é consultado e nenhuma existência é revelada.
 *
 * A prova de posse por tipo vive em `askAi/entityResolvers.js` — antes desta
 * extração o verificador consultava a membership usando o `subjectId` da tela
 * (identificador errado) e `CUSTOMER` reusava o mesmo lookup, então o contexto
 * de entidade nunca era reconhecido e o copiloto negava todo dado vivo.
 *
 * @returns {Promise<{validated: boolean, entity: Object|null, reason: string|null}>}
 */
async function validateEntityContext({ context, tenantId }) {
  if (!context?.entityType || !context?.entityId) {
    return { validated: true, entity: null, reason: 'no_entity_context' };
  }

  const entity = { type: context.entityType, id: context.entityId };
  const ownership = await resolveEntityOwnership({
    entityType: entity.type,
    entityId: entity.id,
    tenantId,
  });

  if (!ownership.owned) {
    return { validated: false, entity: null, reason: ownership.reason };
  }
  return { validated: true, entity, reason: null };
}

// ---------------------------------------------------------------------------
// Composição da resposta
// ---------------------------------------------------------------------------

function formatFactValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  if (typeof value === 'number') return String(value);
  const text = String(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function buildOperationalSection(toolResults) {
  const lines = [];
  const facts = [];
  for (const result of toolResults) {
    if (result.failed || !result.found) continue;
    for (const fact of result.facts || []) {
      const formatted = formatFactValue(fact.value);
      if (formatted === null) continue;
      const sanitized = sanitizeUntrustedContent(formatted);
      facts.push({ key: fact.key, label: fact.label, value: sanitized.text });
      lines.push(`- ${fact.label}: ${sanitized.text}`);
    }
  }
  return { facts, block: lines.join('\n') };
}

function buildAnswer({
  intent,
  entityLabel,
  operationalBlock,
  knowledgeAnswer,
  deniedTools,
  failedTools,
  accessDenied,
}) {
  // Compatibilidade: a composição real vive em `synthesis.js` (A8). Um
  // `operationalBlock` textual é convertido de volta para fatos rotulados.
  const facts = String(operationalBlock || '')
    .split('\n')
    .map((line) => line.replace(/^-\s*/, ''))
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(': ');
      if (separator === -1) return { key: line, label: line, value: '' };
      return { key: line.slice(0, separator), label: line.slice(0, separator), value: line.slice(separator + 2) };
    });

  return buildGroundedSynthesis({
    intent,
    entityLabel,
    facts,
    knowledgeAnswer,
    deniedTools,
    failedTools,
    accessDenied,
  }).answer;
}

function computeConfidence({ accessDenied, facts, knowledgeAnswer, failedTools }) {
  if (accessDenied) return 'insufficient_evidence';
  const hasFacts = facts.length > 0;
  const hasKnowledge = Boolean(knowledgeAnswer);
  if ((hasFacts || hasKnowledge) && failedTools.length === 0) return 'fully_grounded';
  if (hasFacts || hasKnowledge) return 'partially_grounded';
  return 'insufficient_evidence';
}

function buildSources({ toolResults, knowledgeSources }) {
  const sources = [];
  for (const result of toolResults) {
    if (result.failed || !result.found) continue;
    // Rótulo HUMANO do catálogo canônico: o usuário final lia o id técnico
    // (`askai.billing.membershipHistory`) — e o widget, sem campo amigável,
    // imprimia o objeto inteiro em JSON cru na resposta.
    const catalogTool = findAskAiTool(result.toolId);
    sources.push({
      type: 'OPERATIONAL_DATA',
      toolId: result.toolId,
      label: catalogTool?.label || result.toolId,
    });
  }
  for (const source of knowledgeSources || []) {
    sources.push({
      type: 'KNOWLEDGE_DOCUMENT',
      documentId: source.documentId || source.document_id || null,
      title: source.title || null,
      score: source.score ?? null,
    });
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------

/**
 * Executa um turno do copiloto.
 *
 * @param {Object} input
 * @param {Object} input.payload - Payload já validado por contextContract
 * @param {string} input.tenantId
 * @param {Object} input.actor - `req.agent`
 * @param {Object} input.deps - `{ ragService, logger? }`
 * @param {Function} [input.openConversation] - injeção p/ teste
 * @returns {Promise<Object>}
 */
async function runAskAiTurn({ payload, tenantId, actor, deps }) {
  const ragService = deps?.ragService;
  const openConversation = deps?.openConversation || conversationStore.openConversation;
  const appendTurn = deps?.appendTurn || conversationStore.appendTurn;

  const classification = getClassificationForAgent(actor);
  const registry = buildRegistry();

  const conversation = await openConversation({
    conversationId: payload.conversationId,
    tenantId,
    actor,
    context: payload.context,
  });

  // ── Histórico PERSISTIDO participa do turno ─────────────────────────────
  // O histórico enviado pelo cliente continua sendo ignorado: a janela vem da
  // conversa persistida (tenant + usuário) e o contexto de entidade vem do
  // turno anterior já validado server-side — e será revalidado de novo abaixo.
  const history = buildPromptHistory(conversation);
  const { context: effectiveContext, source: contextSource } = resolveEffectiveContext({
    payloadContext: payload.context,
    persistedContext: conversation.context,
  });

  const intentResult = classifyIntent({
    question: payload.question,
    context: effectiveContext,
    classification,
  });

  // Pedido sobre internals técnicos por ator PRODUCTION: negado ANTES de
  // qualquer recuperação (nunca toca o domínio SYSTEM).
  if (intentResult.blocked) {
    const answer = 'Não posso responder sobre conteúdo técnico interno da plataforma. Posso ajudar com a operação, roteiros e informações do seu negócio.';
    const stored = await appendTurn({
      conversation,
      question: payload.question,
      answer,
      intent: intentResult.intent,
      context: effectiveContext,
    });
    return {
      conversationId: conversation.id,
      answer,
      sources: [],
      facts: [],
      intent: intentResult.intent,
      confidence: 'insufficient_evidence',
      provenance: { liveData: [], knowledge: [], inference: 'none', recommendation: 'none' },
      // O contrato de resposta consumido pela rota exige `policy` em TODO
      // turno: sem ele, a recusa determinística virava HTTP 500 no boundary.
      policy: {
        classification,
        accessDenied: false,
        deniedTools: [],
        injectionDetected: false,
        entityValidated: false,
        conversation: describeConversationUse({
          history,
          effectiveContextSource: contextSource,
          inheritedIntent: false,
          hasSummary: Boolean(history.summary),
          context: effectiveContext,
        }),
      },
      historyWindow: stored.window.length,
      blocked: true,
    };
  }

  // Um acompanhamento curto herda a família de intenção do turno anterior —
  // "E a frequência dele?" não é uma pergunta apenas documental quando o
  // turno anterior era dado vivo + método.
  const inherited = inheritIntent({
    question: payload.question,
    intent: intentResult.intent,
    previousIntent: lastIntent(history),
    hasEntity: Boolean(effectiveContext?.entityId),
  });
  const intent = inherited.intent;

  // ── Contexto de entidade: revalidado server-side a cada turno ──────────
  const entityValidation = await validateEntityContext({
    context: effectiveContext,
    tenantId,
  });

  const entity = entityValidation.validated ? entityValidation.entity : null;
  const accessDenied = Boolean(effectiveContext?.entityId) && !entityValidation.validated;

  // ── Data tools: registro explícito + autorização por capabilidade ───────
  const { required } = selectTools({
    intent,
    question: payload.question,
    entity,
    registry,
  });

  const authorization = authorizeTools({ actor, tools: registry.all() });
  const deniedIds = new Set(authorization.denied.map((entry) => entry.toolId));
  const { runnable, denied } = splitByAuthorization({ required, actor, deniedIds });

  const toolResults = [];
  if (!accessDenied && entity) {
    const budget = getToolBudget();
    for (const tool of runnable.slice(0, budget)) {
      // eslint-disable-next-line no-await-in-loop
      const result = await executeTool(tool.id, { tenantId, actor, entity });
      toolResults.push({ ...result, label: tool.label });
      if (result.failed) {
        logger.warn('[ask-ai] Tool operacional falhou', {
          tenantId,
          toolId: tool.id,
          error: result.error,
        });
      }
    }
  }

  const operational = buildOperationalSection(toolResults);
  const failedTools = toolResults.filter((result) => result.failed).map((result) => ({ label: result.label }));

  // ── Conhecimento: RAG OPERATIONAL (global ∪ tenant). Nunca SYSTEM. ──────
  let knowledgeAnswer = null;
  let knowledgeSources = [];
  if (!accessDenied && needsKnowledge(intent) && getRagBudget() > 0 && ragService) {
    try {
      // Recuperação contextualizada: um acompanhamento curto não é buscado no
      // corpus sem sujeito — o assunto do turno anterior entra na consulta.
      const retrievalQuery = buildRetrievalQuery({ question: payload.question, history });
      const ragResult = await ragService.queryRag(
        retrievalQuery,
        tenantId,
        { actor, source: 'ask-ai' },
        { topK: 6, minScore: 0.45, maxTokens: 1000 },
      );
      if (ragResult?.success && typeof ragResult.response === 'string' && ragResult.response.trim()) {
        knowledgeAnswer = ragResult.response;
        knowledgeSources = Array.isArray(ragResult.sources) ? ragResult.sources : [];
      }
    } catch (error) {
      logger.warn('[ask-ai] Recuperação de conhecimento indisponível', {
        tenantId,
        error: error.message,
      });
    }
  }

  const entityLabel = entity ? 'Aluno' : null;
  const synthesis = buildGroundedSynthesis({
    intent,
    entityLabel,
    facts: operational.facts,
    knowledgeAnswer,
    deniedTools: denied,
    failedTools,
    accessDenied,
  });
  const answer = synthesis.answer;

  const confidence = computeConfidence({
    accessDenied,
    facts: operational.facts,
    knowledgeAnswer,
    failedTools,
  });

  const sources = buildSources({ toolResults, knowledgeSources });

  const stored = await appendTurn({
    conversation,
    question: payload.question,
    answer,
    sources,
    facts: operational.facts,
    intent,
    // Persiste o contexto EFETIVO (payload validado ou o herdado da conversa)
    // para dar continuidade ao turno seguinte — sempre revalidado lá.
    context: effectiveContext,
  });

  const docInjection = knowledgeSources.some(
    (source) => detectInjection(source?.excerpt || source?.content || '').detected,
  );

  return {
    conversationId: conversation.id,
    answer,
    sources,
    facts: operational.facts,
    intent,
    confidence,
    provenance: {
      liveData: toolResults.filter((r) => !r.failed && r.found).map((r) => r.toolId),
      knowledge: knowledgeSources.map((s) => s.title || s.documentId || null).filter(Boolean),
      inference: synthesis.provenance.inference ? 'derived-from-facts' : 'none',
      recommendation: synthesis.provenance.recommendation,
      // A9: cada item carrega o TIPO de afirmação (FACT/KNOWLEDGE/INFERENCE/
      // RECOMMENDATION) — nunca detalhe técnico desnecessário ao usuário.
      items: synthesis.provenance.items,
    },
    policy: {
      classification,
      accessDenied,
      deniedTools: denied.map((tool) => tool.id),
      injectionDetected: docInjection,
      entityValidated: entityValidation.validated,
      // Continuidade conversacional auditável (nunca valores de negócio).
      conversation: describeConversationUse({
        history,
        effectiveContextSource: contextSource,
        inheritedIntent: inherited.inherited,
        hasSummary: Boolean(history.summary),
        context: effectiveContext,
      }),
    },
    historyWindow: stored.window.length,
    blocked: false,
  };
}

module.exports = {
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_MAX_RAG_QUERIES,
  BILLING_MARKERS,
  CHURN_MARKERS,
  ENTITY_TYPES_WITH_OWNERSHIP_CHECK,
  selectTools,
  validateEntityContext,
  buildOperationalSection,
  buildAnswer,
  computeConfidence,
  buildSources,
  runAskAiTurn,
};
