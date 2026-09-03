'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Hermeticidade: runMesh anexa na cadeia append-only (executionHistoryChain)
// e grava baseline.json. Sem redirect, execuções sintéticas de teste poluem a
// cadeia real (quebra de integridade observada em 2026-09-03: appends
// concorrentes de workers paralelos criaram fork na cadeia, NO_GO no
// coverage gate) e sujam baseline.json no worktree.
const MESH_TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-runner-test-'));
process.env.QA_MESH_HISTORY_CHAIN_PATH = path.join(MESH_TEST_TMP, 'execution-history.jsonl');
process.env.QA_MESH_BASELINE_PATH = path.join(MESH_TEST_TMP, 'baseline.json');

jest.mock('../adapters/apiAdapter', () => ({
  executeScenario: jest.fn(),
}));

jest.mock('../adapters/rpaAdapter', () => ({
  executeScenario: jest.fn(),
}));

jest.mock('../adapters/pbxAdapter', () => ({
  executeScenario: jest.fn(),
}));

const {
  EVIDENCE_DIR,
  HISTORY_DIR,
  runMesh,
  run,
  normalizeExecutionRecord,
  applyGovernanceIntegrations,
  loadRegistry,
} = require('../meshRunner');
const apiAdapter = require('../adapters/apiAdapter');
const rpaAdapter = require('../adapters/rpaAdapter');
const pbxAdapter = require('../adapters/pbxAdapter');

