'use strict';

/**
 * engine/engineeringRouter/routingPolicy.js
 *
 * Engineering Routing Policy — versionada, declarativa, sem `if vendor/model` espalhado pelo
 * código. Cada taskType declara: capabilities exigidas para CODER e para REVIEWER, classe de
 * custo preferida, se exige review independente e o número máximo de iterações padrão do
 * loop RED→FIX (o Task Contract pode sobrescrever `maxIterations`).
 *
 * Módulo puro (sem I/O).
 */

const { RISK_RANK } = require('./constants');

const POLICY_VERSION = '1.0.0';

const DEFAULT_MAX_ITERATIONS = 3;

/**
 * requiresIndependentReview: 'ALWAYS' | 'BY_RISK' | 'NEVER'.
 *   'BY_RISK' aplica independência de provider quando risk é HIGH ou CRITICAL (regra global
 *   de independência definida em `modelSelector.js`), conforme a missão.
 */
const POLICY = Object.freeze({
  CODE_GENERATION: {
    coderCapabilities: ['CODING'],
    reviewerCapabilities: ['CODE_REVIEW'],
    preferredCostClass: 'ANY',
    requiresIndependentReview: 'BY_RISK',
    defaultMaxIterations: DEFAULT_MAX_ITERATIONS,
  },
  BUG_FIX: {
    coderCapabilities: ['CODING', 'DEBUGGING'],
    reviewerCapabilities: ['CODE_REVIEW'],
    preferredCostClass: 'LOW',
    requiresIndependentReview: 'BY_RISK',
    defaultMaxIterations: DEFAULT_MAX_ITERATIONS,
  },
  COMPLEX_BUG_FIX: {
    coderCapabilities: ['CODING', 'DEBUGGING', 'TOOL_USE'],
    reviewerCapabilities: ['CODE_REVIEW', 'ARCHITECTURE'],
    preferredCostClass: 'ANY',
    requiresIndependentReview: 'ALWAYS',
    defaultMaxIterations: 5,
  },
  REFACTOR: {
    coderCapabilities: ['CODING', 'ARCHITECTURE'],
    reviewerCapabilities: ['CODE_REVIEW', 'ARCHITECTURE'],
    preferredCostClass: 'ANY',
    requiresIndependentReview: 'BY_RISK',
    defaultMaxIterations: DEFAULT_MAX_ITERATIONS,
  },
  TEST_GENERATION: {
    coderCapabilities: ['TEST_GENERATION', 'CODING'],
    reviewerCapabilities: ['CODE_REVIEW'],
    preferredCostClass: 'LOW',
    requiresIndependentReview: 'NEVER',
    defaultMaxIterations: DEFAULT_MAX_ITERATIONS,
  },
  CODE_REVIEW: {
    coderCapabilities: ['CODING'],
    reviewerCapabilities: ['CODE_REVIEW'],
    preferredCostClass: 'ANY',
    requiresIndependentReview: 'ALWAYS',
    defaultMaxIterations: 1,
  },
  SECURITY_REVIEW: {
    coderCapabilities: ['CODING'],
    reviewerCapabilities: ['SECURITY_REVIEW', 'CODE_REVIEW'],
    preferredCostClass: 'ANY',
    requiresIndependentReview: 'ALWAYS',
    defaultMaxIterations: 2,
  },
  DATABASE_CHANGE: {
    coderCapabilities: ['DATABASE', 'CODING'],
    reviewerCapabilities: ['DATABASE', 'CODE_REVIEW'],
    preferredCostClass: 'ANY',
    requiresIndependentReview: 'ALWAYS',
    defaultMaxIterations: DEFAULT_MAX_ITERATIONS,
  },
  FRONTEND: {
    coderCapabilities: ['FRONTEND', 'CODING'],
    reviewerCapabilities: ['CODE_REVIEW'],
    preferredCostClass: 'LOW',
    requiresIndependentReview: 'BY_RISK',
    defaultMaxIterations: DEFAULT_MAX_ITERATIONS,
  },
  DOCKER_INFRA: {
    coderCapabilities: ['DOCKER_INFRA'],
    reviewerCapabilities: ['DOCKER_INFRA', 'CODE_REVIEW'],
    preferredCostClass: 'ANY',
    requiresIndependentReview: 'ALWAYS',
    defaultMaxIterations: DEFAULT_MAX_ITERATIONS,
  },
  GOVERNANCE: {
    coderCapabilities: ['GOVERNANCE'],
    reviewerCapabilities: ['GOVERNANCE', 'CODE_REVIEW'],
    preferredCostClass: 'ANY',
    requiresIndependentReview: 'ALWAYS',
    defaultMaxIterations: DEFAULT_MAX_ITERATIONS,
  },
  RELEASE: {
    coderCapabilities: ['RELEASE', 'GOVERNANCE'],
    reviewerCapabilities: ['RELEASE', 'GOVERNANCE'],
    preferredCostClass: 'ANY',
    requiresIndependentReview: 'ALWAYS',
    defaultMaxIterations: 2,
  },
  REPOSITORY_AUDIT: {
    coderCapabilities: ['REPOSITORY_AUDIT'],
    reviewerCapabilities: ['CODE_REVIEW'],
    preferredCostClass: 'LOW',
    requiresIndependentReview: 'NEVER',
    defaultMaxIterations: 1,
  },
});

function getPolicy(taskType) {
  const policy = POLICY[taskType];
  if (!policy) throw new Error(`RoutingPolicy: taskType desconhecido "${taskType}"`);
  return { ...policy, policyVersion: POLICY_VERSION };
}

/**
 * Decide, para uma task já classificada, se a independência de provider entre CODER e
 * REVIEWER deve ser exigida.
 */
function requiresIndependentReview(taskType, risk) {
  const policy = getPolicy(taskType);
  if (policy.requiresIndependentReview === 'ALWAYS') return true;
  if (policy.requiresIndependentReview === 'NEVER') return false;
  // BY_RISK: HIGH/CRITICAL exigem independência, conforme a missão.
  return RISK_RANK[risk] >= RISK_RANK.HIGH;
}

function resolveMaxIterations(taskType, taskContractMaxIterations) {
  if (Number.isInteger(taskContractMaxIterations) && taskContractMaxIterations > 0) {
    return taskContractMaxIterations;
  }
  return getPolicy(taskType).defaultMaxIterations;
}

module.exports = {
  POLICY_VERSION,
  POLICY,
  getPolicy,
  requiresIndependentReview,
  resolveMaxIterations,
};
