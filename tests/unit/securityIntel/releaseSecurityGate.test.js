'use strict';

/**
 * Testes do Release Security Gate (avaliação pura).
 *
 * Controles obrigatórios:
 *   - DEVE reprovar: achado HIGH aberto, KEV sem correção, SBOM ausente/inválido,
 *     base de advisories vencida, índice vetorial inválido, cobertura insuficiente.
 *   - DEVE aprovar: nenhum risco bloqueante com evidência completa.
 *   - NÃO PODE aprovar por falta de evidência (ausência de dado ≠ risco zero).
 *   - Waiver sem expiração NÃO isenta.
 */

const {
  DECISIONS,
  isOpenRisk,
  waiverExemption,
  evaluateReleaseSecurity,
} = require('../../../engine/securityIntel/releaseSecurityGate');

const NOW = new Date('2026-10-08T12:00:00.000Z');

const POLICY = {
  blockOnSeverity: ['CRITICAL', 'HIGH'],
  blockWhenKevWithoutFix: true,
  blockOnStaleAdvisoryBase: true,
  requireSbomSnapshot: true,
  requireValidSbom: true,
  minCoveragePercent: 80,
  waiverRequiresExpiry: true,
  requireVectorIndexHealthy: true,
};

function healthyInput(overrides = {}) {
  return {
    policy: POLICY,
    findings: { available: true, source: 'security_findings', items: [] },
    sbom: { available: true, valid: true, sha256: 'b00f482c', componentCount: 1653 },
    advisoryBase: { available: true, ageHours: 0.2, status: 'PASS', syncId: 'sync-1', maxAgeHoursBeforeStale: 72, maxAgeHoursBeforeBlocking: 336 },
    vectorIndex: { verdict: 'DEGRADED', findings: [{ code: 'vector_extension_behind_recommended' }] },
    coveragePercent: 100,
    waivers: [],
    now: NOW,
    ...overrides,
  };
}

function finding(overrides = {}) {
  return {
    findingKey: 'GHSA-x|npm:express@5.2.1#RESOLVED#api',
    advisoryId: 'GHSA-x',
    severity: 'HIGH',
    status: 'FIX_AVAILABLE',
    packageName: 'express',
    installedVersion: '5.2.1',
    service: 'api',
    kev: false,
    fixAvailable: true,
    resolvedAt: null,
    ...overrides,
  };
}

describe('releaseSecurityGate — risco aberto e waiver', () => {
  test('isOpenRisk ignora VEX e achados resolvidos', () => {
    expect(isOpenRisk(finding())).toBe(true);
    expect(isOpenRisk(finding({ status: 'NOT_AFFECTED' }))).toBe(false);
    expect(isOpenRisk(finding({ status: 'FALSE_POSITIVE' }))).toBe(false);
    expect(isOpenRisk(finding({ resolvedAt: '2026-10-01T00:00:00Z' }))).toBe(false);
    expect(isOpenRisk(null)).toBe(false);
  });

  test('waiver sem expiração NÃO isenta (isenção perpétua é bypass)', () => {
    expect(waiverExemption({ findingKey: 'x' }, { now: NOW })).toEqual({ exempt: false, reason: 'waiver_without_expiry' });
  });

  test('waiver expirado não isenta; vigente isenta', () => {
    expect(waiverExemption({ expiresAt: '2026-10-01T00:00:00Z' }, { now: NOW }).exempt).toBe(false);
    expect(waiverExemption({ expiresAt: '2026-12-01T00:00:00Z' }, { now: NOW }).exempt).toBe(true);
  });
});

