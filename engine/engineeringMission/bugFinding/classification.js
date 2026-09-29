'use strict';

/**
 * engine/engineeringMission/bugFinding/classification.js
 *
 * TRIAGEM DETERMINÍSTICA: categoria, severidade e elegibilidade de confirmação.
 *
 * Regras que este módulo encarna e que a missão exige explicitamente:
 *   - suspeita de LLM NUNCA confirma (BUG-02): `LLM_SUSPICION` não está entre as bases objetivas;
 *   - TIMEOUT isolado NUNCA vira bug automaticamente (BUG-12): só é confirmável com base objetiva
 *     correspondente; senão o finding fica SUSPECTED/UNKNOWN e é roteado para diagnóstico;
 *   - severidade é derivada de SINAIS OBJETIVOS, nunca do texto de um modelo (o `severityHint` de
 *     LLM é registrado apenas como advisory e não altera a decisão);
 *   - correção de APLICAÇÃO só é roteada quando a categoria é de código: INFRA/PROVIDER/
 *     CONFIGURATION/DATA não viram patch de aplicação por engano.
 */

const {
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  SEVERITY_RANK,
  SEVERITY_ORDER,
  CONFIRMATION_BASES,
  NON_CONFIRMATION_BASES,
  SUSPICION_ONLY_SOURCES,
  INDEPENDENT_REVIEW_SEVERITIES,
  BUG_FAILURE_CODES,
} = require('./constants');

/**
 * SINAIS CRÍTICOS objetivos. Cada um é verificável a partir de `input.signals` (explicitado pelo
 * detector, ex.: o gate de governança que sabe que houve GO com child NO_GO) ou de campos/texto
 * estruturados — nunca de uma opinião.
 */
const CRITICAL_SIGNALS = Object.freeze({
  TENANT_ISOLATION: 'TENANT_ISOLATION',
  PRIVILEGE_ESCALATION: 'PRIVILEGE_ESCALATION',
  DATA_CORRUPTION: 'DATA_CORRUPTION',
  FALSE_RELEASE: 'FALSE_RELEASE',
  STALE_WRITER_OVERWRITE: 'STALE_WRITER_OVERWRITE',
  GOVERNANCE_GO_WITH_CHILD_NO_GO: 'GOVERNANCE_GO_WITH_CHILD_NO_GO',
});

const SIGNAL_PATTERNS = Object.freeze({
  TENANT_ISOLATION: /tenant[\s_-]?(?:isolation|leak|leakage)|cross[\s_-]?tenant|isolamento de tenant/i,
  PRIVILEGE_ESCALATION: /privilege[\s_-]?escalation|escala[cç][aã]o de privil[eé]gio|rbac[\s_-]?bypass/i,
  DATA_CORRUPTION: /corrupt|corrup[cç][aã]o|perda de dado|data[\s_-]?loss/i,
  FALSE_RELEASE: /false[\s_-]?release|release falsa|declarad[oa] (?:como )?(?:go|verde|sucesso)/i,
  STALE_WRITER_OVERWRITE: /stale[\s_-]?writ(?:e|er)|escrita (?:obsoleta|antiga)|overwrote the owner/i,
  GOVERNANCE_GO_WITH_CHILD_NO_GO: /go with (?:a )?child no_?go|no_?go[^\n]{0,40}mas[^\n]{0,40}go|child[^\n]{0,20}no_?go/i,
});

/** Regras de inferência de categoria na ordem de precedência (a primeira que casar vence). */
const CATEGORY_RULES = Object.freeze([
  { category: 'SECURITY', patterns: [/security|seguran[cç]a|vulnerab|exploit|cve-|secret leak|credencial exposta/i] },
  { category: 'CONCURRENCY', patterns: [/deadlock|race condition|corrida|concurren|fence|fencing|stale writ|lease/i] },
  { category: 'RECOVERY', patterns: [/recovery|recupera[cç][aã]o|resume|retomada|checkpoint|crash loop|restart loop/i] },
  { category: 'GOVERNANCE', patterns: [/governance|governan[cç]a|gate|seal|selo|invariant|invariante|audit trail|policy/i] },
  { category: 'TIMEOUT', patterns: [/timeout|timed out|deadline|excedeu o tempo/i] },
  { category: 'PROVIDER', patterns: [/provider|provedor|llm|model not|invalid_api_key|rate.?limit|quota|upstream/i] },
  { category: 'INFRA', patterns: [/docker|container|sandbox|disk|network|dns|postgres indispon|redis indispon|infra/i] },
  { category: 'DATA', patterns: [/dado inconsistente|inconsistent data|orphan(?:ed)? row|registro [oó]rf[aã]o|integridade referencial/i] },
  { category: 'PERFORMANCE', patterns: [/slow|latency|lat[eê]ncia|throughput|memory leak|gc pause/i] },
  { category: 'CONFIGURATION', patterns: [/config|env var|vari[aá]vel de ambiente|not configured|misconfigur/i] },
]);

