/**
 * Dispara execucoes de flow a partir de eventos do event_ledger.
 *
 * Objetivo:
 * - Mapear eventos para flows via metadata.eventTriggers
 * - Executar o DAG de forma controlada (sem bloquear inputs humanos)
 * - Registrar no execution ledger (flow_executions/node_executions)
 */
'use strict';

const logger = require('../utils/logger');
const persistence = require('../../engine/services/persistenceServices');
const { getOrCompileFlow } = require('../../engine/compiledFlowCache');
const { executeStep } = require('../../engine/executeStep');
const { NodeRegistry } = require('../../engine/nodeRegistry');
const { getAiProviderForTenant } = require('./aiProviderManager.js');
const { startFlowExecution, finishFlowExecutionSafe, buildExecutionLedgerAdapter } = require('./flowExecutionLedgerService');

const {
  startNodeHandler,
  messageNodeHandler,
  userInputNodeHandler,
  routerNodeHandler,
  scheduleRouterNodeHandler,
  setVariableNodeHandler,
  handoffNodeHandler,
  endNodeHandler,
  optionsNodeHandler,
  subflowNodeHandler,
} = require('../../engine/nodes/basicNodes');
const { aiNodeHandler } = require('../../engine/nodes/aiNode');
const { aiTaskNodeHandler } = require('../../engine/nodes/aiTaskNode');
const { semanticRouterNodeHandler } = require('../../engine/nodes/semanticRouterNode');
const { ragAnswerNodeHandler } = require('../../engine/nodes/ragAnswerNode');
const { businessEntryNodeHandler } = require('../../engine/nodes/businessEntryNode');
const { mergeNodeHandler } = require('../../engine/nodes/mergeNode');
const {
  getFlowInfoNodeHandler,
  getQueueStatusNodeHandler,
  getConfigValueNodeHandler,
  listFlowsNodeHandler,
} = require('../../engine/nodes/persistenceNodes');
const {
  getCurrentTimeNodeHandler,
  generateUuidNodeHandler,
  delayNodeHandler,
  formatDateNodeHandler,
  randomNumberNodeHandler,
  getUserInfoNodeHandler,
} = require('../../engine/nodes/systemNodes');
const { apiNodeHandler } = require('../../engine/nodes/apiNode');
const { fallbackNodeHandler } = require('../../engine/nodes/fallbackNode');

function createNodeRegistry() {
  const registry = new NodeRegistry();
  registry.register('start', startNodeHandler);
  registry.register('message', messageNodeHandler);
  registry.register('user_input', userInputNodeHandler);
  registry.register('options', optionsNodeHandler);
  registry.register('merge', mergeNodeHandler);
  registry.register('router', routerNodeHandler);
  registry.register('schedule_router', scheduleRouterNodeHandler);
  registry.register('semantic_router', semanticRouterNodeHandler);
  registry.register('business_entry', businessEntryNodeHandler);
  registry.register('set_variable', setVariableNodeHandler);
  registry.register('handoff', handoffNodeHandler);
  registry.register('end', endNodeHandler);
  registry.register('ai', aiNodeHandler);
  registry.register('ai_task', aiTaskNodeHandler);
  registry.register('rag_answer', ragAnswerNodeHandler);
  registry.register('get_flow_info', getFlowInfoNodeHandler);
  registry.register('get_queue_status', getQueueStatusNodeHandler);
  registry.register('get_config_value', getConfigValueNodeHandler);
  registry.register('list_flows', listFlowsNodeHandler);
  registry.register('get_current_time', getCurrentTimeNodeHandler);
  registry.register('generate_uuid', generateUuidNodeHandler);
  registry.register('delay', delayNodeHandler);
  registry.register('format_date', formatDateNodeHandler);
  registry.register('random_number', randomNumberNodeHandler);
  registry.register('get_user_info', getUserInfoNodeHandler);
  registry.register('api', apiNodeHandler);
  registry.register('fallback', fallbackNodeHandler);
  registry.register('subflow', subflowNodeHandler);
  return registry;
}

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeTrim(value, fallback = '') {
  const s = safeToString(value, fallback);
  try { return s.trim(); } catch (_) { return fallback; }
}

