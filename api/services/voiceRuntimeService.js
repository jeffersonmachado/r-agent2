/**
 * Voice runtime (URA) using the flow editor (kind=voice).
 *
 * Design:
 * - Maintains in-memory sessions keyed by tenant+callId.
 * - Executes one or more steps until a voice action is produced or flow ends.
 * - Records audit events in event_ledger and in execution ledger (DB-first).
 */
'use strict';

const logger = require('../utils/logger');
const { executeStep } = require('../../engine/executeStep');
const { NodeRegistry } = require('../../engine/nodeRegistry');
const { getOrCompileFlow } = require('../../engine/compiledFlowCache');
const { appendEventV1 } = require('./eventLedgerService');
const { getAiProviderForTenant } = require('../../engine/aiProviderManager');
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
const { mergeNodeHandler } = require('../../engine/nodes/mergeNode');
const { aiNodeHandler } = require('../../engine/nodes/aiNode');
const { aiTaskNodeHandler } = require('../../engine/nodes/aiTaskNode');
const { semanticRouterNodeHandler } = require('../../engine/nodes/semanticRouterNode');
const { ragAnswerNodeHandler } = require('../../engine/nodes/ragAnswerNode');
const { businessEntryNodeHandler } = require('../../engine/nodes/businessEntryNode');
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
const {
  voicePromptListenNodeHandler,
  voiceListenAsrNodeHandler,
  voiceGatherDtmfNodeHandler,
  voiceBranchNodeHandler,
  voiceTransferRamalNodeHandler,
  voiceTransferFilaNodeHandler,
  voiceTransferUtilsNodeHandler,
  voiceHangupNodeHandler,
} = require('../../engine/nodes/voiceNodes');
const {
  startFlowExecution,
  finishFlowExecutionSafe,
  buildExecutionLedgerAdapter,
} = require('./flowExecutionLedgerService');
const { normalizeInboundEvent } = require('./normalizeInboundEvent');
const { processMedia } = require('./mediaProcessors');
const { synthesizeText } = require('./voiceAdapters/ttsAdapter');

/** @type {Map<string, import('../../engine/flowTypes').ConversationState>} */
const sessions = new Map();

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
  registry.register('voice_prompt_listen', voicePromptListenNodeHandler);
  registry.register('voice_listen_asr', voiceListenAsrNodeHandler);
  registry.register('voice_gather_dtmf', voiceGatherDtmfNodeHandler);
  registry.register('voice_branch', voiceBranchNodeHandler);
  registry.register('voice_transfer_ramal', voiceTransferRamalNodeHandler);
  registry.register('voice_transfer_fila', voiceTransferFilaNodeHandler);
  registry.register('voice_transfer_utils', voiceTransferUtilsNodeHandler);
  registry.register('voice_hangup', voiceHangupNodeHandler);
  return registry;
}

function getSessionKey({ tenantId, callId }) {
  return `${String(tenantId)}:${String(callId)}`;
}

function resolveStartNodeId(flow) {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const startNode = nodes.find((n) => n && n.type === 'start');
  return startNode ? String(startNode.id) : null;
}

function createInitialState({ flow, sessionId, callId, variables = {} }) {
  return {
    tenantId: flow.tenantId,
    sessionId,
    flowId: flow.id,
    flowVersion: flow.version,
    currentNodeId: resolveStartNodeId(flow),
    variables: { ...(variables || {}) },
    history: [],
    metadata: {
      channel: 'voice',
      callId: String(callId),
      createdAt: new Date().toISOString(),
      lastVoiceEventId: null,
    },
  };
}

async function emitVoiceRuntimeEvent({ tenantId, callId, type, payload }) {
  try {
    await appendEventV1({
      tenantId,
      type,
      source: 'voice.runtime',
      occurredAt: new Date(),
      correlationId: String(callId),
      subject: { type: 'pbx_call', id: String(callId) },
      actor: { type: 'system', id: 'voice_runtime' },
      idempotencyKey: `voice_runtime:${tenantId}:${callId}:${type}:${Date.now()}`,
      payload: payload && typeof payload === 'object' ? payload : {},
    });
  } catch (_) {}
}

