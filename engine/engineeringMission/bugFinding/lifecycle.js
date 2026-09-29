'use strict';

/**
 * engine/engineeringMission/bugFinding/lifecycle.js
 *
 * MÁQUINA DE ESTADOS do finding + as duas regras que a missão exige que NUNCA sejam confundidas:
 *
 *   - PATCH ≠ FIX. `canDeclareFixed` exige que a reprodução (que era vermelha) agora passe, que os
 *     testes direcionados passem E que exista parecer aprovado de revisor apropriado. Aplicar um
 *     patch não é nada disso.
 *   - TESTE VERDE ISOLADO ≠ REGRESSÃO VALIDADA. `canDeclareRegressionValidated` exige evidência de
 *     execução das regressões relevantes, referenciadas por id.
 *
 * Módulo PURO.
 */

const {
  FINDING_TRANSITIONS,
  FINDING_STATUSES,
  RECURRENCE_SOURCE_STATUSES,
  BUG_FAILURE_CODES,
  TERMINAL_FINDING_STATUSES,
} = require('./constants');
const { escalateSeverity } = require('./classification');

function isKnownStatus(status) {
  return FINDING_STATUSES.includes(status);
}

/** Transição permitida? Fail-closed: estado desconhecido ou transição não declarada ⇒ recusado. */
function canTransition(from, to) {
  if (!isKnownStatus(from) || !isKnownStatus(to)) {
    return { allowed: false, code: BUG_FAILURE_CODES.INVALID_FINDING_TRANSITION, reason: `estado desconhecido: ${from} → ${to}` };
  }
  if (from === to) {
    return { allowed: true, idempotent: true };
  }
  const allowed = (FINDING_TRANSITIONS[from] || []).includes(to);
  if (!allowed) {
    return {
      allowed: false,
      code: BUG_FAILURE_CODES.INVALID_FINDING_TRANSITION,
      reason: `transição não permitida: ${from} → ${to}`,
      allowedFrom: FINDING_TRANSITIONS[from] || [],
    };
  }
  return { allowed: true, idempotent: false };
}

/** Lança em transição inválida — usado pelos serviços (o erro é de negócio, não 500). */
function assertTransition(from, to) {
  const check = canTransition(from, to);
  if (!check.allowed) {
    throw Object.assign(new Error(check.reason), { code: check.code, from, to, allowedFrom: check.allowedFrom || [] });
  }
  return check;
}

function isTerminal(status) {
  return TERMINAL_FINDING_STATUSES.includes(status);
}

/** A REINCIDÊNCIA é reconhecida a partir de um estado já corrigido/validado/fechado (BUG-17). */
function isRecurrence(previousStatus) {
  return RECURRENCE_SOURCE_STATUSES.includes(previousStatus);
}

/**
 * Aplicação de reincidência: volta para CONFIRMED, incrementa a contagem e ESCALA a severidade.
 * Nunca cria um segundo registro — é a MESMA falha voltando, e o histórico guarda o evento.
 */
function applyRecurrence({ previousStatus, severity, recurrenceCount = 0, now = null }) {
  const nextCount = Number(recurrenceCount || 0) + 1;
  return {
    status: 'CONFIRMED',
    recurrenceCount: nextCount,
    previousStatus,
    severity: escalateSeverity(severity, 1),
    recoveredFrom: previousStatus,
    recurrenceAt: now,
  };
}

/**
 * FIXED exige TRÊS provas simultâneas. Qualquer ausência vira código de falha explícito — nunca
 * "patch aplicado, então corrigido".
 */
function canDeclareFixed({ finding = {}, reproductionPassed = false, targetedTestsPassed = false, reviewPassed = false } = {}) {
  const missing = [];
  if (!reproductionPassed) missing.push('reproduction_not_green');
  if (!targetedTestsPassed) missing.push('targeted_tests_not_green');
  if (!reviewPassed) missing.push('review_not_approved');

  if (missing.length > 0) {
    return {
      allowed: false,
      code: missing.includes('reproduction_not_green')
        ? BUG_FAILURE_CODES.FIX_WITHOUT_REPRODUCTION
        : BUG_FAILURE_CODES.FIX_WITHOUT_REVIEW,
      missing,
      reason: `FIXED exige reprodução verde + testes direcionados verdes + parecer aprovado (faltando: ${missing.join(', ')})`,
    };
  }
  if (!['FIXING', 'CONFIRMED'].includes(finding.status)) {
    return {
      allowed: false,
      code: BUG_FAILURE_CODES.INVALID_FINDING_TRANSITION,
      reason: `só a partir de CONFIRMED/FIXING se declara FIXED (atual: ${finding.status})`,
    };
  }
  return { allowed: true, evidence: { reproductionPassed, targetedTestsPassed, reviewPassed } };
}