function safeErrorMessage(err) {
  try {
    const message = err && typeof err === 'object' ? err.message : null;
    return safeToString(message) || safeToString(err);
  } catch (_) {
    return safeToString(err);
  }
}

function intEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

function boolEnv(name, def = false) {
  const raw = process.env[name];
  if (raw === undefined) return def;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return def;
}

function resolvePositiveStepLimit(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return fallback;
}

function resolveStartNodeId(flow) {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const startNode = nodes.find((n) => n && n.type === 'start');
  return startNode ? safeToString(startNode.id) : null;
}

function normalizeTrigger(trigger) {
  if (!trigger || typeof trigger !== 'object') return null;
  return {
    type: trigger.type ? safeToString(trigger.type) : null,
    source: trigger.source ? safeToString(trigger.source) : null,
    subjectType: trigger.subjectType ? safeToString(trigger.subjectType) : null,
    subjectId: trigger.subjectId ? safeToString(trigger.subjectId) : null,
    actorType: trigger.actorType ? safeToString(trigger.actorType) : null,
    actorId: trigger.actorId ? safeToString(trigger.actorId) : null,
  };
}

function triggerMatchesEvent(trigger, event) {
  if (!trigger) return false;
  const evType = event?.type ? safeToString(event.type) : '';
  if (trigger.type && trigger.type !== evType && trigger.type !== '*') return false;
  if (trigger.source && trigger.source !== safeToString(event?.source || '')) return false;
  if (trigger.subjectType && trigger.subjectType !== safeToString(event?.subject?.type || '')) return false;
  if (trigger.subjectId && trigger.subjectId !== safeToString(event?.subject?.id || '')) return false;
  if (trigger.actorType && trigger.actorType !== safeToString(event?.actor?.type || '')) return false;
  if (trigger.actorId && trigger.actorId !== safeToString(event?.actor?.id || '')) return false;
  return true;
}

async function listMatchingFlows({ tenantId, event }) {
  const flows = await persistence.getFlows();
  const safeTenant = safeToString(tenantId || '');
  return flows.filter((flow) => {
    if (!flow || !flow.id) return false;
    if (safeTenant && safeToString(flow.tenantId || '') !== safeTenant) return false;
    const triggers = flow?.metadata?.eventTriggers;
    if (!Array.isArray(triggers) || triggers.length === 0) return false;
    return triggers.map(normalizeTrigger).some((t) => triggerMatchesEvent(t, event));
  });
}

