/**
 * Nó "rag_answer"
 *
 * Macro para resposta baseada em RAG, reutilizando o nó existente `ai`.
 *
 * Config (alto nível):
 * - topK: number (default 5)
 * - promptTemplate: string (template do prompt)
 * - temperature: number (UI-only por enquanto; o rag-service usa configuração global)
 *
 * Observação:
 * - Para compatibilidade com pipelines existentes, este handler retorna `output.type = 'ai'`.
 */

const { aiNodeHandler } = require('./aiNode');

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

/**
 * @param {import('../flowTypes').FlowNode} node
 * @param {import('../flowTypes').ConversationState} state
 * @param {{ aiProvider?: any, text?: string }} [input]
 * @param {import('../flowTypes').NodeDependencies} [deps]
 */
async function ragAnswerNodeHandler(node, state, input, deps = null) {
  const cfg = node.config || {};
  const topK =
    typeof cfg.topK === 'number' && Number.isFinite(cfg.topK) && cfg.topK > 0
      ? Math.floor(cfg.topK)
      : 5;

  // Se promptTemplate vier vazio, usamos um fallback simples: preferir `variables.context`, senão `variables.user_input`.
  const promptTemplate =
    typeof cfg.promptTemplate === 'string' && cfg.promptTemplate.trim()
      ? String(cfg.promptTemplate)
      : '{{context}}{{user_input}}';

  const outputVariable = `rag.${node.id}.text`;

  // Chama internamente o handler de `ai` com RAG habilitado.
  const aiLikeNode = {
    ...node,
    type: 'ai',
    config: {
      promptTemplate,
      outputVariable,
      // Força RAG sempre que disponível.
      useRag: true,
      ragTopK: topK,
      // Não alteramos temperature aqui (UI-only). maxTokens pode ser estendido no futuro.
    },
  };

  const res = await aiNodeHandler(aiLikeNode, state, input, deps);

  // Mantém o output como 'ai' para compatibilidade com quem envia mensagens.
  return res;
}

module.exports = {
  ragAnswerNodeHandler,
};

