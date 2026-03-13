import { useMemo, useReducer } from 'react';

/**
 * Máquina de estados determinística do pipeline.
 *
 * Regras:
 * - Avança apenas 1 estágio por vez (sem saltos)
 * - Ignora eventos fora de ordem ou duplicados
 * - Não permite regressão
 * - `failed` é terminal e pode ocorrer a qualquer momento
 *
 * Eventos esperados (via websocket):
 * - executionId
 * - stage
 * - timestamp (ISO)
 */

export const PipelineStage = Object.freeze({
  idle: 'idle',
  providerValidated: 'providerValidated',
  ragValidated: 'ragValidated',
  filesInferred: 'filesInferred',
  webScraping: 'webScraping',
  descriptionSuggested: 'descriptionSuggested',
  payloadValid: 'payloadValid',
  contractValid: 'contractValid',
  contextBuilt: 'contextBuilt',
  ragContextBuilt: 'ragContextBuilt',
  questionsGenerated: 'questionsGenerated',
  aiExecuted: 'aiExecuted',
  flowGenerated: 'flowGenerated',
  seedGenerated: 'seedGenerated',
  rpaGenerated: 'rpaGenerated',
  rpaExecuted: 'rpaExecuted',
  faqGenerated: 'faqGenerated',
  initialFlowGenerated: 'initialFlowGenerated',
  approved: 'approved',
  failed: 'failed',
});

export const PIPELINE_STAGE_ORDER = Object.freeze([
  PipelineStage.idle,
  PipelineStage.providerValidated,
  PipelineStage.ragValidated,
  PipelineStage.filesInferred,
  PipelineStage.webScraping,
  PipelineStage.descriptionSuggested,
  // Tenant-first: FAQ e fluxo inicial vêm antes do pipeline de artefatos.
  PipelineStage.questionsGenerated,
  PipelineStage.faqGenerated,
  PipelineStage.initialFlowGenerated,
  PipelineStage.payloadValid,
  PipelineStage.contractValid,
  PipelineStage.contextBuilt,
  PipelineStage.ragContextBuilt,
  PipelineStage.aiExecuted,
  PipelineStage.flowGenerated,
  PipelineStage.seedGenerated,
  PipelineStage.rpaGenerated,
  PipelineStage.rpaExecuted,
  PipelineStage.approved,
]);

const STAGE_INDEX = new Map(PIPELINE_STAGE_ORDER.map((s, idx) => [s, idx]));

export function createInitialPipelineState() {
  return {
    executionId: null,
    executionStatus: null, // idle|running|approved|failed|abstained (vindo do backend)
    stage: PipelineStage.idle,
    lastStageIndex: STAGE_INDEX.get(PipelineStage.idle),
    completedStages: new Set([PipelineStage.idle]),
    stageMeta: {},
    currentStage: null,
    currentStageStatus: null, // ex.: in_progress
    currentStageTimestamp: null,
    currentStageMessage: null,
    lastTimestamp: null,
    failedReason: null,
    failedStage: null,
  };
}

function isValidStage(stage) {
  return typeof stage === 'string' && (STAGE_INDEX.has(stage) || stage === PipelineStage.failed);
}

function normalizeTimestamp(ts) {
  if (typeof ts === 'string' && ts.trim()) return ts.trim();
  return new Date().toISOString();
}

/**
 * Reducer puro: (state, action) => newState
 */
