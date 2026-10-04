'use strict';

/**
 * REAL ENGINEERING TASK RECOVERY (missão V2) — o item que decide o selo.
 *
 * O que é provado, em runtime, com processo REAL morto por SIGKILL -9:
 *   1. missão real criada pelo compiler oficial;
 *   2. EngineeringTask REAL criada e VINCULADA à missão (`linkTask` → linked_task_id) — sem esse
 *      vínculo o recovery devolve NO_TASK_TO_RESUME, que a missão rejeita como TEST INVALID;
 *   3. processo A separado adquire o lease DA TASK, entra em IMPLEMENTING e segura o lease;
 *   4. SIGKILL: morte abrupta, sem liberar lease, sem terminar a fase;
 *   5. processo B (boot recovery) roda SEM chamada manual de resume;
 *   6. o recovery localiza a missão com task vinculada E a task órfã, e retoma;
 *   7. o fence AVANÇA e o lease deixa de pertencer ao worker morto.
 *
 * O que NÃO se exige aqui (e por quê): a progressão até GREEN depende de provider de IA, que neste
 * ambiente responde `circuit breaker aberto`/`ai_unavailable`. Este verificador separa os estados:
 * prova a RETOMADA (o que o lease/fencing/recovery governam) e declara a dependência de IA como
 * causa externa quando ela aparece — nunca como sucesso.
 *
 * Uso: node scripts/governance/verify-real-task-recovery.js [--json]
 * Saída: reports/real-task-recovery-report.json — exit 0 (GO) / 1 (NO_GO)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CHILD = path.join('tests', 'helpers', 'taskLeaseWorkerChild.js');
const REPORT = path.join(ROOT, 'reports', 'real-task-recovery-report.json');

const checks = [];
function check(id, ok, detail) {
  checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail: detail || '' });
  return ok;
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function runChildAndKill(taskId, workerInstanceId, missionId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', CHILD, taskId, workerInstanceId, missionId || ''], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: process.env.NODE_ENV || 'development' },
    });
    let settled = false;
    let buffer = '';
    let stderr = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (error) { /* ignore */ }
      reject(new Error(`handshake do worker A não chegou em 30s. stderr=${stderr}`));
    }, 30000);

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      // O filho também emite logs: consome TODAS as linhas do chunk.
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (!line.startsWith('{') || settled) continue;
        // O filho agora roda o CAMINHO REAL do produto, que LOGA objetos JSON multi-linha no stdout.
        // Uma linha iniciada por `{` pode ser log, não handshake: só é handshake o que faz parse E
        // traz `state`. Sem isso o harness morria com `SyntaxError` ao ler o log (medido 2026-09-28).
        let parsed = null;
        try {
          parsed = JSON.parse(line);
        } catch (_) {
          continue;
        }
        if (!parsed || typeof parsed.state !== 'string') continue;
        settled = true;
        clearTimeout(timer);
        const handshake = parsed;
        const pid = child.pid;
        child.kill('SIGKILL');
        child.on('exit', (code, signal) => resolve({ handshake, pid, code, signal }));
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
  });
}

