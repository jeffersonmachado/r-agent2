#!/usr/bin/env node
'use strict';

/**
 * verify-timeout-architecture-e2e.js — EVIDÊNCIA DE RUNTIME do gate de timeouts.
 *
 * Prova, contra o BANCO REAL, as invariantes que o gate exige para
 * `TIMEOUT_ARCHITECTURE = GREEN`:
 *
 *   LONG_RUNNING_TASK        — task saudável e progressiva sobrevive além dos
 *                              thresholds que ANTES concediam takeover, e idade
 *                              por si só NÃO transfere posse (TIMEOUT-04/05/06).
 *   REAL_DEAD_WORKER_RECOVERY— worker que perde liveness é recuperado (lease
 *                              expira → novo dono com fence+1) e o worker antigo
 *                              NÃO consegue escrever (TIMEOUT-07/08).
 *   NO_PROGRESS_E2E          — worker VIVO sem avanço é diagnosticado como
 *                              NO_PROGRESS (não lease expirado, não kill)
 *                              (TIMEOUT-10/11).
 *   PROVIDER_FALLBACK_E2E    — provider primário falha e o fallback conclui
 *                              (TIMEOUT-02), sem reiniciar worker.
 *
 * Escreve `reports/timeout-architecture-evidence.json` (fonte do gate). Cada
 * cenário tem status PASS/FAIL explícito e as checagens individuais com detalhe.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'reports', 'timeout-architecture-evidence.json');

const store = require(path.join(ROOT, 'api/services/engineeringMission/missionStoreService'));
const progress = require(path.join(ROOT, 'engine/engineeringMission/progressPolicy'));
const db = require(path.join(ROOT, 'api/db'));

const results = {};
function scenario(name, checks) {
  const failed = checks.filter((c) => !c.ok);
  results[name] = {
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    checks,
    failed: failed.map((c) => c.id),
  };
  console.log(`[timeout-e2e] ${failed.length === 0 ? 'PASS' : 'FAIL'} ${name}`);
  for (const c of checks) console.log(`   ${c.ok ? '✓' : '✗'} ${c.id} — ${c.detail}`);
}
function check(id, ok, detail) {
  return { id, ok: Boolean(ok), detail: String(detail === undefined ? '' : detail) };
}

async function withMission(fn) {
  const created = await store.createMission({
    title: `timeout-arch-e2e ${Date.now()}`,
    missionType: 'FEATURE',
    risk: 'LOW',
    originalMission: 'Evidencia de runtime do gate de arquitetura de timeouts.',
    createdBy: 'timeout-architecture-e2e',
    idempotencyKey: `timeout-arch-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const id = created?.id || created?.mission?.id;
  if (!id) throw new Error('createMission não devolveu id');
  return fn(id);
}

/** Envelhece colunas no banco para simular passagem de tempo SEM esperar. */
async function ageMission(id, { lockedAtAgoMs = null, leaseExpiresAgoMs = null, progressAgoMs = null } = {}) {
  const { sequelize } = require(path.join(ROOT, 'api/db/models')).EngineeringMission();
  const sets = [];
  if (lockedAtAgoMs !== null) sets.push(`locked_at = NOW() - ${Math.round(lockedAtAgoMs / 1000)} * INTERVAL '1 second'`);
  if (leaseExpiresAgoMs !== null) sets.push(`lease_expires_at = NOW() - ${Math.round(leaseExpiresAgoMs / 1000)} * INTERVAL '1 second'`);
  if (progressAgoMs !== null) sets.push(`last_progress_at = NOW() - ${Math.round(progressAgoMs / 1000)} * INTERVAL '1 second'`);
  if (sets.length === 0) return;
  await sequelize.query(`UPDATE engineering_missions SET ${sets.join(', ')} WHERE id = :id`, {
    replacements: { id },
  });
}

