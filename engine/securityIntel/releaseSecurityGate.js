'use strict';

/**
 * releaseSecurityGate — avaliação PURA da decisão de release sob a ótica de
 * segurança de versões.
 *
 * Módulo PURO e DETERMINÍSTICO: recebe fatos já coletados e a política
 * declarada, e devolve `GO`/`NO_GO` com os bloqueios nomeados.
 *
 * Lições de projeto aplicadas (medidas neste repo):
 *   1. Um validador que não consegue FALHAR é uma regra sem enforcement: aqui a
 *      avaliação produz `NO_GO` com motivos nomeados e o gate traduz isso em
 *      exit code — há teste com controle negativo provando que ele reprova.
 *   2. A decisão de não avaliar NÃO é "aprovado": ausência de evidência é
 *      `NO_GO` com motivo `SECURITY_EVIDENCE_MISSING`, nunca PASS silencioso.
 *   3. Waiver sem expiração não isenta nada (`waiverRequiresExpiry`): isenção
 *      perpétua e implícita seria um bypass do gate.
 */

const DECISIONS = Object.freeze({ GO: 'GO', NO_GO: 'NO_GO' });

const SEVERITY_RANK = Object.freeze({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4 });

/** Estados que NÃO representam risco aberto (VEX/terminal). */
const NON_RISK_STATUSES = Object.freeze(new Set(['NOT_AFFECTED', 'FALSE_POSITIVE', 'RESOLVED']));

/**
 * Um achado contribui para o release quando não está resolvido e não é VEX.
 */
function isOpenRisk(finding) {
  if (!finding) return false;
  if (finding.resolvedAt || finding.resolved_at) return false;
  return !NON_RISK_STATUSES.has(finding.status);
}

/**
 * Waiver só isenta quando: existe, tem escopo compatível e tem expiração futura.
 * Sem expiração declarada = não isenta (documentado no relatório).
 */
function waiverExemption(waiver, { now, requireExpiry = true } = {}) {
  if (!waiver) return { exempt: false, reason: 'no_waiver' };
  const expiresAt = waiver.expiresAt || waiver.expires_at || null;
  if (!expiresAt) {
    return { exempt: false, reason: requireExpiry ? 'waiver_without_expiry' : 'waiver_without_expiry_allowed' };
  }
  const expiryTime = new Date(expiresAt).getTime();
  if (Number.isNaN(expiryTime)) return { exempt: false, reason: 'waiver_expiry_unparsable' };
  if (expiryTime <= now.getTime()) return { exempt: false, reason: 'waiver_expired' };
  return { exempt: true, reason: 'waiver_valid' };
}

/**
 * Avalia a decisão de release.
 *
 * @param {object} input
 * @param {object} input.policy        `policy.releaseGate`
 * @param {object|null} input.findings `{available:boolean, items:Array, source:string}`
 * @param {object|null} input.sbom     `{available, valid, sha256, generatedAt, componentCount}`
 * @param {object|null} input.advisoryBase `{available, ageHours, status, syncId, maxAgeHoursBeforeStale, maxAgeHoursBeforeBlocking}`
 * @param {object|null} input.vectorIndex  `{verdict, findings}`
 * @param {number|null} input.coveragePercent
 * @param {Array<object>} [input.waivers]
 * @param {Date} [input.now]
 * @returns {{decision:string, blocking:Array, warnings:Array, checks:Array, summary:string}}
 */
