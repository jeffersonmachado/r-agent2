'use strict';

/**
 * riskEngine — priorização de risco para a inteligência de segurança.
 *
 * Módulo PURO e DETERMINÍSTICO. A priorização NÃO é "só CVSS": ela combina
 * severidade técnica, exploração conhecida (CISA KEV), probabilidade (EPSS),
 * exposição real do componente, classe da versão (RUNNING pesa mais que
 * DECLARED) e existência de correção — e devolve os FATORES que produziram o
 * veredito, para que a decisão seja auditável em vez de opinativa.
 *
 * Vocabulário de estado (do contrato da missão):
 *   DETECTED, CONFIRMED_APPLICABLE, NOT_AFFECTED, MITIGATED, FIX_AVAILABLE,
 *   NO_FIX_AVAILABLE, UNDER_INVESTIGATION, FALSE_POSITIVE
 */

const SEVERITIES = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL']);

const STATUS = Object.freeze({
  DETECTED: 'DETECTED',
  CONFIRMED_APPLICABLE: 'CONFIRMED_APPLICABLE',
  NOT_AFFECTED: 'NOT_AFFECTED',
  MITIGATED: 'MITIGATED',
  FIX_AVAILABLE: 'FIX_AVAILABLE',
  NO_FIX_AVAILABLE: 'NO_FIX_AVAILABLE',
  UNDER_INVESTIGATION: 'UNDER_INVESTIGATION',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
});

/** Exposição: quanto do sistema é alcançável pelo vetor do problema. */
const EXPOSURE_FACTORS = Object.freeze({
  internet: 1.0,
  partner: 0.85,
  internal: 0.7,
  local: 0.5,
  development: 0.35,
  unknown: 0.75,
});

/** Classe da versão: o que está EXECUTANDO pesa mais que o que está declarado. */
const VERSION_CLASS_FACTORS = Object.freeze({
  RUNNING: 1.0,
  BUILT: 0.9,
  RESOLVED: 0.85,
  DECLARED: 0.5,
});

/** Serviços cuja indisponibilidade compromete a plataforma inteira. */
const CRITICAL_SERVICES = Object.freeze(new Set(['api', 'postgres', 'redis', 'rag-service', 'frontend']));

const RANK = Object.freeze({
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFORMATIONAL: 0,
});

/** Severidade a partir do CVSS 3.x (faixas oficiais do FIRST). */
function severityFromCvss(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  if (score >= 9) return 'CRITICAL';
  if (score >= 7) return 'HIGH';
  if (score >= 4) return 'MEDIUM';
  if (score > 0) return 'LOW';
  return 'INFORMATIONAL';
}

function escalate(severity, levels = 1) {
  const index = SEVERITIES.indexOf(severity);
  if (index < 0) return severity;
  return SEVERITIES[Math.max(index - levels, 0)];
}

