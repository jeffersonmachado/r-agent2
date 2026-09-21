'use strict';

/**
 * engine/engineeringRouter/constants.js — vocabulário fechado do Engineering Model Router V1.
 *
 * Módulo puro (sem I/O). Fonte única de verdade para os enums usados pelo classifier, pela
 * routing policy, pelo model selector e pela state machine. Não codifica vendor nenhum aqui —
 * ver `modelCapabilities.js` para o mapeamento provider:model → capability.
 */

const TASK_TYPES = Object.freeze([
  'CODE_GENERATION',
  'BUG_FIX',
  'COMPLEX_BUG_FIX',
  'REFACTOR',
  'TEST_GENERATION',
  'CODE_REVIEW',
  'SECURITY_REVIEW',
  'DATABASE_CHANGE',
  'FRONTEND',
  'DOCKER_INFRA',
  'GOVERNANCE',
  'RELEASE',
  'REPOSITORY_AUDIT',
]);

const RISK_LEVELS = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const RISK_RANK = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });

const TASK_SCOPES = Object.freeze(['SMALL', 'MEDIUM', 'LARGE', 'REPOSITORY_WIDE']);

const CAPABILITIES = Object.freeze([
  'CODING',
  'DEBUGGING',
  'CODE_REVIEW',
  'TEST_GENERATION',
  'LONG_CONTEXT',
  'TOOL_USE',
  'ARCHITECTURE',
  'SECURITY_REVIEW',
  'REPOSITORY_AUDIT',
  'DOCKER_INFRA',
  'DATABASE',
  'FRONTEND',
  'GOVERNANCE',
  'RELEASE',
]);

const MODEL_ROLES = Object.freeze(['CODER', 'REVIEWER']);

const COST_CLASSES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'ANY']);
const CONTEXT_CLASSES = Object.freeze(['STANDARD', 'LONG', 'EXTENDED']);

/**
 * Estados da EngineeringTask (state machine). Transições válidas ficam em `stateMachine.js`.
 */
const TASK_STATES = Object.freeze([
  'CREATED',
  'CLASSIFIED',
  'ROUTED',
  'CODING',
  'TESTING',
  'REVIEWING',
  'REGRESSION',
  'GOVERNANCE',
  'GREEN',
  // ERV1-CLOSE-005: distinto de GREEN — CODER/TESTE/REVIEW/REGRESSION/GOVERNANCE passaram de
  // verdade, mas a promoção do patch validado ao repositório real não completou (target
  // divergiu, smoke pós-promoção falhou, etc.). Nunca finge GREEN quando isso acontece.
  'READY_FOR_PROMOTION',
  'RED',
  'BLOCKED',
  'CANCELLED',
]);

const TERMINAL_STATES = Object.freeze(['GREEN', 'READY_FOR_PROMOTION', 'RED', 'BLOCKED', 'CANCELLED']);

/**
 * Reason codes estruturados para decisões de roteamento — nunca texto livre gerado por LLM.
 */
const REASON_CODES = Object.freeze({
  CAPABILITY_MATCH: 'CAPABILITY_MATCH',
  CAPABILITY_MISSING: 'CAPABILITY_MISSING',
  CONTEXT_MATCH: 'CONTEXT_MATCH',
  PROVIDER_HEALTHY: 'PROVIDER_HEALTHY',
  PROVIDER_UNHEALTHY: 'PROVIDER_UNHEALTHY',
  PROVIDER_DISABLED: 'PROVIDER_DISABLED',
  PROVIDER_NO_CREDENTIAL: 'PROVIDER_NO_CREDENTIAL',
  POLICY_PRIORITY: 'POLICY_PRIORITY',
  LOWER_COST_AMONG_QUALIFIED: 'LOWER_COST_AMONG_QUALIFIED',
  INDEPENDENT_PROVIDER_APPLIED: 'INDEPENDENT_PROVIDER_APPLIED',
  INDEPENDENT_PROVIDER_UNAVAILABLE: 'INDEPENDENT_PROVIDER_UNAVAILABLE',
  NO_QUALIFIED_CANDIDATE: 'NO_QUALIFIED_CANDIDATE',
  // ERV1-CLOSE-008: modelo com falha real recente (404/retirado/auth negada) — provider pode
  // estar healthy (breaker fechado) e mesmo assim este modelId específico não funcionar.
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
});

const FAILURE_CODES = Object.freeze({
  PATCH_OUTSIDE_ALLOWED_SCOPE: 'PATCH_OUTSIDE_ALLOWED_SCOPE',
  PATCH_INVALID_FORMAT: 'PATCH_INVALID_FORMAT',
  PATCH_FORBIDDEN_FILE: 'PATCH_FORBIDDEN_FILE',
  PATCH_BINARY_CHANGE: 'PATCH_BINARY_CHANGE',
  PATCH_TOO_LARGE: 'PATCH_TOO_LARGE',
  PATCH_UNEXPECTED_DELETE: 'PATCH_UNEXPECTED_DELETE',
  PATCH_APPLY_FAILED: 'PATCH_APPLY_FAILED',
  ENGINEERING_TASK_EXHAUSTED: 'ENGINEERING_TASK_EXHAUSTED',
  COMMAND_NOT_ALLOWED: 'COMMAND_NOT_ALLOWED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  TASK_ALREADY_RUNNING: 'TASK_ALREADY_RUNNING',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  // ERV1-CLOSE-008: reroute esgotou todos os candidatos qualificados restantes (diferente de
  // NO_QUALIFIED_CODER, que é quando não havia NENHUM candidato desde o início do roteamento).
  NO_ALTERNATIVE_CANDIDATE: 'NO_ALTERNATIVE_CANDIDATE',
  // ERV1-CLOSE-004: REGRESSION/GOVERNANCE agora são checagens reais que podem reprovar — nunca
  // são só uma transição de status decorativa.
  REGRESSION_FAILED: 'REGRESSION_FAILED',
  GOVERNANCE_FAILED: 'GOVERNANCE_FAILED',
});

const FINDING_SEVERITIES = Object.freeze(['BLOCKER', 'REGRESSION', 'POST_RELEASE']);

const REVIEW_DECISIONS = Object.freeze(['APPROVE', 'REJECT']);

module.exports = {
  TASK_TYPES,
  RISK_LEVELS,
  RISK_RANK,
  TASK_SCOPES,
  CAPABILITIES,
  MODEL_ROLES,
  COST_CLASSES,
  CONTEXT_CLASSES,
  TASK_STATES,
  TERMINAL_STATES,
  REASON_CODES,
  FAILURE_CODES,
  FINDING_SEVERITIES,
  REVIEW_DECISIONS,
};
