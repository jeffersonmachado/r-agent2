'use strict';

/**
 * tests/integration/bugWorkerBootFindsRealWorkE2E.test.js
 *
 * BOOT_TO_REAL_BUG_PROCESSING_E2E — o worker do laço de bugs é iniciado pelo BOOT
 * NORMAL e, sem NENHUMA chamada manual ao loop, ENCONTRA trabalho real e o FAZ
 * PROGREDIR.
 *
 * POR QUE ESTE TESTE EXISTE (e por que os dois E2Es vizinhos não bastam):
 *   - `bugWorkerFullBootE2E` prova a FIAÇÃO do boot, mas DUBLA o ciclo
 *     (`runBugLoopSweep` mockado) — ele diz que o worker START, não que ele TRABALHA;
 *   - `engineeringBugAutonomousLoopE2E` prova o ciclo REAL, mas o dispara À MÃO
 *     (`bugLoop.handleAnomaly(...)`) — prova a peça, não a descoberta de trabalho.
 * A lacuna entre os dois é exatamente onde um defeito vive: o worker pode subir
 * corretamente e nunca encontrar nada, e os dois testes continuam verdes.
 *
 * O que este teste prova: com o finding SUSPECTED REAL plantado no Postgres, o
 * sweep disparado PELO BOOT o encontra e o PROCESSА (tenta reproduzir), deixando
 * progresso OBSERVÁVEL na linha do finding — sem que o teste chame
 * `runBugLoopSweep`, `handleAnomaly` ou `reproduce` uma única vez.
 *
 * O que é dublê: somente a rede (nenhuma é usada) e o runner de reprodução, que é
 * injetado pelo worker. Nada do caminho boot → worker → descoberta → progressão.
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO via `skipOrFail` (RELEASE_AUTHORITATIVE=1 lança).
 */

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
// O OBJETO DO TESTE: o worker do laço de bugs habilitado pelo caminho de BOOT.
process.env.ENABLE_BUG_LOOP_WORKER = 'true';
process.env.ENGINEERING_BUG_LOOP_INTERVAL_MS = '600000';

const path = require('path');

const sequelizeModule = require('../../api/db/sequelize');
const { skipOrFail } = require('../helpers/infraGate');
const bugFindingService = require('../../api/services/engineeringMission/bugFindingService');
const bugLoopWorker = require('../../api/services/engineeringMission/bugLoopWorker');

const SUITE_NAME = 'bug-worker-boot-finds-real-work-e2e';
const createdFindingIds = [];

let dbAvailable = false;
let dbReason = 'desconhecido';

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

async function waitFor(predicate, { timeoutMs = 120000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last;
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
}, 60000);

afterAll(async () => {
  try { require('../../api/runtime/startWorkers').stopWorkers(); } catch (_) { /* best-effort */ }
  if (dbAvailable) {
    const models = require('../../api/db/models');
    for (const id of createdFindingIds) {
      await models.getEngineeringBugFinding().destroy({ where: { id } }).catch(() => {});
    }
  }
  await sequelizeModule.close().catch(() => {});
}, 60000);

