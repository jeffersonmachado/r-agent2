'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const { evaluateCoverageGate, buildGateItems } = require('../../../qa/coverage/coverageGate');
const { COVERAGE_STATES } = require('../../../qa/coverage/coverageStates');
const { resolveThresholds, DEFAULT_THRESHOLDS } = require('../../../qa/coverage/gateThresholds');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');

function apiItem(id, extra = {}) {
  return {
    id,
    kind: 'api',
    classification: 'PRODUCTION',
    linkStatus: 'LINKED',
    linkKind: 'journey',
    linkedJourneys: [],
    linkedDomains: [],
    ...extra,
  };
}

function scenario(id, domain, criticality) {
  return { id, domain, criticality };
}

/** Fixture base: 2 cenários beauty (1 blocking, 1 high), 1 fitness medium. */
function baseFixture() {
  const scenarios = [
    scenario('sc-beauty-blocking', 'beauty', 'blocking'),
    scenario('sc-beauty-high', 'beauty', 'high'),
    scenario('sc-fitness-medium', 'fitness', 'medium'),
  ];
  const journeys = ['beauty_booking', 'fitness_checkin'];
  const inventoryItems = [
    apiItem('api:GET:/api/beauty/a', { linkedDomains: ['beauty'], linkedJourneys: ['beauty_booking'] }),
    apiItem('api:GET:/api/beauty/b', { linkedDomains: ['beauty'], linkedJourneys: ['beauty_booking'] }),
    apiItem('api:GET:/api/fitness/a', { linkedDomains: ['fitness'], linkedJourneys: ['fitness_checkin'] }),
  ];
  const executions = scenarios.map((s) => ({ scenarioId: s.id, status: 'passed' }));
  return { scenarios, journeys, inventoryItems, executions };
}

