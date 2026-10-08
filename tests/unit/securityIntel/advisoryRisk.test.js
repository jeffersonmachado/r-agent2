'use strict';

/**
 * Testes do modelo de advisory e do Risk Engine.
 *
 * As provas centrais:
 *   - Um advisory só é "aplicável" quando a comparação de versão REALMENTE
 *     concluiu; não comparável = UNKNOWN (nunca NOT_AFFECTED).
 *   - Advisory retirado não gera achado.
 *   - KEV eleva para pelo menos HIGH; EPSS alto eleva severidade baixa;
 *     prioridade é determinística e traz os fatores que a produziram.
 *   - MITIGATED exige waiver vigente (waiver nunca é criado pelo motor).
 */

const {
  normalizeAdvisory,
  matchesComponent,
  indexAdvisoriesByPackage,
  packageKeyOf,
  isWithdrawn,
} = require('../../../engine/securityIntel/advisoryModel');

const { computeRisk, STATUS, severityFromCvss } = require('../../../engine/securityIntel/riskEngine');

const NOW = '2026-10-08T12:00:00.000Z';

function osvFixture(overrides = {}) {
  return {
    id: 'GHSA-test-0000-0000',
    aliases: ['CVE-2026-0001'],
    summary: 'Prototype pollution em pacote de teste',
    details: 'Detalhes.',
    published: '2026-01-02T00:00:00Z',
    modified: '2026-02-02T00:00:00Z',
    severity: [{ type: 'CVSS_V3', score: '9.8' }],
    affected: [{
      package: { ecosystem: 'npm', name: 'left-pad', purl: 'pkg:npm/left-pad' },
      ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.3.0' }] }],
    }],
    references: [{ type: 'ADVISORY', url: 'https://example.test/advisory' }],
    ...overrides,
  };
}

function component(overrides = {}) {
  return {
    ecosystem: 'npm',
    name: 'left-pad',
    version: '1.2.0',
    versionClass: 'RUNNING',
    service: 'api',
    ...overrides,
  };
}

describe('advisoryModel — normalização', () => {
  test('normaliza CVSS e aliases', () => {
    const advisory = normalizeAdvisory(osvFixture(), { source: 'osv', fetchedAt: NOW });
    expect(advisory.id).toBe('GHSA-test-0000-0000');
    expect(advisory.aliases).toEqual(['CVE-2026-0001']);
    expect(advisory.severity.cvssScore).toBe(9.8);
    expect(advisory.affected[0]).toMatchObject({
      ecosystemCanonical: 'npm',
      name: 'left-pad',
      normalizedName: 'left-pad',
    });
    expect(advisory.affected[0].ranges[0].events).toHaveLength(2);
  });

  test('severidade não-CVSS e normalização de nome PyPI', () => {
    const advisory = normalizeAdvisory(osvFixture({
      severity: [{ type: 'Ubuntu', score: 'High' }],
      affected: [{
        package: { ecosystem: 'PyPI', name: 'PyYAML' },
        ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '6.0.1' }] }],
      }],
    }));
    expect(advisory.severity.declaredSeverity).toBe('HIGH');
    expect(advisory.severity.cvssScore).toBeNull();
    expect(advisory.affected[0].normalizedName).toBe('pyyaml');
  });

  test('registro sem id é descartado (não inventa identificador)', () => {
    expect(normalizeAdvisory({ summary: 'sem id' })).toBeNull();
    expect(normalizeAdvisory(null)).toBeNull();
  });

  test('withdrawn é reconhecido', () => {
    expect(isWithdrawn(normalizeAdvisory(osvFixture({ withdrawn: '2026-03-01T00:00:00Z' })))).toBe(true);
  });
});

