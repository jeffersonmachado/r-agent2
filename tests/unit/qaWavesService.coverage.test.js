'use strict';

/**
 * Regressão: a cobertura de uma wave em listWaves() NÃO pode ser derivada do
 * share de tamanho da wave (totalItems / total de cenários do registry).
 * Cobertura é métrica de EXECUÇÃO: último resultado por cenário no histórico
 * do mesh (passed/passed_via_fallback/failed/flaky/skipped/...), ponderada por
 * criticidade via qa/coverage/coverageCalculator.
 */

jest.mock('../../api/services/qaMeshService', () => ({
  getRegistry: jest.fn(),
  getMeshHistory: jest.fn(),
  queueMeshRun: jest.fn(),
  queueScenarioReplay: jest.fn(),
}));

const qaMeshService = require('../../api/services/qaMeshService');
const qaWavesService = require('../../api/services/qaWavesService');

const REGISTRY = [
  { id: 'cov-alpha-1', domain: 'alpha', flow: 'Alpha unico', criticality: 'blocking', adapter: 'api' },
  { id: 'cov-beta-1', domain: 'beta', flow: 'Beta um', criticality: 'high', adapter: 'api' },
  { id: 'cov-beta-2', domain: 'beta', flow: 'Beta dois', criticality: 'medium', adapter: 'api' },
  { id: 'cov-beta-3', domain: 'beta', flow: 'Beta tres', criticality: 'medium', adapter: 'api' },
  { id: 'cov-gamma-1', domain: 'gamma', flow: 'Gamma blocking', criticality: 'blocking', adapter: 'api' },
  { id: 'cov-gamma-2', domain: 'gamma', flow: 'Gamma high', criticality: 'high', adapter: 'api' },
];

function mockRegistry() {
  qaMeshService.getRegistry.mockReturnValue(REGISTRY.map((item) => ({ ...item })));
}

function mockHistory(results) {
  qaMeshService.getMeshHistory.mockReturnValue(results.length > 0
    ? [{ executionId: 'cov-exec-1', startedAt: '2026-07-20T10:00:00.000Z', results }]
    : []);
}

describe('qaWavesService coverage de execucao (regressao do bug de share)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistry();
  });

  test('wave pequena sem nenhuma execucao deve reportar cobertura de execucao 0, nao share de tamanho', () => {
    mockHistory([]);

    const waves = qaWavesService.listWaves();
    const alpha = waves.find((wave) => wave.domain === 'alpha');

    expect(alpha).toBeTruthy();
    expect(alpha.totalItems).toBe(1);
    // Bug antigo: coverage = round(1/6 * 100) = 17 (share de tamanho).
    // Cobertura de execucao real: nada executado -> 0.
    expect(alpha.visitedCoverage).toBe(0);
    expect(alpha.validatedCoverage).toBe(0);
    expect(alpha.weightedCoverage).toBe(0);
    // O campo legado derivado de share nao pode mais existir com valor de share.
    expect(alpha.coverage).not.toBe(17);
  });

  test('mapeia ultimo status por cenario: passed=validado, skipped=bloqueado, failed=falha, nunca executado=nao coberto', () => {
    mockHistory([
      { id: 'cov-alpha-1', status: 'passed', startedAt: '2026-07-20T10:00:01.000Z' },
      { id: 'cov-beta-1', status: 'skipped', startedAt: '2026-07-20T10:00:02.000Z' },
      { id: 'cov-beta-2', status: 'failed', startedAt: '2026-07-20T10:00:03.000Z' },
      // cov-beta-3, cov-gamma-* nunca executados
    ]);

    const waves = qaWavesService.listWaves();
    const alpha = waves.find((wave) => wave.domain === 'alpha');
    const beta = waves.find((wave) => wave.domain === 'beta');

    expect(alpha.visitedCoverage).toBe(100);
    expect(alpha.validatedCoverage).toBe(100);
    expect(alpha.successRate).toBe(100);

    // beta: 1 falha (conta como visitado), 1 bloqueado, 1 nao coberto
    expect(beta.visitedCoverage).toBeCloseTo(33.3, 1);
    expect(beta.validatedCoverage).toBe(0);
    // taxa de sucesso considera apenas concluidos (passed/failed): 0/1
    expect(beta.successRate).toBe(0);
  });

  test('passed_via_fallback conta como visitado mas nao como validado', () => {
    mockHistory([
      { id: 'cov-alpha-1', status: 'passed_via_fallback', startedAt: '2026-07-20T10:00:01.000Z' },
    ]);

    const waves = qaWavesService.listWaves();
    const alpha = waves.find((wave) => wave.domain === 'alpha');

    expect(alpha.visitedCoverage).toBe(100);
    expect(alpha.validatedCoverage).toBe(0);
  });

  test('cobertura ponderada usa CRITICALITY_WEIGHTS (blocking=CRITICAL, high=HIGH, medium=NORMAL)', () => {
    mockHistory([
      { id: 'cov-gamma-1', status: 'passed', startedAt: '2026-07-20T10:00:01.000Z' },
      // cov-gamma-2 (high) nunca executado
    ]);

    const waves = qaWavesService.listWaves();
    const gamma = waves.find((wave) => wave.domain === 'gamma');

    // pesos: CRITICAL=5 validado, HIGH=3 nao validado -> 5/8 = 62.5
    expect(gamma.weightedCoverage).toBe(62.5);
    expect(gamma.validatedCoverage).toBe(50);
  });

  test('getGlobalCoverageSummary consolida visited/validated/success/weighted/dimensionCoverage/criticalSummary', () => {
    mockHistory([
      { id: 'cov-alpha-1', status: 'passed', startedAt: '2026-07-20T10:00:01.000Z' },
      { id: 'cov-gamma-1', status: 'failed', startedAt: '2026-07-20T10:00:02.000Z' },
    ]);

    const summary = qaWavesService.getGlobalCoverageSummary();

    expect(summary.totalItems).toBe(REGISTRY.length);
    expect(typeof summary.visitedCoverage).toBe('number');
    expect(typeof summary.validatedCoverage).toBe('number');
    expect(typeof summary.successRate).toBe('number');
    expect(typeof summary.weightedCoverage).toBe('number');
    expect(summary.dimensionCoverage).toHaveProperty('alpha');
    expect(summary.dimensionCoverage).toHaveProperty('beta');
    expect(summary.dimensionCoverage.alpha.validated).toBe(100);
    // criticalSummary conta itens blocking (cov-alpha-1 passed, cov-gamma-1 failed)
    expect(summary.criticalSummary.failed).toBe(1);
    expect(summary.criticalSummary.uncovered).toBe(0);
  });

  test('resumo global com zero execucoes reporta cobertura 0 (e nao share)', () => {
    mockHistory([]);

    const summary = qaWavesService.getGlobalCoverageSummary();

    expect(summary.visitedCoverage).toBe(0);
    expect(summary.validatedCoverage).toBe(0);
    expect(summary.weightedCoverage).toBe(0);
    expect(summary.criticalSummary.uncovered).toBe(2); // cov-alpha-1 e cov-gamma-1
  });
});
