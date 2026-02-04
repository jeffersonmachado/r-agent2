/**
 * Handlers de nós de VOZ/URA (kind=voice).
 *
 * Contrato:
 * - Emitem output.type="voice" com ações declarativas para um gateway de telefonia (ARI/AMI/etc.).
 * - Podem "aguardar input" via output.waitForInput=true; o runner mantém o currentNodeId no mesmo nó.
 * - Persistem dados de ASR/DTMF em state.variables (config.variable).
 */

'use strict';

const { createEngineEvent } = require('../utils');
const { renderTemplate } = require('../utils/templateRenderer');

/**
 * @typedef {import('../flowTypes').ConversationState} ConversationState
 * @typedef {import('../flowTypes').EngineStepOutput} EngineStepOutput
 */

function cloneState(state) {
  return {
    ...state,
    variables: { ...state.variables },
    metadata: state.metadata ? { ...state.metadata } : undefined,
  };
}

function safeString(v) {
  return v == null ? '' : String(v);
}

function readVoiceInput(input) {
  if (!input || typeof input !== 'object') return { transcript: null, dtmf: null, recordingUrl: null };
  const v = input.voice && typeof input.voice === 'object' ? input.voice : {};
  const transcript = v.transcript != null ? safeString(v.transcript) : (input.text != null ? safeString(input.text) : null);
  const dtmf = v.dtmf != null ? safeString(v.dtmf) : (input.dtmf != null ? safeString(input.dtmf) : null);
  const recordingUrl = v.recordingUrl != null ? safeString(v.recordingUrl) : null;
  return {
    transcript: transcript && transcript.trim() ? transcript : null,
    dtmf: dtmf && dtmf.trim() ? dtmf : null,
    recordingUrl: recordingUrl && recordingUrl.trim() ? recordingUrl : null,
  };
}

async function voicePromptListenNodeHandler(node, state, input) {
  const nextState = cloneState(state);

  const textTemplate = node?.config?.text != null ? String(node.config.text) : '';
  if (!textTemplate.trim()) {
    const error = new Error(`voice_prompt_listen "${node.id}" deve ter "config.text" não vazio.`);
    // @ts-ignore
    error.code = 'VOICE_PROMPT_EMPTY_TEXT';
    // @ts-ignore
    error.type = 'data';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  const renderedText = renderTemplate(textTemplate, nextState.variables || {});
  const recordSeconds = node?.config?.recordSeconds != null ? Number(node.config.recordSeconds) : null;
  const bargeIn = node?.config?.bargeIn === true;

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [],
    output: {
      type: 'voice',
      action: 'prompt',
      text: renderedText,
      bargeIn,
      recordSeconds: Number.isFinite(recordSeconds) && recordSeconds > 0 ? recordSeconds : null,
    },
  };

  result.events.push(createEngineEvent({
    sessionId: state.sessionId,
    flowId: state.flowId,
    nodeId: node.id,
    type: 'VOICE_PROMPT',
    payload: result.output,
  }));

  return result;
}

async function voiceListenAsrNodeHandler(node, state, input) {
  const nextState = cloneState(state);

  const variableName = node?.config?.variable != null ? String(node.config.variable) : 'utterance';
  const { transcript, recordingUrl } = readVoiceInput(input);

  if (!transcript) {
    /** @type {EngineStepOutput} */
    const waiting = {
      nextState,
      events: [
        createEngineEvent({
          sessionId: state.sessionId,
          flowId: state.flowId,
          nodeId: node.id,
          type: 'VOICE_WAIT_ASR',
          payload: { variable: variableName },
        }),
      ],
      output: {
        type: 'voice',
        action: 'listen_asr',
        variable: variableName,
        waitForInput: true,
      },
    };
    return waiting;
  }

  nextState.variables[variableName] = transcript;
  if (recordingUrl) nextState.variables[`${variableName}_recording_url`] = recordingUrl;

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'VOICE_ASR_IN',
        payload: { transcript, variable: variableName, recordingUrl: recordingUrl || null },
      }),
    ],
    output: {
      type: 'voice',
      action: 'listen_asr',
      transcript,
      recordingUrl: recordingUrl || null,
      variable: variableName,
      waitForInput: false,
    },
  };
  return result;
}

async function voiceGatherDtmfNodeHandler(node, state, input) {
  const nextState = cloneState(state);
  const variableName = node?.config?.variable != null ? String(node.config.variable) : 'dtmf';
  const maxDigits = node?.config?.maxDigits != null ? Number(node.config.maxDigits) : null;
  const timeoutMs = node?.config?.timeoutMs != null ? Number(node.config.timeoutMs) : null;

  const { dtmf } = readVoiceInput(input);
  if (!dtmf) {
    /** @type {EngineStepOutput} */
    const waiting = {
      nextState,
      events: [
        createEngineEvent({
          sessionId: state.sessionId,
          flowId: state.flowId,
          nodeId: node.id,
          type: 'VOICE_WAIT_DTMF',
          payload: { variable: variableName },
        }),
      ],
      output: {
        type: 'voice',
        action: 'gather_dtmf',
        variable: variableName,
        maxDigits: Number.isFinite(maxDigits) && maxDigits > 0 ? maxDigits : null,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : null,
        waitForInput: true,
      },
    };
    return waiting;
  }

  nextState.variables[variableName] = dtmf;
  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'VOICE_DTMF_IN',
        payload: { dtmf, variable: variableName },
      }),
    ],
    output: {
      type: 'voice',
      action: 'gather_dtmf',
      dtmf,
      variable: variableName,
      waitForInput: false,
    },
  };
  return result;
}