describe('advisoryModel — aplicabilidade', () => {
  const advisory = normalizeAdvisory(osvFixture());

  test('versão dentro da faixa é CONFIRMED_APPLICABLE com correção conhecida', () => {
    const result = matchesComponent(advisory, component({ version: '1.2.0' }));
    expect(result.matched).toBe(true);
    expect(result.applicability).toBe('CONFIRMED_APPLICABLE');
    expect(result.fixedVersions).toEqual(['1.3.0']);
  });

  test('versão fora da faixa é NOT_AFFECTED (com justificativa)', () => {
    const result = matchesComponent(advisory, component({ version: '1.3.0' }));
    expect(result.matched).toBe(false);
    expect(result.reason).toBe('version_outside_affected_ranges');
  });

  test('pacote diferente no mesmo ecossistema é NOT_AFFECTED', () => {
    const result = matchesComponent(advisory, component({ name: 'right-pad' }));
    expect(result).toMatchObject({ matched: false, reason: 'package_not_listed_for_ecosystem' });
  });

  test('versão desconhecida é UNKNOWN, nunca NOT_AFFECTED', () => {
    expect(matchesComponent(advisory, component({ version: 'unknown' })).applicability).toBe('UNKNOWN');
    expect(matchesComponent(advisory, component({ version: null })).applicability).toBe('UNKNOWN');
  });

  test('versão não comparável é UNKNOWN', () => {
    const result = matchesComponent(advisory, component({ version: 'latest' }));
    expect(result.matched).toBeNull();
    expect(result.reason).toBe('range_not_comparable');
  });

  test('advisory retirado não gera achado', () => {
    const withdrawn = normalizeAdvisory(osvFixture({ withdrawn: '2026-03-01T00:00:00Z' }));
    expect(matchesComponent(withdrawn, component())).toMatchObject({ matched: null, reason: 'advisory_withdrawn' });
  });

  test('advisory sem faixa nem lista de versões é INCONCLUSIVO', () => {
    const vague = normalizeAdvisory(osvFixture({
      affected: [{ package: { ecosystem: 'npm', name: 'left-pad' } }],
    }));
    expect(matchesComponent(vague, component({ version: '1.2.0' })).applicability).toBe('UNKNOWN');
  });

  test('ecossistema não suportado não vira NOT_AFFECTED', () => {
    const alpine = normalizeAdvisory(osvFixture({
      affected: [{ package: { ecosystem: 'Alpine:v3.19', name: 'openssl' }, ranges: [] }],
    }));
    const result = matchesComponent(alpine, component({ ecosystem: 'generic', name: 'openssl', version: '3.0.15' }));
    expect(result.matched).toBeNull();
  });

  test('lista explícita de versões afetadas é respeitada', () => {
    const listed = normalizeAdvisory(osvFixture({
      affected: [{ package: { ecosystem: 'npm', name: 'left-pad' }, versions: ['1.1.0', '1.2.0'] }],
    }));
    expect(matchesComponent(listed, component({ version: '1.2.0' })).matched).toBe(true);
    expect(matchesComponent(listed, component({ version: '1.1.5' })).matched).toBe(false);
  });

  test('índice por pacote encontra o advisory e a chave é estável', () => {
    const index = indexAdvisoriesByPackage([advisory]);
    expect(index.get(packageKeyOf(component()))).toHaveLength(1);
    expect(packageKeyOf({ ecosystem: 'PyPI', name: 'PyYAML' })).toBe('pypi:pyyaml');
  });
});

