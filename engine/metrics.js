/**
 * Coleta de métricas por nó / passo de execução.
 *
 * Regras de design:
 * - Métricas NÃO afetam a execução:
 *   - Qualquer erro na coleta é capturado e ignorado.
 *   - A função principal de execução (executeStep) nunca depende
 *     do resultado da coleta.
 * - Coleta assíncrona:
 *   - A chamada ao coletor é feita de forma assíncrona (fire & forget).
 * - Separadas por tenant:
 *   - Cada evento de métrica inclui tenantId, flowId e flowVersion.
 * - Inclui uso de IA:
 *   - Eventos relacionados a IA (AI_REQUESTED, AI_RESPONSE, AI_ERROR)
 *     são marcados explicitamente.
 */

/**
 * @typedef {import('./flowTypes').ConversationState} ConversationState
 * @typedef {import('./flowTypes').EngineEvent} EngineEvent
 * @typedef {import('./flowTypes').CompiledFlow} CompiledFlow
 * @typedef {import('./flowTypes').EngineStepOutput} EngineStepOutput
 */

/**
 * Estrutura de um evento de métrica emitido pela engine.
 *
 * Observação:
 * - É uma estrutura simples, facilmente transformável para
 *   formatos específicos (Prometheus, logs, etc.) pelo coletor.
 *
 * @typedef {Object} MetricEvent
 * @property {string} tenantId
 * @property {string} flowId
 * @property {number} flowVersion
 * @property {string} sessionId
 * @property {string|null} nodeId
 * @property {string} eventType       - Tipo do evento de engine (NODE_ENTER, MESSAGE_OUT, AI_ERROR, etc.)
 * @property {string} at              - Timestamp ISO do evento
 * @property {boolean} isAiEvent      - true para eventos relacionados à IA (AI_*)
 * @property {boolean} isAiError      - true para AI_ERROR
 */

/**
 * Função de coleta de métricas, configurável pela aplicação.
 *
 * @callback MetricsCollector
 * @param {MetricEvent[]} events
 * @returns {Promise<void>|void}
 */

/** @type {MetricsCollector|null} */
let collector = null;

/**
 * Define a função de coleta de métricas a ser usada pela engine.
 *
 * Decisão importante:
 * - A engine NUNCA chama diretamente sistemas externos de métricas.
 *   Ela apenas emite eventos para um coletor configurável.
 *
 * @param {MetricsCollector|null} fn
 */
function setMetricsCollector(fn) {
  collector = typeof fn === 'function' ? fn : null;
}

/**
 * Constrói eventos de métrica a partir dos EngineEvent gerados
 * em um passo de execução.
 *
 * @param {ConversationState} stateBefore
 * @param {CompiledFlow} compiledFlow
 * @param {EngineEvent[]} events
 * @returns {MetricEvent[]}
 */
function buildMetricEvents(stateBefore, compiledFlow, events) {
  if (!Array.isArray(events) || events.length === 0) return [];

  const tenantId = stateBefore.tenantId;
  const flowId = stateBefore.flowId;
  const flowVersion = stateBefore.flowVersion || compiledFlow.version;
  const sessionId = stateBefore.sessionId;

  return events.map((ev) => {
    const isAiEvent = typeof ev.type === 'string' && ev.type.startsWith('AI_');
    const isAiError = ev.type === 'AI_ERROR';

    /** @type {MetricEvent} */
    const metric = {
      tenantId,
      flowId,
      flowVersion,
      sessionId,
      nodeId: ev.nodeId || null,
      eventType: ev.type,
      at: ev.timestamp,
      isAiEvent,
      isAiError,
    };

    return metric;
  });
}

/**
 * Registra métricas para um passo de execução.
 *
 * Importante:
 * - Esta função é pensada para ser chamada pela camada de orquestração
 *   (ex.: executeStep), após a execução de um nó.
 * - A chamada ao coletor é assíncrona e erros são engolidos.
 *
 * @param {ConversationState} stateBefore
 * @param {CompiledFlow} compiledFlow
 * @param {EngineStepOutput} stepOutput
 */
function recordMetricsForStep(stateBefore, compiledFlow, stepOutput) {
  if (!collector) return;

  const metricEvents = buildMetricEvents(stateBefore, compiledFlow, stepOutput.events || []);
  if (metricEvents.length === 0) return;

  // Fire & forget: não aguardamos o resultado e capturamos
  // qualquer erro silenciosamente, para não afetar a execução.
  Promise.resolve()
    .then(() => collector && collector(metricEvents))
    .catch(() => {
      // Erros de métricas são ignorados de propósito.
    });
}

module.exports = {
  setMetricsCollector,
  recordMetricsForStep,
  _internal: {
    buildMetricEvents,
  },
};


