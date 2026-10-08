'use strict';

/**
 * Testes do worker de monitoramento contínuo.
 *
 * Provas centrais:
 *   - Egress é OPT-IN: sem a flag não se sincroniza base (worker offline).
 *   - Base vencida é o gatilho da sincronização — não um relógio fixo.
 *   - Achado KEV/CRITICAL/HIGH NOVO escalona em nível de erro (alerta visível).
 *   - Falha de ciclo é contada e derruba a saúde — monitor parado nunca parece UP.
 */

const logger = require('../../../api/utils/logger');

jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../api/services/securityIntel/vulnerabilityScanService', () => ({
  loadPolicy: jest.fn(),
  scanComponents: jest.fn(),
  syncAdvisories: jest.fn(),
}));

jest.mock('../../../api/services/securityIntel/inventoryStoreService', () => ({
  listDistinctPackages: jest.fn(),
}));

jest.mock('../../../api/services/securityIntel/patchPlanService', () => ({
  generatePatchPlans: jest.fn(),
}));

jest.mock('../../../api/db/sequelize', () => ({
  connect: jest.fn(),
  getSequelize: jest.fn(),
}));

jest.mock('../../../api/db/models/SecurityAdvisorySync', () => jest.fn());

const { loadPolicy, scanComponents, syncAdvisories } = require('../../../api/services/securityIntel/vulnerabilityScanService');
const { listDistinctPackages } = require('../../../api/services/securityIntel/inventoryStoreService');
const { generatePatchPlans } = require('../../../api/services/securityIntel/patchPlanService');
const { getSequelize } = require('../../../api/db/sequelize');
const getSecurityAdvisorySync = require('../../../api/db/models/SecurityAdvisorySync');

const {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  isEnabled,
  resolveIntervalMs,
  shouldSyncAdvisories,
  countEscalations,
  runCycle,
  startSecurityIntelWorker,
  stopSecurityIntelWorker,
  getSecurityIntelWorkerStatus,
  _resetSecurityIntelWorkerState,
} = require('../../../api/services/securityIntel/securityIntelWorker');

const POLICY = {
  advisorySources: { osv: { maxAgeHoursBeforeStale: 72 } },
};

function scanReport(overrides = {}) {
  return {
    componentsScanned: 1653,
    findings: 21,
    events: 3,
    resolved: 1,
    kevFindings: 0,
    advisoryBaseStale: false,
    bySeverity: { HIGH: 2, MEDIUM: 19 },
    ...overrides,
  };
}

beforeEach(() => {
  // resetMocks: true apaga implementações — reestabelecer sempre.
  logger.info.mockImplementation(() => {});
  logger.error.mockImplementation(() => {});
  logger.warn.mockImplementation(() => {});
  loadPolicy.mockReturnValue(POLICY);
  scanComponents.mockResolvedValue(scanReport());
  generatePatchPlans.mockResolvedValue({ candidates: 21, summary: { withoutPatch: 5, requiringHumanApproval: 16 } });
  listDistinctPackages.mockResolvedValue([{ ecosystem: 'npm', name: 'ws' }]);
  syncAdvisories.mockResolvedValue({ stats: { advisories: 298 }, failures: [] });
  getSequelize.mockReturnValue({});
  getSecurityAdvisorySync.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
  _resetSecurityIntelWorkerState();
});

afterEach(() => {
  _resetSecurityIntelWorkerState();
});

describe('securityIntelWorker — configuração', () => {
  test('habilitado por padrão, desabilitável por env', () => {
    expect(isEnabled({})).toBe(true);
    expect(isEnabled({ ENABLE_SECURITY_INTEL_WORKER: 'false' })).toBe(false);
  });

  test('intervalo tem default, respeita env e tem piso mínimo', () => {
    expect(resolveIntervalMs({})).toBe(DEFAULT_INTERVAL_MS);
    expect(resolveIntervalMs({ SECURITY_INTEL_WORKER_INTERVAL_MS: '900000' })).toBe(900000);
    expect(resolveIntervalMs({ SECURITY_INTEL_WORKER_INTERVAL_MS: '5' })).toBe(MIN_INTERVAL_MS);
    expect(resolveIntervalMs({ SECURITY_INTEL_WORKER_INTERVAL_MS: 'lixo' })).toBe(DEFAULT_INTERVAL_MS);
  });

  test('sincronizar base é OPT-IN (worker não sai para a rede por padrão)', () => {
    expect(shouldSyncAdvisories({})).toBe(false);
    expect(shouldSyncAdvisories({ SECURITY_INTEL_SYNC_ADVISORIES: 'true' })).toBe(false);
    expect(shouldSyncAdvisories({ SECURITY_INTEL_SYNC_ADVISORIES: '1' })).toBe(true);
  });

  test('escalonamento conta KEV, CRITICAL e HIGH do relatório de scan', () => {
    expect(countEscalations(scanReport({ kevFindings: 1, bySeverity: { CRITICAL: 2, HIGH: 3 } })))
      .toMatchObject({ kev: 1, critical: 2, high: 3 });
  });
});