async function runLongRunningTask() {
  await withMission(async (id) => {
    const leaseA = await store.acquireMissionLease(id, { workerInstanceId: 'worker-A', workerType: 'COMPILER', ttlMs: 60000 });
    const checks = [];

    // Renova a posse AO VIVO várias vezes (heartbeat real, em tempo real).
    let renewals = 0;
    for (let i = 0; i < 3; i += 1) {
      await new Promise((r) => setTimeout(r, 700));
      // eslint-disable-next-line no-await-in-loop
      const r = await store.renewMissionLease(id, { leaseToken: leaseA.lease.token, ttlMs: 60000 });
      if (r) renewals += 1;
    }
    checks.push(check('HEARTBEAT_RENOVA_LEASE', renewals === 3, `renovações efetivas=${renewals}/3`));

    // "Thresholds antigos": envelhece locked_at MUITO além do LOCK_STALE_MS e
    // também o started_at. Antes, idade concedia takeover.
    await ageMission(id, { lockedAtAgoMs: (store.LOCK_STALE_MS || 900000) * 10, progressAgoMs: 5000 });

    // Progresso significativo recente (a task está AVANÇANDO).
    const prog = await store.recordMissionProgress(id, { signal: 'test_result', detail: 'regressão parcial verde' });
    checks.push(check('PROGRESSO_REGISTRADO', prog.accepted === true, `accepted=${prog.accepted} (${prog.reason})`));

    // Leitura de expiração por lease NÃO inclui a missão (heartbeat fresco).
    const expired = await store.findMissionsWithExpiredLease({ limit: 200 });
    const inExpired = (expired || []).some((m) => (m.id || m.missionId) === id);
    checks.push(check('NAO_LISTADA_COMO_EXPIRADA', !inExpired, `findMissionsWithExpiredLease contém a missão=${inExpired}`));

    // Takeover tentado: o lease ATIVO manda — idade não transfere posse.
    let takeoverBlocked = false;
    let blockedCode = null;
    try {
      await store.lockMission(id, 'worker-B');
    } catch (err) {
      blockedCode = err && err.code;
      takeoverBlocked = err && err.code === 'MISSION_LOCKED_BY_OTHER_WORKER';
    }
    checks.push(check('IDADE_NAO_CONCEDE_TAKEOVER', takeoverBlocked, `código=${blockedCode}`));

    const leaseAfter = await store.getMissionLease(id);
    checks.push(check('POSSE_MANTIDA_PELO_DONO', leaseAfter && leaseAfter.workerInstanceId === 'worker-A',
      `dono=${leaseAfter && leaseAfter.workerInstanceId} fence=${leaseAfter && leaseAfter.fence}`));

    scenario('LONG_RUNNING_TASK', checks);
  });
}

async function runDeadWorkerRecovery() {
  await withMission(async (id) => {
    const leaseA = await store.acquireMissionLease(id, { workerInstanceId: 'worker-doomed', workerType: 'COMPILER', ttlMs: 60000 });
    const checks = [];

    // Liveness perdida: o dono parou de renovar e a validade venceu.
    await ageMission(id, { leaseExpiresAgoMs: 5000 });
    const leaseB = await store.acquireMissionLease(id, { workerInstanceId: 'worker-recovery', workerType: 'RECOVERY', ttlMs: 60000 });
    checks.push(check('TAKEOVER_APOS_EXPIRACAO', Boolean(leaseB && leaseB.lease && leaseB.lease.token), `novo dono=${leaseB && leaseB.lease && leaseB.lease.workerInstanceId}`));
    checks.push(check('FENCE_MONOTONICO', Number(leaseB.lease.fence) === Number(leaseA.lease.fence) + 1,
      `fence A=${leaseA.lease.fence} → B=${leaseB.lease.fence}`));

    // Worker antigo tenta escrever com o token/fence antigos.
    let refused = null;
    try {
      await store.updateMissionGuarded(id, { status: 'ENRICHING' }, { leaseToken: leaseA.lease.token, fence: leaseA.lease.fence });
    } catch (err) {
      refused = err && err.code;
    }
    checks.push(check('ESCRITA_DO_WORKER_MORTO_RECUSADA',
      ['MISSION_STALE_WORKER_WRITE', 'MISSION_LEASE_NOT_HELD', 'MISSION_LEASE_EXPIRED'].includes(refused), `código=${refused}`));

    // O novo dono escreve normalmente.
    let wrote = false;
    let writeCode = null;
    try {
      await store.updateMissionGuarded(id, { status: 'ENRICHING' }, { leaseToken: leaseB.lease.token, fence: leaseB.lease.fence });
      wrote = true;
    } catch (err) {
      writeCode = err && err.code;
    }
    checks.push(check('NOVO_DONO_ESCREVE', wrote, `código=${writeCode}`));

    scenario('REAL_DEAD_WORKER_RECOVERY', checks);
  });
}

