'use strict';

/**
 * engine/engineeringMission/bugFinding/routing.js
 *
 * TRADUÇÃO finding → contrato de trabalho para o Engineer Router EXISTENTE. Este módulo NÃO escolhe
 * modelo nem provider (isso é do Router: capability fit + saúde + custo + risco, com credencial
 * real). Aqui só se declara o que a CORREÇÃO exige — capabilities, tipo de task, critérios de
 * aceite — a partir de categoria/severidade/subsistemas.
 *
 * Nunca há lista vendor-specific: DeepSeek/Qwen/Claude/OpenAI/Kimi são recursos do Router.
 *
 * Módulo PURO.
 */

const { CAPABILITIES, TASK_TYPES } = require('../../engineeringRouter/constants');
const { FINDING_CATEGORIES, SEVERITY_RANK } = require('./constants');

/** Capabilities por categoria de finding. */
const CAPABILITIES_BY_CATEGORY = Object.freeze({
  BUG: ['CODING', 'DEBUGGING', 'TEST_GENERATION'],
  DATA: ['DATABASE', 'CODING', 'DEBUGGING'],
  SECURITY: ['SECURITY_REVIEW', 'CODING', 'CODE_REVIEW'],
  CONCURRENCY: ['CODING', 'DEBUGGING', 'ARCHITECTURE'],
  RECOVERY: ['DEBUGGING', 'CODING'],
  GOVERNANCE: ['GOVERNANCE', 'CODE_REVIEW', 'REPOSITORY_AUDIT'],
  TIMEOUT: ['DEBUGGING', 'CODING', 'ARCHITECTURE'],
  PROVIDER: ['DEBUGGING', 'CODING'],
  INFRA: ['DOCKER_INFRA', 'DEBUGGING'],
  CONFIGURATION: ['DEBUGGING', 'GOVERNANCE'],
  PERFORMANCE: ['CODING', 'ARCHITECTURE', 'DEBUGGING'],
  TEST_DEFECT: ['TEST_GENERATION', 'CODING'],
  UNKNOWN: ['CODING', 'DEBUGGING'],
});

/** Tipo de task no Router por categoria (o Router classifica; aqui só damos o sinal correto). */
const TASK_TYPE_BY_CATEGORY = Object.freeze({
  GOVERNANCE: 'GOVERNANCE',
  SECURITY: 'COMPLEX_BUG_FIX',
  DATA: 'COMPLEX_BUG_FIX',
  CONCURRENCY: 'COMPLEX_BUG_FIX',
  RECOVERY: 'COMPLEX_BUG_FIX',
  TEST_DEFECT: 'TEST_GENERATION',
  INFRA: 'BUG_FIX',
  PROVIDER: 'BUG_FIX',
  CONFIGURATION: 'BUG_FIX',
  TIMEOUT: 'COMPLEX_BUG_FIX',
  PERFORMANCE: 'COMPLEX_BUG_FIX',
  BUG: 'BUG_FIX',
  UNKNOWN: 'BUG_FIX',
});

const FRONTEND_PATTERN = /(^|\/)(frontend|frontend-e2e)\/|\.jsx?$|\.tsx?$|frontend/i;

/** Indica se o fix toca frontend (por caminhos/subsistemas afetados). */
function touchesFrontend({ paths = [], subsystems = [] } = {}) {
  const list = [...(Array.isArray(paths) ? paths : []), ...(Array.isArray(subsystems) ? subsystems : [])];
  return list.some((entry) => FRONTEND_PATTERN.test(String(entry || '')));
}

function unique(list) {
  return Array.from(new Set(list.filter((c) => CAPABILITIES.includes(c))));
}

/**
 * Capabilities exigidas do CODER e do REVISOR.
 *   - HIGH/CRITICAL exigem CODE_REVIEW (revisor independente);
 *   - SECURITY exige SECURITY_REVIEW (revisor de segurança obrigatório, BUG-16);
 *   - frontend afetado acrescenta FRONTEND.
 */
function deriveCapabilities({ category = 'UNKNOWN', severity = 'MEDIUM', paths = [], subsystems = [] } = {}) {
  const base = CAPABILITIES_BY_CATEGORY[category] || CAPABILITIES_BY_CATEGORY.UNKNOWN;
  const coder = [...base];
  if (touchesFrontend({ paths, subsystems })) coder.push('FRONTEND');

  const reviewer = ['CODE_REVIEW'];
  if (category === 'SECURITY') reviewer.push('SECURITY_REVIEW');
  if (category === 'GOVERNANCE') reviewer.push('GOVERNANCE');
  if (category === 'DATA') reviewer.push('DATABASE');
  if (SEVERITY_RANK[severity] >= SEVERITY_RANK.HIGH) reviewer.push('DEBUGGING');

  return {
    coder: unique(coder),
    reviewer: unique(reviewer),
    requiresIndependentReviewer: SEVERITY_RANK[severity] >= SEVERITY_RANK.HIGH,
    requiresSecurityReviewer: category === 'SECURITY' || SEVERITY_RANK[severity] >= SEVERITY_RANK.CRITICAL,
  };
}