function clampSeverity(severity) {
  return SEVERITIES.includes(severity) ? severity : 'INFORMATIONAL';
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Calcula risco/prioridade de um achado.
 *
 * @param {object} input
 * @param {object} input.advisory      advisory normalizado
 * @param {object} input.component     componente do inventário
 * @param {object} input.match         resultado de `matchesComponent`
 * @param {object} [input.exploit]     `{ kev: boolean, kevDueDate, epss: number, epssPercentile }`
 * @param {string} [input.exposure]    'internet'|'partner'|'internal'|'local'|'development'|'unknown'
 * @param {object} [input.waiver]      waiver vigente (se houver) — nunca criado aqui
 * @param {boolean} [input.falsePositiveConfirmed]
 * @returns {object} veredito auditável
 */
function computeRisk({
  advisory,
  component,
  match,
  exploit = {},
  exposure = 'unknown',
  waiver = null,
  falsePositiveConfirmed = false,
} = {}) {
  const factors = [];
  const rationale = [];

  if (falsePositiveConfirmed) {
    return {
      severity: 'INFORMATIONAL',
      status: STATUS.FALSE_POSITIVE,
      priority: 0,
      cvssScore: advisory?.severity?.cvssScore ?? null,
      epss: exploit.epss ?? null,
      kev: exploit.kev === true,
      exposure,
      versionClass: component?.versionClass || null,
      factors: [{ name: 'false_positive_confirmed', weight: 0, detail: 'confirmado como falso positivo com evidência' }],
      rationale: ['achado confirmado como falso positivo: não entra na priorização'],
      fixAvailable: false,
    };
  }

  if (!match || match.matched === false) {
    return {
      severity: 'INFORMATIONAL',
      status: STATUS.NOT_AFFECTED,
      priority: 0,
      cvssScore: advisory?.severity?.cvssScore ?? null,
      epss: exploit.epss ?? null,
      kev: exploit.kev === true,
      exposure,
      versionClass: component?.versionClass || null,
      factors: [{ name: 'not_affected', weight: 0, detail: match ? match.reason : 'componente não corresponde ao advisory' }],
      rationale: ['componente não é afetado segundo a faixa declarada (justificativa registrada)'],
      fixAvailable: false,
    };
  }

  if (match.matched === null) {
    return {
      severity: 'INFORMATIONAL',
      status: STATUS.UNDER_INVESTIGATION,
      priority: 0,
      cvssScore: advisory?.severity?.cvssScore ?? null,
      epss: exploit.epss ?? null,
      kev: exploit.kev === true,
      exposure,
      versionClass: component?.versionClass || null,
      factors: [{ name: 'not_comparable', weight: 0, detail: match.reason }],
      rationale: [`não foi possível comparar a versão (${match.reason}) — requer investigação humana`],
      fixAvailable: false,
    };
  }

  // ── severidade base ─────────────────────────────────────────────────────
  const cvssScore = advisory?.severity?.cvssScore ?? null;
  const declaredSeverity = advisory?.severity?.declaredSeverity ?? null;
  let severity = severityFromCvss(cvssScore) || (declaredSeverity ? clampSeverity(declaredSeverity) : 'MEDIUM');
  factors.push({
    name: 'base_severity',
    weight: RANK[severity],
    detail: cvssScore !== null
      ? `CVSS ${cvssScore}`
      : declaredSeverity
        ? `severidade declarada pela fonte: ${declaredSeverity}`
        : 'sem CVSS nem severidade declarada: assumido MEDIUM (não LOW)',
  });
  if (cvssScore === null && !declaredSeverity) {
    rationale.push('fonte não publicou CVSS nem severidade: NÃO foi assumido "sem risco"');
  }

  // ── exploração conhecida (peso máximo) ──────────────────────────────────
  const kev = exploit.kev === true;
  if (kev) {
    const before = severity;
    if (RANK[severity] < RANK.HIGH) severity = 'HIGH';
    factors.push({
      name: 'cisa_kev',
      weight: 40,
      detail: before === severity ? 'presente no CISA KEV (já era >= HIGH)' : `presente no CISA KEV → elevado de ${before} para ${severity}`,
    });
    rationale.push('vulnerabilidade com exploração conhecida em campo: prioridade máxima para correção');
    if (exploit.kevDueDate) rationale.push(`prazo do CISA KEV: ${exploit.kevDueDate}`);
  } else {
    factors.push({ name: 'cisa_kev', weight: 0, detail: 'não listada no CISA KEV' });
  }

  // ── probabilidade de exploração (EPSS) ─────────────────────────────────
  const epss = typeof exploit.epss === 'number' ? exploit.epss : null;
  if (epss !== null) {
    if (epss >= 0.5 && RANK[severity] < RANK.HIGH) {
      const before = severity;
      severity = 'HIGH';
      rationale.push(`EPSS ${epss} (>= 0.50) eleva a severidade de ${before} para HIGH`);
    }
    factors.push({
      name: 'epss',
      weight: Math.round(epss * 30),
      detail: `EPSS ${epss}${exploit.epssPercentile ? ` (percentil ${exploit.epssPercentile})` : ''}`,
    });
  } else {
    factors.push({ name: 'epss', weight: 0, detail: 'EPSS indisponível para este advisory' });
  }

  // ── exposição real e classe da versão ───────────────────────────────────
  const exposureFactor = EXPOSURE_FACTORS[exposure] ?? EXPOSURE_FACTORS.unknown;
  factors.push({ name: 'exposure', weight: Math.round(exposureFactor * 20), detail: `exposição: ${exposure}` });
  const versionClassFactor = VERSION_CLASS_FACTORS[component?.versionClass] ?? 0.6;
  factors.push({
    name: 'version_class',
    weight: Math.round(versionClassFactor * 15),
    detail: `classe da versão: ${component?.versionClass || 'desconhecida'}`,
  });
  if (component?.service && CRITICAL_SERVICES.has(component.service)) {
    factors.push({ name: 'critical_service', weight: 10, detail: `serviço crítico: ${component.service}` });
  }
  if (component?.builtLocally === true) {
    factors.push({ name: 'locally_built', weight: 0, detail: 'imagem construída localmente (não auditada por digest de registry)' });
  }

  // ── disponibilidade de correção ─────────────────────────────────────────
  const fixedVersions = (match.fixedVersions || []).filter(Boolean);
  const fixAvailable = fixedVersions.length > 0;
  factors.push({
    name: 'fix_availability',
    weight: fixAvailable ? 5 : 15,
    detail: fixAvailable ? `correção disponível em ${fixedVersions.join(', ')}` : 'SEM versão corrigida declarada pela fonte',
  });

  // ── prioridade determinística ───────────────────────────────────────────
  const severityWeight = { CRITICAL: 55, HIGH: 40, MEDIUM: 25, LOW: 12, INFORMATIONAL: 3 }[severity];
  const priority = Math.min(100, Math.round(
    severityWeight
    + (kev ? 25 : 0)
    + (epss !== null ? Math.round(epss * 15) : 0)
    + Math.round(exposureFactor * 5)
    + (component?.versionClass === 'RUNNING' ? 5 : 0)
  ));

  let status;
  if (waiver) {
    status = STATUS.MITIGATED;
    rationale.push(`mitigado por waiver vigente (expira em ${waiver.expires_at || waiver.expiresAt || 'data não declarada'})`);
  } else if (fixAvailable) {
    status = STATUS.FIX_AVAILABLE;
  } else {
    status = STATUS.NO_FIX_AVAILABLE;
  }

  return {
    severity,
    status,
    priority,
    cvssScore,
    epss,
    kev,
    exposure,
    versionClass: component?.versionClass || null,
    fixedVersions,
    fixAvailable,
    waiverApplied: Boolean(waiver),
    factors,
    rationale,
  };
}

module.exports = {
  SEVERITIES,
  STATUS,
  EXPOSURE_FACTORS,
  VERSION_CLASS_FACTORS,
  CRITICAL_SERVICES,
  EXPOSURES: Object.freeze(Object.keys(EXPOSURE_FACTORS)),
  severityFromCvss,
  escalate,
  computeRisk,
};
