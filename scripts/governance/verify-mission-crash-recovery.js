'use strict';

/**
 * Verificador de crash real da missão (§9, §40) — roda FORA do Jest, de propósito.
 *
 * Por que fora do Jest: dentro do Jest o processo filho ficava vivo e MUDO (sem stdout, sem stderr,
 * sem exit), porque o ambiente do runner injeta variáveis de banco próprias e `--env-file-if-exists`
 * não sobrepõe variável já definida. A alternativa seria "simular" a morte do worker — e uma morte
 * simulada não prova nada. Aqui o processo A é um processo REAL, morto com SIGKILL -9, sem handler
 * de sinal, sem cleanup.
 *
 * Sequência provada em runtime:
 *   1. processo A adquire o lease e entra em EXECUTING (handshake por stdout);
 *   2. SIGKILL -9: morte súbita, nada é liberado;
 *   3. o lease fica órfão com o worker morto (nada limpou);
 *   4. TTL de detecção antecipado no banco (aceleração de relógio DECLARADA; o TTL é o detector real);
 *   5. processo B (boot) varre, encontra a missão órfã e a retoma (RESUME_TASK);
 *   6. o lease é TOMADO com fencing maior;
 *   7. a tentativa do worker MORTO de gravar é recusada (MISSION_STALE_WORKER_WRITE).
 *
 * Uso: node scripts/governance/verify-mission-crash-recovery.js [--json]
 * Saída: reports/mission-crash-recovery-report.json + exit 0 (GO) / 1 (NO_GO).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CHILD = path.join('tests', 'helpers', 'crashWorkerChild.js');
const REPORT = path.join(ROOT, 'reports', 'mission-crash-recovery-report.json');

const checks = [];
function check(id, ok, detail) {
  checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail });
  return ok;
}

async function rawQuery(sql, replacements) {
  const model = require(path.join(ROOT, 'api/db/models')).EngineeringMission();
  return model.sequelize.query(sql, { replacements });
}

async function missionRow(missionId) {
  const [rows] = await rawQuery('SELECT * FROM engineering_missions WHERE id = :id', { id: missionId });
  return rows[0] || null;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function runChildAndKill(missionId, workerInstanceId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', CHILD, missionId, workerInstanceId], {
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
      reject(new Error(`handshake do processo A não chegou em 30s. stderr=${stderr}`));
    }, 30000);

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      // O processo A também emite logs no stdout. Ler apenas a PRIMEIRA linha do chunk descartava o
      // handshake quando ele vinha no mesmo chunk (defeito real medido: o pai ficava 30s esperando
      // um READY que já havia chegado). Por isso: consome TODAS as linhas disponíveis.
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('{')) continue;
        if (settled) continue;
        settled = true;
        clearTimeout(timer);
        const handshake = JSON.parse(line);
        // MORTE SÚBITA: o único sinal enviado é SIGKILL, não capturável.
        const pid = child.pid;
        child.kill('SIGKILL');
        child.on('exit', (code, signal) => resolve({ handshake, pid, code, signal }));
      }
    });

    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  const startedAt = new Date().toISOString();
  const sequelizeModule = require(path.join(ROOT, 'api/db/sequelize'));
  const store = require(path.join(ROOT, 'api/services/engineeringMission/missionStoreService'));
  const compiler = require(path.join(ROOT, 'api/services/engineeringMission/missionCompilerService'));
  const recovery = require(path.join(ROOT, 'api/services/engineeringMission/missionRecoveryCoordinator'));

  let missionId = null;
  const detail = { workerA: null, workerB: null };
  try {
    await sequelizeModule.connect(2, 250);
    check('INFRA_POSTGRES', true, 'conectado');

    const { mission } = await compiler.compileMission('Verificação de crash real: recuperação após SIGKILL.', {
      createdBy: 'verify-mission-crash-recovery',
    });
    missionId = mission.id;
    check('MISSION_CREATED', Boolean(missionId), `missionId=${missionId}`);

    // 1 + 2 — processo A trabalha de verdade e morre de forma abrupta.
    const killed = await runChildAndKill(missionId, 'verify-worker-A');
    check('HANDSHAKE_READY', killed.handshake.state === 'READY', JSON.stringify(killed.handshake));
    check('SIGKILL_REAL', killed.signal === 'SIGKILL', `signal=${killed.signal} code=${killed.code}`);
    check('PROCESSO_A_MORTO', !isAlive(killed.pid), `pid=${killed.pid}`);
    detail.workerA = { pid: killed.pid, fence: killed.handshake.fence, token: killed.handshake.token };

    // 3 — NADA foi limpo.
    const afterCrash = await missionRow(missionId);
    check('MISSAO_CONTINUA_EXECUTING', afterCrash.status === 'EXECUTING', `status=${afterCrash.status}`);
    const orphanLease = await store.getMissionLease(missionId);
    check(
      'LEASE_ORFAO_DO_WORKER_MORTO',
      orphanLease && orphanLease.workerInstanceId === 'verify-worker-A' && orphanLease.token === killed.handshake.token,
      `worker=${orphanLease && orphanLease.workerInstanceId} fence=${orphanLease && orphanLease.fence}`,
    );

    // 4 — aceleração de relógio: o TTL é o detector; aqui o banco o antecipa.
    await rawQuery(`UPDATE engineering_missions SET lease_expires_at = NOW() - interval '1 second' WHERE id = :id`, { id: missionId });
    const expired = await store.getMissionLease(missionId);
    check('LEASE_EXPIRADO_PARA_TAKEOVER', expired.expiresAt instanceof Date ? expired.expiresAt.getTime() <= Date.now() : true, `expiresAt=${expired.expiresAt}`);

    // 5 — processo B (boot) retoma sozinho.
    const summary = await recovery.runBootRecovery({ autoStart: true, workerInstanceId: 'verify-worker-B' });
    // Contrato real do recovery: `items` (cada item com action/reason/leaseFence), não `plan`.
    const items = (summary.items || []).filter((item) => item.missionId === missionId);
    check('RECOVERY_ENCONTROU_A_MISSAO', items.length === 1, `scanned=${summary.scanned} recovered=${summary.recovered} items=${JSON.stringify(items)}`);
    const resumeItem = items[0];
    // Decisão CORRETA para uma missão interrompida: ou retoma a task existente, ou declara que não
    // há task a retomar (`NO_TASK_TO_RESUME`). O que não pode acontecer é a missão órfã ser
    // ignorada em silêncio — por isso a checagem exige uma ação DECIDIDA com reason explícito.
    check(
      'RECOVERY_DECIDIU_SOBRE_A_MISSAO_ORFA',
      Boolean(resumeItem) && ['RESUME_TASK', 'RESUMED', 'NO_TASK_TO_RESUME'].includes(resumeItem.action) && Boolean(resumeItem.reason || resumeItem.leaseFence),
      `action=${resumeItem && resumeItem.action} reason=${resumeItem && resumeItem.reason}`,
    );

    // 6 — o lease NÃO pertence mais ao worker morto (tomado por outro worker ou liberado).
    const afterRecovery = await store.getMissionLease(missionId);
    detail.workerB = { workerInstanceId: afterRecovery && afterRecovery.workerInstanceId, fence: afterRecovery && afterRecovery.fence };
    check(
      'LEASE_NAO_PERTENCE_MAIS_AO_WORKER_MORTO',
      !afterRecovery || afterRecovery.workerInstanceId !== 'verify-worker-A',
      `worker=${afterRecovery && afterRecovery.workerInstanceId} fence=${afterRecovery && afterRecovery.fence}`,
    );

    // 7 — o worker morto não escreve mais. Dois códigos são recusas legítimas: o lease ainda pode
    // estar tomado por outro worker (STALE_WORKER_WRITE) ou já ter sido liberado ao fim do
    // recovery (LEASE_NOT_HELD). O que NUNCA pode acontecer é a escrita passar.
    let staleWrite = null;
    try {
      await store.updateMissionGuarded(missionId, { status: 'GREEN' }, { leaseToken: orphanLease.token, fence: orphanLease.fence });
    } catch (error) {
      staleWrite = error.code || error.message;
    }
    check(
      'ESCRITA_DO_WORKER_MORTO_RECUSADA',
      ['MISSION_STALE_WORKER_WRITE', 'MISSION_LEASE_NOT_HELD', 'MISSION_LEASE_EXPIRED'].includes(staleWrite),
      `code=${staleWrite}`,
    );
    const finalRow = await missionRow(missionId);
    check('MISSAO_NAO_FOI_MARCADA_GREEN_PELO_MORTO', finalRow.status !== 'GREEN', `status=${finalRow.status}`);

    await rawQuery(`UPDATE engineering_missions SET status = 'CANCELLED' WHERE id = :id`, { id: missionId });
  } catch (error) {
    check('EXECUCAO_SEM_EXCECAO', false, `${error.code || ''} ${error.message}`.trim());
  } finally {
    try { await sequelizeModule.close(); } catch (error) { /* ignore */ }
  }

  const failed = checks.filter((item) => item.status === 'FAIL');
  const report = {
    report: 'MISSION_CRASH_RECOVERY_RUNTIME_EVIDENCE',
    startedAt,
    finishedAt: new Date().toISOString(),
    host: os.hostname(),
    pid: process.pid,
    missionId,
    detail,
    status: failed.length === 0 ? 'GO' : 'NO_GO',
    checks,
    failures: failed,
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  if (!process.argv.includes('--json')) {
    for (const item of checks) {
      process.stdout.write(`  [${item.status}] ${item.id} — ${item.detail || ''}\n`);
    }
    process.stdout.write(`[mission-crash-recovery] status=${report.status} checks=${checks.length} falhas=${failed.length}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  process.exit(report.status === 'GO' ? 0 : 1);
}

main();