describe('coverage/coverageGate', () => {
  test('GO quando tudo validado', () => {
    const fixture = baseFixture();
    const result = evaluateCoverageGate(fixture);

    expect(result.releaseGate.decision).toBe('GO');
    expect(result.status).toBe('GO');
    expect(result.releaseGate.reasons).toEqual([]);
    expect(result.validatedCoverage).toBe(100);
    expect(result.weightedCoverage).toBe(100);
    expect(result.successRate).toBe(100);
    expect(result.journeyCoverage).toBe(100);
  });

  test('NO_GO quando item CRITICAL uncovered — reason cita o id', () => {
    const fixture = baseFixture();
    // cenário blocking nunca executado
    fixture.executions = fixture.executions.filter((e) => e.scenarioId !== 'sc-beauty-blocking');

    const result = evaluateCoverageGate(fixture);

    expect(result.releaseGate.decision).toBe('NO_GO');
    const uncovered = result.releaseGate.reasons.find((r) => r.check === 'uncoveredCriticalItems');
    expect(uncovered).toBeDefined();
    expect(uncovered.items).toContain('outcome:sc-beauty-blocking');
    // item do domínio parcialmente executado: VISITED (não UNCOVERED), mas
    // não conta como validado → derruba criticalJourneysValidated
    const item = buildGateItems(fixture).find((i) => i.id === 'api:GET:/api/beauty/a');
    expect(item.state).toBe(COVERAGE_STATES.VISITED);
    const journeys = result.releaseGate.reasons.find((r) => r.check === 'criticalJourneysValidated');
    expect(journeys.items).toContain('journey:beauty_booking');
  });

  test('NO_GO quando evidência stale (fingerprint alterado)', () => {
    const fixture = baseFixture();
    fixture.staleItemIds = ['api:GET:/api/beauty/a'];

    const result = evaluateCoverageGate(fixture);

    expect(result.releaseGate.decision).toBe('NO_GO');
    const stale = result.releaseGate.reasons.find((r) => r.check === 'staleCriticalEvidence');
    expect(stale).toBeDefined();
    expect(stale.items).toContain('api:GET:/api/beauty/a');
    const item = buildGateItems(fixture).find((i) => i.id === 'api:GET:/api/beauty/a');
    expect(item.state).toBe(COVERAGE_STATES.REVALIDATION_REQUIRED);
  });

  test('passed_via_fallback não conta como validado: visited sobe, validated não, successRate cai', () => {
    const fixture = baseFixture();
    fixture.executions = fixture.executions.map((e) => (
      e.scenarioId === 'sc-beauty-high' ? { ...e, status: 'passed_via_fallback' } : e
    ));

    const result = evaluateCoverageGate(fixture);

    expect(result.visitedCoverage).toBe(100);
    expect(result.validatedCoverage).toBeLessThan(100);
    expect(result.successRate).toBeLessThan(100);
    const outcome = buildGateItems(fixture).find((i) => i.id === 'outcome:sc-beauty-high');
    expect(outcome.state).toBe(COVERAGE_STATES.VISITED);
  });

  test('thresholds sobrescrevíveis via env', () => {
    const { thresholds } = resolveThresholds({
      configPath: null,
      env: { COVERAGE_GATE_MINIMUM_JOURNEY_COVERAGE: '50' },
    });
    expect(thresholds.minimumJourneyCoverage).toBe(50);
    expect(thresholds.criticalJourneysValidated).toBe(DEFAULT_THRESHOLDS.criticalJourneysValidated);

    const fixture = baseFixture();
    // fitness (NORMAL) não executado → journeyCoverage cai, mas threshold 50 tolera
    fixture.executions = fixture.executions.filter((e) => e.scenarioId !== 'sc-fitness-medium');
    fixture.thresholds = { minimumJourneyCoverage: 50, minimumTechnicalCoverage: 50, minimumWeightedCoverage: 50 };

    const result = evaluateCoverageGate(fixture);
    expect(result.journeyCoverage).toBe(50);
    expect(result.releaseGate.reasons.find((r) => r.check === 'minimumJourneyCoverage')).toBeUndefined();
  });

  test('modo informative: CLI sai 0 mesmo com NO_GO e marca mode no relatório', () => {
    const fs = require('fs');
    const script = path.join(ROOT_DIR, 'scripts', 'governance', 'validate-coverage-gate.js');
    const reportPath = path.join(ROOT_DIR, 'reports', 'coverage-gate-report.json');

    execFileSync(process.execPath, [script, '--informative'], { cwd: ROOT_DIR, stdio: 'pipe' });
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    expect(report.mode).toBe('informative');
    expect(['GO', 'NO_GO']).toContain(report.releaseGate.decision);
  });

  test('modo blocking (default): CLI sai 1 em NO_GO', () => {
    const script = path.join(ROOT_DIR, 'scripts', 'governance', 'validate-coverage-gate.js');
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [script], { cwd: ROOT_DIR, stdio: 'pipe' });
    } catch (error) {
      exitCode = error.status;
    }
    // Com os dados reais do repositório o gate é NO_GO; se um dia for GO, exit 0 também é válido.
    const report = JSON.parse(
      require('fs').readFileSync(path.join(ROOT_DIR, 'reports', 'coverage-gate-report.json'), 'utf8'),
    );
    expect(report.mode).toBe('blocking');
    expect(exitCode).toBe(report.releaseGate.decision === 'NO_GO' ? 1 : 0);
  });

  test('órfão CRITICAL bloqueia o gate', () => {
    const fixture = baseFixture();
    fixture.inventoryItems.push(apiItem('api:POST:/api/sem-vinculo', {
      linkStatus: 'ORPHANED',
      linkedJourneys: [],
      linkedDomains: [],
      criticality: 'CRITICAL',
    }));
    fixture.thresholds = { minimumTechnicalCoverage: 50, minimumWeightedCoverage: 50 };

    const result = evaluateCoverageGate(fixture);

    expect(result.releaseGate.decision).toBe('NO_GO');
    const orphan = result.releaseGate.reasons.find((r) => r.check === 'orphanedCriticalItems');
    expect(orphan).toBeDefined();
    expect(orphan.items).toContain('api:POST:/api/sem-vinculo');
  });

  test('weightedCoverage cai mais com falha CRITICAL do que com falha NORMAL', () => {
    const fixtureCritical = baseFixture();
    fixtureCritical.executions = fixtureCritical.executions.map((e) => (
      e.scenarioId === 'sc-beauty-blocking' ? { ...e, status: 'failed' } : e
    ));
    const criticalResult = evaluateCoverageGate(fixtureCritical);

    const fixtureNormal = baseFixture();
    fixtureNormal.executions = fixtureNormal.executions.map((e) => (
      e.scenarioId === 'sc-fitness-medium' ? { ...e, status: 'failed' } : e
    ));
    const normalResult = evaluateCoverageGate(fixtureNormal);

    expect(criticalResult.weightedCoverage).toBeLessThan(normalResult.weightedCoverage);
  });

  test('status skipped/infra_error/environment_missing mapeiam para BLOCKED', () => {
    const fixture = baseFixture();
    fixture.executions = fixture.executions.map((e) => (
      e.scenarioId === 'sc-fitness-medium' ? { ...e, status: 'infra_error' } : e
    ));
    const items = buildGateItems(fixture);
    expect(items.find((i) => i.id === 'outcome:sc-fitness-medium').state).toBe(COVERAGE_STATES.BLOCKED);
    expect(items.find((i) => i.id === 'journey:fitness_checkin').state).toBe(COVERAGE_STATES.BLOCKED);
  });
});