describe('riskEngine — priorização', () => {
  const baseAdvisory = normalizeAdvisory(osvFixture({ severity: [{ type: 'CVSS_V3', score: '5.4' }] }));
  const baseMatch = matchesComponent(baseAdvisory, component({ version: '1.2.0' }));

  test('faixas oficiais de CVSS', () => {
    expect(severityFromCvss(9.8)).toBe('CRITICAL');
    expect(severityFromCvss(7.0)).toBe('HIGH');
    expect(severityFromCvss(4.0)).toBe('MEDIUM');
    expect(severityFromCvss(0.1)).toBe('LOW');
    expect(severityFromCvss(null)).toBeNull();
  });

  test('KEV eleva severidade baixa para HIGH e domina a prioridade', () => {
    const risk = computeRisk({
      advisory: baseAdvisory,
      component: component(),
      match: baseMatch,
      exploit: { kev: true, kevDueDate: '2026-11-01' },
      exposure: 'internet',
    });
    expect(risk.severity).toBe('HIGH');
    expect(risk.kev).toBe(true);
    expect(risk.factors.some((factor) => factor.name === 'cisa_kev' && factor.weight === 40)).toBe(true);
    expect(risk.priority).toBeGreaterThan(60);
    expect(risk.rationale.join(' ')).toMatch(/CISA KEV/);
  });

  test('EPSS alto eleva severidade baixa', () => {
    const risk = computeRisk({
      advisory: baseAdvisory,
      component: component(),
      match: baseMatch,
      exploit: { epss: 0.72, epssPercentile: 0.98 },
      exposure: 'internal',
    });
    expect(risk.severity).toBe('HIGH');
    expect(risk.rationale.join(' ')).toMatch(/EPSS/);
  });

  test('RUNNING e serviço crítico pesam mais que DECLARED', () => {
    const running = computeRisk({ advisory: baseAdvisory, component: component({ versionClass: 'RUNNING', service: 'api' }), match: baseMatch, exposure: 'internal' });
    const declared = computeRisk({ advisory: baseAdvisory, component: component({ versionClass: 'DECLARED', service: 'docs' }), match: baseMatch, exposure: 'internal' });
    expect(running.priority).toBeGreaterThan(declared.priority);
    expect(running.factors.some((factor) => factor.name === 'critical_service')).toBe(true);
  });

  test('sem CVSS nem severidade declarada NÃO vira LOW silencioso', () => {
    const noSeverity = normalizeAdvisory(osvFixture({ severity: [] }));
    const match = matchesComponent(noSeverity, component({ version: '1.2.0' }));
    const risk = computeRisk({ advisory: noSeverity, component: component(), match });
    expect(risk.severity).toBe('MEDIUM');
    expect(risk.rationale.join(' ')).toMatch(/NÃO foi assumido/);
  });

  test('correção disponível produz FIX_AVAILABLE; ausência produz NO_FIX_AVAILABLE', () => {
    const withFix = computeRisk({ advisory: baseAdvisory, component: component(), match: baseMatch });
    expect(withFix.status).toBe(STATUS.FIX_AVAILABLE);
    expect(withFix.fixedVersions).toEqual(['1.3.0']);

    const noFixAdvisory = normalizeAdvisory(osvFixture({
      affected: [{ package: { ecosystem: 'npm', name: 'left-pad' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }] }] }],
    }));
    const noFixMatch = matchesComponent(noFixAdvisory, component({ version: '1.2.0' }));
    const noFix = computeRisk({ advisory: noFixAdvisory, component: component(), match: noFixMatch });
    expect(noFix.status).toBe(STATUS.NO_FIX_AVAILABLE);
    expect(noFix.fixAvailable).toBe(false);
  });

  test('waiver vigente é o único caminho para MITIGATED', () => {
    const risk = computeRisk({
      advisory: baseAdvisory,
      component: component(),
      match: baseMatch,
      waiver: { expires_at: '2026-12-01', reason: 'controle compensatório' },
    });
    expect(risk.status).toBe(STATUS.MITIGATED);
    expect(risk.waiverApplied).toBe(true);
    expect(risk.rationale.join(' ')).toMatch(/waiver/);
  });

  test('não afetado e não comparável têm prioridade zero e estado próprio', () => {
    const notAffected = computeRisk({
      advisory: baseAdvisory,
      component: component({ version: '2.0.0' }),
      match: matchesComponent(baseAdvisory, component({ version: '2.0.0' })),
    });
    expect(notAffected).toMatchObject({ status: STATUS.NOT_AFFECTED, priority: 0 });

    const unknown = computeRisk({
      advisory: baseAdvisory,
      component: component({ version: 'latest' }),
      match: matchesComponent(baseAdvisory, component({ version: 'latest' })),
    });
    expect(unknown).toMatchObject({ status: STATUS.UNDER_INVESTIGATION, priority: 0 });
  });

  test('falso positivo confirmado é terminal e não prioriza', () => {
    const risk = computeRisk({
      advisory: baseAdvisory,
      component: component(),
      match: baseMatch,
      falsePositiveConfirmed: true,
    });
    expect(risk).toMatchObject({ status: STATUS.FALSE_POSITIVE, priority: 0, severity: 'INFORMATIONAL' });
  });

  test('veredito é determinístico (mesma entrada ⇒ mesma saída)', () => {
    const args = { advisory: baseAdvisory, component: component(), match: baseMatch, exploit: { epss: 0.3 }, exposure: 'internal' };
    expect(JSON.stringify(computeRisk(args))).toBe(JSON.stringify(computeRisk(args)));
  });
});
