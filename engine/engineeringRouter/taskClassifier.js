'use strict';

/**
 * engine/engineeringRouter/taskClassifier.js
 *
 * TaskClassifier V1 — determinístico, regras versionadas. Sem ML (por escopo congelado da
 * missão). Quando a classificação já vem explícita no Task Contract (`task.taskType`,
 * `task.risk`, `task.scope`), o classifier NÃO a sobrescreve silenciosamente — apenas
 * complementa `requiredCapabilities`/`recommendedRoles` que não tenham sido informados.
 *
 * Módulo puro (sem I/O).
 */

const { TASK_TYPES, RISK_LEVELS, TASK_SCOPES, CAPABILITIES } = require('./constants');

const CLASSIFIER_VERSION = '1.0.0';

const TASK_TYPE_SET = new Set(TASK_TYPES);
const RISK_SET = new Set(RISK_LEVELS);
const SCOPE_SET = new Set(TASK_SCOPES);

/**
 * Regras determinísticas: para cada taskType, quais capabilities são exigidas e qual risco
 * mínimo faz sentido por padrão (o risco declarado explicitamente no contrato sempre vence).
 */
const TASK_TYPE_RULES = Object.freeze({
  CODE_GENERATION: { capabilities: ['CODING'], defaultRisk: 'MEDIUM' },
  BUG_FIX: { capabilities: ['CODING', 'DEBUGGING'], defaultRisk: 'LOW' },
  COMPLEX_BUG_FIX: { capabilities: ['CODING', 'DEBUGGING', 'TOOL_USE'], defaultRisk: 'HIGH' },
  REFACTOR: { capabilities: ['CODING', 'ARCHITECTURE'], defaultRisk: 'MEDIUM' },
  TEST_GENERATION: { capabilities: ['TEST_GENERATION', 'CODING'], defaultRisk: 'LOW' },
  CODE_REVIEW: { capabilities: ['CODE_REVIEW'], defaultRisk: 'LOW' },
  SECURITY_REVIEW: { capabilities: ['SECURITY_REVIEW', 'CODE_REVIEW'], defaultRisk: 'CRITICAL' },
  DATABASE_CHANGE: { capabilities: ['DATABASE', 'CODING'], defaultRisk: 'HIGH' },
  FRONTEND: { capabilities: ['FRONTEND', 'CODING'], defaultRisk: 'MEDIUM' },
  DOCKER_INFRA: { capabilities: ['DOCKER_INFRA'], defaultRisk: 'HIGH' },
  GOVERNANCE: { capabilities: ['GOVERNANCE'], defaultRisk: 'HIGH' },
  RELEASE: { capabilities: ['RELEASE', 'GOVERNANCE'], defaultRisk: 'CRITICAL' },
  REPOSITORY_AUDIT: { capabilities: ['REPOSITORY_AUDIT'], defaultRisk: 'LOW' },
});

/**
 * Heurísticas determinísticas de detecção de taskType a partir de sinais explícitos do
 * contexto (nunca a partir de texto livre interpretado por LLM). Usadas somente quando
 * `task.taskType` não foi informado.
 */
function inferTaskType(task, context) {
  const hint = String(task?.objective || task?.title || '').toLowerCase();
  const paths = Array.isArray(task?.allowedPaths) ? task.allowedPaths : [];
  const failingTests = Array.isArray(context?.failingTests) ? context.failingTests : [];

  if (paths.some((p) => /governance\//.test(p) || /qa-mesh\//.test(p))) return 'GOVERNANCE';
  if (paths.some((p) => /docker|compose|dockerfile/i.test(p))) return 'DOCKER_INFRA';
  if (paths.some((p) => /migrations?\//.test(p) || /models\//.test(p))) return 'DATABASE_CHANGE';
  if (paths.some((p) => /frontend\//.test(p))) return 'FRONTEND';
  if (paths.some((p) => /release/.test(p))) return 'RELEASE';
  if (hint.includes('security') || hint.includes('segurança')) return 'SECURITY_REVIEW';
  if (hint.includes('audit') || hint.includes('auditoria')) return 'REPOSITORY_AUDIT';
  if (hint.includes('review') || hint.includes('revisão')) return 'CODE_REVIEW';
  if (hint.includes('test') || hint.includes('teste')) return 'TEST_GENERATION';
  if (hint.includes('refactor') || hint.includes('refatora')) return 'REFACTOR';
  if (failingTests.length > 1) return 'COMPLEX_BUG_FIX';
  if (failingTests.length === 1 || hint.includes('bug') || hint.includes('fix') || hint.includes('corrig')) {
    return 'BUG_FIX';
  }
  return 'CODE_GENERATION';
}

function inferScope(task) {
  const allowed = Array.isArray(task?.allowedPaths) ? task.allowedPaths : [];
  if (allowed.length === 0) return 'MEDIUM';
  if (allowed.some((p) => p === '**' || p === '.' || p === './')) return 'REPOSITORY_WIDE';
  if (allowed.length === 1) return 'SMALL';
  if (allowed.length <= 3) return 'MEDIUM';
  return 'LARGE';
}

/**
 * Classifica uma EngineeringTask.
 *
 * @param {Object} task - Task Contract (parcial ou completo)
 * @param {Object} [context] - Sinais adicionais (ex.: failingTests, previousAttempts)
 * @returns {{taskType:string, risk:string, scope:string, requiredCapabilities:string[], recommendedRoles:string[], classifierVersion:string, overridesRespected:boolean}}
 */
function classify(task = {}, context = {}) {
  const explicitTaskType = TASK_TYPE_SET.has(task.taskType) ? task.taskType : null;
  const taskType = explicitTaskType || inferTaskType(task, context);
  if (!TASK_TYPE_SET.has(taskType)) {
    throw new Error(`TaskClassifier: taskType inválido "${taskType}"`);
  }

  const rule = TASK_TYPE_RULES[taskType];

  const explicitRisk = RISK_SET.has(task.risk) ? task.risk : null;
  const risk = explicitRisk || rule.defaultRisk;

  const explicitScope = SCOPE_SET.has(task.scope) ? task.scope : null;
  const scope = explicitScope || inferScope(task);

  const explicitCapabilities = Array.isArray(task.requiredCapabilities) && task.requiredCapabilities.length > 0
    ? task.requiredCapabilities.filter((c) => CAPABILITIES.includes(c))
    : null;
  // Contrato explícito nunca é silenciosamente alterado: apenas complementa com o mínimo da
  // regra do taskType se algo faltar, sem remover o que já foi declarado.
  const requiredCapabilities = explicitCapabilities
    ? Array.from(new Set([...explicitCapabilities, ...rule.capabilities]))
    : [...rule.capabilities];

  const recommendedRoles = ['CODER'];
  if (taskType === 'CODE_REVIEW' || taskType === 'SECURITY_REVIEW' || risk === 'HIGH' || risk === 'CRITICAL') {
    recommendedRoles.push('REVIEWER');
  }

  return {
    taskType,
    risk,
    scope,
    requiredCapabilities,
    recommendedRoles,
    classifierVersion: CLASSIFIER_VERSION,
    overridesRespected: Boolean(explicitTaskType || explicitRisk || explicitScope || explicitCapabilities),
  };
}

module.exports = {
  CLASSIFIER_VERSION,
  TASK_TYPE_RULES,
  classify,
};
