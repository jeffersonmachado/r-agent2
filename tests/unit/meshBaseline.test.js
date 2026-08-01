'use strict';

/**
 * Regressão — erosão do bestKnown do baseline do QA Mesh por execução parcial.
 *
 * Falha observada (2026-08-01): toda execução parcial do mesh (15 cenários,
 * ex.: waves técnicas disparadas pelo gate de governança) substituía o
 * bestKnown canônico (130/130, passRate=1) porque a condição de substituição
 * era apenas `currentPassRate >= bestPassRate` — empate em passRate com
 * cobertura muito menor degradava a baseline registrada. A baseline é insumo
 * do go/no-go (BASELINE_PASS_RATE_REGRESSION); erodi-la silenciosamente é
 * cobertura falsa.
 *
 * Comportamento correto esperado:
 * 1. Execução parcial com mesmo passRate NÃO substitui um bestKnown com
 *    cobertura maior (total de cenários).
 * 2. Execução com passRate maior substitui (melhora real).
 * 3. Execução com mesmo passRate e cobertura >= substitui (refresh válido).
 * 4. Execuções com total < 10 nunca atualizam (guarda já existente).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('qa-mesh updateBaseline — proteção contra erosão do bestKnown', () => {
  let tmpDir;
  let baselinePath;
  let updateBaseline;

  const canonicalBest = {
    executionId: 'mesh-canonical-130',
    passRate: 1,
    blockingFailures: 0,
    infraErrors: 0,
    total: 130,
    passed: 130,
    failed: 0,
    flaky: 0,
    updatedAt: '2026-07-31T20:39:11.956Z',
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-baseline-'));
    baselinePath = path.join(tmpDir, 'baseline.json');
    process.env.QA_MESH_BASELINE_PATH = baselinePath;
    jest.resetModules();
    ({ updateBaseline } = require('../../qa-mesh/meshRunner'));
  });

  afterEach(() => {
    delete process.env.QA_MESH_BASELINE_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedBaseline() {
    fs.writeFileSync(
      baselinePath,
      `${JSON.stringify({
        target: { passRate: 0.9, blockingFailures: 0, infraErrors: 0 },
        accepted: true,
        bestKnown: canonicalBest,
        history: [],
      }, null, 2)}\n`,
      'utf8',
    );
  }

  function readBaseline() {
    return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  }

  test('execução parcial (15/15, passRate=1) NÃO substitui bestKnown canônico (130/130)', () => {
    seedBaseline();
    const summary = { total: 15, passed: 15, failed: 0 };
    updateBaseline(summary, [], 'mesh-partial-15');

    const baseline = readBaseline();
    expect(baseline.bestKnown.executionId).toBe('mesh-canonical-130');
    expect(baseline.bestKnown.total).toBe(130);
  });

  test('passRate maior substitui o bestKnown (melhora real)', () => {
    seedBaseline();
    const seeded = readBaseline();
    seeded.bestKnown = { ...canonicalBest, passRate: 0.9, passed: 117, failed: 13 };
    fs.writeFileSync(baselinePath, `${JSON.stringify(seeded, null, 2)}\n`, 'utf8');
    const summary = { total: 15, passed: 15, failed: 0 };
    updateBaseline(summary, [], 'mesh-better-15');

    const baseline = readBaseline();
    expect(baseline.bestKnown.executionId).toBe('mesh-better-15');
    expect(baseline.bestKnown.passRate).toBe(1);
  });

  test('mesmo passRate com cobertura >= substitui (refresh canônico válido)', () => {
    seedBaseline();
    const summary = { total: 130, passed: 130, failed: 0 };
    updateBaseline(summary, [], 'mesh-canonical-new');

    const baseline = readBaseline();
    expect(baseline.bestKnown.executionId).toBe('mesh-canonical-new');
    expect(baseline.bestKnown.total).toBe(130);
  });

  test('execução com total < 10 nunca atualiza o bestKnown', () => {
    seedBaseline();
    const summary = { total: 3, passed: 3, failed: 0 };
    updateBaseline(summary, [], 'mesh-tiny-3');

    const baseline = readBaseline();
    expect(baseline.bestKnown.executionId).toBe('mesh-canonical-130');
  });
});