/** Base por categoria quando nenhum sinal crítico se aplica. */
const BASE_SEVERITY_BY_CATEGORY = Object.freeze({
  SECURITY: 'HIGH',
  DATA: 'HIGH',
  GOVERNANCE: 'HIGH',
  CONCURRENCY: 'HIGH',
  RECOVERY: 'MEDIUM',
  BUG: 'MEDIUM',
  INFRA: 'MEDIUM',
  PROVIDER: 'LOW',
  TIMEOUT: 'LOW',
  PERFORMANCE: 'MEDIUM',
  CONFIGURATION: 'MEDIUM',
  TEST_DEFECT: 'LOW',
  UNKNOWN: 'MEDIUM',
});

/** Categorias que NÃO podem ser resolvidas por patch de código de aplicação. */
const NON_APPLICATION_CATEGORIES = Object.freeze(['INFRA', 'PROVIDER', 'CONFIGURATION']);

/** Categorias cujo fix exige revisor de segurança dedicado. */
const SECURITY_REVIEW_CATEGORIES = Object.freeze(['SECURITY']);

function textOf(input = {}) {
  return [
    input.title,
    input.description,
    input.observedBehavior,
    input.errorType,
    input.code,
    input.invariant,
    input.subsystem,
    ...(Array.isArray(input.affectedSubsystems) ? input.affectedSubsystems : []),
  ].filter(Boolean).join(' \n ');
}

/** Sinais críticos OBJETIVOS (explícitos em `signals` ou casados por padrão em campos estruturados). */
function detectCriticalSignals(input = {}) {
  const explicit = Array.isArray(input.signals) ? input.signals : [];
  const text = textOf(input);
  const found = new Set(explicit.filter((s) => Object.prototype.hasOwnProperty.call(CRITICAL_SIGNALS, s)));
  for (const [signal, pattern] of Object.entries(SIGNAL_PATTERNS)) {
    if (pattern.test(text)) found.add(signal);
  }
  // Regra estrutural: invariante de release declarado GO com filho NO_GO é CRÍTICO sem precisar de
  // texto — o detector que o observou passa os dois estados explicitamente.
  if (input.invariantOutcome && input.childOutcome) {
    const parent = String(input.invariantOutcome).toUpperCase();
    const child = String(input.childOutcome).toUpperCase();
    if (parent === 'GO' && /NO_?GO/.test(child)) found.add(CRITICAL_SIGNALS.GOVERNANCE_GO_WITH_CHILD_NO_GO);
  }
  return Array.from(found);
}

/**
 * Categoria determinística. `source` ajuda (crash → RECOVERY/BUG; governance inconsistency →
 * GOVERNANCE), mas quem decide é o conteúdo estruturado + padrões — nunca um rótulo do chamador.
 */
function inferCategory(input = {}) {
  if (typeof input.category === 'string' && FINDING_CATEGORIES.includes(input.category)) return input.category;

  const text = textOf(input);
  const source = String(input.source || '').toUpperCase();

  // Mapeamentos de origem com prioridade (a origem é um fato, não uma opinião).
  if (source === 'GOVERNANCE_INCONSISTENCY') return 'GOVERNANCE';
  if (source === 'STALE_WRITE' || source === 'LEASE_FENCING') return 'CONCURRENCY';
  if (source === 'PROCESS_CRASH' && /crash loop|restart loop/i.test(text)) return 'RECOVERY';
  if (source === 'PROVIDER_ERROR') return 'PROVIDER';
  if (source === 'DATABASE_ERROR') return 'DATA';
  if (source === 'TIMEOUT' || source === 'NO_PROGRESS') {
    // TIMEOUT/NO_PROGRESS só são categoria TIMEOUT/RECOVERY quando NÃO há sintoma de código.
    if (/hang|travad|deadlock|loop infinito/i.test(text)) return 'BUG';
    return source === 'NO_PROGRESS' ? 'RECOVERY' : 'TIMEOUT';
  }
  if (source === 'INFRA') return 'INFRA';

  // Invariante violado de governança é GOVERNANCE por definição.
  if (source === 'INVARIANT_VIOLATION' && /governan|gate|seal|selo/i.test(text)) return 'GOVERNANCE';

  for (const rule of CATEGORY_RULES) {
    if (rule.forbidden) continue;
    if (rule.patterns.some((p) => p.test(text))) return rule.category;
  }

  if (/test(?:e)?\b[^\n]{0,30}(?:errado|incorreto|assert)|flaky|assertion error/i.test(text)) return 'TEST_DEFECT';
  if (/infra|sandbox|docker|disco|container/i.test(text)) return 'INFRA';
  if (source.endsWith('_TEST') || source === 'RELEASE_GATE' || source === 'EXCEPTION' || source === 'STACK_TRACE') return 'BUG';
  return 'UNKNOWN';
}

/** Máximo entre duas severidades (rank). */
function maxSeverity(a, b) {
  const ra = SEVERITY_RANK[a] ?? -1;
  const rb = SEVERITY_RANK[b] ?? -1;
  return ra >= rb ? a : b;
}

