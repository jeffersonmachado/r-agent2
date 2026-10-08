'use strict';

/**
 * Resiliência do worker de inteligência de segurança (Fase 9b).
 *
 * O que estes testes protegem — falhas que NÃO aparecem no caminho feliz:
 *   1. Ciclos NUNCA se sobrepõem: um ciclo lento em andamento não deixa o
 *      próximo disparar em paralelo (cadeia de `setTimeout`, nunca `setInterval`).
 *   2. Erro de ciclo é CAPTURADO: o worker não pode derrubar o processo da API
 *      com unhandled rejection, e continua tentando no intervalo seguinte.
 *   3. Falha persistente derruba a saúde para DEGRADED (monitor doente não pode
 *      parecer saudável) e um ciclo bem-sucedido recupera o estado.
 *   4. Restart é limpo: `stop` cancela o agendamento de verdade (nenhum ciclo
 *      fantasma depois), e `start` seguinte volta a rodar.
 *   5. Falha na sincronização da base (opt-in) NÃO é memorizada como base fresca:
 *      o ciclo seguinte tenta de novo em vez de achar que a base está boa.
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
  startSecurityIntelWorker,
  stopSecurityIntelWorker,
  getSecurityIntelWorkerStatus,
  _resetSecurityIntelWorkerState,
} = require('../../../api/services/securityIntel/securityIntelWorker');

const POLICY = { advisorySources: { osv: { maxAgeHoursBeforeStale: 72 } } };
const INTERVAL_MS = 1000;

function scanReport(overrides = {}) {
  return {
    componentsScanned: 1653,
    findings: 248,
    events: 0,
    resolved: 0,
    kevFindings: 0,
    advisoryBaseStale: false,
    bySeverity: { HIGH: 118, MEDIUM: 108 },
    ...overrides,
  };
}

/**
 * Encerramento explícito de cada teste.
 *
 * O `afterEach` de `tests/setup.js` (deste repo) aguarda um `setTimeout` REAL:
 * com timers falsos ainda instalados esse hook trava até o timeout do Jest. Por
 * isso os timers reais voltam AQUI, no corpo do teste, e não no `afterEach` —
 * a ordem de execução dos `afterEach` não é uma garantia que se possa usar.
 */
function finish() {
  stopSecurityIntelWorker();
  _resetSecurityIntelWorkerState();
  jest.useRealTimers();
}

