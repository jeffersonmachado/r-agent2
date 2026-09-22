'use strict';

/**
 * ERV1-CLOSE-009 — restart/resume + concorrência, com DB real.
 *
 * Achado real: `POST /engineering/tasks/:id/run` disparava `runTask` sem `await`
 * (fire-and-forget) e só DEPOIS `runTask` tentava o lock (`lockForRun`) — ou seja, o lock era
 * verificado DEPOIS da resposta HTTP 202 já ter sido enviada. Duas chamadas concorrentes de
 * `/run` na MESMA task recebiam 202+202; a segunda tentativa de lock falhava com
 * `TASK_ALREADY_RUNNING` de verdade, mas esse erro só era logado (`.catch(err => logger.error)`)
 * — o segundo chamador nunca sabia que a execução dele nunca rodou. Corrigido com `beginRun`:
 * adquire o lock de forma SÍNCRONA (awaited) antes de responder — a segunda chamada concorrente
 * agora recebe `TASK_ALREADY_RUNNING` genuinamente, antes de qualquer 202/409 ser decidido.
 *
 * Este teste usa `engineeringTaskService.lockForRun`/`unlockTask` diretamente (nível de
 * serviço, sem precisar de chamadas reais de LLM) para provar, com Postgres real:
 *   1. duas aquisições de lock concorrentes na mesma task — uma ganha, a outra recebe
 *      TASK_ALREADY_RUNNING de verdade (nunca duas simultâneas).
 *   2. um lock "órfão" (mais velho que o TTL de stale lock) é recuperado por um runner
 *      diferente — restart-safe de verdade, sem exigir intervenção manual.
 */

const sequelizeModule = require('../../api/db/sequelize');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const { beginRun, tolerantTransition } = require('../../api/services/engineeringRouter/engineeringRouterService');

// ER-V1-FINAL-001: o loop real (beginRun) roda testCommands via `docker run` real; sob a
// suíte completa em paralelo isso pode estourar o default de 10s do projeto.
jest.setTimeout(60000);