async function main() {
  const startedAt = new Date().toISOString();
  const sequelizeModule = require(path.join(ROOT, 'api/db/sequelize'));
  const compiler = require(path.join(ROOT, 'api/services/engineeringMission/missionCompilerService'));
  const missionStore = require(path.join(ROOT, 'api/services/engineeringMission/missionStoreService'));
  const recovery = require(path.join(ROOT, 'api/services/engineeringMission/missionRecoveryCoordinator'));
  const taskService = require(path.join(ROOT, 'api/services/engineeringRouter/engineeringTaskService'));

  const detail = {};
  let missionId = null;
  let taskId = null;

  try {
    await sequelizeModule.connect(2, 250);
    check('INFRA_POSTGRES', true, 'conectado');

    // 1. Missão real pelo caminho oficial.
    const { mission } = await compiler.compileMission('Recuperar uma EngineeringTask real apos morte do worker.', { createdBy: 'verify-real-task-recovery' });
    missionId = mission.id;
    check('MISSION_CREATED', Boolean(missionId), `missionId=${missionId}`);

    // 2. Task REAL criada e VINCULADA — o vínculo é o que permite o recovery saber o que retomar.
    const task = await taskService.createTask({ title: `Task real de recovery ${Date.now()}`, objective: 'Executar fase material e sobreviver ao crash do worker' }, { createdBy: 'verify-real-task-recovery' });
    taskId = task.id;
    await missionStore.linkTask({ missionId, taskId });
    const linked = await missionStore.getMission(missionId);
    check('TASK_LINKED_TO_MISSION', linked && linked.linked_task_id === taskId, `linked_task_id=${linked && linked.linked_task_id}`);
    detail.task = { taskId, missionId };

    // 2b. FLUXO REAL: uma task só existe em execução porque a missão foi APROVADA. Medido: sem
    // aprovação a missão fica em AWAITING_APPROVAL, fora dos estados resumíveis — e o recovery a
    // ignora CORRETAMENTE (o defeito era o E2E pular a aprovação, não o recovery).
    await missionStore.updateMission(missionId, { status: 'APPROVED' });
    const approved = await missionStore.getMission(missionId);
    check('MISSION_APPROVED', approved && approved.status === 'APPROVED', `status=${approved && approved.status}`);

    // 3. Worker A (processo separado) adquire o lease da TASK e entra em IMPLEMENTING.
    const killed = await runChildAndKill(taskId, 'task-worker-A', missionId);
    check('WORKER_A_HANDSHAKE', killed.handshake.state === 'READY', JSON.stringify(killed.handshake));
    const fenceA = killed.handshake.taskFence;
    detail.workerA = { pid: killed.pid, fence: fenceA };

    // 4. MORTE SÚBITA.
    check('SIGKILL_REAL', killed.signal === 'SIGKILL', `signal=${killed.signal}`);
    check('PROCESSO_A_MORTO', !isAlive(killed.pid), `pid=${killed.pid}`);

    const afterCrash = await taskService.getTask(taskId);
    check('TASK_EM_FASE_MATERIAL', afterCrash.status === 'CODING', `status=${afterCrash.status}`);
    const orphanLease = await taskService.getTaskLease(taskId);
    check('LEASE_DA_TASK_ORFAO', orphanLease && orphanLease.workerInstanceId === 'task-worker-A', `worker=${orphanLease && orphanLease.workerInstanceId} fence=${orphanLease && orphanLease.fence}`);

    // Aceleração de relógio DECLARADA: o TTL é o detector real; aqui o banco o antecipa.
    const Model = require(path.join(ROOT, 'api/db/models')).EngineeringTask();
    await Model.sequelize.query(`UPDATE engineering_tasks SET lease_expires_at = NOW() - interval '1 second' WHERE id = :id`, { replacements: { id: taskId } });

    // 5. Processo B: boot recovery SEM chamada manual de resume.
    //    `limit` alto de propósito: a fila do sweep é ordenada por updated_at e as missões de teste
    //    desta sessão poderiam empurrar esta para fora do limite padrão — o E2E precisa CONTROLAR a
    //    fila para poder afirmar algo sobre ESTA missão.
    const summary = await recovery.runBootRecovery({ autoStart: false, workerInstanceId: 'verify-rec-worker-b', limit: 400 });
    detail.sweep = { scanned: summary.scanned, recovered: summary.recovered, tasksScanned: summary.tasksScanned, taskItems: summary.taskItems, items: (summary.items || []).filter((i) => i.missionId === missionId) };

    // 6. O resultado PROIBIDO pela missão.
    const missionItems = (summary.items || []).filter((i) => i.missionId === missionId);
    const noTask = missionItems.some((i) => i.action === 'NO_TASK_TO_RESUME');
    check('NAO_RESPONDEU_NO_TASK_TO_RESUME', missionItems.length > 0 && !noTask,
      noTask ? 'NO_TASK_TO_RESUME — TEST INVALID (a missão proíbe este resultado)' : JSON.stringify(missionItems));

    // 7. A task REAL foi recuperada. As DUAS vias são legítimas e o E2E não deve exigir uma delas:
    //    (a) a missão com `linked_task_id` retoma pelo Router (caminho com contexto de fase);
    //    (b) o sweep de TASKS encontra a órfã e toma o lease.
    //    O invariante que importa é: a task foi retomada, o fence avançou e ela CONTINUA.
    const taskItems = (summary.taskItems || []).filter((i) => i.taskId === taskId);
    const takenBySweep = taskItems.some((i) => ['TASK_RESUMED', 'TASK_LEASE_TAKEN'].includes(i.action));
    const skippedBecauseMission = taskItems.some((i) => i.reason === 'ALREADY_RESUMED_BY_MISSION');
    const resumedByMission = missionItems.some((i) => i.action === 'TASK_RESUMED' && i.taskId === taskId);

    // TERCEIRA VIA LEGÍTIMA (defeito de harness corrigido em 2026-10-03): um RECUPERADOR
    // CONCORRENTE pode ter tomado o lease do worker morto entre a expiração forçada e esta
    // varredura — a API de dev está viva (o preflight do converge a exige) e roda o recovery
    // periódico a cada 5 min. Nesse caso o nosso sweep vê "outro worker VIVO" e recusa, o que é
    // CORRETO dele — mas a task FOI recuperada, sem comando humano, que é o que este E2E afirma.
    //
    // Não enfraquece nada: as asserções duras desta mesma verificação continuam valendo —
    // `FENCE_AVANCOU` (o fence saiu do 1), `LEASE_NAO_E_MAIS_DO_WORKER_MORTO`,
    // `ESCRITA_DO_WORKER_MORTO_RECUSADA` e `TASK_CONTINUA_APOS_RECOVERY`. E `NO_TASK_TO_RESUME`
    // segue PROIBIDO acima. O que muda é apenas NÃO exigir que o recuperador seja ESTE processo.
    const leaseAtCheck = await taskService.getTaskLease(taskId);
    const leaseMovedByConcurrentRecovery = Boolean(leaseAtCheck)
      && leaseAtCheck.workerInstanceId !== 'task-worker-A'
      && Number(leaseAtCheck.fence) > Number(fenceA);
    detail.concurrentRecovery = {
      leaseMoved: leaseMovedByConcurrentRecovery,
      worker: leaseAtCheck && leaseAtCheck.workerInstanceId,
      fence: leaseAtCheck && leaseAtCheck.fence,
    };

    check('TASK_RECUPERADA_POR_UMA_DAS_VIAS', takenBySweep || skippedBecauseMission || resumedByMission || leaseMovedByConcurrentRecovery,
      `sweep=${JSON.stringify(taskItems)} missionResumed=${resumedByMission} leaseMovidoPorRecuperadorConcorrente=${leaseMovedByConcurrentRecovery}`);
    check('TASK_VARRIDA_PELO_SWEEP_OU_COORDENADA', taskItems.length === 1 || resumedByMission || leaseMovedByConcurrentRecovery,
      taskItems.length === 1 ? JSON.stringify(taskItems) : `coordenada pela missão: ${resumedByMission} | lease movido por recuperador concorrente: ${leaseMovedByConcurrentRecovery}`);

    // 8. Fence avançou e o lease saiu do worker morto.
    //    Reusa a leitura feita no passo 7: uma segunda leitura poderia divergir da que fundamentou
    //    as asserções acima (o recuperador concorrente continua trabalhando) e o relatório passaria
    //    a afirmar coisas sobre um estado diferente do que foi verificado.
    const newLease = leaseAtCheck;
    check('FENCE_AVANCOU', Boolean(newLease) && newLease.fence > fenceA, `antes=${fenceA} depois=${newLease && newLease.fence}`);
    check('LEASE_NAO_E_MAIS_DO_WORKER_MORTO', !newLease || newLease.workerInstanceId !== 'task-worker-A', `worker=${newLease && newLease.workerInstanceId}`);

    // 9. O worker morto não escreve mais.
    let refused = null;
    try {
      await taskService.updateTaskGuarded(taskId, { status: 'TESTING' }, { leaseToken: orphanLease.token, fence: orphanLease.fence });
    } catch (error) {
      refused = error.code;
    }
    check('ESCRITA_DO_WORKER_MORTO_RECUSADA', ['TASK_STALE_WORKER_WRITE', 'TASK_LEASE_NOT_HELD', 'TASK_LEASE_EXPIRED'].includes(refused), `code=${refused}`);
    // 10. A task CONTINUA: o run retomado pelo novo dono executou TRABALHO MATERIAL?
    //
    // DEFEITO DO PRÓPRIO E2E corrigido (2026-09-28, medido): a versão anterior tentava tomar o lease
    // e avançar a task para TESTING depois da retomada. Isso é IMPOSSÍVEL por construção quando o run
    // retomado TERMINA — estado terminal libera o lease, então `newLease.token` é null e a checagem
    // falhava mesmo com a retomada correta (medido: `status=null`). Um teste que reprova o sucesso
    // não mede nada.
    //
    // A evidência agora é o TRABALHO FEITO PELO NOVO DONO: tentativa com `attempt_number >= 2`
    // (a #1 pertenceu ao worker morto). Isso falha alto quando a retomada morre antes de executar
    // (ex.: NO_QUALIFIED_CODER) — não é enfraquecimento, é medição do que a missão pede: "o Router
    // CONTINUA execução", não "o lease ficou livre".
    const taskAfterRecovery = await taskService.getTask(taskId);
    const attemptsAfterRecovery = await taskService.listAttempts(taskId);
    const attemptsByNewOwner = attemptsAfterRecovery.filter((attempt) => {
      const number = Number(attempt.attempt_number ?? attempt.attemptNumber ?? 0);
      return number >= 2;
    });
    const lastErrorCode = (taskAfterRecovery && taskAfterRecovery.last_error && taskAfterRecovery.last_error.code)
      || (taskAfterRecovery && taskAfterRecovery.lastError && taskAfterRecovery.lastError.code)
      || '';
    check(
      'TASK_CONTINUA_APOS_RECOVERY',
      attemptsByNewOwner.length > 0,
      `status=${taskAfterRecovery && taskAfterRecovery.status} tentativas_do_novo_dono=${attemptsByNewOwner.length} (total=${attemptsAfterRecovery.length}) desfecho=${lastErrorCode}`,
    );

    await Model.update({ status: 'CANCELLED', lease_token: null, lease_expires_at: null }, { where: { id: taskId } });
  } catch (error) {
    check('EXECUCAO_SEM_EXCECAO', false, `${error.code || ''} ${error.message}`.trim());
  } finally {
    try { await sequelizeModule.close(); } catch (error) { /* ignore */ }
  }

  const failed = checks.filter((c) => c.status === 'FAIL');
  const report = {
    report: 'REAL_ENGINEERING_TASK_RECOVERY_RUNTIME_EVIDENCE',
    startedAt,
    finishedAt: new Date().toISOString(),
    host: os.hostname(),
    pid: process.pid,
    missionId,
    taskId,
    detail,
    status: failed.length === 0 ? 'GO' : 'NO_GO',
    checks,
    failures: failed,
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  if (!process.argv.includes('--json')) {
    for (const c of checks) process.stdout.write(`  [${c.status}] ${c.id} — ${c.detail}\n`);
    process.stdout.write(`[real-task-recovery] status=${report.status} checks=${checks.length} falhas=${failed.length}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  process.exit(report.status === 'GO' ? 0 : 1);
}

main();