describe('securityIntelWorker — ciclo', () => {
  test('sem opt-in não toca a rede e mantém a correlação fresca', async () => {
    const result = await runCycle({ tenantKey: 'system', env: {} });
    expect(syncAdvisories).not.toHaveBeenCalled();
    expect(scanComponents).toHaveBeenCalledWith(expect.objectContaining({ scope: 'installed' }));
    expect(generatePatchPlans).toHaveBeenCalled();
    expect(result.summary.sync).toBeNull();
    expect(result.summary.scan).toMatchObject({ components: 1653, findings: 21 });
    expect(result.summary.plans).toMatchObject({ candidates: 21 });
  });

  test('com opt-in sincroniza quando a base está vencida', async () => {
    const old = new Date(Date.now() - 10 * 24 * 3600000).toISOString();
    getSecurityAdvisorySync.mockReturnValue({ findOne: jest.fn().mockResolvedValue({ started_at: old, finished_at: old }) });
    const result = await runCycle({ tenantKey: 'system', env: { SECURITY_INTEL_SYNC_ADVISORIES: '1' } });
    expect(syncAdvisories).toHaveBeenCalledTimes(1);
    expect(result.summary.sync).toMatchObject({ advisories: 298 });
  });

  test('com opt-in NÃO sincroniza base fresca (não bate na rede sem necessidade)', async () => {
    const fresh = new Date(Date.now() - 3600000).toISOString();
    getSecurityAdvisorySync.mockReturnValue({ findOne: jest.fn().mockResolvedValue({ started_at: fresh, finished_at: fresh }) });
    const result = await runCycle({ tenantKey: 'system', env: { SECURITY_INTEL_SYNC_ADVISORIES: '1' } });
    expect(syncAdvisories).not.toHaveBeenCalled();
    expect(result.summary.sync).toMatchObject({ skipped: true });
  });

  test('achado KEV/CRITICAL/HIGH NOVO escala em nível de erro', async () => {
    scanComponents.mockResolvedValue(scanReport({ kevFindings: 1, bySeverity: { CRITICAL: 1, HIGH: 2 } }));
    await runCycle({ tenantKey: 'system', env: {} });
    expect(logger.error).toHaveBeenCalledWith(
      '[securityIntelWorker] achados de risco exigem atenção',
      expect.objectContaining({ kev: 1, critical: 1, high: 2 })
    );
  });

  test('sem evento novo não escala (evita alarme repetido)', async () => {
    scanComponents.mockResolvedValue(scanReport({ events: 0, bySeverity: { CRITICAL: 5 } }));
    await runCycle({ tenantKey: 'system', env: {} });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('securityIntelWorker — ciclo de vida e saúde', () => {
  test('start/stop com estado visível (DOWN quando parado)', () => {
    expect(getSecurityIntelWorkerStatus()).toMatchObject({ health: 'DOWN', code: 'worker_not_started' });
    const started = startSecurityIntelWorker({ intervalMs: 3600000, env: {} });
    expect(started).toMatchObject({ started: true, intervalMs: 3600000 });
    expect(getSecurityIntelWorkerStatus()).toMatchObject({ health: 'UP', running: true });
    stopSecurityIntelWorker();
    expect(getSecurityIntelWorkerStatus()).toMatchObject({ health: 'DOWN', code: 'worker_stopped', running: false });
  });

  test('não inicia duas vezes nem quando desabilitado', () => {
    startSecurityIntelWorker({ intervalMs: 3600000, env: {} });
    expect(startSecurityIntelWorker({ intervalMs: 3600000, env: {} })).toMatchObject({ started: false, reason: 'already_running' });
    stopSecurityIntelWorker();
    expect(startSecurityIntelWorker({ intervalMs: 3600000, env: { ENABLE_SECURITY_INTEL_WORKER: 'false' } }))
      .toMatchObject({ started: false, reason: 'disabled_by_env' });
  });

  test('status expõe a configuração de egress vigente', () => {
    expect(getSecurityIntelWorkerStatus().syncAdvisoriesEnabled).toBe(false);
  });
});