async function executeFlowForEvent({ tenantId, flow, event, maxSteps = null }) {
  const flowId = flow?.id || null;
  if (!tenantId || !flowId) return { ok: false, reason: 'invalid_args' };

  const tenantIdStr = safeToString(tenantId);
  const flowIdStr = safeToString(flowId);
  if (!tenantIdStr || !flowIdStr) return { ok: false, reason: 'invalid_args' };

  const compiled = getOrCompileFlow(flow);
  const startNodeId = resolveStartNodeId(compiled);
  if (!startNodeId) return { ok: false, reason: 'start_node_missing' };

  const correlationId = event?.correlationId ? safeToString(event.correlationId) : `event:${safeToString(event?.id || '')}`;
  const subjectType = event?.subject?.type ? safeToString(event.subject.type) : 'event';
  const subjectId = event?.subject?.id ? safeToString(event.subject.id) : safeToString(event?.id || '');

  const sessionId = `event_${tenantIdStr}_${flowIdStr}_${Date.now()}`;
  const start = await startFlowExecution({
    tenantId: tenantIdStr,
    flowId: compiled.id,
    flowVersion: compiled.version,
    sessionId,
    correlationId,
    subjectType,
    subjectId,
    meta: {
      mode: 'event',
      eventId: event?.id || null,
      eventType: event?.type || null,
      eventSource: event?.source || null,
      eventCorrelationId: event?.correlationId || null,
      eventSubjectType: event?.subject?.type || null,
      eventSubjectId: event?.subject?.id || null,
    },
  });
  const executionId = start?.executionId || null;
  if (start && start.reused) {
    return { ok: true, steps: 0, executionId, reused: true, stoppedOnInput: false };
  }

  let state = {
    tenantId: tenantIdStr,
    sessionId,
    flowId: compiled.id,
    flowVersion: compiled.version,
    currentNodeId: startNodeId,
    variables: {
      event: event || {},
      eventType: event?.type || null,
      eventSource: event?.source || null,
      eventCorrelationId: event?.correlationId || null,
      eventSubjectType: event?.subject?.type || null,
      eventSubjectId: event?.subject?.id || null,
    },
    history: [],
    metadata: {
      mode: 'event',
      createdAt: new Date().toISOString(),
      executionId: executionId || null,
      eventId: event?.id || null,
    },
  };

  const registry = createNodeRegistry();
  const aiProvider = getAiProviderForTenant(tenantIdStr);
  const stepsLimit = resolvePositiveStepLimit(maxSteps, intEnv('EVENT_TRIGGER_MAX_STEPS', 50));
  let steps = 0;
  const executionLedgerAdapter = executionId
    ? buildExecutionLedgerAdapter({
      tenantId,
      executionId,
      sanitizeInput: (inObj) => (inObj && typeof inObj === 'object' ? { event: inObj.event || null } : {}),
      sanitizeOutput: (outObj) => (outObj && typeof outObj === 'object' ? outObj : {}),
    })
    : null;

  try {
    while (state.currentNodeId && steps < stepsLimit) {
      const currentNodeId = safeToString(state.currentNodeId);
      const node = Array.isArray(compiled.nodes) ? compiled.nodes.find((n) => n && safeToString(n.id) === currentNodeId) : null;
      const nodeType = node?.type || null;

      if (nodeType === 'user_input') {
        break;
      }

      const input = {
        event,
        channel: 'event',
        aiProvider,
      };

      // eslint-disable-next-line no-await-in-loop
      const result = await executeStep(state, compiled, {
        registry,
        input,
        deps: {
          persistence,
          registry,
          allowUnreviewedAiFlow: boolEnv('ALLOW_EVENT_TRIGGER_UNREVIEWED_AI_FLOW', false),
          executionLedger: executionLedgerAdapter,
        },
      });

      state = result.state;
      steps += 1;

      if (!state.currentNodeId) break;
    }
  } catch (err) {
    if (executionId) {
      await finishFlowExecutionSafe({
        tenantId: tenantIdStr,
        executionId,
        status: 'failed',
        metaPatch: { error: safeErrorMessage(err) },
      }).catch(() => {});
    }
    throw err;
  }

  if (executionId) {
    await finishFlowExecutionSafe({
      tenantId: tenantIdStr,
      executionId,
      status: 'done',
      metaPatch: {
        finishedBy: steps >= stepsLimit ? 'event_trigger_max_steps' : 'event_trigger_complete',
        steps,
        waitingForInput: state.currentNodeId ? true : false,
      },
    }).catch(() => {});
  }

  return { ok: true, steps, executionId, stoppedOnInput: !!state.currentNodeId, reused: false };
}

async function dispatchFlowsForEvent({ tenantId, event }) {
  if (!tenantId || !event) return { ok: false, reason: 'invalid_args' };
  const flows = await listMatchingFlows({ tenantId, event });
  if (!flows.length) return { ok: true, matched: 0, executed: 0 };
  const strictFailures = boolEnv('EVENT_TRIGGER_STRICT_FAILURES', true);

  let executed = 0;
  let failed = 0;
  const failures = [];
  for (const flow of flows) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await executeFlowForEvent({ tenantId, flow, event });
      executed += 1;
    } catch (err) {
      failed += 1;
      failures.push({
        flowId: flow?.id || null,
        error: safeErrorMessage(err),
      });
      logger.warn('[EventTrigger] Falha ao executar flow para evento', {
        tenantId,
        flowId: flow?.id || null,
        eventId: event?.id || null,
        error: safeErrorMessage(err),
      });
    }
  }

  if (failed > 0 && strictFailures) {
    const error = new Error('event_trigger_flows_failed');
    // @ts-ignore
    error.code = 'event_trigger_flows_failed';
    // @ts-ignore
    error.details = { matched: flows.length, executed, failed, failures };
    throw error;
  }

  return { ok: true, matched: flows.length, executed, failed, failures };
}

module.exports = {
  dispatchFlowsForEvent,
  executeFlowForEvent,
  listMatchingFlows,
};
