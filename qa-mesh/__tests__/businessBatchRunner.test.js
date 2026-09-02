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

const apiAdapter = require('../adapters/apiAdapter');
const {
  isBusinessBatchEnabled,
  getBusinessBatchInfo,
  planBusinessBatches,
  executeBusinessBatches,
} = require('../businessBatchRunner');
const { runMesh } = require('../meshRunner');

function businessScenario(code, mode, overrides = {}) {
  return {
    id: `business-${code.toLowerCase()}`,
    domain: 'beauty',
    type: mode === 'screens' ? 'smoke' : 'regression',
    source: 'qa',
    flow: `fluxo ${code}`,
    criticality: 'high',
    adapter: 'api',
    command: 'node',
    commandArgs: ['core/rpa/cli.js', 'business', `--mode=${mode}`, `--code=${code}`],
    env: { PIPELINE_BYPASS: '1' },
    scenarioCode: code,
    assertions: [],
    ...overrides,
  };
}

function writeBatchReport(dir, name, scenarios) {
  const reportPath = path.join(dir, name);
  fs.writeFileSync(reportPath, `${JSON.stringify({ scenarios }, null, 2)}\n`, 'utf8');
  return reportPath;
}

function reportEntry(code, status, causaRaiz = null) {
  // Shape REAL do relatório business-qa (tests/rpa/business/reporting.js):
  // o campo canônico é `codigo` (pt-BR), não `code`. Manter assim para o
  // teste pegar regressões de atribuição code-vs-codigo.
  return {
    codigo: code,
    status,
    etapas: status === 'FAIL'
      ? [{ nome: 'flow-validation', status: 'FAIL', detalhe: `detalhe ${code}` }]
      : [{ nome: 'flow-validation', status: 'PASS' }],
    resumo: { causaRaiz },
  };
}

function batchProcessResult(reportPath, { success = true, code = 0, errors = [] } = {}) {
  return {
    success,
    code,
    logs: [
      { level: 'stdout', message: 'Business QA concluído', timestamp: new Date().toISOString() },
      { level: 'stdout', message: `- json: ${reportPath}`, timestamp: new Date().toISOString() },
    ],
    metrics: { command: 'node core/rpa/cli.js business' },
    errors,
  };
}

