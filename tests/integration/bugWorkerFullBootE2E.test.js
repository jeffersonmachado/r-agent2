'use strict';

/**
 * tests/integration/bugWorkerFullBootE2E.test.js
 *
 * BUG_WORKER_FULL_APPLICATION_BOOT_E2E — o worker do laço de bugs é iniciado pelo BOOT NORMAL da
 * aplicação, e NÃO por uma chamada direta ao starter.
 *
 * POR QUE ISSO IMPORTA (e por que uma prova que chama `startBugLoopWorker()` não serve): o worker
 * já sabia rodar ciclos, mas o que o operador observa é a APLICAÇÃO SUBINDO. Um teste que chama o
 * starter à mão prova a peça; não prova a FIACAO — e era exatamente a fiação que podia regredir sem
 * ninguém ver (o `startWorkers` podia parar de iniciar o worker e a saúde continuaria verde nos
 * testes da peça isolada).
 *
 * O caminho exercitado é o REAL: `startServerRuntime` → `startWorkers` → worker. A identidade da
 * instância é gerada no boot (não é um rótulo do teste), a saúde é publicada, e o shutdown limpa o
 * timer (sem processo pendurado).
 *
 * O CICLO do worker é dublado de propósito: o alvo aqui é a FIACAO de boot/saúde/shutdown, não o
 * processamento de findings — esse tem provas próprias (`engineeringBugAutonomousLoopE2E`) e exigir
 * banco no boot tornaria o teste de fiacao refém de infraestrutura alheia ao que ele mede.
 */

// Desliga TODOS os workers que não são o objeto deste teste: o alvo é a fiação do laço de bugs.
process.env.ENABLE_WHATSAPP_QR_BRIDGE = 'false';
process.env.ENABLE_OUTBOUND_WORKER = 'false';
process.env.ENABLE_TICKET_AUTO_CLEANUP = 'false';
process.env.ENABLE_AUTO_RETURN_TO_BOT = 'false';
process.env.ENABLE_ASSIGNMENT_WORKER = 'false';
process.env.ENABLE_EXECUTION_QUEUE_WORKER = 'false';
process.env.ENABLE_SCHEDULER = 'false';
process.env.ENABLE_VERTICAL_SCHEDULER = 'false';
process.env.ENABLE_CHANNEL_HEALTH_MONITOR = 'false';
process.env.ENABLE_MARKETING_GOOGLE_ADS_SCHEDULER = 'false';
process.env.ENABLE_PLAYWRIGHT_BOOT_CHECK = 'false';
process.env.ENABLE_BUG_LOOP_WORKER = 'true';
process.env.ENGINEERING_BUG_LOOP_INTERVAL_MS = '60000';

jest.mock('../../api/services/engineeringMission/bugLoopCoordinatorService', () => ({
  runBugLoopSweep: jest.fn(async () => ({ scanned: 0, items: [] })),
  runFixLoop: jest.fn(),
  handleAnomaly: jest.fn(),
}));

const { startServerRuntime } = require('../../api/runtime/startServerRuntime');
const { startWorkers, stopWorkers, getEngineeringWorkerHealth } = require('../../api/runtime/startWorkers');
const bugLoopWorker = require('../../api/services/engineeringMission/bugLoopWorker');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function fakeProcess() {
  const handlers = {};
  return { exit: jest.fn(), on: jest.fn((event, fn) => { handlers[event] = fn; }), handlers };
}

describe('BUG_WORKER_FULL_APPLICATION_BOOT_E2E', () => {
  afterAll(() => {
    // Nunca deixar timer do worker vazando entre suítes (o módulo tem estado de processo).
    try { stopWorkers(); } catch (_) { /* shutdown best-effort */ }
  });

  it('o BOOT NORMAL inicia o worker, publica saúde e o shutdown limpa o timer', async () => {
    // `resetMocks` apaga as implementações de fábrica: o dublê do ciclo é reinstalado aqui.
    const coordinator = require('../../api/services/engineeringMission/bugLoopCoordinatorService');
    coordinator.runBugLoopSweep.mockResolvedValue({ scanned: 0, items: [] });

    const startSpy = jest.spyOn(bugLoopWorker, 'startBugLoopWorker');

    const processRef = fakeProcess();
    const server = { listen: jest.fn((port, cb) => cb()) };

    // ── O BOOT, pelo entrypoint de produção (startServerRuntime → startWorkers) ────────────────
    const result = await startServerRuntime({
      logger: silentLogger,
      clearLimitersCache: () => {},
      startInitialization: async () => {},
      getOrCreateServer: () => server,
      port: 0,
      startWorkers,
      workerDeps: {
        logger: silentLogger,
        outboundWorker: { start() {} },
        startAutoCleanup: null,
        startAutoReturnToBot: () => {},
        startAssignmentWorker: () => {},
      },
      processRef,
    });

    expect(result).toBe(server);
    expect(server.listen).toHaveBeenCalled();

    // A FIACAO: o boot chamou o starter do laço de bugs (e não o próprio teste).
    expect(startSpy).toHaveBeenCalledTimes(1);

    // SAÚDE publicada pelo boot: worker RUNNING, com IDENTIDADE gerada no boot.
    const status = bugLoopWorker.getBugLoopWorkerStatus();
    expect(status.running).toBe(true);
    expect(status.health).toBe('RUNNING');
    expect(status.workerInstanceId).toBeTruthy();
    expect(String(status.workerInstanceId)).toMatch(/BUG_LOOP/);

    const health = getEngineeringWorkerHealth({ engineerRouterEnabled: true });
    expect(health.workers.bugLoop.health).toBe('RUNNING');
    expect(health.engineeringReadiness).not.toBe('NO_GO');
    // `blocking` é a LISTA de motivos bloqueantes (vazia quando nada bloqueia).
    expect(health.blocking).toHaveLength(0);

    // ── SHUTDOWN LIMPO ──────────────────────────────────────────────────────────────────────────
    stopWorkers();
    const afterStop = bugLoopWorker.getBugLoopWorkerStatus();
    expect(afterStop.running).toBe(false);
    expect(afterStop.workerInstanceId).toBeNull();
    // Sem timer vivo, a saúde não pode continuar afirmando RUNNING.
    expect(afterStop.health).not.toBe('RUNNING');

    // Nenhum ciclo foi disparado pelo TESTE: o único ciclo possível é o imediato agendado pelo
    // PRÓPRIO boot (comportamento intencional do worker: assumir trabalho de um processo anterior).
    expect(coordinator.runBugLoopSweep.mock.calls.length).toBeLessThanOrEqual(1);

    startSpy.mockRestore();
  }, 60000);
});
