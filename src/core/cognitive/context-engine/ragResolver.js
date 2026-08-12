'use strict';

/**
 * RAG Resolver — integra a RAG como fonte de contexto no Cognitive Core.
 *
 * O resolver consulta a RAG (via ragService.queryRag) usando a mensagem/payload
 * do usuário e injeta o resultado no `context.rag`, disponível para todo o
 * pipeline: INTENT → AGENT SUPERVISOR → PLAN → EXECUTION ROUTER.
 *
 * Contrato de resolver (igual às demais fontes do Context Engine):
 *   async ({ tenantId, input }) => value | null
 *
 * Falha é best-effort: nunca lança; retorna null e deixa o trace do Context
 * Engine registrar o erro.
 */

/**
 * Cria o resolver RAG.
 *
 * @param {object} deps
 * @param {object} [deps.ragService] Serviço de query RAG (api/services/ragService).
 *   Se omitido, tenta carregar por require. Em ambiente de engine pura (sem
 *   api/), retorna null sem erro.
 * @param {object} [deps.logger] Logger opcional.
 * @param {number} [deps.minScore] Score mínimo para considerar a resposta útil (default 0.4).
 * @param {object} [deps.options] Opções extras passadas a queryRag.
 * @returns {{ rag: (ctx: {tenantId: string, input: object}) => Promise<object|null> }}
 */
function createRagResolver(deps = {}) {
  const { logger, minScore = 0.4, options = {} } = deps;

  let ragService = deps.ragService;
  if (!ragService) {
    try {
      // Require relativo à api/services — resolve quando executado no contexto da API.
      ragService = require('../../../../api/services/ragService');
    } catch {
      // Engine pura sem acesso à api/: resolver fica inativo (best-effort).
      ragService = null;
    }
  }

  async function rag({ tenantId, input }) {
    if (!ragService || typeof ragService.queryRag !== 'function') {
      return null;
    }

    const query = buildQuery(input);
    if (!query) {
      return null;
    }

    try {
      const result = await ragService.queryRag(query, tenantId, {
        channel: input.channel || null,
        actor: input.actor || null,
      }, {
        ...options,
        topK: options.topK ?? 5,
        minScore: options.minScore ?? minScore,
      });

      if (!result || !result.success || result.skipped) {
        return null;
      }

      return {
        query,
        response: result.response || null,
        confidence: result.confidence ?? null,
        sources: Array.isArray(result.sources)
          ? result.sources.map((s) => ({
              documentId: s.documentId || null,
              score: s.score ?? null,
              excerpt: typeof s.excerpt === 'string' ? s.excerpt.slice(0, 300) : null,
            }))
          : [],
        fromCache: Boolean(result.fromCache),
      };
    } catch (err) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('rag_context_resolver_failed', { message: err.message });
      }
      return null;
    }
  }

  return { rag };
}

/**
 * Constrói a query RAG a partir do input do Context Engine.
 * Prioriza uma pergunta explícita; senão, usa a mensagem do usuário.
 */
function buildQuery(input) {
  if (!input) return null;

  const explicit = input.ragQuery || input.knowledgeQuery;
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim().slice(0, 500);
  }

  const message = input.message;
  if (typeof message === 'string' && message.trim()) {
    return message.trim().slice(0, 500);
  }

  return null;
}

module.exports = { createRagResolver, buildQuery };
