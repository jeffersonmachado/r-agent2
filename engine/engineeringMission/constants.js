'use strict';

/**
 * engine/engineeringMission/constants.js — vocabulário fechado do Engineering Mission Compiler.
 *
 * Módulo puro (sem I/O). Uma EngineeringMission é um nível ACIMA da EngineeringTask: a task é a
 * unidade de execução do Engineer Router (patch/teste/review/regressão), a mission é o objetivo
 * de engenharia completo que pode gerar várias tasks ao longo de várias iterações.
 *
 * Não duplica a state machine de execução: os estados de execução continuam sendo os canônicos
 * de `engine/engineeringRouter/constants.js` (TASK_STATES), referenciados por `missionStatus.js`.
 * Aqui vivem apenas os estados que NÃO existem no Router — enriquecimento, materialidade e
 * aprovação.
 */

const MISSION_TYPES = Object.freeze([
  'BUG_FIX',
  'FEATURE',
  'ARCHITECTURE',
  'REFACTOR',
  'SECURITY',
  'DATABASE',
  'PERFORMANCE',
  'INTEGRATION',
  'MIGRATION',
  'RELEASE',
  'INVESTIGATION',
  'TECH_DEBT',
  'QA_HARDENING',
]);

/**
 * Estados persistidos da mission. Deliberadamente separados dos estados de execução:
 * `EXECUTING` é o único estado em que a execução real (EngineeringTask) acontece; o progresso
 * detalhado é lido da task, nunca recriado aqui.
 */
const MISSION_STATES = Object.freeze([
  'CREATED',
  'ENRICHING',
  'AWAITING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'GREEN',
  'BLOCKED',
  'FAILED',
  'DEGRADED',
]);

const TERMINAL_MISSION_STATES = Object.freeze(['GREEN', 'REJECTED', 'FAILED']);

/**
 * Status DERIVADO exibido em UI/API/CLI (§42 — status não pode mentir).
 * `AUTO_APPROVED` e `APPROVED` são projeções do MESMO estado persistido `APPROVED`, distintos
 * apenas pela origem da aprovação — nunca dois estados concorrentes.
 */
const DISPLAY_STATUSES = Object.freeze([
  'CREATED',
  'ENRICHING',
  'AWAITING_APPROVAL',
  'AUTO_APPROVED',
  'APPROVED',
  'RUNNING',
  'GREEN',
  'BLOCKED',
  'FAILED',
  'DEGRADED',
  'REJECTED',
  'CANCELLED',
]);

const APPROVAL_MODES = Object.freeze(['MANUAL', 'SAFE_ONLY', 'POLICY_BASED']);

const APPROVAL_STATES = Object.freeze(['PENDING', 'APPROVED', 'AUTO_APPROVED', 'REJECTED', 'SUPERSEDED']);

/** Categorias visuais do preview de enriquecimento (§7). */
const ENRICHMENT_TYPES = Object.freeze(['ADDED', 'MODIFIED', 'INFERRED', 'POLICY_REQUIRED', 'UNCHANGED']);

/** Fontes auditáveis de um enriquecimento (§8). Nunca raciocínio interno de modelo. */
const ENRICHMENT_SOURCES = Object.freeze([
  'USER_INPUT',
  'REPOSITORY_INSPECTION',
  'ARCHITECTURE_POLICY',
  'SECURITY_POLICY',
  'TENANCY_POLICY',
  'DATABASE_POLICY',
  'QA_POLICY',
  'RELEASE_POLICY',
  'VISIBILITY_POLICY',
  'ENGINEERING_MEMORY',
  'ENGINEERING_KNOWLEDGE',
  'RELEASE_HISTORY',
  'MODEL_ENRICHMENT',
]);

/** Materialidade de uma alteração da MissionSpec (§15). */
const MATERIALITY_LEVELS = Object.freeze(['NON_MATERIAL', 'MATERIAL', 'CRITICAL']);
const MATERIALITY_RANK = Object.freeze({ NON_MATERIAL: 0, MATERIAL: 1, CRITICAL: 2 });

