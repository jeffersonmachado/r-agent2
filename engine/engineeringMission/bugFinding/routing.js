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
 * ── FRONTEIRA PERSISTÊNCIA → CONTRATO ───────────────────────────────────────────
 *
 * Este contrato lê o finding em camelCase; `bugFindingService.getFinding` devolve as linhas CRUAS
 * do Sequelize, em snake_case. Nada normalizava essa fronteira, e o efeito era silencioso: campos
 * PRESENTES no banco chegavam aqui como `undefined`.
 *
 * Medido em 2026-10-08 (fix task d84bdab8, INC-3B): o `objective` é montado com
 * `expectedBehavior`/`observedBehavior`/`rootCause`. Os três existiam no banco
 * (`expected_behavior`, `observed_behavior`, `root_cause`) e mesmo assim a task nasceu com UMA
 * linha — "Corrigir finding X (BUG/MEDIUM) na causa raiz, não no sintoma" — sem o comportamento
 * esperado, o observado nem a causa raiz. O coder recebia objetivo genérico para um defeito
 * descrito em detalhe. Não era dado ausente (ausência de dado é um fato); era dado presente que o
 * contrato não enxergava.
 *
 * `FIELD_ALIASES` aceita as DUAS grafias de propósito: o contrato é chamado tanto com a linha crua
 * do banco quanto com objetos já normalizados (memória de engenharia, testes), e nenhum dos dois é
 * errado. Nada é inventado: campo vazio continua vazio.
 */
const FIELD_ALIASES = Object.freeze({
  affectedFiles: 'affected_files',
  affectedSubsystems: 'affected_subsystems',
  expectedBehavior: 'expected_behavior',
  observedBehavior: 'observed_behavior',
  rootCause: 'root_cause',
  acceptanceCriteria: 'acceptance_criteria',
  regressionCommands: 'regression_commands',
  missionId: 'mission_id',
  missionVersion: 'mission_version',
  missionSpecHash: 'mission_spec_hash',
  evidenceRefs: 'evidence_refs',
  selfModification: 'self_modification',
});

/**
 * Valor de um campo do finding aceitando camelCase (forma do contrato) ou snake_case (linha crua
 * do banco). O valor NÃO-vaZIO declarado em camelCase tem precedência; sem ele, cai para o alias.
 */
function fieldOf(finding, name) {
  if (!finding) return undefined;
  const value = finding[name];
  if (value !== undefined && value !== null) return value;
  const alias = FIELD_ALIASES[name];
  return alias ? finding[alias] : undefined;
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
  const affectedFiles = fieldOf(finding, 'affectedFiles');
  const paths = Array.isArray(allowedPaths) && allowedPaths.length > 0
    ? allowedPaths
    : (Array.isArray(affectedFiles) ? affectedFiles : []);

  const capabilities = deriveCapabilities({
    category,
    severity,
    paths,
    subsystems: fieldOf(finding, 'affectedSubsystems'),
  });

  // Comandos de teste da correção: a PRÓPRIA reprodução (que era vermelha e deve ficar verde) mais
  // as regressões declaradas. Sem duplicatas; a allowlist de comandos continua sendo do Router.
  const reproductionCommand = finding.reproduction && typeof finding.reproduction.command === 'string'
    ? finding.reproduction.command
    : null;
  const regressionCommands = fieldOf(finding, 'regressionCommands');
  const testCommands = Array.from(new Set([
    ...(reproductionCommand ? [reproductionCommand] : []),
    ...(Array.isArray(regressionCommands) ? regressionCommands : []),
  ].filter(Boolean)));

  const expectedBehavior = fieldOf(finding, 'expectedBehavior');
  const observedBehavior = fieldOf(finding, 'observedBehavior');
  const rootCause = fieldOf(finding, 'rootCause');
  const acceptanceCriteria = fieldOf(finding, 'acceptanceCriteria');

  return {
    // O id do finding vai no TÍTULO de propósito: a task nasce no Router e precisa ser
    // rastreável de volta ao bug sem consultar o banco (BUG-07).
    title: `[BUG ${severity}] ${finding.title || 'finding sem título'} (${finding.id || 'sem-id'})`,
    objective: [
      `Corrigir finding ${finding.id} (${category}/${severity}) na causa raiz, não no sintoma.`,
      expectedBehavior ? `Comportamento esperado: ${expectedBehavior}` : null,
      observedBehavior ? `Comportamento observado: ${observedBehavior}` : null,
      rootCause ? `Causa raiz: ${rootCause}` : null,
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
      ...(Array.isArray(acceptanceCriteria) ? acceptanceCriteria : []),
    ],
    testCommands,
    maxIterations: maxIterations || undefined,
    releaseBlocker: SEVERITY_RANK[severity] >= SEVERITY_RANK.HIGH,
    findingId: finding.id || null,
    missionId: fieldOf(finding, 'missionId') || null,
    missionVersion: fieldOf(finding, 'missionVersion') || null,
    missionSpecHash: fieldOf(finding, 'missionSpecHash') || null,
    evidenceRefs: Array.isArray(fieldOf(finding, 'evidenceRefs')) ? fieldOf(finding, 'evidenceRefs') : [],
    selfModification: fieldOf(finding, 'selfModification') === true,
  };
}