/**
 * REGRESSION_VALIDATED exige evidência de execução de regressões. Sem id de regressão executado,
 * recusado — "o teste passou isolado" não valida regressão.
 */
function canDeclareRegressionValidated({ finding = {}, regressionRuns = [] } = {}) {
  const runs = Array.isArray(regressionRuns) ? regressionRuns.filter(Boolean) : [];
  if (finding.status !== 'FIXED') {
    return {
      allowed: false,
      code: BUG_FAILURE_CODES.REGRESSION_WITHOUT_FIX,
      reason: `regressão só se valida depois de FIXED (atual: ${finding.status})`,
    };
  }
  if (runs.length === 0) {
    return {
      allowed: false,
      code: BUG_FAILURE_CODES.REGRESSION_EVIDENCE_MISSING,
      reason: 'nenhuma execução de regressão referenciada — teste verde isolado não valida regressão',
    };
  }
  const failed = runs.filter((run) => run && run.passed === false);
  if (failed.length > 0) {
    return {
      allowed: false,
      code: BUG_FAILURE_CODES.REGRESSION_EVIDENCE_MISSING,
      reason: `${failed.length} regressão(ões) reprovada(s)`,
      failed,
    };
  }
  return { allowed: true, runs };
}

/** Um finding CONFIRMED pode virar work item? (Só CONFIRMED gera EngineeringTask — BUG-06.) */
function canGenerateFixTask(finding = {}) {
  if (finding.status !== 'CONFIRMED' && finding.status !== 'FIXING') {
    return { allowed: false, code: BUG_FAILURE_CODES.FINDING_NOT_CONFIRMED, reason: `finding em ${finding.status} não gera task de correção` };
  }
  if (finding.duplicateOf) {
    return { allowed: false, code: BUG_FAILURE_CODES.FINDING_NOT_CONFIRMED, reason: 'duplicata não gera task própria' };
  }
  return { allowed: true };
}

/**
 * REGRESSION GUARD do gate (BUG_AUTONOMOUS_LOOP): detecta as formas de "fechar" um bug por
 * enfraquecimento do critério. Retorna a lista de violações — vazia quando o ciclo é honesto.
 */
function detectGreenwashing({ finding = {}, events = [] } = {}) {
  const violations = [];
  const list = Array.isArray(events) ? events : [];

  if (finding.status === 'CLOSED') {
    const hasConfirmation = list.some((e) => e.type === 'STATUS_CHANGED' && e.payload && e.payload.to === 'CONFIRMED');
    if (hasConfirmation && !list.some((e) => e.type === 'REPRODUCTION_ATTEMPTED')) {
      violations.push({ code: 'CLOSED_WITHOUT_REPRODUCTION', detail: 'finding CONFIRMED fechado sem tentativa de reprodução registrada' });
    }
    if (!Array.isArray(finding.evidenceRefs) || finding.evidenceRefs.length === 0) {
      violations.push({ code: 'CLOSED_WITHOUT_EVIDENCE', detail: 'finding fechado sem evidência persistida' });
    }
  }

  if (finding.status === 'REGRESSION_VALIDATED' || finding.status === 'CLOSED') {
    const hasRegression = list.some((e) => e.type === 'REGRESSION_VALIDATED');
    const hasRefs = Array.isArray(finding.regressionTestRefs) && finding.regressionTestRefs.length > 0;
    if (!hasRegression && !hasRefs) {
      violations.push({ code: 'REGRESSION_NOT_EXECUTED', detail: 'finding declarado validado/fechado sem execução de regressão comprovada' });
    }
    const hasFixApplied = list.some((e) => e.type === 'FIX_APPLIED');
    if (!hasFixApplied) {
      violations.push({ code: 'FIX_WITHOUT_REGRESSION', detail: 'fix declarado sem registro de correção (FIX_APPLIED) — patch não é fix' });
    }
  }
  return violations;
}

module.exports = {
  isKnownStatus,
  canTransition,
  assertTransition,
  isTerminal,
  isRecurrence,
  applyRecurrence,
  canDeclareFixed,
  canDeclareRegressionValidated,
  canGenerateFixTask,
  detectGreenwashing,
};
