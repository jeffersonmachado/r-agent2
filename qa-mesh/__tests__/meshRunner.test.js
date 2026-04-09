'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../adapters/apiAdapter', () => ({
  executeScenario: jest.fn(),
}));

jest.mock('../adapters/rpaAdapter', () => ({
  executeScenario: jest.fn(),
}));

jest.mock('../adapters/pbxAdapter', () => ({
  executeScenario: jest.fn(),
}));

const { EVIDENCE_DIR, HISTORY_DIR, runMesh } = require('../meshRunner');
const apiAdapter = require('../adapters/apiAdapter');
const rpaAdapter = require('../adapters/rpaAdapter');
const pbxAdapter = require('../adapters/pbxAdapter');

describe('qa-mesh/meshRunner', () => {
  beforeEach(() => {
    apiAdapter.executeScenario.mockImplementation(async (scenario) => {
      if (scenario.id === 'mesh-api-pass') {
        return {
          success: true,
          logs: [{ message: 'api pass' }],
          metrics: { adapter: 'api' },
          errors: [],
          artifacts: [{ type: 'payload', path: '/tmp/api-pass.json' }],
        };
      }
      if (scenario.id === 'mesh-api-fail') {
        return {
          success: false,
          logs: [{ message: 'api fail' }],
          metrics: { adapter: 'api' },
          errors: ['boom'],
          artifacts: [],
        };
      }
      return {
        success: true,
        logs: [{ message: `fallback ${scenario.id}` }],
        metrics: { adapter: 'api', fallback: true },
        errors: [],
        artifacts: [],
      };
    });
    rpaAdapter.executeScenario.mockResolvedValue({
      success: true,
      logs: [{ message: 'rpa pass' }],
      metrics: { adapter: 'rpa' },
      errors: [],
      artifacts: [],
    });
    pbxAdapter.executeScenario.mockResolvedValue({
      success: true,
      logs: [{ message: 'pbx pass' }],
      metrics: { adapter: 'pbx' },
      errors: [],
      artifacts: [],
    });
  });

  test('executa 3 cenários mockados e gera summary coerente', async () => {
    const executionId = `mesh-test-${Date.now()}`;
    const registry = [
      {
        id: 'mesh-api-pass',
        domain: 'beauty',
        type: 'smoke',
        source: 'qa',
        flow: 'beauty_pass',
        criticality: 'medium',
        adapter: 'api',
        assertions: ['passa'],
      },
      {
        id: 'mesh-api-fail',
        domain: 'core',
        type: 'technical',
        source: 'qa',
        flow: 'core_fail',
        criticality: 'blocking',
        adapter: 'api',
        assertions: ['falha'],
      },
      {
        id: 'mesh-invalid-adapter',
        domain: 'fitness',
        type: 'regression',
        source: 'hybrid',
        flow: 'fitness_invalid',
        criticality: 'medium',
        adapter: 'missing-adapter',
        assertions: ['skip explícito'],
      },
    ];

    const result = await runMesh({
      executionId,
      registry,
      refreshRegistry: false,
    });

    expect(result.executionId).toBe(executionId);
    expect(result.results).toHaveLength(3);
    expect(result.summary.attempted).toBe(3);
    expect(result.summary.executed).toBe(2);
    expect(result.summary.passed).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.executionCoverage).toBeCloseTo(2 / 3);
    expect(result.summary.executionQuality).toBe('invalid');
    expect(result.summary.goNoGo).toBe('NO_GO');
    expect(result.summary.reasons).toContain('INSUFFICIENT_COVERAGE');
    expect(result.summary.reasons).toContain('BLOCKING_SCENARIO_FAILED');
    expect(result.summary.failuresByType.functional_failure).toBe(1);
    expect(result.repairPlan.orderedFixList[0].scenarioId).toBe('mesh-api-fail');

    const skipped = result.results.find((item) => item.id === 'mesh-invalid-adapter');
    expect(skipped.status).toBe('skipped');
    expect(skipped.startedAt).toBeTruthy();
    expect(skipped.finishedAt).toBeTruthy();
    expect(skipped.errors).toContain('Adapter inválido: missing-adapter');
    expect(skipped.artifacts.some((item) => item.type === 'replay')).toBe(true);

    const summaryPath = path.join(EVIDENCE_DIR, executionId, 'summary.json');
    const historyPath = path.join(HISTORY_DIR, `${executionId}.json`);
    const repairPlanPath = path.join(process.cwd(), 'qa-mesh/repairPlan.json');
    const baselinePath = path.join(process.cwd(), 'qa-mesh/baseline.json');
    const metricsPath = path.join(process.cwd(), 'qa-mesh/metrics.json');
    expect(fs.existsSync(summaryPath)).toBe(true);
    expect(fs.existsSync(historyPath)).toBe(true);
    expect(fs.existsSync(repairPlanPath)).toBe(true);
    expect(fs.existsSync(baselinePath)).toBe(true);
    expect(fs.existsSync(metricsPath)).toBe(true);

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    expect(summary.executionId).toBe(executionId);
    expect(summary.total).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.topErrors.length).toBeGreaterThan(0);

    const failed = result.results.find((item) => item.id === 'mesh-api-fail');
    expect(failed.failureType).toBe('functional_failure');
    expect(failed.errorMessage).toBe('boom');
    expect(failed.rootCauseHint).toBeTruthy();
    expect(failed.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('não grava saídas canônicas quando writeCanonicalOutputs=false', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-noncanonical-'));
    const envBackup = {
      QA_MESH_REPORT_PATH: process.env.QA_MESH_REPORT_PATH,
      QA_MESH_REPAIR_PLAN_PATH: process.env.QA_MESH_REPAIR_PLAN_PATH,
      QA_MESH_METRICS_PATH: process.env.QA_MESH_METRICS_PATH,
      QA_MESH_GO_NO_GO_PATH: process.env.QA_MESH_GO_NO_GO_PATH,
      QA_MESH_RELEASE_GATE_PATH: process.env.QA_MESH_RELEASE_GATE_PATH,
      QA_MESH_HISTORY_DIR: process.env.QA_MESH_HISTORY_DIR,
      QA_MESH_EVIDENCE_DIR: process.env.QA_MESH_EVIDENCE_DIR,
      QA_MESH_INTELLIGENCE_DIR: process.env.QA_MESH_INTELLIGENCE_DIR,
    };

    process.env.QA_MESH_REPORT_PATH = path.join(tempRoot, 'meshReport.json');
    process.env.QA_MESH_REPAIR_PLAN_PATH = path.join(tempRoot, 'repairPlan.json');
    process.env.QA_MESH_METRICS_PATH = path.join(tempRoot, 'metrics.json');
    process.env.QA_MESH_GO_NO_GO_PATH = path.join(tempRoot, 'go-no-go-report.json');
    process.env.QA_MESH_RELEASE_GATE_PATH = path.join(tempRoot, 'release-gate-report.json');
    process.env.QA_MESH_HISTORY_DIR = path.join(tempRoot, 'history');
    process.env.QA_MESH_EVIDENCE_DIR = path.join(tempRoot, 'evidence');
    process.env.QA_MESH_INTELLIGENCE_DIR = path.join(tempRoot, 'intelligence');

    jest.resetModules();
    jest.doMock('../adapters/apiAdapter', () => ({
      executeScenario: jest.fn().mockResolvedValue({
        success: true,
        logs: [{ message: 'api pass' }],
        metrics: { adapter: 'api' },
        errors: [],
        artifacts: [],
      }),
    }));
    jest.doMock('../adapters/rpaAdapter', () => ({
      executeScenario: jest.fn().mockResolvedValue({
        success: true,
        logs: [{ message: 'rpa pass' }],
        metrics: { adapter: 'rpa' },
        errors: [],
        artifacts: [],
      }),
    }));
    jest.doMock('../adapters/pbxAdapter', () => ({
      executeScenario: jest.fn().mockResolvedValue({
        success: true,
        logs: [{ message: 'pbx pass' }],
        metrics: { adapter: 'pbx' },
        errors: [],
        artifacts: [],
      }),
    }));

    const isolatedMeshRunner = require('../meshRunner');

    try {
      const executionId = `mesh-no-canonical-${Date.now()}`;
      const result = await isolatedMeshRunner.runMesh({
        executionId,
        refreshRegistry: false,
        writeCanonicalOutputs: false,
        registry: [{
          id: 'mesh-api-pass',
          domain: 'beauty',
          type: 'smoke',
          source: 'qa',
          flow: 'beauty_pass',
          criticality: 'medium',
          adapter: 'api',
          assertions: ['passa'],
        }],
      });

      expect(result.summary.goNoGo).toBe('GO');
      expect(fs.existsSync(process.env.QA_MESH_REPORT_PATH)).toBe(false);
      expect(fs.existsSync(process.env.QA_MESH_REPAIR_PLAN_PATH)).toBe(false);
      expect(fs.existsSync(process.env.QA_MESH_METRICS_PATH)).toBe(false);
      expect(fs.existsSync(process.env.QA_MESH_GO_NO_GO_PATH)).toBe(false);
      expect(fs.existsSync(process.env.QA_MESH_RELEASE_GATE_PATH)).toBe(false);
      expect(fs.existsSync(path.join(process.env.QA_MESH_EVIDENCE_DIR, executionId, 'summary.json'))).toBe(true);
      expect(fs.existsSync(path.join(process.env.QA_MESH_HISTORY_DIR, `${executionId}.json`))).toBe(true);
    } finally {
      Object.entries(envBackup).forEach(([key, value]) => {
        if (typeof value === 'undefined') {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      jest.resetModules();
    }
  });
});