describe('qa-mesh/meshRunner', () => {
  let runningInPipelineBackup;

  beforeAll(() => {
    runningInPipelineBackup = process.env.RUNNING_IN_PIPELINE;
  });

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

  afterEach(() => {
    if (typeof runningInPipelineBackup === 'undefined') {
      delete process.env.RUNNING_IN_PIPELINE;
    } else {
      process.env.RUNNING_IN_PIPELINE = runningInPipelineBackup;
    }
  });

  test('executa 3 cenários mockados e gera summary coerente', async () => {
    process.env.RUNNING_IN_PIPELINE = '1';
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
    expect(result.summary.pipelineBlocked).toBe(0);
    expect(result.executionOrigin).toBe('pipeline');
    expect(result.isCanonicalExecution).toBe(false);
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

  test('execução local fora do pipeline é marcada como não canônica mesmo sem writeCanonicalOutputs=false', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-local-noncanonical-'));
    const envBackup = {
      QA_MESH_REPORT_PATH: process.env.QA_MESH_REPORT_PATH,
      QA_MESH_REPAIR_PLAN_PATH: process.env.QA_MESH_REPAIR_PLAN_PATH,
      QA_MESH_METRICS_PATH: process.env.QA_MESH_METRICS_PATH,
      QA_MESH_GO_NO_GO_PATH: process.env.QA_MESH_GO_NO_GO_PATH,
      QA_MESH_RELEASE_GATE_PATH: process.env.QA_MESH_RELEASE_GATE_PATH,
      QA_MESH_HISTORY_DIR: process.env.QA_MESH_HISTORY_DIR,
      QA_MESH_EVIDENCE_DIR: process.env.QA_MESH_EVIDENCE_DIR,
      QA_MESH_INTELLIGENCE_DIR: process.env.QA_MESH_INTELLIGENCE_DIR,
      RUNNING_IN_PIPELINE: process.env.RUNNING_IN_PIPELINE,
    };

    delete process.env.RUNNING_IN_PIPELINE;
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
      const executionId = `mesh-local-${Date.now()}`;
      const result = await isolatedMeshRunner.runMesh({
        executionId,
        refreshRegistry: false,
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

      expect(result.executionOrigin).toBe('manual_run');
      expect(result.isCanonicalExecution).toBe(false);
      expect(result.summary.executionOrigin).toBe('manual_run');
      expect(result.summary.isCanonicalExecution).toBe(false);
      expect(fs.existsSync(process.env.QA_MESH_GO_NO_GO_PATH)).toBe(false);
      expect(fs.existsSync(process.env.QA_MESH_RELEASE_GATE_PATH)).toBe(false);
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

  test('pipeline com registry parcial não sobrescreve saídas canônicas', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-partial-pipeline-'));
    const envBackup = {
      QA_MESH_REPORT_PATH: process.env.QA_MESH_REPORT_PATH,
      QA_MESH_REPAIR_PLAN_PATH: process.env.QA_MESH_REPAIR_PLAN_PATH,
      QA_MESH_METRICS_PATH: process.env.QA_MESH_METRICS_PATH,
      QA_MESH_GO_NO_GO_PATH: process.env.QA_MESH_GO_NO_GO_PATH,
      QA_MESH_RELEASE_GATE_PATH: process.env.QA_MESH_RELEASE_GATE_PATH,
      QA_MESH_HISTORY_DIR: process.env.QA_MESH_HISTORY_DIR,
      QA_MESH_EVIDENCE_DIR: process.env.QA_MESH_EVIDENCE_DIR,
      QA_MESH_INTELLIGENCE_DIR: process.env.QA_MESH_INTELLIGENCE_DIR,
      RUNNING_IN_PIPELINE: process.env.RUNNING_IN_PIPELINE,
    };

    process.env.RUNNING_IN_PIPELINE = '1';
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
      const executionId = `mesh-partial-pipeline-${Date.now()}`;
      const result = await isolatedMeshRunner.runMesh({
        executionId,
        refreshRegistry: false,
        registry: [{
          id: 'workspace-core-status-separation',
          domain: 'workspace',
          type: 'workspace',
          source: 'qa',
          flow: 'workspace status separation',
          criticality: 'blocking',
          adapter: 'api',
          assertions: ['status tecnico preservado'],
        }],
      });

      expect(result.executionOrigin).toBe('pipeline');
      expect(result.isCanonicalExecution).toBe(false);
      expect(result.summary.isCanonicalExecution).toBe(false);
      expect(fs.existsSync(process.env.QA_MESH_REPORT_PATH)).toBe(false);
      expect(fs.existsSync(process.env.QA_MESH_REPAIR_PLAN_PATH)).toBe(false);
      expect(fs.existsSync(process.env.QA_MESH_METRICS_PATH)).toBe(false);
      expect(fs.existsSync(process.env.QA_MESH_GO_NO_GO_PATH)).toBe(false);
      expect(fs.existsSync(process.env.QA_MESH_RELEASE_GATE_PATH)).toBe(false);
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

  test('execução canônica concorrente falha rápido com lock explícito', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-canonical-lock-'));
    const envBackup = {
      QA_MESH_REPORT_PATH: process.env.QA_MESH_REPORT_PATH,
      QA_MESH_REPAIR_PLAN_PATH: process.env.QA_MESH_REPAIR_PLAN_PATH,
      QA_MESH_METRICS_PATH: process.env.QA_MESH_METRICS_PATH,
      QA_MESH_GO_NO_GO_PATH: process.env.QA_MESH_GO_NO_GO_PATH,
      QA_MESH_RELEASE_GATE_PATH: process.env.QA_MESH_RELEASE_GATE_PATH,
      QA_MESH_HISTORY_DIR: process.env.QA_MESH_HISTORY_DIR,
      QA_MESH_EVIDENCE_DIR: process.env.QA_MESH_EVIDENCE_DIR,
      QA_MESH_INTELLIGENCE_DIR: process.env.QA_MESH_INTELLIGENCE_DIR,
      QA_MESH_CANONICAL_LOCK_PATH: process.env.QA_MESH_CANONICAL_LOCK_PATH,
      QA_MESH_CANONICAL_PROMOTION_PATH: process.env.QA_MESH_CANONICAL_PROMOTION_PATH,
      RUNNING_IN_PIPELINE: process.env.RUNNING_IN_PIPELINE,
    };

    process.env.RUNNING_IN_PIPELINE = '1';
    process.env.QA_MESH_REPORT_PATH = path.join(tempRoot, 'meshReport.json');
    process.env.QA_MESH_REPAIR_PLAN_PATH = path.join(tempRoot, 'repairPlan.json');
    process.env.QA_MESH_METRICS_PATH = path.join(tempRoot, 'metrics.json');
    process.env.QA_MESH_GO_NO_GO_PATH = path.join(tempRoot, 'go-no-go-report.json');
    process.env.QA_MESH_RELEASE_GATE_PATH = path.join(tempRoot, 'release-gate-report.json');
    process.env.QA_MESH_HISTORY_DIR = path.join(tempRoot, 'history');
    process.env.QA_MESH_EVIDENCE_DIR = path.join(tempRoot, 'evidence');
    process.env.QA_MESH_INTELLIGENCE_DIR = path.join(tempRoot, 'intelligence');
    process.env.QA_MESH_CANONICAL_LOCK_PATH = path.join(tempRoot, 'canonical.lock.json');
    process.env.QA_MESH_CANONICAL_PROMOTION_PATH = path.join(tempRoot, 'canonical-promotion.json');

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
      fs.writeFileSync(process.env.QA_MESH_CANONICAL_LOCK_PATH, `${JSON.stringify({
        executionId: 'mesh-canonical-in-flight',
        startedAt: '2026-05-11T17:40:00.000Z',
        pid: process.pid,
      }, null, 2)}\n`, 'utf8');

      await expect(isolatedMeshRunner.runMesh({
        executionId: `mesh-canonical-${Date.now()}`,
        refreshRegistry: false,
      })).rejects.toThrow('Outra execução canônica do QA Mesh já está em andamento');

      expect(fs.existsSync(process.env.QA_MESH_REPORT_PATH)).toBe(false);
      expect(fs.existsSync(process.env.QA_MESH_CANONICAL_PROMOTION_PATH)).toBe(false);
      const currentLock = JSON.parse(fs.readFileSync(process.env.QA_MESH_CANONICAL_LOCK_PATH, 'utf8'));
      expect(currentLock.executionId).toBe('mesh-canonical-in-flight');
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

  test('recupera lock canônico stale quando o processo dono não existe mais', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-canonical-stale-lock-'));
    const envBackup = {
      QA_MESH_REPORT_PATH: process.env.QA_MESH_REPORT_PATH,
      QA_MESH_REPAIR_PLAN_PATH: process.env.QA_MESH_REPAIR_PLAN_PATH,
      QA_MESH_METRICS_PATH: process.env.QA_MESH_METRICS_PATH,
      QA_MESH_GO_NO_GO_PATH: process.env.QA_MESH_GO_NO_GO_PATH,
      QA_MESH_RELEASE_GATE_PATH: process.env.QA_MESH_RELEASE_GATE_PATH,
      QA_MESH_HISTORY_DIR: process.env.QA_MESH_HISTORY_DIR,
      QA_MESH_EVIDENCE_DIR: process.env.QA_MESH_EVIDENCE_DIR,
      QA_MESH_INTELLIGENCE_DIR: process.env.QA_MESH_INTELLIGENCE_DIR,
      QA_MESH_CANONICAL_LOCK_PATH: process.env.QA_MESH_CANONICAL_LOCK_PATH,
      QA_MESH_CANONICAL_PROMOTION_PATH: process.env.QA_MESH_CANONICAL_PROMOTION_PATH,
      RUNNING_IN_PIPELINE: process.env.RUNNING_IN_PIPELINE,
    };

    process.env.RUNNING_IN_PIPELINE = '1';
    process.env.QA_MESH_REPORT_PATH = path.join(tempRoot, 'meshReport.json');
    process.env.QA_MESH_REPAIR_PLAN_PATH = path.join(tempRoot, 'repairPlan.json');
    process.env.QA_MESH_METRICS_PATH = path.join(tempRoot, 'metrics.json');
    process.env.QA_MESH_GO_NO_GO_PATH = path.join(tempRoot, 'go-no-go-report.json');
    process.env.QA_MESH_RELEASE_GATE_PATH = path.join(tempRoot, 'release-gate-report.json');
    process.env.QA_MESH_HISTORY_DIR = path.join(tempRoot, 'history');
    process.env.QA_MESH_EVIDENCE_DIR = path.join(tempRoot, 'evidence');
    process.env.QA_MESH_INTELLIGENCE_DIR = path.join(tempRoot, 'intelligence');
    process.env.QA_MESH_CANONICAL_LOCK_PATH = path.join(tempRoot, 'canonical.lock.json');
    process.env.QA_MESH_CANONICAL_PROMOTION_PATH = path.join(tempRoot, 'canonical-promotion.json');

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
      fs.writeFileSync(process.env.QA_MESH_CANONICAL_LOCK_PATH, `${JSON.stringify({
        executionId: 'mesh-canonical-stale',
        startedAt: '2026-05-11T17:40:00.000Z',
        pid: 999999,
      }, null, 2)}\n`, 'utf8');

      const result = await isolatedMeshRunner.runMesh({
        executionId: `mesh-canonical-recovered-${Date.now()}`,
        refreshRegistry: false,
      });

      expect(result.isCanonicalExecution).toBe(true);
      expect(fs.existsSync(process.env.QA_MESH_CANONICAL_PROMOTION_PATH)).toBe(true);
      expect(fs.existsSync(process.env.QA_MESH_CANONICAL_LOCK_PATH)).toBe(false);
      const promotion = JSON.parse(fs.readFileSync(process.env.QA_MESH_CANONICAL_PROMOTION_PATH, 'utf8'));
      expect(promotion.executionId).toBe(result.executionId);
      expect(promotion.criterion).toBe('serialized_canonical_execution');
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
  }, 30000);

  test('classifica bloqueio de pipeline como pipeline_required e não flaky', async () => {
    const previousExecutionId = `mesh-prev-${Date.now()}`;
    const previousHistoryPath = path.join(HISTORY_DIR, `${previousExecutionId}.json`);
    fs.writeFileSync(previousHistoryPath, `${JSON.stringify({
      executionId: previousExecutionId,
      results: [{ id: 'mesh-pipeline-only', status: 'passed' }],
      summary: { total: 1, passed: 1, failed: 0, executionCoverage: 1, goNoGo: 'GO' },
    }, null, 2)}\n`, 'utf8');

    apiAdapter.executeScenario.mockResolvedValueOnce({
      success: false,
      logs: [],
      metrics: { adapter: 'api' },
      errors: ['Error: [core/rpa/cli] "business-qa" exige o pipeline oficial. Execute: npm run pipeline Para uso local explicito: PIPELINE_BYPASS=1 <comando>'],
      artifacts: [],
    });

    const executionId = `mesh-pipeline-${Date.now()}`;
    const result = await runMesh({
      executionId,
      refreshRegistry: false,
      registry: [{
        id: 'mesh-pipeline-only',
        domain: 'beauty',
        type: 'regression',
        source: 'qa',
        flow: 'pipeline_only',
        criticality: 'high',
        adapter: 'api',
        requiresOfficialPipeline: true,
        assertions: ['pipeline only'],
      }],
    });

    const scenario = result.results.find((item) => item.id === 'mesh-pipeline-only');
    expect(scenario.status).toBe('environment_missing');
    expect(scenario.failureType).toBe('pipeline_required');
    expect(scenario.rootCauseHint).toContain('pipeline oficial');
    expect(result.summary.pipelineBlocked).toBe(1);
  });

  test('normaliza origem legada segura para pipeline e execuções manuais da UI', () => {
    const pipelineExecution = normalizeExecutionRecord({
      executionId: 'mesh-pipeline-123',
      summary: {},
    });
    expect(pipelineExecution.executionOrigin).toBe('pipeline');
    expect(pipelineExecution.isCanonicalExecution).toBe(true);

    const manualExecution = normalizeExecutionRecord({
      executionId: 'meshq-123-abc',
      summary: {},
    });
    expect(manualExecution.executionOrigin).toBe('manual_run');
    expect(manualExecution.isCanonicalExecution).toBe(false);
  });

  test('meshRunner.run aplica mode=failure no workspace-core', async () => {
    process.env.RUNNING_IN_PIPELINE = '1';
    const executionId = `mesh-workspace-mode-${Date.now()}`;

    await run('workspace-core', {
      executionId,
      refreshRegistry: false,
      registry: [{
        id: 'workspace-core',
        domain: 'workspace',
        type: 'workspace',
        source: 'qa',
        flow: 'Workspace Core Journey',
        criticality: 'blocking',
        adapter: 'api',
        command: 'node',
        commandArgs: ['scripts/workspace-core-smoke.js'],
        assertions: ['status coerente'],
      }],
      mode: 'failure',
    });

    expect(apiAdapter.executeScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'workspace-core',
        env: expect.objectContaining({ WORKSPACE_TEST_MODE: 'failure' }),
        runtimeMode: 'failure',
      }),
      expect.any(Object),
    );
  });

  test('governance cria AutoCorrectionRun e Workspace insight/action quando decision=REVIEW', async () => {
    const fakeDb = {
      connect: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(true),
      models: {
        AutoCorrectionRun: () => ({
          findOne: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'run-1' }),
        }),
        AutoCorrectionAction: () => ({
          create: jest.fn().mockResolvedValue({ id: 'auto-action-1' }),
        }),
        WorkspaceEntityLink: () => ({
          findOrCreate: jest.fn().mockResolvedValue([{ id: 'link-1' }, true]),
        }),
        WorkspaceInsight: () => ({
          create: jest.fn().mockResolvedValue({ id: 'insight-1' }),
        }),
        WorkspaceAction: () => ({
          create: jest.fn().mockResolvedValue({ id: 'action-1' }),
        }),
        WorkspaceTimelineEvent: () => ({
          create: jest.fn().mockResolvedValue({ id: 'event-1' }),
        }),
        Evidence: () => ({
          findOne: jest.fn().mockResolvedValue({ toJSON: () => ({ metadata: {} }) }),
          update: jest.fn().mockResolvedValue([1]),
        }),
      },
    };

    const integration = await applyGovernanceIntegrations({
      summary: {
        wave: 'workspace-core',
        status: 'passed',
        tenantId: 'tenant-1',
        entityId: 'entity-1',
        checks: { entityCreated: true },
        artifacts: { summaryPath: 'qa/workspace-core/evidence/latest/summary.json', replayPath: 'qa/workspace-core/evidence/latest/replay.json' },
        records: { evidenceId: 'evidence-1' },
      },
      governance: {
        decision: 'REVIEW',
        reason: 'High severity checks require technical review',
        severity: 'high',
        failedChecks: ['taskLinked'],
      },
      scenario: { id: 'workspace-core' },
      summaryPath: '/opt/results/ria/r-agent2/qa/workspace-core/evidence/latest/summary.json',
      db: fakeDb,
    });

    expect(integration.integrated).toBe(true);
    expect(integration.created.autocorrectionRunId).toBe('run-1');
    expect(integration.created.workspaceInsightId).toBe('insight-1');
    expect(integration.created.workspaceActionId).toBe('action-1');
    expect(fakeDb.connect).toHaveBeenCalled();
    expect(fakeDb.close).toHaveBeenCalled();
  });

  test('governance GO_WITH_WARNINGS não cria AutoCorrectionRun e mantém insight/action', async () => {
    const runFindOne = jest.fn().mockResolvedValue(null);
    const runCreate = jest.fn().mockResolvedValue({ id: 'run-should-not-exist' });
    const actionCreate = jest.fn().mockResolvedValue({ id: 'auto-action-should-not-exist' });
    const workspaceInsightCreate = jest.fn().mockResolvedValue({ id: 'insight-2' });
    const workspaceActionCreate = jest.fn().mockResolvedValue({ id: 'action-2' });

    const fakeDb = {
      connect: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(true),
      models: {
        AutoCorrectionRun: () => ({
          findOne: runFindOne,
          create: runCreate,
        }),
        AutoCorrectionAction: () => ({
          create: actionCreate,
        }),
        WorkspaceEntityLink: () => ({
          findOrCreate: jest.fn().mockResolvedValue([{ id: 'link-2' }, true]),
        }),
        WorkspaceInsight: () => ({
          create: workspaceInsightCreate,
        }),
        WorkspaceAction: () => ({
          create: workspaceActionCreate,
        }),
        WorkspaceTimelineEvent: () => ({
          create: jest.fn().mockResolvedValue({ id: 'event-2' }),
        }),
        Evidence: () => ({
          findOne: jest.fn().mockResolvedValue({ toJSON: () => ({ metadata: {} }) }),
          update: jest.fn().mockResolvedValue([1]),
        }),
      },
    };

    const integration = await applyGovernanceIntegrations({
      summary: {
        wave: 'workspace-core',
        status: 'passed',
        tenantId: 'tenant-1',
        entityId: 'entity-1',
        checks: { metadataComplete: false },
        artifacts: {
          summaryPath: 'qa/workspace-core/evidence/latest/summary.json',
          replayPath: 'qa/workspace-core/evidence/latest/replay.json',
        },
        records: { evidenceId: 'evidence-2' },
      },
      governance: {
        decision: 'GO_WITH_WARNINGS',
        reason: 'Only medium checks failed',
        severity: 'medium',
        failedChecks: ['metadataComplete'],
      },
      scenario: { id: 'workspace-core' },
      summaryPath: '/opt/results/ria/r-agent2/qa/workspace-core/evidence/latest/summary.json',
      db: fakeDb,
    });

    expect(integration.integrated).toBe(true);
    expect(integration.created.autocorrectionRunId).toBeNull();
    expect(integration.created.workspaceInsightId).toBe('insight-2');
    expect(integration.created.workspaceActionId).toBe('action-2');
    expect(runFindOne).not.toHaveBeenCalled();
    expect(runCreate).not.toHaveBeenCalled();
    expect(actionCreate).not.toHaveBeenCalled();
    expect(workspaceInsightCreate).toHaveBeenCalled();
    expect(workspaceActionCreate).toHaveBeenCalled();
    expect(fakeDb.connect).toHaveBeenCalled();
    expect(fakeDb.close).toHaveBeenCalled();
  });

  test('governance pode preservar conexão compartilhada quando executa dentro do servidor', async () => {
    const fakeDb = {
      connect: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(true),
      models: {},
    };

    const integration = await applyGovernanceIntegrations({
      summary: {
        wave: 'workspace-core',
        status: 'passed',
        tenantId: 'tenant-1',
        entityId: null,
        checks: {},
        artifacts: {},
        records: {},
      },
      governance: {
        decision: 'GO',
        reason: 'All critical checks passed',
        severity: 'low',
        failedChecks: [],
      },
      scenario: { id: 'workspace-core' },
      closeDbAfterIntegration: false,
      db: fakeDb,
    });

    expect(integration.integrated).toBe(true);
    expect(fakeDb.connect).toHaveBeenCalled();
    expect(fakeDb.close).not.toHaveBeenCalled();
  });

  test('governance GO cria apenas timeline leve qa_execution', async () => {
    const runFindOne = jest.fn().mockResolvedValue(null);
    const runCreate = jest.fn().mockResolvedValue({ id: 'run-should-not-exist' });
    const workspaceInsightCreate = jest.fn().mockResolvedValue({ id: 'insight-should-not-exist' });
    const workspaceActionCreate = jest.fn().mockResolvedValue({ id: 'action-should-not-exist' });
    const timelineCreate = jest.fn().mockResolvedValue({ id: 'event-go-1' });

    const fakeDb = {
      connect: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(true),
      models: {
        AutoCorrectionRun: () => ({
          findOne: runFindOne,
          create: runCreate,
        }),
        AutoCorrectionAction: () => ({
          create: jest.fn(),
        }),
        WorkspaceEntityLink: () => ({
          findOrCreate: jest.fn().mockResolvedValue([{ id: 'link-go' }, true]),
        }),
        WorkspaceInsight: () => ({
          create: workspaceInsightCreate,
        }),
        WorkspaceAction: () => ({
          create: workspaceActionCreate,
        }),
        WorkspaceTimelineEvent: () => ({
          create: timelineCreate,
        }),
        Evidence: () => ({
          findOne: jest.fn().mockResolvedValue({ toJSON: () => ({ metadata: {} }) }),
          update: jest.fn().mockResolvedValue([1]),
        }),
      },
    };

    const integration = await applyGovernanceIntegrations({
      summary: {
        wave: 'workspace-core',
        status: 'passed',
        tenantId: 'tenant-1',
        entityId: 'entity-1',
        checks: {},
        artifacts: {
          summaryPath: 'qa/workspace-core/evidence/latest/summary.json',
          replayPath: 'qa/workspace-core/evidence/latest/replay.json',
        },
        records: { evidenceId: 'evidence-go' },
      },
      governance: {
        decision: 'GO',
        reason: 'All critical checks passed',
        severity: 'low',
        failedChecks: [],
      },
      scenario: { id: 'workspace-core' },
      summaryPath: '/opt/results/ria/r-agent2/qa/workspace-core/evidence/latest/summary.json',
      db: fakeDb,
    });

    expect(integration.integrated).toBe(true);
    expect(integration.created.autocorrectionRunId).toBeNull();
    expect(integration.created.workspaceInsightId).toBeNull();
    expect(integration.created.workspaceActionId).toBeNull();
    expect(integration.created.timelineEventId).toBe('event-go-1');
    expect(runFindOne).not.toHaveBeenCalled();
    expect(runCreate).not.toHaveBeenCalled();
    expect(workspaceInsightCreate).not.toHaveBeenCalled();
    expect(workspaceActionCreate).not.toHaveBeenCalled();
    expect(timelineCreate).toHaveBeenCalledWith(expect.objectContaining({ type: 'qa_execution' }));
  });

  test('mantém status técnico original mesmo quando decision=REVIEW', async () => {
    process.env.RUNNING_IN_PIPELINE = '1';
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-governance-status-'));
    const summaryPath = path.join(tmpRoot, 'summary.json');
    fs.writeFileSync(summaryPath, `${JSON.stringify({
      wave: 'workspace-core',
      mode: 'real',
      status: 'passed',
      tenantId: 'tenant-x',
      entityId: null,
      checks: {
        entityCreated: true,
        linksCreated: true,
        timelineConsistent: true,
        replayGenerated: true,
        evidenceGenerated: true,
        ticketLinked: false,
      },
      errors: [],
      artifacts: {},
      records: {},
      autocorrection: { required: false, created: false, reason: 'n/a' },
    }, null, 2)}\n`, 'utf8');

    apiAdapter.executeScenario.mockResolvedValueOnce({
      success: true,
      logs: [{ message: JSON.stringify({ summaryPath }) }],
      metrics: { adapter: 'api' },
      errors: [],
      artifacts: [],
    });

    const execution = await runMesh({
      executionId: `mesh-governance-status-${Date.now()}`,
      refreshRegistry: false,
      registry: [{
        id: 'workspace-core-status-separation',
        domain: 'workspace',
        type: 'workspace',
        source: 'qa',
        flow: 'workspace status separation',
        criticality: 'blocking',
        adapter: 'api',
        assertions: ['status tecnico preservado'],
      }],
    });

    const scenario = execution.results.find((item) => item.id === 'workspace-core-status-separation');
    expect(scenario).toBeTruthy();
    expect(scenario.status).toBe('passed');
    expect(scenario.governance?.decision).toBe('REVIEW');
  });

  test('meshRegistry contém cenário workspace-core oficial', () => {
    // Usa loadRegistry() para ser resiliente a drift externo do arquivo JSON.
    // loadRegistry() chama ensureWorkspaceCoreInRegistry() e garante workspace-core sempre.
    const registry = loadRegistry();
    const workspaceCore = registry.find((item) => item.id === 'workspace-core');

    expect(workspaceCore).toBeTruthy();
    expect(workspaceCore.adapter).toBe('api-rpa');
    expect(workspaceCore.command).toBe('node');
    expect(workspaceCore.commandArgs).toEqual(['scripts/workspace-core-smoke.js']);
  });
});
