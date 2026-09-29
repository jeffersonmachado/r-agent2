'use strict';

/**
 * AI Control Plane Status — estado de runtime (singleton) da camada de
 * resiliência do AI control plane.
 *
 * Responsabilidades:
 * - Classificar os componentes do control plane por criticidade.
 * - Manter o status por componente (POLICY_ENGINE, MODEL_REGISTRY, ...).
 * - Manter circuit breakers por provider de IA (openai/anthropic/deepseek).
 * - Manter buffer limitado e priorizado de eventos críticos de auditoria.
 * - Agregar e reportar AI_CONTROL_PLANE_STATUS.
 *
 * A lógica pura/determinística fica em `engine/aiControlPlaneResilience.js`.
 * Este serviço só guarda estado e faz a fiação com logger/observabilidade.
 */

const {
  COMPONENT_CRITICALITY,
  COMPONENT_STATUS,
  EVENT_PRIORITY,
  createCircuitBreaker,
  classifyProviderError,
  createBoundedEventBuffer,
  aggregateControlPlaneStatus,
  canRunCriticalOperation,
} = require('../../engine/aiControlPlaneResilience');

const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Classificação de criticidade (confrontada com a arquitetura real)
// ---------------------------------------------------------------------------

/**
 * Mapeamento componente → criticidade (item 2).
 *
 * - POLICY_ENGINE → SAFETY_CRITICAL: política de acesso/principal/tenant
 *   fail-closed (principal.js, requireClassification, tenantAIService).
 *   Indisponível ⇒ não há base para estabelecer elegibilidade de modelo.
 * - MODEL_REGISTRY → ROUTING_CRITICAL: engine/aiProviderManager
 *   (providerRegistry). Sem ele não há rota homologada.
 * - MARKET_INTELLIGENCE → ECONOMIC_CRITICAL: degrada em LAST_KNOWN_GOOD,
 *   não bloqueia roteamento por si só (itens 10-11).
 * - BUDGET_MANAGER → ECONOMIC_CRITICAL: hard budget ⇒ FAIL CLOSED para
 *   gasto incerto (itens 13-14).
 * - RELEASE_MANAGER → ROUTING_CRITICAL: release ativa desconhecida bloqueia
 *   missão crítica (itens 22-23).
 * - DATABASE → SAFETY_CRITICAL: persistência obrigatória (item 15).
 * - OBSERVABILITY → OBSERVABILITY_CRITICAL: degrada sem derrubar tarefas
 *   simples, mas pode bloquear tarefa crítica não-auditável (itens 25-26).
 * - BENCHMARK_SERVICE → OPTIONAL: não impede operação com modelos
 *   homologados (item 27).
 */
const COMPONENT_DEFINITIONS = Object.freeze({
  POLICY_ENGINE: COMPONENT_CRITICALITY.SAFETY_CRITICAL,
  MODEL_REGISTRY: COMPONENT_CRITICALITY.ROUTING_CRITICAL,
  MARKET_INTELLIGENCE: COMPONENT_CRITICALITY.ECONOMIC_CRITICAL,
  BUDGET_MANAGER: COMPONENT_CRITICALITY.ECONOMIC_CRITICAL,
  RELEASE_MANAGER: COMPONENT_CRITICALITY.ROUTING_CRITICAL,
  DATABASE: COMPONENT_CRITICALITY.SAFETY_CRITICAL,
  OBSERVABILITY: COMPONENT_CRITICALITY.OBSERVABILITY_CRITICAL,
  BENCHMARK_SERVICE: COMPONENT_CRITICALITY.OPTIONAL,
});

/** @type {Record<string, string>} estado por componente (default UNKNOWN). */
const componentStatus = {};
for (const id of Object.keys(COMPONENT_DEFINITIONS)) {
  componentStatus[id] = COMPONENT_STATUS.UNKNOWN;
}

/** @type {Record<string, object>} circuit breakers por provider de IA. */
const providerBreakers = {};

/**
 * Última categoria de erro real (`classifyProviderError`) que levou este provider a
 * `recordFailure()`. Achado real (QA Mesh, execução canônica do pipeline oficial): sem
 * isto, TODA chamada bloqueada por circuito aberto lançava a mesma mensagem genérica
 * "indisponível (circuit breaker aberto)", não importa se a causa raiz foi uma
 * credencial ausente/inválida (condição de AMBIENTE, nunca deveria contar como falha
 * funcional bloqueante) ou uma instabilidade real do provider (falha funcional de
 * verdade). Guardado FORA do breaker genérico (`engine/aiControlPlaneResilience.js`,
 * primitivo reusado por outros consumidores como `src/core/mcp/tool-lifecycle.js`) —
 * nunca muda o contrato compartilhado, é estado auxiliar só deste consumidor.
 * @type {Record<string, {category: string, message: string}>}
 */