export function pipelineReducer(state, action) {
  if (!action || typeof action !== 'object') return state;

  if (action.type === 'PIPELINE_STATUS') {
    const payload = action.payload && typeof action.payload === 'object' ? action.payload : null;
    const executionId = (payload?.executionId && String(payload.executionId).trim()) ? String(payload.executionId).trim() : null;
    if (!executionId) return state;

    // Idempotência por executionId
    if (state.executionId && state.executionId !== executionId) return state;

    const status = (payload?.status && String(payload.status).trim()) ? String(payload.status).trim() : null;
    const stages = payload?.stages && typeof payload.stages === 'object' ? payload.stages : {};
    const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
    const nowIso = new Date().toISOString();

    // Metadata opcional para dar "vida" ao pipeline visual (ex.: etapa atual em execução).
    const currentStage =
      (typeof metadata?.currentStage === 'string' && metadata.currentStage.trim())
        ? metadata.currentStage.trim()
        : null;
    const currentStageStatus =
      (typeof metadata?.stageStatus === 'string' && metadata.stageStatus.trim())
        ? metadata.stageStatus.trim()
        : null;
    const currentStageMessage =
      (typeof metadata?.message === 'string' && metadata.message.trim())
        ? metadata.message.trim()
        : null;
    const currentStageTimestamp =
      (typeof metadata?.timestamp === 'string' && metadata.timestamp.trim())
        ? metadata.timestamp.trim()
        : null;

    // Determina o maior estágio concluído por snapshot.
    // IMPORTANTE: não "auto-completar" etapas intermediárias apenas porque uma etapa posterior veio true.
    let maxIndex = STAGE_INDEX.get(PipelineStage.idle);
    for (const [stage, idx] of STAGE_INDEX.entries()) {
      if (stage === PipelineStage.idle) continue;
      if (stages && stages[stage] === true && idx > maxIndex) {
        maxIndex = idx;
      }
    }

    // Status terminal tem precedência
    if (status === 'failed') {
      const completedStages = new Set([PipelineStage.idle]);
      for (const [stage] of STAGE_INDEX.entries()) {
        if (stage === PipelineStage.idle) continue;
        if (stages && stages[stage] === true) completedStages.add(stage);
      }
      completedStages.add(PipelineStage.failed);
      const failedStage = (
        (typeof metadata?.stage === 'string' && metadata.stage.trim())
          ? metadata.stage.trim()
          : (typeof metadata?.currentStage === 'string' && metadata.currentStage.trim())
            ? metadata.currentStage.trim()
            : (typeof state.currentStage === 'string' && state.currentStage.trim())
              ? state.currentStage.trim()
              : null
      );
      const safeFailedStage = (failedStage && STAGE_INDEX.has(failedStage)) ? failedStage : null;
      const failedMsg = metadata?.message || metadata?.reason || null;
      const stageMeta = { ...(state.stageMeta || {}) };
      if (safeFailedStage && failedMsg) {
        stageMeta[safeFailedStage] = { timestamp: nowIso, message: failedMsg };
      }
      stageMeta[PipelineStage.failed] = { timestamp: nowIso, message: failedMsg };
      return {
        ...state,
        executionId,
        executionStatus: status,
        stage: PipelineStage.failed,
        lastStageIndex: maxIndex,
        completedStages,
        stageMeta,
        currentStage: null,
        currentStageStatus: null,
        currentStageTimestamp: null,
        currentStageMessage: null,
        failedReason: failedMsg,
        failedStage: safeFailedStage,
        lastTimestamp: nowIso,
      };
    }

    if (status === 'approved') {
      maxIndex = STAGE_INDEX.get(PipelineStage.approved);
    }

    const derivedStage = PIPELINE_STAGE_ORDER[maxIndex] || PipelineStage.idle;
    const completedStages = new Set([PipelineStage.idle]);
    for (const [stage] of STAGE_INDEX.entries()) {
      if (stage === PipelineStage.idle) continue;
      if (stages && stages[stage] === true) completedStages.add(stage);
    }
    if (status === 'approved') completedStages.add(PipelineStage.approved);
    const nextStageMeta = { ...(state.stageMeta || {}) };
    // Importante:
    // - Evitar associar `metadata.message` ao "derivedStage" de forma genérica, pois isso pode
    //   colocar mensagens em etapas erradas quando o backend emite snapshots de status.
    // - Preferimos mensagens explicitamente ancoradas em `metadata.stage` (updateStage) ou
    //   em `metadata.currentStage` (in_progress).

    const explicitStage = (typeof metadata?.stage === 'string' && metadata.stage.trim())
      ? metadata.stage.trim()
      : null;

    if (explicitStage && metadata?.message) {
      nextStageMeta[explicitStage] = {
        timestamp: nowIso,
        message: metadata?.message || null,
      };
    } else if (currentStage && currentStageMessage) {
      nextStageMeta[currentStage] = {
        timestamp: currentStageTimestamp || nowIso,
        message: currentStageMessage,
      };
    } else if (status === 'approved' && metadata?.message) {
      // Para o card "Aprovado" ter texto quando vier apenas via status.
      nextStageMeta[PipelineStage.approved] = {
        timestamp: nowIso,
        message: metadata?.message || null,
      };
    }

    return {
      ...state,
      executionId,
      executionStatus: status || state.executionStatus,
      stage: derivedStage,
      lastStageIndex: maxIndex,
      completedStages,
      stageMeta: nextStageMeta,
      currentStage: currentStage || state.currentStage,
      currentStageStatus: currentStageStatus || (currentStage ? state.currentStageStatus : state.currentStageStatus),
      currentStageTimestamp: currentStageTimestamp || (currentStage ? state.currentStageTimestamp : state.currentStageTimestamp),
      currentStageMessage: currentStageMessage || (currentStage ? state.currentStageMessage : state.currentStageMessage),
      failedReason: null,
      lastTimestamp: nowIso,
    };
  }

  if (action.type === 'PIPELINE_RESET') {
    return createInitialPipelineState();
  }

  if (action.type === 'PIPELINE_START') {
    const executionId = typeof action.executionId === 'string' ? action.executionId.trim() : null;
    const next = createInitialPipelineState();
    if (executionId) next.executionId = executionId;
    return next;
  }

  if (action.type !== 'PIPELINE_EVENT') return state;

  const executionId = typeof action.executionId === 'string' ? action.executionId.trim() : '';
  const stage = action.stage;
  const timestamp = normalizeTimestamp(action.timestamp);
  const message = typeof action.message === 'string' ? action.message : null;

  if (!executionId) return state;
  if (!isValidStage(stage)) return state;

  // Se ainda não temos executionId, "ancora" no primeiro evento.
  if (!state.executionId) {
    const anchored = {
      ...state,
      executionId,
    };
    return pipelineReducer(anchored, action);
  }

  // Idempotência por executionId: ignora eventos de outras execuções.
  if (state.executionId !== executionId) return state;

  // `failed` é terminal e pode ocorrer a qualquer momento.
  if (stage === PipelineStage.failed) {
    if (state.stage === PipelineStage.failed) return state; // duplicado
    const completedStages = new Set(state.completedStages);
    completedStages.add(PipelineStage.failed);
    const stageMeta = { ...(state.stageMeta || {}) };
    stageMeta[PipelineStage.failed] = { timestamp, message };
    return {
      ...state,
      stage: PipelineStage.failed,
      lastTimestamp: timestamp,
      failedReason: message,
      completedStages,
      stageMeta,
    };
  }

  const incomingIndex = STAGE_INDEX.get(stage);
  if (!Number.isFinite(incomingIndex)) return state;

  // Não permite regressão ou duplicação.
  if (incomingIndex <= state.lastStageIndex) return state;

  // Não permite salto ilegal (apenas próximo estágio).
  if (incomingIndex !== state.lastStageIndex + 1) return state;

  const completedStages = new Set(state.completedStages);
  completedStages.add(stage);
  const stageMeta = { ...(state.stageMeta || {}) };
  stageMeta[stage] = { timestamp, message };

  return {
    ...state,
    stage,
    lastStageIndex: incomingIndex,
    completedStages,
    stageMeta,
    lastTimestamp: timestamp,
    failedReason: null,
  };
}

export function usePipelineMachine() {
  const [state, dispatch] = useReducer(pipelineReducer, undefined, createInitialPipelineState);

  const api = useMemo(() => {
    return {
      state,
      dispatch,
      reset: () => dispatch({ type: 'PIPELINE_RESET' }),
      start: (executionId) => dispatch({ type: 'PIPELINE_START', executionId }),
      acceptEvent: (evt) =>
        dispatch({
          type: 'PIPELINE_EVENT',
          executionId: evt?.executionId,
          stage: evt?.stage,
          timestamp: evt?.timestamp,
          message: evt?.message,
        }),
      isCompleted: (stage) => state.completedStages.has(stage),
    };
  }, [state]);

  return api;
}