/** Motivos de bloqueio de autoaprovação (§11) — administráveis por política, nunca espalhados. */
const AUTO_APPROVAL_BLOCK_REASONS = Object.freeze({
  DISABLED: 'DISABLED',
  MODE_MANUAL: 'MODE_MANUAL',
  MISSION_TYPE_NOT_ALLOWED: 'MISSION_TYPE_NOT_ALLOWED',
  REPOSITORY_NOT_ALLOWED: 'REPOSITORY_NOT_ALLOWED',
  BRANCH_NOT_ALLOWED: 'BRANCH_NOT_ALLOWED',
  SCOPE_NOT_ALLOWED: 'SCOPE_NOT_ALLOWED',
  RISK_ABOVE_POLICY: 'RISK_ABOVE_POLICY',
  CONFIDENCE_BELOW_THRESHOLD: 'CONFIDENCE_BELOW_THRESHOLD',
  DERIVED_REQUIREMENTS_NOT_ALLOWED: 'DERIVED_REQUIREMENTS_NOT_ALLOWED',
  POLICY_REQUIREMENTS_NOT_ALLOWED: 'POLICY_REQUIREMENTS_NOT_ALLOWED',
  CONTRADICTORY_REQUIREMENT: 'CONTRADICTORY_REQUIREMENT',
  MATERIAL_AMBIGUITY: 'MATERIAL_AMBIGUITY',
  IRREVERSIBLE_DESTRUCTIVE_ACTION: 'IRREVERSIBLE_DESTRUCTIVE_ACTION',
  CREDENTIAL_CHANGE: 'CREDENTIAL_CHANGE',
  SECRET_EXPOSURE: 'SECRET_EXPOSURE',
  SECURITY_POLICY_CHANGE: 'SECURITY_POLICY_CHANGE',
  TENANT_ISOLATION_CHANGE: 'TENANT_ISOLATION_CHANGE',
  INCOMPATIBLE_SCHEMA_CHANGE: 'INCOMPATIBLE_SCHEMA_CHANGE',
  DESTRUCTIVE_PRODUCTION_OPERATION: 'DESTRUCTIVE_PRODUCTION_OPERATION',
  DEVELOPMENT_SUPPORT_EXPOSURE_IN_PRODUCTION: 'DEVELOPMENT_SUPPORT_EXPOSURE_IN_PRODUCTION',
  RBAC_CRITICAL_CHANGE: 'RBAC_CRITICAL_CHANGE',
});

/** Códigos de falha estruturados (nunca texto livre). */
const MISSION_FAILURE_CODES = Object.freeze({
  ORIGINAL_MISSION_MUTATED: 'ORIGINAL_MISSION_MUTATED',
  MISSION_SPEC_NOT_APPROVED: 'MISSION_SPEC_NOT_APPROVED',
  MISSION_SPEC_VERSION_CONFLICT: 'MISSION_SPEC_VERSION_CONFLICT',
  MISSION_APPROVAL_NOT_FOUND: 'MISSION_APPROVAL_NOT_FOUND',
  MISSION_STALE_VERSION: 'MISSION_STALE_VERSION',
  MISSION_REJECTED: 'MISSION_REJECTED',
  MISSION_LOCKED_BY_OTHER_WORKER: 'MISSION_LOCKED_BY_OTHER_WORKER',
  INVALID_MISSION_TRANSITION: 'INVALID_MISSION_TRANSITION',
  ENRICHMENT_FAILED: 'ENRICHMENT_FAILED',
  MISSION_TASK_NOT_LINKED: 'MISSION_TASK_NOT_LINKED',
  CREDENTIAL_UNAVAILABLE: 'CREDENTIAL_UNAVAILABLE',
});

/** Tipos de evento do histórico de versões/aprovações (§13, §29). */
const MISSION_VERSION_EVENTS = Object.freeze([
  'ENRICHED',
  'RE_ENRICHED',
  'MATERIAL_CHANGE_APPLIED',
  'APPROVED',
  'AUTO_APPROVED',
  'REJECTED',
  'VERSION_SUPERSEDED',
]);

module.exports = {
  MISSION_TYPES,
  MISSION_STATES,
  TERMINAL_MISSION_STATES,
  DISPLAY_STATUSES,
  APPROVAL_MODES,
  APPROVAL_STATES,
  ENRICHMENT_TYPES,
  ENRICHMENT_SOURCES,
  MATERIALITY_LEVELS,
  MATERIALITY_RANK,
  AUTO_APPROVAL_BLOCK_REASONS,
  MISSION_FAILURE_CODES,
  MISSION_VERSION_EVENTS,
};