const providerLastFailureReason = {};

/** Buffer limitado e priorizado de eventos críticos de auditoria. */
let eventBuffer = createBoundedEventBuffer({
  maxEntries: parsePositiveInt(process.env.AI_CP_BUFFER_MAX_ENTRIES, 1000),
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parsePositiveInt(raw, fallback) {
  const value = parseInt(String(raw), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeLog(level, message, meta) {
  try {
    if (typeof logger[level] === 'function') logger[level](message, meta);
  } catch (_) {
    /* observabilidade nunca derruba o control plane */
  }
}

// ---------------------------------------------------------------------------
// Component status
// ---------------------------------------------------------------------------

function setComponentStatus(componentId, status) {
  const id = String(componentId || '').toUpperCase();
  if (!COMPONENT_DEFINITIONS[id]) return false;
  const normalized = COMPONENT_STATUS[status] ? status : COMPONENT_STATUS.UNKNOWN;
  const previous = componentStatus[id];
  if (previous !== normalized) {
    componentStatus[id] = normalized;
    safeLog('warn', '[AI Control Plane] componente mudou de status', {
      component: id,
      from: previous,
      to: normalized,
    });
  }
  return true;
}

function getComponentStatus(componentId) {
  const id = String(componentId || '').toUpperCase();
  return COMPONENT_DEFINITIONS[id] ? componentStatus[id] : COMPONENT_STATUS.UNKNOWN;
}

function getComponents() {
  return Object.keys(COMPONENT_DEFINITIONS).map((id) => ({
    id,
    criticality: COMPONENT_DEFINITIONS[id],
    status: componentStatus[id],
  }));
}

// ---------------------------------------------------------------------------
// Circuit breakers por provider (itens 39-43)
// ---------------------------------------------------------------------------

function getProviderBreaker(providerId) {
  const id = String(providerId || '').toLowerCase();
  if (!id) return null;
  if (!providerBreakers[id]) {
    providerBreakers[id] = createCircuitBreaker({
      failureThreshold: parsePositiveInt(process.env.AI_CP_BREAKER_FAILURE_THRESHOLD, 3),
      resetMs: parsePositiveInt(process.env.AI_CP_BREAKER_RESET_MS, 30000),
      recoveryProbeSuccessThreshold: parsePositiveInt(process.env.AI_CP_BREAKER_RECOVERY_PROBES, 2),
    });
  }
  return providerBreakers[id];
}

/**
 * Envolve a função `generate` de um provider com o circuit breaker central
 * daquele provider (item 40: estado compartilhado, cada worker não redescobre
 * a falha). Em circuito aberto, falha fechado sem ir à rede.
 *
 * @param {string} providerId
 * @param {(prompt: string, context: any) => Promise<any>} generateFn
 * @returns {(prompt: string, context: any) => Promise<any>}
 */
function wrapProviderGenerate(providerId, generateFn) {
  const breaker = getProviderBreaker(providerId);
  return async function resilientGenerate(prompt, context) {
    if (!breaker.acquire()) {
      const lastReason = providerLastFailureReason[providerId];
      const suffix = lastReason && lastReason.category === 'AUTH'
        ? ' Motivo da última falha real: credencial não configurada ou inválida (auth).'
        : '';
      const err = new Error(`Provider de IA '${providerId}' indisponível (circuit breaker aberto).${suffix}`);
      err.code = 'provider_circuit_open';
      throw err;
    }
    try {
      const result = await generateFn(prompt, context);
      breaker.recordSuccess();
      return result;
    } catch (err) {
      // Abort iniciado pelo CHAMADOR (deadline do Execution Deadline Manager, cancelamento por
      // NO_PROGRESS, lease perdido) não é contabilizado aqui: o timeout é registrado UMA vez, com
      // categoria, por `recordProviderTimeout` na borda do deadline; cancelamento cooperativo não é
      // falha de saúde do provider. Sem isto, um timeout contava em dobro (AbortError + registro).
      if (context && context.signal && context.signal.aborted) throw err;
      breaker.recordFailure();
      const { category } = classifyProviderError(err);
      providerLastFailureReason[providerId] = { category, message: err.message };
      // Registra falha de acesso a modelo no buffer (prioridade alta).
      bufferEvent(
        {
          type: 'model_access_failure',
          provider: providerId,
          category,
          at: new Date().toISOString(),
        },
        EVENT_PRIORITY.MODEL_ACCESS_FAILURE,
      );
      throw err;
    }
  };
}

/**
 * Timeout de provider como SINAL DE SAÚDE (§61): a expiração decidida pelo Execution Deadline
 * Manager alimenta o MESMO circuit breaker central do provider (não existe outro mecanismo).
 * Timeouts repetidos abrem o circuito e o roteamento passa a evitar o provider.
 */
function recordProviderTimeout(providerId, detail = {}) {
  const id = String(providerId || '').trim().toLowerCase();
  const breaker = getProviderBreaker(id);
  if (!breaker) return null;
  breaker.recordFailure();
  providerLastFailureReason[id] = { category: 'TIMEOUT', message: detail.message || 'PROVIDER_TIMEOUT' };
  bufferEvent(
    { type: 'model_access_failure', provider: id, category: 'TIMEOUT', at: new Date().toISOString() },
    EVENT_PRIORITY.MODEL_ACCESS_FAILURE,
  );
  return breaker.getState();
}

function getBreakerStates() {
  return Object.keys(providerBreakers).map((id) => ({
    provider: id,
    ...providerBreakers[id].getState(),
  }));
}

// ---------------------------------------------------------------------------
// Buffer de eventos (itens 17-19)
// ---------------------------------------------------------------------------

function bufferEvent(event, priority) {
  return eventBuffer.push(event, priority);
}

/**
 * Drena (e opcionalmente limpa) os eventos bufferizados, em ordem de
 * prioridade, para replay idempotente após recuperação.
 *
 * @param {boolean} [clear=true]
 * @returns {Array}
 */
function drainBufferedEvents(clear = true) {
  return eventBuffer.drain(clear);
}

function getBufferState() {
  return eventBuffer.getState();
}

// ---------------------------------------------------------------------------
// Agregação e report
// ---------------------------------------------------------------------------

function getControlPlaneStatus() {
  return aggregateControlPlaneStatus(getComponents());
}

/**
 * Restaura o estado do control plane ao default (UNKNOWN, sem breakers, sem
 * buffer). Uso em testes e em re-inicialização pós-recovery.
 */
function resetAiControlPlaneState() {
  for (const id of Object.keys(COMPONENT_DEFINITIONS)) {
    componentStatus[id] = COMPONENT_STATUS.UNKNOWN;
  }
  for (const key of Object.keys(providerBreakers)) {
    delete providerBreakers[key];
  }
  for (const key of Object.keys(providerLastFailureReason)) {
    delete providerLastFailureReason[key];
  }
  eventBuffer = createBoundedEventBuffer({
    maxEntries: parsePositiveInt(process.env.AI_CP_BUFFER_MAX_ENTRIES, 1000),
  });
}

/**
 * Report consolidado (itens 119, 123): status por componente e por domínio,
 * circuit breakers, buffer e snapshots. Não condensa tudo num único OK.
 *
 * @returns {object}
 */
function getControlPlaneReport() {
  const components = getComponents();
  const status = aggregateControlPlaneStatus(components);

  const componentHealth = {};
  for (const c of components) componentHealth[c.id] = c.status;

  return {
    aiControlPlaneStatus: status,
    criticalOperationAllowed: canRunCriticalOperation(components),
    componentHealth,
    componentCriticality: COMPONENT_DEFINITIONS,
    degradedComponents: components.filter((c) => c.status === COMPONENT_STATUS.DEGRADED).map((c) => c.id),
    blockedComponents: components.filter((c) => c.status === COMPONENT_STATUS.BLOCKED).map((c) => c.id),
    circuitBreakers: getBreakerStates(),
    eventBuffer: getBufferState(),
    safeMode: status === 'SAFE_MODE',
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  COMPONENT_DEFINITIONS,
  setComponentStatus,
  getComponentStatus,
  getComponents,
  getProviderBreaker,
  wrapProviderGenerate,
  recordProviderTimeout,
  getBreakerStates,
  bufferEvent,
  drainBufferedEvents,
  getBufferState,
  getControlPlaneStatus,
  getControlPlaneReport,
  resetAiControlPlaneState,
};