/** Tipo de task do Router para esta categoria, elevando para COMPLEX_BUG_FIX em HIGH/CRITICAL. */
function deriveTaskType({ category = 'UNKNOWN', severity = 'MEDIUM' } = {}) {
  const mapped = TASK_TYPE_BY_CATEGORY[category] || 'BUG_FIX';
  if (!TASK_TYPES.includes(mapped)) return 'BUG_FIX';
  if (mapped === 'BUG_FIX' && SEVERITY_RANK[severity] >= SEVERITY_RANK.HIGH) return 'COMPLEX_BUG_FIX';
  return mapped;
}

/**
 * Contrato de correção para `engineeringTaskService.createTask`. O escopo de caminhos NUNCA é
 * inventado: vem dos arquivos afetados declarados no finding ou da MissionSpec corrente. Sem escopo
 * e sem autorização explícita, o chamador recebe `allowedPaths: []` — e o Router é fail-closed
 * (`NO_PATCH_SCOPE`), nunca "tudo permitido".
 */
function buildFixTaskContract({
  finding = {},
  allowedPaths = [],
  forbiddenPaths = [],
  explicitPolicyAuthorization = false,
  maxIterations = undefined,
} = {}) {
  const category = finding.category || 'UNKNOWN';
  const severity = finding.severity || 'MEDIUM';
  const paths = Array.isArray(allowedPaths) && allowedPaths.length > 0
    ? allowedPaths
    : (Array.isArray(finding.affectedFiles) ? finding.affectedFiles : []);

  const capabilities = deriveCapabilities({
    category,
    severity,
    paths,
    subsystems: finding.affectedSubsystems,
  });

  // Comandos de teste da correção: a PRÓPRIA reprodução (que era vermelha e deve ficar verde) mais
  // as regressões declaradas. Sem duplicatas; a allowlist de comandos continua sendo do Router.
  const reproductionCommand = finding.reproduction && typeof finding.reproduction.command === 'string'
    ? finding.reproduction.command
    : null;
  const testCommands = Array.from(new Set([
    ...(reproductionCommand ? [reproductionCommand] : []),
    ...(Array.isArray(finding.regressionCommands) ? finding.regressionCommands : []),
  ].filter(Boolean)));

  return {
    // O id do finding vai no TÍTULO de propósito: a task nasce no Router e precisa ser
    // rastreável de volta ao bug sem consultar o banco (BUG-07).
    title: `[BUG ${severity}] ${finding.title || 'finding sem título'} (${finding.id || 'sem-id'})`,
    objective: [
      `Corrigir finding ${finding.id} (${category}/${severity}) na causa raiz, não no sintoma.`,
      finding.expectedBehavior ? `Comportamento esperado: ${finding.expectedBehavior}` : null,
      finding.observedBehavior ? `Comportamento observado: ${finding.observedBehavior}` : null,
      finding.rootCause ? `Causa raiz: ${finding.rootCause}` : null,
    ].filter(Boolean).join('\n'),
    taskType: deriveTaskType({ category, severity }),
    risk: severity === 'CRITICAL' ? 'CRITICAL' : (severity === 'HIGH' ? 'HIGH' : (severity === 'MEDIUM' ? 'MEDIUM' : 'LOW')),
    requiredCapabilities: capabilities.coder,
    reviewerCapabilities: capabilities.reviewer,
    requiresIndependentReviewer: capabilities.requiresIndependentReviewer,
    allowedPaths: paths,
    forbiddenPaths: Array.isArray(forbiddenPaths) ? forbiddenPaths : [],
    explicitPolicyAuthorization: explicitPolicyAuthorization === true,
    acceptanceCriteria: [
      `A reprodução registrada no finding ${finding.id} passa a ser verde`,
      'Testes direcionados passam',
      'Nenhuma regressão relevante quebrada',
      ...(Array.isArray(finding.acceptanceCriteria) ? finding.acceptanceCriteria : []),
    ],
    testCommands,
    maxIterations: maxIterations || undefined,
    releaseBlocker: SEVERITY_RANK[severity] >= SEVERITY_RANK.HIGH,
    findingId: finding.id || null,
    missionId: finding.missionId || null,
    missionVersion: finding.missionVersion || null,
    missionSpecHash: finding.missionSpecHash || null,
    evidenceRefs: Array.isArray(finding.evidenceRefs) ? finding.evidenceRefs : [],
    selfModification: finding.selfModification === true,
  };
}

module.exports = {
  CAPABILITIES_BY_CATEGORY,
  deriveCapabilities,
  deriveTaskType,
  touchesFrontend,
  buildFixTaskContract,
  FINDING_CATEGORIES,
};