/**
 * ── CAUSA RAIZ: DECLARADA OU DERIVADA DA PRÓPRIA OCORRÊNCIA ───────────────────────────────────
 *
 * A memória de engenharia exige `rootCause` no problema conhecido
 * (`preventiveRules.KNOWN_PROBLEM_REQUIRED_FIELDS`) e `closeFinding` RECUSA o fechamento de um
 * finding de SELF_MODIFICATION/REINCIDENTE sem problema conhecido COMPLETO e ACTIVE.
 *
 * DEFEITO MEDIDO (2026-10-10, `governanceApprovalFullWorkerE2E`): o finding era reproduzido, a
 * correção era executada de verdade, a task chegava a GREEN com a promoção confirmada, a regressão
 * era validada — e o fechamento era recusado com
 * `KNOWN_PROBLEM_INCOMPLETE (faltando: rootCause)`, porque NENHUM produtor de finding escreve
 * `root_cause` (`hookMissionFailure`, `missionReviewService` e `bugReproductionService` registram o
 * comportamento observado, os arquivos afetados e as evidências, mas nunca a causa). O ciclo
 * autônomo travava no ÚLTIMO passo e o finding ficava órfão em REGRESSION_VALIDATED para sempre.
 * O defeito era invisível no teste de integração do laço porque a fixture daquele teste DECLARAVA
 * um `rootCause` à mão — a capacidade existia no teste e não existia em produção.
 *
 * Correção: quando ninguém declara a causa raiz, ela é ASSERTADA a partir de evidência REAL desta
 * ocorrência (o comportamento observado medido + a reprodução que foi executada), marcada como
 * DERIVADA tanto no texto quanto na proveniência do problema conhecido. Nada é inventado e nada é
 * copiado de outra ocorrência — a triagem proíbe explicitamente tratar a causa de uma ocorrência
 * ANTERIOR como causa desta (ela entra apenas como PISTA a confirmar).
 *
 * Ordem de autoridade:
 *   1. `root_cause` DECLARADO (humano/API) — vence sempre e nunca é sobrescrito;
 *   2. derivação da evidência medida desta ocorrência;
 *   3. `null` — quando não há NADA real a afirmar. O registro permanece INCOMPLETO de propósito
 *      (fail-closed) e o fechamento continua recusado: ausência de dado não vira dado.
 */
function deriveRootCauseStatement(finding) {
  const declared = fieldOf(finding, 'rootCause');
  if (typeof declared === 'string' && declared.trim() !== '') return declared.trim();

  const observed = fieldOf(finding, 'observedBehavior');
  const reproduction = finding && typeof finding.reproduction === 'object' && finding.reproduction !== null
    ? finding.reproduction
    : null;
  const command = reproduction && typeof reproduction.command === 'string' && reproduction.command.trim() !== ''
    ? reproduction.command.trim()
    : null;

  const evidence = [];
  if (typeof observed === 'string' && observed.trim() !== '') {
    evidence.push(`comportamento observado: ${observed.trim()}`);
  }
  if (command) {
    evidence.push(`reprodução executada: "${command}" (expect=${reproduction.expect || 'FAIL'})`);
  }
  if (evidence.length === 0) return null;

  const source = String(finding.source || 'UNKNOWN');
  const category = String(finding.category || 'UNKNOWN');
  return `derivada da evidência medida desta ocorrência (fonte ${source}, categoria ${category}): `
    + evidence.join('; ');
}

module.exports = {
  CAPABILITIES_BY_CATEGORY,
  deriveCapabilities,
  deriveTaskType,
  touchesFrontend,
  buildFixTaskContract,
  deriveRootCauseStatement,
  fieldOf,
  FINDING_CATEGORIES,
};