/** Escala uma severidade um degrau (usado na REINCIDÊNCIA, BUG-17). */
function escalateSeverity(severity, steps = 1) {
  const index = SEVERITY_ORDER.indexOf(severity);
  if (index < 0) return SEVERITY_ORDER[SEVERITY_ORDER.length - 1];
  const next = Math.min(SEVERITY_ORDER.length - 1, index + Math.max(1, steps));
  return SEVERITY_ORDER[next];
}

/**
 * Severidade DERIVADA. Ordem: sinal crítico > categoria > impacto objetivo declarado.
 * `input.severityHint` (tipicamente de LLM) é registrado como `advisorySeverity` e NUNCA decide.
 */
function assessSeverity(input = {}) {
  const category = inferCategory(input);
  const signals = detectCriticalSignals(input);
  const objectiveSeverity = FINDING_SEVERITIES.includes(input.objectiveSeverity) ? input.objectiveSeverity : null;

  let severity = BASE_SEVERITY_BY_CATEGORY[category] || 'MEDIUM';
  if (objectiveSeverity) severity = maxSeverity(severity, objectiveSeverity);
  // Sinal crítico eleva para CRITICAL incondicionalmente: são os casos em que "esperar" é o maior
  // risco (corrupção, isolamento, privilégio, release falsa, stale writer, governança incoerente).
  if (signals.length > 0) severity = 'CRITICAL';

  const advisory = FINDING_SEVERITIES.includes(input.severityHint) ? input.severityHint : null;
  return {
    category,
    severity,
    signals,
    advisorySeverity: advisory,
    advisoryOnly: Boolean(advisory && advisory !== severity),
  };
}

/** A severidade exigiu do valor declarado pelo chamador? (registro de divergência auditável) */
function severityDivergesFromHint(assessment) {
  return Boolean(assessment.advisorySeverity && assessment.advisorySeverity !== assessment.severity);
}

/** Uma correção de APLICAÇÃO é o caminho? (INFRA/PROVIDER/CONFIGURATION/DATA não são patch.) */
function requiresApplicationFix(category) {
  return !NON_APPLICATION_CATEGORIES.includes(category);
}

/** O fix exige revisor de SEGURANÇA dedicado? */
function requiresSecurityReview(category, severity) {
  return SECURITY_REVIEW_CATEGORIES.includes(category) || SEVERITY_RANK[severity] >= SEVERITY_RANK.HIGH;
}

/** O fix exige CODER ≠ REVIEWER (e provider independente quando disponível)? */
function requiresIndependentReview(severity) {
  return INDEPENDENT_REVIEW_SEVERITIES.includes(severity);
}

/**
 * Uma BASE OBJETIVA confirma o bug? Precisa ser uma das bases objetivas E ter evidência persistida.
 * Suspeita de LLM, heurística e TIMEOUT isolado NÃO confirmam (BUG-02, BUG-12).
 */
function assessConfirmation({ confirmationBasis = null, evidenceRefs = [], source = null } = {}) {
  const refs = Array.isArray(evidenceRefs) ? evidenceRefs : [];
  if (!confirmationBasis) {
    return {
      confirmed: false,
      code: BUG_FAILURE_CODES.INSUFFICIENT_CONFIRMATION_BASIS,
      reason: 'sem base de confirmação declarada: um finding sem base objetiva permanece SUSPECTED',
      suspicionOnlySource: SUSPICION_ONLY_SOURCES.includes(String(source || '').toUpperCase()),
    };
  }
  if (NON_CONFIRMATION_BASES.includes(confirmationBasis)) {
    return {
      confirmed: false,
      code: BUG_FAILURE_CODES.INSUFFICIENT_CONFIRMATION_BASIS,
      reason: `base "${confirmationBasis}" não é objetiva — LLM/heurística/timout isolado nunca confirmam`,
      suspicionOnlySource: SUSPICION_ONLY_SOURCES.includes(String(source || '').toUpperCase()),
    };
  }
  if (!CONFIRMATION_BASES.includes(confirmationBasis)) {
    return {
      confirmed: false,
      code: BUG_FAILURE_CODES.INSUFFICIENT_CONFIRMATION_BASIS,
      reason: `base de confirmação desconhecida: ${confirmationBasis}`,
      suspicionOnlySource: false,
    };
  }
  if (refs.length === 0) {
    return {
      confirmed: false,
      code: BUG_FAILURE_CODES.INSUFFICIENT_CONFIRMATION_BASIS,
      reason: `base "${confirmationBasis}" exige ao menos uma evidência persistida`,
      suspicionOnlySource: false,
    };
  }
  return { confirmed: true, basis: confirmationBasis, evidenceCount: refs.length, suspicionOnlySource: false };
}

module.exports = {
  CRITICAL_SIGNALS,
  BASE_SEVERITY_BY_CATEGORY,
  NON_APPLICATION_CATEGORIES,
  detectCriticalSignals,
  inferCategory,
  maxSeverity,
  escalateSeverity,
  assessSeverity,
  severityDivergesFromHint,
  requiresApplicationFix,
  requiresSecurityReview,
  requiresIndependentReview,
  assessConfirmation,
};