/** Espera ativa: evita depender de um `sleep` calibrado em máquina carregada. */
async function waitFor(predicate, { timeoutMs = 5000, stepMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  throw new Error('waitFor: condição não satisfeita dentro do timeout');
}

beforeEach(() => {
  jest.useFakeTimers();
  logger.info.mockImplementation(() => {});
  logger.error.mockImplementation(() => {});
  logger.warn.mockImplementation(() => {});
  loadPolicy.mockReturnValue(POLICY);
  scanComponents.mockImplementation(() => Promise.resolve(scanReport()));
  generatePatchPlans.mockResolvedValue({ candidates: 108, summary: { withoutPatch: 9, requiringHumanApproval: 29 } });
  listDistinctPackages.mockResolvedValue([{ ecosystem: 'npm', name: 'ws' }]);
  syncAdvisories.mockResolvedValue({ stats: { advisories: 654 }, failures: [] });
  getSequelize.mockReturnValue({});
  getSecurityAdvisorySync.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
  _resetSecurityIntelWorkerState();
});

afterEach(() => {
  finish();
});

describe('securityIntelWorker — resiliência', () => {
  it('não sobrepõe ciclos quando o ciclo anterior ainda está em andamento', async () => {
    // Este cenário usa tempo REAL de propósito: o callback do agendamento é
    // `() => tick(...)`, ou seja, devolve a promise do ciclo — e o avanço de
    // timers falsos aguarda essa promise, travando enquanto o ciclo está
    // pendente (justamente o estado que queremos observar).
    jest.useRealTimers();

    const SCAN_DURATION_MS = 400;
    scanComponents
      .mockImplementationOnce(() => new Promise((resolve) => {
        setTimeout(() => resolve(scanReport()), SCAN_DURATION_MS);
      }))
      .mockImplementation(() => Promise.resolve(scanReport()));

    startSecurityIntelWorker({ intervalMs: 30 });
    await waitFor(() => scanComponents.mock.calls.length >= 1);
    expect(scanComponents).toHaveBeenCalledTimes(1);

    // Vários intervalos passam com o ciclo ainda em andamento: nada novo dispara.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(scanComponents).toHaveBeenCalledTimes(1);

    // Concluído o ciclo, o próximo é agendado e executado.
    await waitFor(() => scanComponents.mock.calls.length >= 2);
    expect(getSecurityIntelWorkerStatus().cycles).toBeGreaterThanOrEqual(1);
    finish();
  });

  it('captura o erro do ciclo (sem unhandled rejection) e continua tentando', async () => {
    const failure = new Error('banco fora do ar');
    failure.code = 'persistence_required';
    scanComponents.mockImplementation(() => Promise.reject(failure));

    startSecurityIntelWorker({ intervalMs: INTERVAL_MS });
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(scanComponents).toHaveBeenCalledTimes(1);
    // O erro precisa ser LOGADO, não propagado: propagar derrubaria a API.
    expect(logger.error).toHaveBeenCalledWith(
      '[securityIntelWorker] ciclo FALHOU',
      expect.objectContaining({ error: 'banco fora do ar', code: 'persistence_required' }),
    );
    expect(getSecurityIntelWorkerStatus().lastError).toBe('banco fora do ar');

    // Continua tentando no intervalo seguinte (o worker não morre no primeiro erro).
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(scanComponents).toHaveBeenCalledTimes(2);
    expect(generatePatchPlans).not.toHaveBeenCalled();
    finish();
  });

  it('falha persistente derruba a saúde para DEGRADED e um sucesso recupera', async () => {
    scanComponents.mockImplementation(() => Promise.reject(new Error('timeout do provedor')));

    startSecurityIntelWorker({ intervalMs: INTERVAL_MS });
    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    const degraded = getSecurityIntelWorkerStatus();
    expect(degraded.health).toBe('DEGRADED');
    expect(degraded.code).toBe('consecutive_cycle_failures');
    expect(degraded.consecutiveErrors).toBeGreaterThanOrEqual(3);
    expect(degraded.running).toBe(true);

    scanComponents.mockImplementation(() => Promise.resolve(scanReport()));
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);

    const recovered = getSecurityIntelWorkerStatus();
    expect(recovered.health).toBe('UP');
    expect(recovered.code).toBeNull();
    expect(recovered.consecutiveErrors).toBe(0);
    finish();
  });

  it('restart é limpo: stop cancela o agendamento e não deixa ciclo fantasma', async () => {
    const first = startSecurityIntelWorker({ intervalMs: INTERVAL_MS });
    expect(first.started).toBe(true);

    // Segundo start enquanto roda não cria um segundo agendamento.
    const second = startSecurityIntelWorker({ intervalMs: INTERVAL_MS });
    expect(second).toEqual({ started: false, reason: 'already_running' });

    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(scanComponents).toHaveBeenCalledTimes(1);

    stopSecurityIntelWorker();
    expect(getSecurityIntelWorkerStatus().health).toBe('DOWN');
    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 10);
    expect(scanComponents).toHaveBeenCalledTimes(1);

    // Parar duas vezes é seguro (idempotente).
    expect(() => stopSecurityIntelWorker()).not.toThrow();

    const restarted = startSecurityIntelWorker({ intervalMs: INTERVAL_MS });
    expect(restarted.started).toBe(true);
    expect(getSecurityIntelWorkerStatus().cycles).toBe(0);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(scanComponents).toHaveBeenCalledTimes(2);
    finish();
  });

  it('falha na sincronização da base não é memorizada como base fresca', async () => {
    // Base ausente (findOne → null) + opt-in explícito de egress.
    syncAdvisories.mockImplementation(() => Promise.reject(new Error('osv 503')));

    startSecurityIntelWorker({
      intervalMs: INTERVAL_MS,
      env: { SECURITY_INTEL_SYNC_ADVISORIES: '1' },
    });

    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(syncAdvisories).toHaveBeenCalledTimes(1);
    // A correlação nem roda: sem base sincronizada o ciclo falha ANTES do scan.
    expect(scanComponents).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(syncAdvisories).toHaveBeenCalledTimes(2);
    finish();
  });
});