async function ensureExecutionLedger({ tenantId, state, callId }) {
  if (!state?.metadata || state.metadata.executionId) return state;
  try {
    const started = await startFlowExecution({
      tenantId,
      flowId: state.flowId,
      flowVersion: state.flowVersion,
      sessionId: state.sessionId,
      correlationId: `voice:${String(callId)}`,
      subjectType: 'pbx_call',
      subjectId: String(callId),
      meta: {
        mode: 'voice',
        callId: String(callId),
      },
    });
    if (started && started.ok) {
      state.metadata = state.metadata || {};
      state.metadata.executionId = started.executionId;
    }
  } catch (_) {}
  return state;
}

async function runVoiceSession({
  tenantId,
  flowId,
  callId,
  input = null,
  variables = null,
  maxSteps = 40,
  startIfMissing = true,
} = {}) {
  if (!tenantId) return { ok: false, error: 'tenant_required' };
  if (!callId) return { ok: false, error: 'call_id_required' };

  const registry = createNodeRegistry();
  const sessionKey = getSessionKey({ tenantId, callId });

  let state = sessions.get(sessionKey) || null;
  if (!flowId && state && state.flowId) {
    flowId = state.flowId;
  }
  if (!flowId) return { ok: false, error: 'flow_id_required' };
  let flow = null;

  try {
    const rawFlow = await require('../../engine/services/persistenceServices').getFlow(flowId);
    flow = rawFlow ? getOrCompileFlow(rawFlow) : null;
  } catch (err) {
    logger.error('[VoiceRuntime] Falha ao carregar fluxo', { flowId, err: err?.message });
  }

  if (!flow) return { ok: false, error: 'flow_not_found' };
  if (String(flow.kind || 'chat') !== 'voice') return { ok: false, error: 'flow_kind_not_voice' };

  if (!state) {
    if (!startIfMissing) return { ok: false, error: 'session_not_found' };
    const sessionId = `voice_${tenantId}_${callId}`;
    state = createInitialState({ flow, sessionId, callId, variables });
  }

  if (!state.currentNodeId) {
    return { ok: false, error: 'start_node_missing' };
  }

  state = await ensureExecutionLedger({ tenantId, state, callId });
  const executionId = state?.metadata?.executionId || null;
  const executionLedger = executionId
    ? buildExecutionLedgerAdapter({
      tenantId,
      executionId,
      sanitizeInput: (inObj) => (inObj && typeof inObj === 'object' ? inObj : {}),
      sanitizeOutput: (outObj) => (outObj && typeof outObj === 'object' ? outObj : {}),
    })
    : null;

  const aiProvider = getAiProviderForTenant(tenantId);
  const deps = {
    persistence: require('../../engine/services/persistenceServices'),
    registry,
    executionLedger,
    allowUnreviewedAiFlow: false,
  };

  const maxLoops = Math.min(Math.max(Number(maxSteps) || 40, 1), 200);
  let steps = 0;
  let lastOutput = null;
  let lastEvents = [];

  if (input) {
    const incomingEventId = input?.eventId ? String(input.eventId) : null;
    const lastVoiceEventId = state?.metadata?.lastVoiceEventId ? String(state.metadata.lastVoiceEventId) : null;
    if (incomingEventId && lastVoiceEventId && incomingEventId === lastVoiceEventId) {
      return {
        ok: true,
        callId: String(callId),
        flowId: String(flow.id),
        executionId: executionId || null,
        steps: 0,
        output: null,
        events: [],
        finished: !state?.currentNodeId,
        deduplicated: true,
      };
    }
    if (incomingEventId) {
      state.metadata = state.metadata || {};
      state.metadata.lastVoiceEventId = incomingEventId;
    }
    await emitVoiceRuntimeEvent({
      tenantId,
      callId,
      type: 'VoiceFlowInput',
      payload: {
        hasVoice: !!input.voice,
        hasDtmf: !!input.dtmf || !!input?.voice?.dtmf,
        hasTranscript: !!input.text || !!input?.voice?.transcript,
      },
    });
    const recUrl = input?.voice?.recordingUrl;
    if (recUrl) {
      await emitVoiceRuntimeEvent({
        tenantId,
        callId,
        type: 'VoiceRecordingCaptured',
        payload: { recordingUrl: String(recUrl) },
      });
    }
  }

  while (state && state.currentNodeId && steps < maxLoops) {
    // eslint-disable-next-line no-await-in-loop
    const result = await executeStep(state, flow, {
      registry,
      input: input ? { ...input, aiProvider } : { aiProvider },
      deps,
    });
    state = result.state;
    lastOutput = result.output || null;
    lastEvents = Array.isArray(result.events) ? result.events : [];

    if (lastOutput && lastOutput.type === 'voice') {
      await emitVoiceRuntimeEvent({
        tenantId,
        callId,
        type: 'VoiceFlowAction',
        payload: {
          action: lastOutput.action || null,
          waitForInput: lastOutput.waitForInput === true,
          nodeId: result?.state?.currentNodeId || null,
        },
      });
      break;
    }

    if (lastOutput && lastOutput.type === 'handoff') {
      break;
    }

    steps += 1;
  }

  sessions.set(sessionKey, state);

  if (!state?.currentNodeId) {
    try {
      await finishFlowExecutionSafe({
        tenantId,
        executionId,
        status: 'done',
        metaPatch: { finishedBy: 'voice_runtime_end', finishedAt: new Date().toISOString() },
      });
    } catch (_) {}
  }

  return {
    ok: true,
    callId: String(callId),
    flowId: String(flow.id),
    executionId: executionId || null,
    steps,
    output: lastOutput,
    events: lastEvents,
    finished: !state?.currentNodeId,
  };
}

