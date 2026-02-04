/**
 * Flow execution ledger (DB-first).
 *
 * Persists:
 * - flow_executions: header per execution
 * - node_executions: per step/node with input/output/state/events
 *
 * Replay:
 * - only supported in controlled mode and only for executions with meta.mode=simulation
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { FlowExecution, NodeExecution } = require('../db/models');

function dbAvailable() {
  return !!getSequelize();
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeJson(obj, fallback) {
  if (!obj) return fallback;
  if (typeof obj !== 'object') return fallback;
  return obj;
}

function normalizeDateOrNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function startFlowExecution({
  tenantId,
  flowId,
  flowVersion = null,
  sessionId = null,
  correlationId = null,
  subjectType = null,
  subjectId = null,
  meta = {},
}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  if (!tenantId) return { ok: false, error: 'tenant_id_required' };
  if (!flowId) return { ok: false, error: 'flow_id_required' };

  const Model = FlowExecution();
  const now = new Date();
  const row = await Model.create({
    id: newId('fx'),
    tenant_key: String(tenantId),
    flow_id: String(flowId),
    flow_version: flowVersion != null ? Number(flowVersion) : null,
    session_id: sessionId ? String(sessionId) : null,
    correlation_id: correlationId ? String(correlationId) : null,
    subject_type: subjectType ? String(subjectType) : null,
    subject_id: subjectId ? String(subjectId) : null,
    status: 'running',
    started_at: now,
    finished_at: null,
    meta: safeJson(meta, {}),
    created_at: now,
    updated_at: now,
  });

  return { ok: true, executionId: row.id };
}

async function appendNodeExecution({
  tenantId,
  executionId,
  nodeId = null,
  nodeType = null,
  stepIndex = null,
  status = 'ok',
  startedAt = null,
  finishedAt = null,
  input = {},
  output = {},
  stateBefore = {},
  stateAfter = {},
  events = [],
  errorMessage = null,
}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  if (!tenantId) return { ok: false, error: 'tenant_id_required' };
  if (!executionId) return { ok: false, error: 'execution_id_required' };

  const Model = NodeExecution();
  const now = new Date();
  const row = await Model.create({
    id: newId('nx'),
    tenant_key: String(tenantId),
    execution_id: String(executionId),
    node_id: nodeId ? String(nodeId) : null,
    node_type: nodeType ? String(nodeType) : null,
    step_index: stepIndex != null ? Number(stepIndex) : null,
    status: String(status) === 'error' ? 'error' : 'ok',
    started_at: normalizeDateOrNull(startedAt) || now,
    finished_at: normalizeDateOrNull(finishedAt) || null,
    input: safeJson(input, {}),
    output: safeJson(output, {}),
    state_before: safeJson(stateBefore, {}),
    state_after: safeJson(stateAfter, {}),
    events: Array.isArray(events) ? events : [],
    error_message: errorMessage ? String(errorMessage) : null,
    created_at: now,
    updated_at: now,
  });

  return { ok: true, nodeExecutionId: row.id };
}

async function finishFlowExecution({ tenantId, executionId, status = 'done', metaPatch = null }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const Model = FlowExecution();
  const row = await Model.findOne({ where: { tenant_key: String(tenantId), id: String(executionId) } });
  if (!row) return { ok: false, error: 'execution_not_found' };

  const meta = (row.meta && typeof row.meta === 'object') ? { ...row.meta } : {};
  if (metaPatch && typeof metaPatch === 'object') {
    Object.assign(meta, metaPatch);
  }

  row.status = String(status) === 'failed' ? 'failed' : 'done';
  row.finished_at = new Date();
  row.meta = meta;
  await row.save();

  return { ok: true };
}

async function getFlowExecutionDetails({ tenantId, executionId }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const ExecModel = FlowExecution();
  const NodeModel = NodeExecution();

  const exec = await ExecModel.findOne({ where: { tenant_key: String(tenantId), id: String(executionId) } });
  if (!exec) return { ok: false, error: 'execution_not_found' };

  const nodes = await NodeModel.findAll({
    where: { tenant_key: String(tenantId), execution_id: String(executionId) },
    order: [['step_index', 'ASC'], ['created_at', 'ASC']],
    limit: 10000,
  });

  const header = exec.toJSON ? exec.toJSON() : exec;
  return {
    ok: true,
    execution: header,
    nodes: nodes.map((n) => (n.toJSON ? n.toJSON() : n)),
  };
}

async function listFlowExecutions({
  tenantId,
  correlationId = null,
  sessionId = null,
  subjectType = null,
  subjectId = null,
  limit = 50,
  offset = 0,
}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const Model = FlowExecution();
  const where = { tenant_key: String(tenantId) };
  if (correlationId) where.correlation_id = String(correlationId);
  if (sessionId) where.session_id = String(sessionId);
  if (subjectType) where.subject_type = String(subjectType);
  if (subjectId) where.subject_id = String(subjectId);

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const { count, rows } = await Model.findAndCountAll({
    where,
    order: [['started_at', 'DESC']],
    limit: safeLimit,
    offset: safeOffset,
  });

  return {
    ok: true,
    total: count,
    items: (rows || []).map((r) => (r.toJSON ? r.toJSON() : r)),
    limit: safeLimit,
    offset: safeOffset,
  };
}

function createReplayRegistry() {
  const { NodeRegistry } = require('../../engine/nodeRegistry');
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

const mockAiProvider = {
  async generate(prompt) {
    return `[REPLAY] ${prompt}`;
  },
};

async function replayFromNode({
  tenantId,
  executionId,
  fromNodeExecutionId = null,
  fromStepIndex = null,
  maxSteps = 200,
}) {
  const enabled = process.env.ENABLE_EXECUTION_LEDGER_REPLAY === 'true';
  if (!enabled) return { ok: false, error: 'replay_disabled' };
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };

  const details = await getFlowExecutionDetails({ tenantId, executionId });
  if (!details.ok) return details;

  const header = details.execution || {};
  const meta = header.meta && typeof header.meta === 'object' ? header.meta : {};
  if (meta.mode !== 'simulation') {
    return { ok: false, error: 'replay_only_supported_for_simulation' };
  }

  const nodes = Array.isArray(details.nodes) ? details.nodes : [];
  const fromNode = fromNodeExecutionId
    ? nodes.find((n) => String(n.id) === String(fromNodeExecutionId))
    : (fromStepIndex != null ? nodes.find((n) => Number(n.step_index) === Number(fromStepIndex)) : null);
  if (!fromNode) {
    return { ok: false, error: 'from_node_not_found' };
  }

  const flowId = header.flow_id;
  if (!flowId) return { ok: false, error: 'flow_id_missing' };

  const persistence = require('../../engine/services/persistenceServices');
  const flow = await persistence.getFlow(String(flowId));
  if (!flow) return { ok: false, error: 'flow_not_found' };

  const { getOrCompileFlow } = require('../../engine/compiledFlowCache');
  const { executeStep } = require('../../engine/executeStep');
  const compiled = getOrCompileFlow(flow);

  const registry = createReplayRegistry();

  let state = fromNode.state_before || {};
  // Garantia mínima
  if (!state || typeof state !== 'object') {
    return { ok: false, error: 'invalid_state_snapshot' };
  }

  const replayExec = await startFlowExecution({
    tenantId,
    flowId: header.flow_id,
    flowVersion: header.flow_version || null,
    sessionId: header.session_id || null,
    correlationId: header.correlation_id ? `replay:${header.correlation_id}` : `replay:${executionId}`,
    subjectType: header.subject_type || null,
    subjectId: header.subject_id || null,
    meta: {
      mode: 'replay',
      replayOf: String(executionId),
      fromNodeExecutionId: String(fromNode.id),
      fromStepIndex: fromNode.step_index != null ? Number(fromNode.step_index) : null,
    },
  });
  if (!replayExec.ok) return replayExec;

  const replayExecutionId = replayExec.executionId;

  // Reexecuta a partir do snapshot, usando inputs armazenados quando possível.
  const startIdx = Number(fromNode.step_index || 0);
  const candidates = nodes
    .filter((n) => n && n.step_index != null && Number(n.step_index) >= startIdx)
    .sort((a, b) => Number(a.step_index) - Number(b.step_index));

  const stepsToRun = Math.min(Number(maxSteps) || 200, 1000);
  const ran = [];

  for (let i = 0; i < candidates.length && i < stepsToRun; i += 1) {
    const target = candidates[i];
    const before = state;
    const startedAt = new Date();

    const storedInput = target.input && typeof target.input === 'object' ? target.input : {};
    const execInput = { ...storedInput };
    // Garanta aiProvider para nós AI (não persiste funções)
    execInput.aiProvider = mockAiProvider;

    let result;
    let error = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await executeStep(before, compiled, {
        registry,
        input: execInput,
        deps: {
          persistence,
          registry,
          allowUnreviewedAiFlow: true,
        },
      });
    } catch (err) {
      error = err;
      result = null;
    }

    const finishedAt = new Date();

    if (!result) {
      // Registra erro e encerra replay
      await appendNodeExecution({
        tenantId,
        executionId: replayExecutionId,
        nodeId: target.node_id || null,
        nodeType: target.node_type || null,
        stepIndex: target.step_index != null ? Number(target.step_index) : null,
        status: 'error',
        startedAt,
        finishedAt,
        input: storedInput,
        output: {},
        stateBefore: before,
        stateAfter: before,
        events: [],
        errorMessage: error && error.message ? error.message : String(error),
      }).catch(() => {});
      await finishFlowExecution({
        tenantId,
        executionId: replayExecutionId,
        status: 'failed',
        metaPatch: { error: error && error.message ? error.message : String(error) },
      }).catch(() => {});
      return { ok: true, replayExecutionId, ranSteps: ran, stoppedOnError: true };
    }

    // Avança estado
    state = result.state;

    await appendNodeExecution({
      tenantId,
      executionId: replayExecutionId,
      nodeId: target.node_id || null,
      nodeType: target.node_type || null,
      stepIndex: target.step_index != null ? Number(target.step_index) : null,
      status: 'ok',
      startedAt,
      finishedAt,
      input: storedInput,
      output: safeJson(result.output || {}, {}),
      stateBefore: before,
      stateAfter: safeJson(result.state || {}, {}),
      events: Array.isArray(result.events) ? result.events : [],
      errorMessage: null,
    }).catch(() => {});

    ran.push({
      stepIndex: target.step_index != null ? Number(target.step_index) : null,
      nodeId: target.node_id || null,
      nodeType: target.node_type || null,
      nodeExecutionId: null,
    });

    if (!state.currentNodeId) break;
  }

  await finishFlowExecution({ tenantId, executionId: replayExecutionId, status: 'done' }).catch(() => {});
  logger.info('[ExecutionLedger] replay concluído', { executionId, replayExecutionId, steps: ran.length });
  return { ok: true, replayExecutionId, ranSteps: ran, stoppedOnError: false };
}

module.exports = {
  startFlowExecution,
  appendNodeExecution,
  finishFlowExecution,
  getFlowExecutionDetails,
  listFlowExecutions,
  replayFromNode,
};