async function runNoProgress() {
  await withMission(async (id) => {
    const lease = await store.acquireMissionLease(id, { workerInstanceId: 'worker-stuck', workerType: 'ORCHESTRATOR', ttlMs: 120000 });
    const checks = [];

    const ok = await store.recordMissionProgress(id, { signal: 'command_output_relevant', detail: 'suite de regressão iniciada' });
    checks.push(check('PROGRESSO_ACEITO', ok.accepted === true, `accepted=${ok.accepted}`));

    const livenessOnly = await store.recordMissionProgress(id, { signal: 'heartbeat' });
    checks.push(check('HEARTBEAT_NAO_E_PROGRESSO', livenessOnly.accepted === false, `accepted=${livenessOnly.accepted} (${livenessOnly.reason})`));

    // Renova o lease para PROVAR que o worker está VIVO...
    await store.renewMissionLease(id, { leaseToken: lease.lease.token, ttlMs: 120000 });
    // ...e envelhece SOMENTE o progresso, além do limiar da fase TESTING (30min).
    await ageMission(id, { progressAgoMs: 31 * 60 * 1000 });

    const evaluated = await store.evaluateMissionProgress(id, { phase: 'TESTING' });
    checks.push(check('DIAGNOSTICADO_COMO_NO_PROGRESS',
      evaluated && evaluated.state === progress.PROGRESS_STATES.NO_PROGRESS,
      `state=${evaluated && evaluated.state} silentForMs=${evaluated && evaluated.silentForMs}`));
    checks.push(check('LIVENESS_FRESCA_CONFIRMADA',
      evaluated && evaluated.livenessFresh === true,
      `heartbeat fresco=${evaluated && evaluated.livenessFresh} (vivo, apesar de travado)`));
    checks.push(check('NAO_E_LEASE_EXPIRED',
      evaluated && evaluated.state !== 'LEASE_EXPIRED' && evaluated.actions.includes('wait'),
      `ações=${evaluated && evaluated.actions && evaluated.actions.join(',')}`));
    checks.push(check('NO_PROGRESS_NAO_MATA',
      evaluated && !evaluated.actions.some((a) => /kill|fail_mission|takeover/i.test(a)),
      'nenhuma ação de kill/takeover na lista'));
    checks.push(check('LIMIAR_POR_FASE_APLICADO',
      evaluated && evaluated.thresholdMs === progress.DEFAULT_PHASE_THRESHOLDS_MS.TESTING,
      `thresholdMs=${evaluated && evaluated.thresholdMs}`));

    scenario('NO_PROGRESS_E2E', checks);
  });
}

function runProviderFallback() {
  const checks = [];
  let out = '';
  let ok = false;
  try {
    out = execFileSync('npx', ['jest', 'tests/integration/engineeringRouterModelRerouteE2E.test.js', '--silent'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 600000,
      env: { ...process.env },
    });
    ok = true;
  } catch (err) {
    out = `${err.stdout || ''}${err.stderr || ''}`;
    ok = false;
  }
  const summary = (out.match(/Tests:.*/) || ['sem sumário'])[0];
  checks.push(check('FALLBACK_E2E_SUITE', ok, `suíte de reroute/fallback de provider: ${summary}`));
  scenario('PROVIDER_FALLBACK_E2E', checks);
}

(async () => {
  const startedAt = Date.now();
  // Os cenários usam o STORE real contra o Postgres: sem conexão explícita o
  // Sequelize não está inicializado (scripts standalone não passam pelo boot da API).
  await db.connect();
  try {
    await runLongRunningTask();
  } catch (err) {
    scenario('LONG_RUNNING_TASK', [check('CENARIO_EXECUTOU', false, `erro: ${err.message}`)]);
  }
  try {
    await runDeadWorkerRecovery();
  } catch (err) {
    scenario('REAL_DEAD_WORKER_RECOVERY', [check('CENARIO_EXECUTOU', false, `erro: ${err.message}`)]);
  }
  try {
    await runNoProgress();
  } catch (err) {
    scenario('NO_PROGRESS_E2E', [check('CENARIO_EXECUTOU', false, `erro: ${err.message}`)]);
  }
  try {
    runProviderFallback();
  } catch (err) {
    scenario('PROVIDER_FALLBACK_E2E', [check('CENARIO_EXECUTOU', false, `erro: ${err.message}`)]);
  }

  // Contrato consumido por `validate-timeout-architecture.js`.
  const evidence = {
    artifactType: 'TIMEOUT_ARCHITECTURE_EVIDENCE',
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    LONG_RUNNING_TASK: results.LONG_RUNNING_TASK?.status || 'FAIL',
    REAL_DEAD_WORKER_RECOVERY: results.REAL_DEAD_WORKER_RECOVERY?.status || 'FAIL',
    NO_PROGRESS_E2E: results.NO_PROGRESS_E2E?.status || 'FAIL',
    PROVIDER_FALLBACK_E2E: results.PROVIDER_FALLBACK_E2E?.status || 'FAIL',
    scenarios: results,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`);

  const failed = Object.entries(results).filter(([, v]) => v.status !== 'PASS').map(([k]) => k);
  console.log(`[timeout-e2e] evidência: ${path.relative(ROOT, OUT)}`);
  console.log(`[timeout-e2e] resultado: ${failed.length === 0 ? 'TODOS OS CENÁRIOS PASS' : `FALHOU: ${failed.join(', ')}`}`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[timeout-e2e] falha fatal:', err && err.message);
  process.exit(1);
});