describe('BOOT_TO_REAL_BUG_PROCESSING_E2E', () => {
  jest.setTimeout(240000);

  test('o BOOT sobe o worker, o worker ENCONTRA o finding real e o faz PROGREDIR (sem chamada manual)', async () => {
    if (!dbAvailable) return skipOrFail(SUITE_NAME, `Postgres indisponível: ${dbReason}`, { requirement: 'postgres' });

    // ── Trabalho REAL plantado no banco ──────────────────────────────────────
    // O finding nasce SUSPECTED: é justamente o estado que o sweep procura.
    const registered = await bugFindingService.registerFinding(
      {
        title: `E2E boot→descoberta ${Date.now()}`,
        source: 'INVARIANT_VIOLATION',
        detail: 'invariante de fixture violada para provar que o worker do boot encontra trabalho real',
        evidenceRefs: [{ type: 'ARTIFACT', ref: 'tests/integration/bugWorkerBootFindsRealWorkE2E.test.js' }],
        // Sem plano de reprodução o sweep não teria o que executar
        // (`buildReproductionPlan` devolve UNAVAILABLE) e o finding ficaria parado —
        // que é um estado legítimo do produto, mas não prova PROCESSAMENTO.
        reproduction: {
          invariants: [{
            id: 'INV-BOOT-E2E',
            description: 'o worker iniciado pelo boot encontra e processa o finding real',
          }],
        },
      },
      { actor: 'jest-e2e-boot', tenantId: 'system' },
    );
    // `registerFinding` devolve { finding, deduplicated, recurrence }.
    const finding = registered.finding || registered;
    createdFindingIds.push(finding.id);
    const created = await bugFindingService.getFinding(finding.id);
    expect(String(created.status)).toBe('SUSPECTED');

    // NENHUMA chamada ao loop antes/disso: o disparo tem de vir do BOOT.
    const sweepSpy = jest.spyOn(
      require('../../api/services/engineeringMission/bugLoopCoordinatorService'),
      'runBugLoopSweep',
    );

    const { startServerRuntime } = require('../../api/runtime/startServerRuntime');
    const { startWorkers, getEngineeringWorkerHealth } = require('../../api/runtime/startWorkers');

    const server = { listen: jest.fn((port, cb) => cb()) };
    await startServerRuntime({
      logger: silentLogger(),
      clearLimitersCache: () => {},
      startInitialization: async () => {},
      getOrCreateServer: () => server,
      port: 0,
      startWorkers,
      workerDeps: {
        logger: silentLogger(),
        outboundWorker: { start() {} },
        startAutoCleanup: null,
        startAutoReturnToBot: () => {},
        startAssignmentWorker: () => {},
      },
      processRef: { exit: jest.fn(), on: jest.fn() },
    });

    // A FIACAO: o boot iniciou o worker do laço de bugs.
    const workerStatus = bugLoopWorker.getBugLoopWorkerStatus();
    expect(workerStatus.running).toBe(true);
    expect(workerStatus.health).toBe('RUNNING');

    // ── A DESCOBERTA: o sweep foi disparado PELO WORKER, não pelo teste ──────
    // O worker agenda um sweep imediato no boot para assumir trabalho de um
    // processo anterior. A asserção é sobre a ORIGEM da chamada (nenhuma linha
    // deste teste chamou o loop), não sobre o número de ciclos.
    await waitFor(async () => sweepSpy.mock.calls.length > 0, { timeoutMs: 60000, intervalMs: 500 });
    expect(sweepSpy.mock.calls.length).toBeGreaterThan(0);

    // ── A PROGRESSÃO: o finding real saiu de SUSPECTED ───────────────────────
    // Progresso observável = o estado mudou OU a tentativa de reprodução ficou
    // registrada. Não se exige o ciclo inteiro (isso é do E2E do loop): exige-se
    // que o trabalho REAL tenha sido ENCONTRADO e PROCESSADO.
    const progressed = await waitFor(async () => {
      const current = await bugFindingService.getFinding(finding.id);
      if (!current) return null;
      const status = String(current.status);
      if (status !== 'SUSPECTED') return { kind: 'STATUS', status };
      const attempts = Array.isArray(current.reproduction_attempts) ? current.reproduction_attempts : [];
      if (attempts.length > 0) return { kind: 'REPRODUCTION_ATTEMPT', status, attempts: attempts.length };
      return null;
    }, { timeoutMs: 90000, intervalMs: 2000 });

    expect(progressed).toBeTruthy();

    const after = await bugFindingService.getFinding(finding.id);
    // A prova é o PROCESSAMENTO real: ou o estado avançou, ou a tentativa de
    // reprodução ficou registrada no próprio finding.
    const attemptsAfter = Array.isArray(after.reproduction_attempts) ? after.reproduction_attempts : [];
    expect(String(after.status) !== 'SUSPECTED' || attemptsAfter.length > 0).toBe(true);

    // ── SHUTDOWN LIMPO ───────────────────────────────────────────────────────
    const { stopWorkers } = require('../../api/runtime/startWorkers');
    stopWorkers();
    const afterStop = bugLoopWorker.getBugLoopWorkerStatus();
    expect(afterStop.running).toBe(false);
    expect(afterStop.workerInstanceId).toBeNull();

    // A saúde publicada também precisa parar de afirmar RUNNING sem timer vivo.
    const health = getEngineeringWorkerHealth({ engineerRouterEnabled: true });
    expect(health.workers.bugLoop.health).not.toBe('RUNNING');

    sweepSpy.mockRestore();
  });
});
