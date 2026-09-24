'use strict';

/**
 * engine/engineeringMission/missionStatus.js — status exibido sem mentir (§42).
 *
 * "Enriched" ≠ "Approved"; "Approved" ≠ "Completed"; "Generation completed" ≠ "Engineering
 * mission completed". O status exibido é DERIVADO de duas fontes canônicas:
 *   - `mission.status` (persistido, estados de missão — ver constants.js)
 *   - status da EngineeringTask vinculada (TASK_STATES canônicos do Router — não recriados aqui)
 *
 * Mapeamento de execução reusa a semântica já fixada no Router: `READY_FOR_PROMOTION` NUNCA é
 * GREEN (o patch passou nos gates mas não foi promovido) — é DEGRADED, e a UI precisa mostrar isso.
 *
 * Módulo puro (sem I/O).
 */

const { DISPLAY_STATUSES } = require('./constants');
const { TASK_STATES, TERMINAL_STATES, TASK_TYPES } = require('../engineeringRouter/constants');

const TASK_TO_DISPLAY = Object.freeze({
  GREEN: 'GREEN',
  READY_FOR_PROMOTION: 'DEGRADED',
  RED: 'FAILED',
  BLOCKED: 'BLOCKED',
  CANCELLED: 'CANCELLED',
});

/**
 * Normaliza a linha persistida (snake_case) para o shape do contrato (camelCase).
 * Sem isto, `approvalState` chega `undefined` e uma missão autoaprovada é exibida como
 * "APPROVED" — apagando exatamente a distinção que o §42 proíbe (automação não pode ficar
 * indistinguível de decisão humana). Defeito real medido com banco real.
 */
function normalizeMissionForDisplay(mission) {
  if (!mission) return mission;
  return {
    ...mission,
    approvalState: mission.approvalState ?? mission.approval_state ?? null,
  };
}

/**
 * @param {{id:string, status:string, approvalState?:string|null}} mission
 * @param {{status:string}|null} [task]
 * @returns {string} um de DISPLAY_STATUSES
 */
function deriveDisplayStatus(missionInput, task = null) {
  const mission = normalizeMissionForDisplay(missionInput);
  if (!mission) return 'CREATED';
  const status = mission.status;

  switch (status) {
    case 'CREATED':
      return 'CREATED';
    case 'ENRICHING':
      return 'ENRICHING';
    case 'AWAITING_APPROVAL':
      return 'AWAITING_APPROVAL';
    case 'APPROVED':
      return mission.approvalState === 'AUTO_APPROVED' ? 'AUTO_APPROVED' : 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'GREEN':
      return 'GREEN';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'FAILED':
      return 'FAILED';
    case 'DEGRADED':
      return 'DEGRADED';
    case 'EXECUTING': {
      if (!task) return 'RUNNING';
      const taskStatus = task.status;
      if (!TASK_STATES.includes(taskStatus)) return 'RUNNING';
      if (Object.prototype.hasOwnProperty.call(TASK_TO_DISPLAY, taskStatus)) return TASK_TO_DISPLAY[taskStatus];
      return TERMINAL_STATES.includes(taskStatus) ? 'DEGRADED' : 'RUNNING';
    }
    default:
      return 'CREATED';
  }
}

/** Vocabulário de status de missão → rótulo humano (nunca inferido no frontend). */
function describeStatus(displayStatus) {
  const labels = {
    CREATED: 'missão criada, ainda não enriquecida',
    ENRICHING: 'compilando intenção e coletando contexto',
    AWAITING_APPROVAL: 'missão enriquecida aguardando aprovação',
    AUTO_APPROVED: 'missão enriquecida autoaprovada por política (preview persistido)',
    APPROVED: 'missão aprovada por decisão explícita',
    RUNNING: 'executando no Engineer Router',
    GREEN: 'todos os gates obrigatórios passaram',
    BLOCKED: 'bloqueada (falta aprovação, credencial, dependência ou decisão)',
    FAILED: 'execução falhou — requer correção ou nova missão',
    DEGRADED: 'gates parciais: progresso real, sem GREEN (ex.: patch validado não promovido)',
    REJECTED: 'missão enriquecida rejeitada por decisão explícita',
    CANCELLED: 'execução cancelada',
  };
  return labels[displayStatus] || null;
}

function isValidDisplayStatus(value) {
  return DISPLAY_STATUSES.includes(value);
}

/**
 * Tradução de vocabulário missão → EngineeringTask. É tradução de vocabulário, NÃO uma segunda
 * taxonomia: os valores de destino são exatamente os `TASK_TYPES` canônicos do Router, e um tipo
 * de missão sem correspondência falha alto em vez de virar um tipo inventado.
 */
const MISSION_TO_TASK_TYPE = Object.freeze({
  BUG_FIX: 'BUG_FIX',
  FEATURE: 'CODE_GENERATION',
  ARCHITECTURE: 'REFACTOR',
  REFACTOR: 'REFACTOR',
  SECURITY: 'SECURITY_REVIEW',
  DATABASE: 'DATABASE_CHANGE',
  PERFORMANCE: 'COMPLEX_BUG_FIX',
  INTEGRATION: 'CODE_GENERATION',
  MIGRATION: 'DATABASE_CHANGE',
  RELEASE: 'RELEASE',
  INVESTIGATION: 'REPOSITORY_AUDIT',
  TECH_DEBT: 'REFACTOR',
  QA_HARDENING: 'TEST_GENERATION',
});

function toEngineeringTaskType(missionType) {
  const mapped = MISSION_TO_TASK_TYPE[missionType];
  if (!mapped) {
    const err = new Error(`missionType "${missionType}" não tem correspondência em TASK_TYPES do Engineering Router`);
    err.code = 'MISSION_TYPE_NOT_MAPPED';
    throw err;
  }
  if (!TASK_TYPES.includes(mapped)) {
    const err = new Error(`mapeamento inválido: "${missionType}" → "${mapped}" não é um TASK_TYPE canônico`);
    err.code = 'MISSION_TYPE_NOT_MAPPED';
    throw err;
  }
  return mapped;
}

module.exports = {
  TASK_TO_DISPLAY,
  MISSION_TO_TASK_TYPE,
  normalizeMissionForDisplay,
  deriveDisplayStatus,
  describeStatus,
  isValidDisplayStatus,
  toEngineeringTaskType,
};