// voice_branch: similar ao router, mas permite defaultNext em config
async function voiceBranchNodeHandler(node, state) {
  const nextState = cloneState(state);
  const rules = (node.config && Array.isArray(node.config.rules) ? node.config.rules : []);
  const defaultNext = node?.config?.defaultNext != null ? String(node.config.defaultNext) : null;

  // Reusa a lógica do router: avaliador simples de condições (sempre/equals/contains/...)
  // Copiamos um subset seguro para evitar dependência circular.
  function evaluateCondition(condition) {
    if (!condition || typeof condition !== 'object') return false;
    const op = condition.op || 'always';
    const validOps = ['always', 'equals', 'contains', 'not_equals', 'not_contains', 'greater_than', 'less_than'];
    if (!validOps.includes(op)) return false;
    if (op === 'always') return true;
    const varName = condition.var;
    if (!varName) return false;
    const variableValue = nextState.variables[varName];
    if (op === 'equals') return variableValue === condition.value;
    if (op === 'not_equals') return variableValue !== condition.value;
    if (op === 'contains' || op === 'not_contains') {
      const needle = condition.value;
      let has = false;
      if (typeof variableValue === 'string') has = variableValue.includes(String(needle ?? ''));
      else if (Array.isArray(variableValue)) has = variableValue.includes(needle);
      else if (variableValue != null) has = String(variableValue).includes(String(needle ?? ''));
      return op === 'contains' ? has : !has;
    }
    if (op === 'greater_than' || op === 'less_than') {
      const left = Number(variableValue);
      const right = Number(condition.value);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      return op === 'greater_than' ? left > right : left < right;
    }
    return false;
  }

  let chosenNext = null;
  let matchedRule = null;
  for (const r of rules) {
    if (evaluateCondition(r?.condition)) {
      chosenNext = r.next || null;
      matchedRule = r;
      break;
    }
  }
  if (!chosenNext) chosenNext = defaultNext || node.next || null;
  if (!chosenNext) {
    const error = new Error(`voice_branch "${node.id}" não encontrou rota e não tem defaultNext.`);
    // @ts-ignore
    error.code = 'VOICE_BRANCH_NO_MATCH';
    // @ts-ignore
    error.type = 'flow';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'VOICE_BRANCH',
        payload: { chosenNext, matchedRule: matchedRule ? matchedRule.condition : null },
      }),
    ],
    output: { type: 'router', chosenNext },
  };
  return result;
}

async function voiceTransferRamalNodeHandler(node, state) {
  const nextState = cloneState(state);
  const ramal = node?.config?.ramal != null ? safeString(node.config.ramal).trim() : '';
  if (!ramal) {
    const error = new Error(`voice_transfer_ramal "${node.id}" deve ter "config.ramal".`);
    // @ts-ignore
    error.code = 'VOICE_TRANSFER_RAMAL_REQUIRED';
    // @ts-ignore
    error.type = 'data';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }
  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'VOICE_TRANSFER',
        payload: { targetType: 'ramal', ramal },
      }),
    ],
    output: { type: 'voice', action: 'transfer', targetType: 'ramal', ramal },
  };
  return result;
}

async function voiceTransferFilaNodeHandler(node, state) {
  const nextState = cloneState(state);
  const fila = node?.config?.fila != null ? safeString(node.config.fila).trim() : (node?.config?.queue != null ? safeString(node.config.queue).trim() : '');
  if (!fila) {
    const error = new Error(`voice_transfer_fila "${node.id}" deve ter "config.fila" (ou "config.queue").`);
    // @ts-ignore
    error.code = 'VOICE_TRANSFER_FILA_REQUIRED';
    // @ts-ignore
    error.type = 'data';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }
  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'VOICE_TRANSFER',
        payload: { targetType: 'fila', fila },
      }),
    ],
    output: { type: 'voice', action: 'transfer', targetType: 'fila', fila },
  };
  return result;
}

// Utilitário: ação genérica (ex.: originate/click2call) para integração externa
async function voiceTransferUtilsNodeHandler(node, state) {
  const nextState = cloneState(state);
  const action = node?.config?.action != null ? safeString(node.config.action).trim() : 'utils';
  const payload = node?.config?.payload && typeof node.config.payload === 'object' ? node.config.payload : {};
  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'VOICE_UTILS',
        payload: { action, payload },
      }),
    ],
    output: { type: 'voice', action: 'utils', name: action, payload },
  };
  return result;
}

async function voiceHangupNodeHandler(node, state) {
  const nextState = cloneState(state);
  const reason = node?.config?.reason != null ? safeString(node.config.reason).trim() : null;
  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'VOICE_HANGUP',
        payload: { reason },
      }),
    ],
    output: { type: 'voice', action: 'hangup', reason },
  };
  return result;
}

module.exports = {
  voicePromptListenNodeHandler,
  voiceListenAsrNodeHandler,
  voiceGatherDtmfNodeHandler,
  voiceBranchNodeHandler,
  voiceTransferRamalNodeHandler,
  voiceTransferFilaNodeHandler,
  voiceTransferUtilsNodeHandler,
  voiceHangupNodeHandler,
};