function evaluateReleaseSecurity({
  policy = {},
  findings = null,
  sbom = null,
  advisoryBase = null,
  vectorIndex = null,
  coveragePercent = null,
  waivers = [],
  now = new Date('1970-01-01T00:00:00.000Z'),
} = {}) {
  const blocking = [];
  const warnings = [];
  const checks = [];
  const block = (code, message, detail = {}) => blocking.push({ code, message, detail });
  const warn = (code, message, detail = {}) => warnings.push({ code, message, detail });
  const check = (id, ok, detail = '') => checks.push({ id, ok: Boolean(ok), detail });

  const blockOnSeverity = Array.isArray(policy.blockOnSeverity) ? policy.blockOnSeverity : ['CRITICAL', 'HIGH'];
  const waiverMap = new Map();
  for (const waiver of waivers) {
    const key = waiver.findingKey || waiver.finding_key;
    if (key) waiverMap.set(key, waiver);
  }

  // ── 1. Achados com risco aberto ─────────────────────────────────────────
  if (!findings || findings.available !== true) {
    block('SECURITY_EVIDENCE_MISSING',
      'não há resultado de correlação de vulnerabilidades: ausência de evidência NÃO é ausência de risco',
      { source: findings ? findings.source : null });
    check('findings_available', false, 'sem dados de achados');
  } else {
    check('findings_available', true, `${findings.items.length} achado(s) avaliado(s)`);
    const openRisks = findings.items.filter(isOpenRisk);
    for (const finding of openRisks) {
      const key = finding.findingKey || finding.finding_key;
      const waiver = waiverMap.get(key);
      const exemption = waiverExemption(waiver, { now, requireExpiry: policy.waiverRequiresExpiry !== false });
      if (waiver && !exemption.exempt) {
        warn('WAIVER_NOT_VALID', `waiver do achado ${key} não isenta: ${exemption.reason}`, { findingKey: key, reason: exemption.reason });
      }
      if (exemption.exempt) continue;
      const severity = String(finding.severity || '').toUpperCase();
      if (blockOnSeverity.includes(severity)) {
        block('OPEN_VULNERABILITY', `achado ${severity} aberto: ${finding.advisoryId || finding.advisory_id} em ${finding.packageName || finding.package_name}@${finding.installedVersion || finding.installed_version}`,
          { findingKey: key, severity, service: finding.service || null, status: finding.status || null, priority: finding.priority ?? null });
      }
      if (policy.blockWhenKevWithoutFix && (finding.kev === true) && finding.fixAvailable === false) {
        block('KEV_WITHOUT_FIX', `vulnerabilidade com exploração conhecida (KEV) e SEM correção: ${finding.advisoryId || finding.advisory_id}`,
          { findingKey: key, service: finding.service || null });
      }
    }
    if (openRisks.length > 0) {
      const maxRank = Math.min(...openRisks.map((finding) => SEVERITY_RANK[String(finding.severity || '').toUpperCase()] ?? 9));
      check('no_blocking_severity', maxRank > Math.max(...blockOnSeverity.map((s) => SEVERITY_RANK[s] ?? 9)),
        `${openRisks.length} achado(s) aberto(s); severidade máxima observada entre os bloqueantes da política`);
    } else {
      check('no_blocking_severity', true, 'nenhum achado com risco aberto');
    }
  }

  // ── 2. SBOM ─────────────────────────────────────────────────────────────
  if (policy.requireSbomSnapshot) {
    if (!sbom || sbom.available !== true) {
      block('SBOM_MISSING', 'nenhum snapshot de SBOM disponível para o release');
      check('sbom_present', false);
    } else {
      check('sbom_present', true, `sha256=${sbom.sha256}`);
      if (policy.requireValidSbom && sbom.valid !== true) {
        block('SBOM_INVALID', 'o SBOM não passou na validação estrutural', { sha256: sbom.sha256 });
        check('sbom_valid', false);
      } else {
        check('sbom_valid', true);
      }
    }
  }

  // ── 3. Idade/integridade da base de advisories ──────────────────────────
  if (!advisoryBase || advisoryBase.available !== true) {
    block('ADVISORY_BASE_MISSING', 'não há sincronização de base de advisories registrada');
    check('advisory_base_present', false);
  } else {
    check('advisory_base_present', true, `sincronização ${advisoryBase.syncId || '?'} (${advisoryBase.status})`);
    const age = typeof advisoryBase.ageHours === 'number' ? advisoryBase.ageHours : null;
    if (age === null) {
      warn('ADVISORY_BASE_AGE_UNKNOWN', 'idade da base de advisories não declarada');
    } else if (policy.blockOnStaleAdvisoryBase && typeof advisoryBase.maxAgeHoursBeforeBlocking === 'number'
      && age > advisoryBase.maxAgeHoursBeforeBlocking) {
      block('ADVISORY_BASE_STALE', `base de advisories com ${age}h (limite ${advisoryBase.maxAgeHoursBeforeBlocking}h) — análise baseada em informação vencida`,
        { ageHours: age, limitHours: advisoryBase.maxAgeHoursBeforeBlocking });
    } else if (typeof advisoryBase.maxAgeHoursBeforeStale === 'number' && age > advisoryBase.maxAgeHoursBeforeStale) {
      warn('ADVISORY_BASE_AGING', `base de advisories com ${age}h (limite de aviso ${advisoryBase.maxAgeHoursBeforeStale}h)`, { ageHours: age });
    }
    if (advisoryBase.status === 'DEGRADED') {
      warn('ADVISORY_BASE_PARTIAL', 'a última sincronização da base teve falhas: a base é PARCIAL', { syncId: advisoryBase.syncId || null });
    }
  }

  // ── 4. Integridade do índice vetorial ───────────────────────────────────
  if (policy.requireVectorIndexHealthy) {
    if (!vectorIndex || !vectorIndex.verdict) {
      warn('VECTOR_INDEX_NOT_EVALUATED', 'integridade do índice vetorial não avaliada');
    } else if (vectorIndex.verdict === 'INVALID') {
      block('VECTOR_INDEX_INVALID', 'índice vetorial inválido ou ausente: a busca vetorial está comprometida',
        { findings: (vectorIndex.findings || []).map((finding) => finding.code) });
    } else if (vectorIndex.verdict === 'UNKNOWN') {
      warn('VECTOR_INDEX_UNKNOWN', 'saúde do índice vetorial não pôde ser concluída (evidência faltando)',
        { unmeasured: vectorIndex.essentialUnmeasured || [] });
    }
  }

  // ── 5. Cobertura do inventário ──────────────────────────────────────────
  if (typeof policy.minCoveragePercent === 'number') {
    if (typeof coveragePercent !== 'number') {
      warn('COVERAGE_UNKNOWN', 'cobertura do inventário não declarada');
    } else if (coveragePercent < policy.minCoveragePercent) {
      block('COVERAGE_BELOW_MINIMUM', `cobertura do inventário ${coveragePercent}% abaixo do mínimo ${policy.minCoveragePercent}%`,
        { coveragePercent, minimum: policy.minCoveragePercent });
    } else {
      check('coverage_minimum', true, `${coveragePercent}%`);
    }
  }

  const decision = blocking.length === 0 ? DECISIONS.GO : DECISIONS.NO_GO;
  return {
    decision,
    blocking,
    warnings,
    checks,
    summary: decision === DECISIONS.GO
      ? `GO: ${checks.filter((item) => item.ok).length} verificação(ões) satisfeita(s), ${warnings.length} aviso(s)`
      : `NO_GO: ${blocking.map((item) => item.code).join(', ')}`,
  };
}

module.exports = {
  DECISIONS,
  SEVERITY_RANK,
  NON_RISK_STATUSES,
  isOpenRisk,
  waiverExemption,
  evaluateReleaseSecurity,
};