let dbAvailable = false;
let dbReason = null;
const createdTaskIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[engineering-task-concurrency] PULADO: postgres_unreachable (${dbReason})`);
  return true;
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
});

afterAll(async () => {
  if (!dbAvailable) return;
  const getModels = require('../../api/db/models');
  const Task = getModels.getEngineeringTask();
  try {
    await Task.destroy({ where: { id: createdTaskIds } });
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
});

async function makeTask(title) {
  const task = await engineeringTaskService.createTask({
    title,
    objective: 'objetivo de teste',
    allowedPaths: ['tests/unit/__fake.test.js'],
    testCommands: ['npm test'],
    maxIterations: 1,
  }, { createdBy: 'jest-concurrency-test' });
  createdTaskIds.push(task.id);
  return task;
}

describe('ERV1-CLOSE-009 — concorrência real (lockForRun com Postgres real)', () => {
  test('duas aquisições de lock concorrentes na mesma task: uma ganha, a outra recebe TASK_ALREADY_RUNNING real', async () => {
    if (skipIfNoDatabase()) return;
    const task = await makeTask('concurrency-real-test');

    const [first, second] = await Promise.allSettled([
      engineeringTaskService.lockForRun(task.id, 'runner-A'),
      engineeringTaskService.lockForRun(task.id, 'runner-B'),
    ]);

    const results = [first, second];
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Nunca as duas conseguem o lock ao mesmo tempo — exatamente uma ganha.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe('TASK_ALREADY_RUNNING');

    await engineeringTaskService.unlockTask(task.id);
  });

  test('lock fresco (não expirado) rejeita nova tentativa de lock imediatamente', async () => {
    if (skipIfNoDatabase()) return;
    const task = await makeTask('fresh-lock-real-test');

    await engineeringTaskService.lockForRun(task.id, 'runner-holder');
    await expect(engineeringTaskService.lockForRun(task.id, 'runner-intruder')).rejects.toMatchObject({ code: 'TASK_ALREADY_RUNNING' });

    await engineeringTaskService.unlockTask(task.id);
  });

  test('lock órfão (mais velho que o TTL de stale lock) é recuperado por um runner diferente — restart-safe', async () => {
    if (skipIfNoDatabase()) return;
    const task = await makeTask('restart-safe-real-test');

    // Simula um processo anterior que travou a task e morreu sem chamar unlockTask —
    // exatamente o cenário de "process dies during CODING/TESTING/REVIEWING" da missão.
    await engineeringTaskService.lockForRun(task.id, 'runner-crashed');

    const getModels = require('../../api/db/models');
    const Task = getModels.getEngineeringTask();
    const row = await Task.findByPk(task.id);
    const staleTimestamp = new Date(Date.now() - 20 * 60 * 1000); // 20min atrás > LOCK_STALE_MS padrão (15min)
    await row.update({ locked_at: staleTimestamp });

    // Um runner diferente (o processo reiniciado) consegue retomar sem intervenção manual.
    const recovered = await engineeringTaskService.lockForRun(task.id, 'runner-restarted');
    expect(recovered.locked_by).toBe('runner-restarted');

    await engineeringTaskService.unlockTask(task.id);
  });

  test('task em estado terminal nunca aceita novo lock (nem órfão, nem fresco)', async () => {
    if (skipIfNoDatabase()) return;
    const task = await makeTask('terminal-no-lock-real-test');
    // createTask já entrega a task classificada (CLASSIFIED) — não precisa/pode transicionar
    // para o mesmo estado de novo.
    await engineeringTaskService.transitionTask(task.id, 'ROUTED');
    await engineeringTaskService.transitionTask(task.id, 'CODING');
    await engineeringTaskService.transitionTask(task.id, 'TESTING');
    await engineeringTaskService.transitionTask(task.id, 'REVIEWING');
    await engineeringTaskService.transitionTask(task.id, 'REGRESSION');
    await engineeringTaskService.transitionTask(task.id, 'GOVERNANCE');
    await engineeringTaskService.transitionTask(task.id, 'GREEN');

    await expect(engineeringTaskService.lockForRun(task.id, 'runner-late')).rejects.toMatchObject({ code: 'TASK_TERMINAL' });
  });

  // ERV1-CLOSE-010 (achado real durante certificação de runtime): `acquireRunLock`, em
  // engineeringRouterService.js, checava estado terminal com uma lista hardcoded
  // ['GREEN','RED','BLOCKED','CANCELLED'] em vez de TERMINAL_STATES — o mesmo bug já corrigido
  // uma vez em computeOverview() quando READY_FOR_PROMOTION virou terminal (ERV1-CLOSE-005).
  // Impacto real: POST /engineering/tasks/:id/run numa task READY_FOR_PROMOTION não caía no
  // fast-path `alreadyTerminal` e ia direto para `lockForRun`, que rejeitava com TASK_TERMINAL —
  // um erro não tratado especificamente pela rota, virando 500 em vez do 200 idempotente correto.
  test('beginRun numa task READY_FOR_PROMOTION é idempotente (nunca tenta lock/relançar), mesmo sendo um estado terminal "não convencional"', async () => {
    if (skipIfNoDatabase()) return;
    const task = await makeTask('ready-for-promotion-idempotent-real-test');
    await engineeringTaskService.transitionTask(task.id, 'ROUTED');
    await engineeringTaskService.transitionTask(task.id, 'CODING');
    await engineeringTaskService.transitionTask(task.id, 'TESTING');
    await engineeringTaskService.transitionTask(task.id, 'REVIEWING');
    await engineeringTaskService.transitionTask(task.id, 'REGRESSION');
    await engineeringTaskService.transitionTask(task.id, 'GOVERNANCE');
    await engineeringTaskService.transitionTask(task.id, 'READY_FOR_PROMOTION');

    const result = await beginRun(task.id, { runnerId: 'runner-post-promotion-check' });
    expect(result).toEqual({ taskId: task.id, status: 'READY_FOR_PROMOTION', accepted: false });

    // Nunca deixou lock nenhum pendurado — task segue exatamente como estava.
    const reloaded = await engineeringTaskService.getTask(task.id);
    expect(reloaded.status).toBe('READY_FOR_PROMOTION');
    expect(reloaded.locked_by).toBeFalsy();
  });

  // ER-V1-FINAL-005 — Durable Resume, com Postgres real (não mockado). Simula exatamente os
  // cenários "process dies during CODING/TESTING/REVIEWING, restart" exigidos pela missão: o
  // estado real da task no banco já reflete uma transição que um processo anterior completou
  // antes de crashar — a retomada precisa reconhecer isso e continuar, nunca lançar
  // INVALID_STATE_TRANSITION não tratado.
  describe('ER-V1-FINAL-005 — retomada real após crash simulado (tolerantTransition, Postgres real)', () => {
    test('processo morre logo APÓS persistir CODING; retomada (novo processo) tolera e não duplica a transição', async () => {
      if (skipIfNoDatabase()) return;
      const task = await makeTask('resume-after-coding-crash');
      await engineeringTaskService.transitionTask(task.id, 'ROUTED');
      // Simula o processo original completando a transição para CODING e então crashando —
      // nunca chega a criar o attempt nem a transicionar adiante.
      await engineeringTaskService.transitionTask(task.id, 'CODING');

      // "Processo reiniciado" chama exatamente o que runOneAttempt chama no início — precisa
      // tolerar (idempotência real), nunca lançar.
      const resumed = await tolerantTransition(task.id, 'CODING');
      expect(resumed.status).toBe('CODING');

      const reloaded = await engineeringTaskService.getTask(task.id);
      expect(reloaded.status).toBe('CODING');
    });

    test('processo morre logo APÓS persistir TESTING; retomada tolera sem regredir o estado', async () => {
      if (skipIfNoDatabase()) return;
      const task = await makeTask('resume-after-testing-crash');
      await engineeringTaskService.transitionTask(task.id, 'ROUTED');
      await engineeringTaskService.transitionTask(task.id, 'CODING');
      await engineeringTaskService.transitionTask(task.id, 'TESTING');

      const resumed = await tolerantTransition(task.id, 'TESTING');
      expect(resumed.status).toBe('TESTING');
    });

    test('cancelamento concorrente durante CODING: retomada para TESTING detecta o estado terminal real e lança TASK_ALREADY_TERMINAL_DURING_RESUME (nunca opera sobre task morta)', async () => {
      if (skipIfNoDatabase()) return;
      const task = await makeTask('resume-detects-concurrent-cancel');
      await engineeringTaskService.transitionTask(task.id, 'ROUTED');
      await engineeringTaskService.transitionTask(task.id, 'CODING');
      // Simula POST /tasks/:id/cancel concorrente enquanto o processo original ainda "achava"
      // que estava em CODING.
      await engineeringTaskService.transitionTask(task.id, 'CANCELLED');

      await expect(tolerantTransition(task.id, 'TESTING')).rejects.toMatchObject({
        code: 'TASK_ALREADY_TERMINAL_DURING_RESUME',
        currentStatus: 'CANCELLED',
      });

      // A task real permanece CANCELLED — a retomada nunca a arrasta de volta para um estado
      // ativo.
      const reloaded = await engineeringTaskService.getTask(task.id);
      expect(reloaded.status).toBe('CANCELLED');
    });
  });
});
