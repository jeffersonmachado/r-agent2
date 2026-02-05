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
const { getAiProviderForTenant } = require('../../engine/aiProviderManager');
const { startFlowExecution, finishFlowExecution } = require('./flowExecutionLedgerService');

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

function resolveStartNodeId(flow) {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const startNode = nodes.find((n) => n && n.type === 'start');
  return startNode ? String(startNode.id) : null;
}

function normalizeTrigger(trigger) {
  if (!trigger || typeof trigger !== 'object') return null;
  return {
    type: trigger.type ? String(trigger.type) : null,
    source: trigger.source ? String(trigger.source) : null,
    subjectType: trigger.subjectType ? String(trigger.subjectType) : null,
    subjectId: trigger.subjectId ? String(trigger.subjectId) : null,
    actorType: trigger.actorType ? String(trigger.actorType) : null,
    actorId: trigger.actorId ? String(trigger.actorId) : null,
  };
}

function triggerMatchesEvent(trigger, event) {
  if (!trigger) return false;
  const evType = event?.type ? String(event.type) : '';
  if (trigger.type && trigger.type !== evType && trigger.type !== '*') return false;
  if (trigger.source && trigger.source !== String(event?.source || '')) return false;
  if (trigger.subjectType && trigger.subjectType !== String(event?.subject?.type || '')) return false;
  if (trigger.subjectId && trigger.subjectId !== String(event?.subject?.id || '')) return false;
  if (trigger.actorType && trigger.actorType !== String(event?.actor?.type || '')) return false;
  if (trigger.actorId && trigger.actorId !== String(event?.actor?.id || '')) return false;
  return true;
}

async function listMatchingFlows({ tenantId, event }) {
  const flows = await persistence.getFlows();
  const safeTenant = String(tenantId || '');
  return flows.filter((flow) => {
    if (!flow || !flow.id) return false;
    if (safeTenant && String(flow.tenantId || '') !== safeTenant) return false;
    const triggers = flow?.metadata?.eventTriggers;
    if (!Array.isArray(triggers) || triggers.length === 0) return false;
    return triggers.map(normalizeTrigger).some((t) => triggerMatchesEvent(t, event));
  });
}

async function executeFlowForEvent({ tenantId, flow, event, maxSteps = null }) {
  const flowId = flow?.id || null;
  if (!tenantId || !flowId) return { ok: false, reason: 'invalid_args' };

  const compiled = getOrCompileFlow(flow);
  const startNodeId = resolveStartNodeId(compiled);
  if (!startNodeId) return { ok: false, reason: 'start_node_missing' };

  const correlationId = event?.correlationId ? String(event.correlationId) : `event:${String(event?.id || '')}`;
  const subjectType = event?.subject?.type ? String(event.subject.type) : 'event';
  const subjectId = event?.subject?.id ? String(event.subject.id) : String(event?.id || '');

  const sessionId = `event_${tenantId}_${flowId}_${Date.now()}`;
  const start = await startFlowExecution({
    tenantId,
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
    },
  });
  const executionId = start?.executionId || null;

  let state = {
    tenantId,
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
  const aiProvider = getAiProviderForTenant(tenantId);
  const stepsLimit = Number.isFinite(Number(maxSteps)) ? Number(maxSteps) : intEnv('EVENT_TRIGGER_MAX_STEPS', 50);
  let steps = 0;

  while (state.currentNodeId && steps < stepsLimit) {
    const currentNodeId = String(state.currentNodeId);
    const node = Array.isArray(compiled.nodes) ? compiled.nodes.find((n) => n && String(n.id) === currentNodeId) : null;
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
        executionLedger: executionId
          ? {
            executionId,
            sanitizeInput: (inObj) => (inObj && typeof inObj === 'object' ? { event: inObj.event || null } : {}),
            sanitizeOutput: (outObj) => (outObj && typeof outObj === 'object' ? outObj : {}),
            appendNodeExecution: async (args) => {
              const { appendNodeExecution } = require('./flowExecutionLedgerService');
              return appendNodeExecution({ tenantId, executionId, ...args });
            },
          }
          : null,
      },
    });

    state = result.state;
    steps += 1;

    if (!state.currentNodeId) break;
  }

  if (executionId) {
    await finishFlowExecution({
      tenantId,
      executionId,
      status: 'done',
      metaPatch: {
        finishedBy: steps >= stepsLimit ? 'event_trigger_max_steps' : 'event_trigger_complete',
        steps,
        waitingForInput: state.currentNodeId ? true : false,
      },
    }).catch(() => {});
  }

  return { ok: true, steps, executionId, stoppedOnInput: !!state.currentNodeId };
}

async function dispatchFlowsForEvent({ tenantId, event }) {
  if (!tenantId || !event) return { ok: false, reason: 'invalid_args' };
  const flows = await listMatchingFlows({ tenantId, event });
  if (!flows.length) return { ok: true, matched: 0, executed: 0 };

  let executed = 0;
  for (const flow of flows) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await executeFlowForEvent({ tenantId, flow, event });
      executed += 1;
    } catch (err) {
      logger.warn('[EventTrigger] Falha ao executar flow para evento', {
        tenantId,
        flowId: flow?.id || null,
        eventId: event?.id || null,
        error: err.message || String(err),
      });
    }
  }

  return { ok: true, matched: flows.length, executed };
}

module.exports = {
  dispatchFlowsForEvent,
  executeFlowForEvent,
  listMatchingFlows,
};
