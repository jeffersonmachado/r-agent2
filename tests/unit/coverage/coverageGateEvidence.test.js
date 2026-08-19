'use strict';

/**
 * Regressão — coverage gate por evidência real (HARD-010 / FASE 12/17).
 *
 * Falhas observadas (2026-08-18):
 * 1. O broadcast por domínio do go-no-go-report marcava como `passed`
 *    QUALQUER cenário do registry cujo domínio era homogêneo — inclusive
 *    cenários que nunca executaram (sem interseção registry ∩ results).
 * 2. `passed` vira VALIDATED sem verificar se o cenário tem assertions
 *    registradas na execução.
 * 3. Execuções de scenarioIds fora do registry entravam no numerador das
 *    métricas (successRate) em vez de serem reportadas à parte.
 * 4. O gate consumia qa-mesh/meshHistory sem verificar a cadeia de
 *    integridade append-only (qa-mesh/executionHistoryChain).
 *
 * Comportamento correto esperado:
 * - Broadcast por domínio só vale para scenarioIds presentes nos results da
 *   execução canônica e nunca passa de VISITED (inferred_passed).
 * - passed sem assertions registradas → passed_unverified (VISITED).
 * - failed (assertions falhas) → FAILED, nunca VALIDATED.
 * - Execuções inesperadas reportadas em unexpectedExecutions, fora das
 *   métricas; cobertura nunca > 100%.
 * - Cadeia do meshHistory ausente/quebrada → NO_GO (fail-closed).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildExecutions,
  checkMeshHistoryChain,
  applyMeshHistoryChainCheck,
} = require('../../../scripts/governance/validate-coverage-gate');
const { evaluateCoverageGate, buildGateItems } = require('../../../qa/coverage/coverageGate');
const { COVERAGE_STATES } = require('../../../qa/coverage/coverageStates');

function makeFixture({ goNoGo, historyRuns }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-evidence-'));
  const historyDir = path.join(dir, 'meshHistory');
  fs.mkdirSync(historyDir, { recursive: true });
  for (const [name, run] of Object.entries(historyRuns || {})) {
    fs.writeFileSync(path.join(historyDir, `${name}.json`), JSON.stringify(run), 'utf8');
  }
  const goNoGoPath = path.join(dir, 'go-no-go-report.json');
  fs.writeFileSync(goNoGoPath, JSON.stringify(goNoGo), 'utf8');
  return { dir, historyDir, goNoGoPath };
}

const SCENARIOS = [
  { id: 'business-fit-01', domain: 'fitness', criticality: 'blocking' },
  { id: 'business-fit-02', domain: 'fitness', criticality: 'high' },
  { id: 'business-food-01', domain: 'food', criticality: 'blocking' },
];

const HOMOGENEOUS_GO_NO_GO = {
  executionId: 'mesh-canonico',
  totals: {
    executionId: 'mesh-canonico',
    domains: {
      fitness: { passed: 2, failed: 0, skipped: 0, total: 2 },
      food: { passed: 1, failed: 0, skipped: 0, total: 1 },
    },
  },
};

describe('coverage-gate — evidência real (HARD-010)', () => {
  test('broadcast por domínio não cobre cenário fora dos results da execução canônica', () => {
    const { historyDir, goNoGoPath } = makeFixture({
      goNoGo: HOMOGENEOUS_GO_NO_GO,
      historyRuns: {
        // Execução canônica com apenas 2 dos 3 cenários do registry.
        'mesh-canonico': {
          startedAt: '2026-08-01T00:00:00.000Z',
          results: [
            { id: 'business-fit-01', status: 'passed', assertions: ['check-in registrado'] },
            { id: 'business-fit-02', status: 'passed', assertions: ['cobrança ok'] },
          ],
        },
      },
    });

    const executions = buildExecutions(SCENARIOS, { historyDir, goNoGoPath, aliases: {} });
    const byId = new Map(executions.map((e) => [e.scenarioId, e.status]));

    // food-01 NÃO consta nos results da execução canônica: sem broadcast.
    expect(byId.has('business-food-01')).toBe(false);
    // fit-01/fit-02 constam nos results: histórico por cenário vence (passed real).
    expect(byId.get('business-fit-01')).toBe('passed');
    expect(byId.get('business-fit-02')).toBe('passed');

    const items = buildGateItems({ scenarios: SCENARIOS, executions, journeys: [] });
    const stateOf = (id) => items.find((item) => item.id === `outcome:${id}`).state;
    expect(stateOf('business-food-01')).toBe(COVERAGE_STATES.UNCOVERED);
    expect(stateOf('business-fit-01')).toBe(COVERAGE_STATES.VALIDATED);
  });

  test('inferência de domínio (sem arquivo de resultados por cenário) é VISITED, nunca VALIDATED', () => {
    // Execução canônica referenciada existe e lista o cenário, mas o status
    // por cenário NÃO está disponível (results só declaram presença) —
    // construímos esse cenário usando um go-no-go cujo arquivo de histórico
    // tem results sem status, de modo que só o broadcast por domínio se
    // aplica.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-evidence-infer-'));
    const historyDir = path.join(dir, 'meshHistory');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(
      path.join(historyDir, 'mesh-canonico.json'),
      JSON.stringify({
        startedAt: '2026-08-01T00:00:00.000Z',
        results: [{ id: 'business-fit-01' }], // presença sem status
      }),
      'utf8',
    );
    const goNoGoPath = path.join(dir, 'go-no-go-report.json');
    fs.writeFileSync(goNoGoPath, JSON.stringify(HOMOGENEOUS_GO_NO_GO), 'utf8');

    const executions = buildExecutions(SCENARIOS, { historyDir, goNoGoPath, aliases: {} });
    const byId = new Map(executions.map((e) => [e.scenarioId, e.status]));
    expect(byId.get('business-fit-01')).toBe('inferred_passed');
    expect(byId.has('business-fit-02')).toBe(false);
    expect(byId.has('business-food-01')).toBe(false);

    const items = buildGateItems({ scenarios: SCENARIOS, executions, journeys: [] });
    const state = items.find((item) => item.id === 'outcome:business-fit-01').state;
    expect(state).toBe(COVERAGE_STATES.VISITED);
    expect(state).not.toBe(COVERAGE_STATES.VALIDATED);
  });

  test('passed sem assertions registradas vira passed_unverified (VISITED); failed nunca valida', () => {
    const { historyDir, goNoGoPath } = makeFixture({
      goNoGo: { executionId: 'mesh-canonico', totals: { domains: {} } },
      historyRuns: {
        'mesh-canonico': {
          startedAt: '2026-08-01T00:00:00.000Z',
          results: [
            { id: 'business-fit-01', status: 'passed', assertions: [] }, // sem assertions
            { id: 'business-fit-02', status: 'passed', assertions: ['cobrança ok'] },
            { id: 'business-food-01', status: 'failed', assertions: ['pedido criado'] },
          ],
        },
      },
    });

    const executions = buildExecutions(SCENARIOS, { historyDir, goNoGoPath, aliases: {} });
    const byId = new Map(executions.map((e) => [e.scenarioId, e.status]));
    expect(byId.get('business-fit-01')).toBe('passed_unverified');
    expect(byId.get('business-fit-02')).toBe('passed');
    expect(byId.get('business-food-01')).toBe('failed');

    const items = buildGateItems({ scenarios: SCENARIOS, executions, journeys: [] });
    const stateOf = (id) => items.find((item) => item.id === `outcome:${id}`).state;
    expect(stateOf('business-fit-01')).toBe(COVERAGE_STATES.VISITED);
    expect(stateOf('business-fit-02')).toBe(COVERAGE_STATES.VALIDATED);
    expect(stateOf('business-food-01')).toBe(COVERAGE_STATES.FAILED);
  });

  test('execuções de scenarioIds fora do registry não inflam métricas e são reportadas à parte', () => {
    const result = evaluateCoverageGate({
      scenarios: SCENARIOS,
      executions: [
        { scenarioId: 'business-fit-01', status: 'passed' },
        { scenarioId: 'business-fit-02', status: 'failed' },
        { scenarioId: 'ghost-scenario-1', status: 'passed' }, // fora do registry
        { scenarioId: 'ghost-scenario-2', status: 'passed' }, // fora do registry
      ],
      journeys: [],
      inventoryItems: [],
      thresholds: {
        criticalJourneysValidated: 0,
        criticalOutcomesValidated: 0,
        criticalApiContractsValidated: 0,
        minimumJourneyCoverage: 0,
        minimumTechnicalCoverage: 0,
        minimumWeightedCoverage: 0,
      },
    });

    // successRate sobre execuções conhecidas: 1 passed / 2 concluídas = 50.
    // Se os ghosts entrassem no numerador, seria 3/4 = 75.
    expect(result.successRate).toBe(50);
    expect(result.unexpectedExecutions.count).toBe(2);
    expect(result.unexpectedExecutions.items).toEqual(['ghost-scenario-1', 'ghost-scenario-2']);
    // Invariante: cobertura nunca acima de 100%.
    expect(result.validatedCoverage).toBeLessThanOrEqual(100);
    expect(result.visitedCoverage).toBeLessThanOrEqual(100);
    expect(result.weightedCoverage).toBeLessThanOrEqual(100);
  });

  test('meshHistory com cadeia quebrada faz o gate falhar (fail-closed)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-chain-'));
    const historyDir = path.join(dir, 'meshHistory');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, 'run-1.json'), JSON.stringify({ results: [] }), 'utf8');
    const chainPath = path.join(dir, 'index.jsonl');
    fs.writeFileSync(chainPath, '{"hash":"x"}\n', 'utf8');

    const broken = checkMeshHistoryChain({
      historyDir,
      chainPath,
      verifyChain: () => ({ valid: false, brokenAt: 3 }),
    });
    expect(broken.valid).toBe(false);
    expect(broken.reason).toBe('mesh_history_chain_broken');

    const gateResult = {
      status: 'GO',
      releaseGate: { decision: 'GO', reasons: [] },
    };
    applyMeshHistoryChainCheck(gateResult, broken);
    expect(gateResult.releaseGate.decision).toBe('NO_GO');
    expect(gateResult.status).toBe('NO_GO');
    expect(gateResult.releaseGate.reasons).toEqual([
      expect.objectContaining({ check: 'meshHistoryChainIntegrity' }),
    ]);
  });

  test('cadeia ausente com meshHistory presente também falha (NO EVIDENCE → NO VALIDATED)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-chain-missing-'));
    const historyDir = path.join(dir, 'meshHistory');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, 'run-1.json'), JSON.stringify({ results: [] }), 'utf8');

    const missing = checkMeshHistoryChain({
      historyDir,
      chainPath: path.join(dir, 'index.jsonl'),
      verifyChain: () => ({ valid: true, brokenAt: null }),
    });
    expect(missing.valid).toBe(false);
    expect(missing.reason).toBe('mesh_history_chain_missing');

    // Sem meshHistory (modo snapshot): verificação não se aplica.
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-chain-na-'));
    const notApplicable = checkMeshHistoryChain({
      historyDir: path.join(emptyDir, 'meshHistory'),
      chainPath: path.join(emptyDir, 'index.jsonl'),
      verifyChain: () => ({ valid: true, brokenAt: null }),
    });
    expect(notApplicable.applicable).toBe(false);
    expect(notApplicable.valid).toBe(true);

    // Cadeia íntegra não altera o resultado do gate.
    const gateResult = { status: 'GO', releaseGate: { decision: 'GO', reasons: [] } };
    applyMeshHistoryChainCheck(gateResult, { applicable: true, valid: true });
    expect(gateResult.releaseGate.decision).toBe('GO');
  });
});