function clearVoiceSession({ tenantId, callId }) {
  if (!tenantId || !callId) return false;
  const sessionKey = getSessionKey({ tenantId, callId });
  return sessions.delete(sessionKey);
}

function getVoiceRuntimeStats({ tenantId = null } = {}) {
  const items = [];
  for (const [key, state] of sessions.entries()) {
    const split = String(key).split(':');
    const itemTenant = split[0] || null;
    const callId = split.slice(1).join(':') || null;
    if (tenantId && String(itemTenant) !== String(tenantId)) continue;
    items.push({
      tenantId: itemTenant,
      callId,
      flowId: state?.flowId || null,
      currentNodeId: state?.currentNodeId || null,
      createdAt: state?.metadata?.createdAt || null,
    });
  }
  return {
    ok: true,
    totalSessions: items.length,
    items,
  };
}

/**
 * Voice runtime service stub (phase-2 ready):
 * - Aceita evento normalizado com channel=voice/media=audio
 * - Reusa ConversationSessionStore e pipeline de chat
 * - Sem integração SIP/ASR/TTS nesta fase
 */
async function processVoiceInboundEvent(event, deps = {}) {
  const normalized = normalizeInboundEvent(event, {
    channel: 'voice',
    metadata: { source: 'voice_runtime_stub' },
  }).event;

  const voiceEvent = await processMedia({
    ...normalized,
    channel: 'voice',
    media: normalized.media || 'audio',
  });

  logger.info('[VoiceRuntimeStub] evento recebido', {
    trace_id: voiceEvent.trace_id,
    tenant_id: voiceEvent.tenant_id,
    session_id: voiceEvent.session_id,
    lead_id: voiceEvent.lead_id || null,
    channel: voiceEvent.channel,
    media: voiceEvent.media,
  });

  // require tardio para evitar circular dependency com módulos de runtime de voz
  // eslint-disable-next-line global-require
  const { processNormalizedInboundEvent } = require('./messageProcessor');
  const pipelineResult = await processNormalizedInboundEvent(voiceEvent, deps);

  const responseText = pipelineResult && pipelineResult.output && pipelineResult.output.text
    ? String(pipelineResult.output.text)
    : (pipelineResult && pipelineResult.output && pipelineResult.output.response_text
      ? String(pipelineResult.output.response_text)
      : '');
  const tts = await synthesizeText(voiceEvent, responseText);

  logger.info('[VoiceRuntimeStub] processamento concluído', {
    trace_id: voiceEvent.trace_id,
    tenant_id: voiceEvent.tenant_id,
    session_id: voiceEvent.session_id,
    asr_provider: voiceEvent.voice_metadata && voiceEvent.voice_metadata.asr_provider
      ? voiceEvent.voice_metadata.asr_provider
      : null,
    tts_provider: tts && tts.provider ? tts.provider : null,
    tts_skipped: !!(tts && tts.skipped),
  });

  return {
    ...pipelineResult,
    voice: {
      input: voiceEvent,
      tts,
    },
  };
}

module.exports = {
  runVoiceSession,
  clearVoiceSession,
  getVoiceRuntimeStats,
  processVoiceInboundEvent,
};