describe('qa-mesh/businessBatchRunner', () => {
  let tmpDir;
  const envBackup = { QA_MESH_BUSINESS_BATCH: process.env.QA_MESH_BUSINESS_BATCH };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'business-batch-'));
    delete process.env.QA_MESH_BUSINESS_BATCH;
  });

  afterEach(() => {
    if (typeof envBackup.QA_MESH_BUSINESS_BATCH === 'undefined') {
      delete process.env.QA_MESH_BUSINESS_BATCH;
    } else {
      process.env.QA_MESH_BUSINESS_BATCH = envBackup.QA_MESH_BUSINESS_BATCH;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('feature flag', () => {
    test('default ligado; QA_MESH_BUSINESS_BATCH=0 desativa; options.businessBatch=false desativa', () => {
      expect(isBusinessBatchEnabled({})).toBe(true);
      process.env.QA_MESH_BUSINESS_BATCH = '0';
      expect(isBusinessBatchEnabled({})).toBe(false);
      delete process.env.QA_MESH_BUSINESS_BATCH;
      expect(isBusinessBatchEnabled({ businessBatch: false })).toBe(false);
    });
  });

  describe('planBusinessBatches', () => {
    test('agrupa cenários business por modo em ordem determinística e ignora não business', () => {
      const plans = planBusinessBatches([
        businessScenario('J1', 'journeys'),
        { id: 'qa-core-auth-login', adapter: 'api', command: 'node', commandArgs: ['tests/rpa/login.test.js'] },
        businessScenario('S2', 'screens'),
        businessScenario('S1', 'screens'),
        businessScenario('F1', 'flows'),
      ]);

      expect(plans.map((plan) => plan.mode)).toEqual(['screens', 'flows', 'journeys']);
      const screens = plans[0];
      expect(screens.codes).toEqual(['S2', 'S1']);
      expect(screens.batchScenario.commandArgs).toEqual([
        'core/rpa/cli.js', 'business', '--mode=screens', '--code=S2,S1',
      ]);
      expect(screens.batchScenario.env).toEqual({ PIPELINE_BYPASS: '1' });
      expect(plans[1].batchScenario.commandArgs).toContain('--code=F1');
      expect(plans[2].batchScenario.commandArgs).toContain('--code=J1');
    });

    test('getBusinessBatchInfo rejeita cenário sem commandArgs business', () => {
      expect(getBusinessBatchInfo({ adapter: 'rpa', command: 'node' })).toBeNull();
      expect(getBusinessBatchInfo({ adapter: 'api', command: 'npm', commandArgs: ['run', 'x'] })).toBeNull();
      expect(getBusinessBatchInfo(businessScenario('S1', 'screens'))).toEqual({ mode: 'screens', code: 'S1' });
    });
  });

  describe('executeBusinessBatches', () => {
    test('atribui resultado por code: PASS/FAIL individuais, sem contaminação de erros', async () => {
      const reportPath = writeBatchReport(tmpDir, 'business-qa-screens.json', [
        reportEntry('S1', 'PASS'),
        reportEntry('S2', 'FAIL', 'causa raiz S2'),
      ]);
      apiAdapter.executeScenario.mockResolvedValue(batchProcessResult(reportPath, { success: false, code: 1 }));

      const plans = planBusinessBatches([businessScenario('S1', 'screens'), businessScenario('S2', 'screens')]);
      const batch = await executeBusinessBatches(plans, { evidenceDir: tmpDir });

      const s1 = batch.take('business-s1');
      const s2 = batch.take('business-s2');
      expect(s1.status).toBe('passed');
      expect(s1.errors).toEqual([]);
      expect(s2.status).toBe('failed');
      expect(s2.errors.join(' ')).toContain('causa raiz S2');
      expect(s2.errors.join(' ')).not.toContain('S1');
      expect(s2.metrics.businessBatch).toBe(true);
      expect(s2.metrics.exitCode).toBe(1);
      expect(s2.artifacts.some((a) => a.path === reportPath)).toBe(true);
    });

    test('cenário ausente no relatório do batch => failed com business_batch_missing_scenario', async () => {
      const reportPath = writeBatchReport(tmpDir, 'business-qa-screens.json', [
        reportEntry('S1', 'PASS'),
      ]);
      apiAdapter.executeScenario.mockResolvedValue(batchProcessResult(reportPath));

      const plans = planBusinessBatches([businessScenario('S1', 'screens'), businessScenario('S9', 'screens')]);
      const batch = await executeBusinessBatches(plans, { evidenceDir: tmpDir });

      expect(batch.take('business-s1').status).toBe('passed');
      const missing = batch.take('business-s9');
      expect(missing.status).toBe('failed');
      expect(missing.errors[0]).toContain('business_batch_missing_scenario');
    });

    test('processo do batch crashou (spawn lançou) => todos os cenários failed', async () => {
      apiAdapter.executeScenario.mockRejectedValue(new Error('spawn node ENOENT'));

      const plans = planBusinessBatches([businessScenario('F1', 'flows'), businessScenario('F2', 'flows')]);
      const batch = await executeBusinessBatches(plans, { evidenceDir: tmpDir });

      for (const id of ['business-f1', 'business-f2']) {
        const result = batch.take(id);
        expect(result.status).toBe('failed');
        expect(result.errors[0]).toContain('business_batch_crashed');
        expect(result.errors.join(' ')).toContain('spawn node ENOENT');
      }
    });

    test('relatório ausente/ilegível => todos os cenários failed com erro do processo', async () => {
      apiAdapter.executeScenario.mockResolvedValue({
        success: false,
        code: 1,
        logs: [{ level: 'stderr', message: 'boom antes do relatório', timestamp: new Date().toISOString() }],
        metrics: {},
        errors: ['boom antes do relatório'],
      });

      const plans = planBusinessBatches([businessScenario('J1', 'journeys'), businessScenario('J2', 'journeys')]);
      const batch = await executeBusinessBatches(plans, { evidenceDir: tmpDir });

      for (const id of ['business-j1', 'business-j2']) {
        const result = batch.take(id);
        expect(result.status).toBe('failed');
        expect(result.errors[0]).toContain('business_batch_report_missing');
        expect(result.errors.join(' ')).toContain('exit code 1');
      }
    });

    test('take() consome o resultado: retry cai no modo single (segundo take => null)', async () => {
      const reportPath = writeBatchReport(tmpDir, 'business-qa-screens.json', [reportEntry('S1', 'PASS')]);
      apiAdapter.executeScenario.mockResolvedValue(batchProcessResult(reportPath));

      const plans = planBusinessBatches([businessScenario('S1', 'screens')]);
      const batch = await executeBusinessBatches(plans, { evidenceDir: tmpDir });

      expect(batch.take('business-s1')).not.toBeNull();
      expect(batch.take('business-s1')).toBeNull();
      expect(batch.peek('business-s1')).toBeNull();
    });
  });

  describe('integração runMesh', () => {
    // Códigos únicos por execução: o meshRunner classifica 'flaky' a partir do
    // histórico em disco (qa-mesh/meshHistory) — ids reutilizados entre runs
    // ou suítes poluem a classificação. O sufixo torna os testes herméticos.
    const TAG = `t${Date.now().toString(36)}`;
    const S1 = `S1${TAG}`;
    const S2 = `S2${TAG}`;
    const F1 = `F1${TAG}`;
    const idOf = (code) => `business-${code.toLowerCase()}`;

    function mockBatchAdapter(reportByMode) {
      apiAdapter.executeScenario.mockImplementation(async (scenario) => {
        const codeArg = (scenario.commandArgs || []).find((arg) => /^--code=/.test(arg)) || '';
        const modeArg = (scenario.commandArgs || []).find((arg) => /^--mode=/.test(arg)) || '';
        const codes = codeArg.slice('--code='.length).split(',').filter(Boolean);
        const mode = modeArg.slice('--mode='.length);
        if (codes.length > 1) {
          // Chamada batch: 1 processo por modo com relatório compartilhado.
          const entries = codes.map((code) => reportByMode[mode][code]);
          const reportPath = writeBatchReport(tmpDir, `business-qa-${mode}.json`, entries);
          const anyFail = entries.some((entry) => entry && entry.status === 'FAIL');
          return batchProcessResult(reportPath, { success: !anyFail, code: anyFail ? 1 : 0 });
        }
        // Modo single (flag off): 1 processo por cenário com relatório próprio.
        const code = codes[0];
        const entry = reportByMode[mode][code];
        const reportPath = writeBatchReport(tmpDir, `business-qa-single-${code.toLowerCase()}.json`, [entry]);
        return batchProcessResult(reportPath, { success: entry.status === 'PASS', code: entry.status === 'PASS' ? 0 : 1 });
      });
    }

    test('batch ON: 1 processo por modo, resultados atribuídos por code e hints isolados', async () => {
      mockBatchAdapter({
        screens: {
          [S1]: reportEntry(S1, 'PASS'),
          [S2]: reportEntry(S2, 'FAIL', 'causa exclusiva S2'),
        },
        flows: {
          [F1]: reportEntry(F1, 'FAIL', 'causa exclusiva F1'),
        },
      });

      const execution = await runMesh({
        executionId: `mesh-batch-${Date.now()}`,
        refreshRegistry: false,
        registry: [
          businessScenario(S1, 'screens'),
          businessScenario(S2, 'screens'),
          businessScenario(F1, 'flows'),
        ],
      });

      // 2 processos (screens com S1,S2 + flows com F1), não 3.
      expect(apiAdapter.executeScenario).toHaveBeenCalledTimes(2);
      const batchCalls = apiAdapter.executeScenario.mock.calls.map(([scenario]) => scenario.commandArgs.join(' '));
      expect(batchCalls).toContain(`core/rpa/cli.js business --mode=screens --code=${S1},${S2}`);
      expect(batchCalls).toContain(`core/rpa/cli.js business --mode=flows --code=${F1}`);

      const s1 = execution.results.find((item) => item.id === idOf(S1));
      const s2 = execution.results.find((item) => item.id === idOf(S2));
      const f1 = execution.results.find((item) => item.id === idOf(F1));
      expect(s1.status).toBe('passed');
      expect(s2.status).toBe('failed');
      expect(f1.status).toBe('failed');
      // Hints de falha não vazam entre cenários do mesmo batch.
      expect(s2.errorMessage).toContain('causa exclusiva S2');
      expect(s2.errorMessage).not.toContain('F1');
      expect(f1.errorMessage).toContain('causa exclusiva F1');
      expect(f1.errorMessage).not.toContain('S2');
      expect(execution.summary.passed).toBe(1);
      expect(execution.summary.failed).toBe(2);
      expect(execution.summary.goNoGo).toBe('NO_GO');
    });

    test('QA_MESH_BUSINESS_BATCH=0: restaura 1 processo por cenário', async () => {
      process.env.QA_MESH_BUSINESS_BATCH = '0';
      mockBatchAdapter({
        screens: { [S1]: reportEntry(S1, 'PASS'), [S2]: reportEntry(S2, 'PASS') },
        flows: { [F1]: reportEntry(F1, 'PASS') },
      });

      const execution = await runMesh({
        executionId: `mesh-batch-off-${Date.now()}`,
        refreshRegistry: false,
        registry: [
          businessScenario(S1, 'screens'),
          businessScenario(S2, 'screens'),
          businessScenario(F1, 'flows'),
        ],
      });

      expect(apiAdapter.executeScenario).toHaveBeenCalledTimes(3);
      const singleCalls = apiAdapter.executeScenario.mock.calls.map(([scenario]) => scenario.commandArgs.join(' '));
      expect(singleCalls).toContain(`core/rpa/cli.js business --mode=screens --code=${S1}`);
      expect(singleCalls).toContain(`core/rpa/cli.js business --mode=screens --code=${S2}`);
      expect(singleCalls).toContain(`core/rpa/cli.js business --mode=flows --code=${F1}`);
      expect(execution.summary.passed).toBe(3);
      expect(execution.summary.goNoGo).toBe('GO');
    });

    test('batch respeita a seleção: só códigos selecionados entram no --code', async () => {
      mockBatchAdapter({
        screens: { [S1]: reportEntry(S1, 'PASS'), [S2]: reportEntry(S2, 'PASS') },
      });

      await runMesh({
        executionId: `mesh-batch-selection-${Date.now()}`,
        refreshRegistry: false,
        scenarioIds: [idOf(S2)],
        registry: [
          businessScenario(S1, 'screens'),
          businessScenario(S2, 'screens'),
        ],
      });

      expect(apiAdapter.executeScenario).toHaveBeenCalledTimes(1);
      const [batchScenario] = apiAdapter.executeScenario.mock.calls[0];
      expect(batchScenario.commandArgs).toContain(`--code=${S2}`);
      expect(batchScenario.commandArgs.join(' ')).not.toContain(S1);
    });
  });
});