describe('releaseSecurityGate — decisão', () => {
  test('estado sadio com evidência completa ⇒ GO', () => {
    const result = evaluateReleaseSecurity(healthyInput());
    expect(result.decision).toBe(DECISIONS.GO);
    expect(result.blocking).toEqual([]);
  });

  test('achado HIGH aberto ⇒ NO_GO nomeando o motivo', () => {
    const result = evaluateReleaseSecurity(healthyInput({
      findings: { available: true, source: 'security_findings', items: [finding()] },
    }));
    expect(result.decision).toBe(DECISIONS.NO_GO);
    expect(result.blocking.map((item) => item.code)).toContain('OPEN_VULNERABILITY');
    expect(result.blocking[0].detail).toMatchObject({ severity: 'HIGH', service: 'api' });
  });

  test('CRITICAL aberto e MEDIUM aberto: só o bloqueante da política reprova', () => {
    const medium = evaluateReleaseSecurity(healthyInput({
      findings: { available: true, items: [finding({ severity: 'MEDIUM' })] },
    }));
    expect(medium.decision).toBe(DECISIONS.GO);

    const critical = evaluateReleaseSecurity(healthyInput({
      findings: { available: true, items: [finding({ severity: 'CRITICAL' })] },
    }));
    expect(critical.decision).toBe(DECISIONS.NO_GO);
  });

  test('dependência dev-only HIGH vira AVISO, não bloqueio (exposição real)', () => {
    const devOnly = evaluateReleaseSecurity(healthyInput({
      findings: { available: true, items: [finding({ severity: 'HIGH', dev: true, packageName: 'vitest' })] },
    }));
    expect(devOnly.decision).toBe(DECISIONS.GO);
    expect(devOnly.warnings.map((item) => item.code)).toContain('DEV_ONLY_VULNERABILITY');
    expect(devOnly.blocking).toEqual([]);
  });

  test('DEV-only bloqueia quando a política pede explicitamente', () => {
    const strict = evaluateReleaseSecurity(healthyInput({
      policy: { ...POLICY, blockOnDevDependencies: true },
      findings: { available: true, items: [finding({ severity: 'HIGH', dev: true })] },
    }));
    expect(strict.decision).toBe(DECISIONS.NO_GO);
    expect(strict.blocking[0].detail.dev).toBe(true);
  });

  test('KEV dev-only sem correção também vira aviso, não bloqueio', () => {
    const result = evaluateReleaseSecurity(healthyInput({
      findings: { available: true, items: [finding({ severity: 'MEDIUM', dev: true, kev: true, fixAvailable: false })] },
    }));
    expect(result.decision).toBe(DECISIONS.GO);
    expect(result.warnings.map((item) => item.code)).toContain('DEV_ONLY_VULNERABILITY');
  });

  test('KEV sem correção ⇒ NO_GO mesmo em severidade menor', () => {
    const result = evaluateReleaseSecurity(healthyInput({
      findings: { available: true, items: [finding({ severity: 'MEDIUM', kev: true, fixAvailable: false })] },
    }));
    expect(result.decision).toBe(DECISIONS.NO_GO);
    expect(result.blocking.map((item) => item.code)).toContain('KEV_WITHOUT_FIX');
  });

  test('waiver vigente isenta o achado; waivr inválido gera aviso e ainda bloqueia', () => {
    const items = [finding()];
    const exempted = evaluateReleaseSecurity(healthyInput({
      findings: { available: true, items },
      waivers: [{ findingKey: items[0].findingKey, expiresAt: '2026-12-01T00:00:00Z' }],
    }));
    expect(exempted.decision).toBe(DECISIONS.GO);

    const notExempted = evaluateReleaseSecurity(healthyInput({
      findings: { available: true, items },
      waivers: [{ findingKey: items[0].findingKey }],
    }));
    expect(notExempted.decision).toBe(DECISIONS.NO_GO);
    expect(notExempted.warnings.map((item) => item.code)).toContain('WAIVER_NOT_VALID');
  });

  test('ausência de dados de achados ⇒ NO_GO (não aprova por falta de evidência)', () => {
    const result = evaluateReleaseSecurity(healthyInput({ findings: null }));
    expect(result.decision).toBe(DECISIONS.NO_GO);
    expect(result.blocking.map((item) => item.code)).toContain('SECURITY_EVIDENCE_MISSING');
  });

  test('SBOM ausente ou inválido ⇒ NO_GO', () => {
    const missing = evaluateReleaseSecurity(healthyInput({ sbom: { available: false } }));
    expect(missing.blocking.map((item) => item.code)).toContain('SBOM_MISSING');
    const invalid = evaluateReleaseSecurity(healthyInput({ sbom: { available: true, valid: false, sha256: 'x' } }));
    expect(invalid.blocking.map((item) => item.code)).toContain('SBOM_INVALID');
  });

  test('base de advisories vencida bloqueia; envelhecendo apenas avisa; parcial avisa', () => {
    const stale = evaluateReleaseSecurity(healthyInput({
      advisoryBase: { available: true, ageHours: 400, status: 'PASS', maxAgeHoursBeforeStale: 72, maxAgeHoursBeforeBlocking: 336 },
    }));
    expect(stale.decision).toBe(DECISIONS.NO_GO);
    expect(stale.blocking.map((item) => item.code)).toContain('ADVISORY_BASE_STALE');

    const aging = evaluateReleaseSecurity(healthyInput({
      advisoryBase: { available: true, ageHours: 100, status: 'PASS', maxAgeHoursBeforeStale: 72, maxAgeHoursBeforeBlocking: 336 },
    }));
    expect(aging.decision).toBe(DECISIONS.GO);
    expect(aging.warnings.map((item) => item.code)).toContain('ADVISORY_BASE_AGING');

    const partial = evaluateReleaseSecurity(healthyInput({
      advisoryBase: { available: true, ageHours: 1, status: 'DEGRADED', maxAgeHoursBeforeStale: 72, maxAgeHoursBeforeBlocking: 336 },
    }));
    expect(partial.decision).toBe(DECISIONS.GO);
    expect(partial.warnings.map((item) => item.code)).toContain('ADVISORY_BASE_PARTIAL');
  });

  test('base de advisories ausente ⇒ NO_GO', () => {
    const result = evaluateReleaseSecurity(healthyInput({ advisoryBase: null }));
    expect(result.blocking.map((item) => item.code)).toContain('ADVISORY_BASE_MISSING');
  });

  test('índice vetorial INVÁLIDO bloqueia; UNKNOWN apenas avisa', () => {
    const invalid = evaluateReleaseSecurity(healthyInput({
      vectorIndex: { verdict: 'INVALID', findings: [{ code: 'vector_index_invalid' }] },
    }));
    expect(invalid.decision).toBe(DECISIONS.NO_GO);
    expect(invalid.blocking.map((item) => item.code)).toContain('VECTOR_INDEX_INVALID');

    const unknown = evaluateReleaseSecurity(healthyInput({
      vectorIndex: { verdict: 'UNKNOWN', essentialUnmeasured: ['planner'] },
    }));
    expect(unknown.decision).toBe(DECISIONS.GO);
    expect(unknown.warnings.map((item) => item.code)).toContain('VECTOR_INDEX_UNKNOWN');
  });

  test('cobertura abaixo do mínimo bloqueia; ausente apenas avisa', () => {
    const low = evaluateReleaseSecurity(healthyInput({ coveragePercent: 40 }));
    expect(low.decision).toBe(DECISIONS.NO_GO);
    expect(low.blocking.map((item) => item.code)).toContain('COVERAGE_BELOW_MINIMUM');

    const unknown = evaluateReleaseSecurity(healthyInput({ coveragePercent: null }));
    expect(unknown.decision).toBe(DECISIONS.GO);
    expect(unknown.warnings.map((item) => item.code)).toContain('COVERAGE_UNKNOWN');
  });

  test('veredito é determinístico', () => {
    const input = healthyInput();
    expect(JSON.stringify(evaluateReleaseSecurity(input))).toBe(JSON.stringify(evaluateReleaseSecurity(input)));
  });
});
