'use strict';

/**
 * Lease distribuído + fencing (§30–§32) — prova contra Postgres REAL.
 *
 * A autoridade de "worker vivo" era `process.kill(pid, 0)` sobre um PID embutido em `locked_by`.
 * Estes testes provam o modelo correto: identidade de INSTÂNCIA, validade temporal (takeover) e
 * fencing token monotônico que impede um worker antigo de sobrescrever a execução atual.
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO (ver tests/integration/README-anti-greenwashing.md e
 * `npm run test:release-authoritative`, onde o mesmo cenário é fail-closed).
 */

const sequelizeModule = require('../../api/db/sequelize');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const store = require('../../api/services/engineeringMission/missionStoreService');

let dbAvailable = false;
let dbReason = null;
const created = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  // Porta ÚNICA de infraestrutura (§11/§12): em RELEASE_AUTHORITATIVE=1 isto LANÇA INFRA_ERROR
  // (nunca PASS silencioso); em dev registra NOT_EXECUTED com motivo.
  return require('../helpers/infraGate').skipOrFail({ suite: 'mission-lease', available: dbAvailable, reason: dbReason, requirement: 'postgres' });
}

function models() {
  const index = require('../../api/db/models');
  return { Mission: index.EngineeringMission() };
}

async function newMission() {
  const { mission } = await compiler.compileMission('Missão para provar lease distribuído e fencing.', { createdBy: 'jest-lease' });
  created.push(mission.id);
  return mission;
}

async function expireLease(missionId) {
  await models().Mission.sequelize.query(
    `UPDATE engineering_missions SET lease_expires_at = NOW() - interval '1 second' WHERE id = :id`,
    { replacements: { id: missionId } },
  );
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
}, 20000);

afterAll(async () => {
  if (!dbAvailable) return;
  const { Mission } = models();
  try {
    for (const id of created) {
      for (const table of ['engineering_mission_reviews', 'engineering_mission_approvals', 'engineering_mission_versions']) {
        await Mission.sequelize.query(`DELETE FROM ${table} WHERE mission_id = :id`, { replacements: { id } });
      }
      await Mission.destroy({ where: { id } });
    }
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
}, 30000);

describe('Engineering Mission — lease distribuído (§30–§32)', () => {
  jest.setTimeout(60000);

  test('schema real: colunas, índices de lease e FKs de histórico com ON DELETE RESTRICT', async () => {
    if (skipIfNoDatabase()) return;
    const { Mission } = models();
    const q = (sql) => Mission.sequelize.query(sql, { type: Mission.sequelize.constructor.QueryTypes.SELECT });

    const columns = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='engineering_missions' AND column_name LIKE 'lease%'`);
    const names = columns.map((c) => c.column_name);
    for (const expected of ['lease_token', 'lease_fence', 'lease_expires_at', 'lease_heartbeat_at', 'lease_worker_instance_id', 'lease_worker_type', 'lease_host', 'lease_acquired_at']) {
      expect(names).toContain(expected);
    }

    const indexes = await q(`SELECT indexname FROM pg_indexes WHERE tablename='engineering_missions' AND indexname LIKE '%lease%'`);
    expect(indexes.map((i) => i.indexname)).toEqual(expect.arrayContaining(['engineering_missions_lease_expires_idx', 'engineering_missions_lease_worker_idx']));

    const fks = await q(`SELECT conname, confdeltype FROM pg_constraint WHERE contype='f' AND conname LIKE 'engineering_mission%fk'`);
    expect(fks).toHaveLength(3);
    // `confdeltype = 'r'` é ON DELETE RESTRICT: histórico de auditoria nunca é apagado em cascata.
    for (const fk of fks) expect(fk.confdeltype).toBe('r');
  }, 60000);

  test('dois workers NUNCA seguram o mesmo lease; segundo recebe motivo explícito', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newMission();
    const first = await store.acquireMissionLease(mission.id, { workerInstanceId: 'worker-A', workerType: 'COMPILER', ttlMs: 60000 });
    expect(first.acquired).toBe(true);
    expect(first.lease.fence).toBe(1);
    expect(first.lease.token).toBeTruthy();

    const second = await store.acquireMissionLease(mission.id, { workerInstanceId: 'worker-B', workerType: 'ORCHESTRATOR', ttlMs: 60000 });
    expect(second.acquired).toBe(false);
    expect(second.reason).toBe('MISSION_LEASE_HELD_BY_OTHER_WORKER');

    // O mesmo worker pode reentrar (renovação de identidade), sem roubar de outro.
    const again = await store.acquireMissionLease(mission.id, { workerInstanceId: 'worker-A', workerType: 'COMPILER', ttlMs: 60000 });
    expect(again.acquired).toBe(true);
    expect(again.lease.fence).toBe(2);
  }, 60000);

  test('heartbeat renova; perder o lease é falha explícita (MISSION_LEASE_LOST)', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newMission();
    const lease = await store.acquireMissionLease(mission.id, { workerInstanceId: 'worker-hb', workerType: 'COMPILER', ttlMs: 60000 });

    const renewed = await store.renewMissionLease(mission.id, { leaseToken: lease.lease.token, ttlMs: 120000 });
    expect(renewed.token).toBe(lease.lease.token);
    expect(new Date(renewed.expiresAt).getTime()).toBeGreaterThan(new Date(lease.lease.expiresAt).getTime());
    expect(renewed.heartbeatAt).toBeTruthy();

    await expireLease(mission.id);
    await expect(store.renewMissionLease(mission.id, { leaseToken: lease.lease.token, ttlMs: 60000 }))
      .rejects.toMatchObject({ code: 'MISSION_LEASE_LOST' });
  }, 60000);

  test('lease expirado é reassumido com fence NOVO, e o worker antigo não escreve mais (§32)', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newMission();
    const stale = await store.acquireMissionLease(mission.id, { workerInstanceId: 'worker-velho', workerType: 'COMPILER', ttlMs: 60000 });
    expect(stale.lease.fence).toBe(1);

    // Crash do worker antigo: o lease vence (sem esperar TTL real, para o teste ser determinístico).
    await expireLease(mission.id);

    const takeover = await store.acquireMissionLease(mission.id, { workerInstanceId: 'worker-novo', workerType: 'RECOVERY', ttlMs: 60000 });
    expect(takeover.acquired).toBe(true);
    expect(takeover.lease.fence).toBe(2);
    expect(takeover.lease.token).not.toBe(stale.lease.token);

    // O worker antigo volta tarde: escreve com o token/fence antigos e PRECISA ser recusado.
    await expect(store.updateMissionGuarded(mission.id, { status: 'ENRICHING' }, { leaseToken: stale.lease.token, fence: stale.lease.fence }))
      .rejects.toMatchObject({ code: 'MISSION_STALE_WORKER_WRITE' });

    // O dono vigente escreve normalmente.
    const written = await store.updateMissionGuarded(mission.id, { status: 'ENRICHING' }, { leaseToken: takeover.lease.token, fence: takeover.lease.fence });
    expect(written.status).toBe('ENRICHING');

    // Mesmo token com fence antigo (takeover no meio) também é recusado.
    await expect(store.updateMissionGuarded(mission.id, { status: 'EXECUTING' }, { leaseToken: takeover.lease.token, fence: 1 }))
      .rejects.toMatchObject({ code: 'MISSION_STALE_WORKER_WRITE' });
  }, 60000);

  test('recovery encontra trabalho abandonado APENAS em estado retomável (não em AWAITING_APPROVAL)', async () => {
    if (skipIfNoDatabase()) return;

    // Assunção descartada na auditoria: "missão com lease expirado" NÃO é sinônimo de "trabalho
    // abandonado". Uma missão em AWAITING_APPROVAL está esperando decisão HUMANA (ou política) —
    // recuperá-la automaticamente seria o sistema avançando por cima de uma decisão que não é dele.
    const awaiting = await newMission();
    const awaitingDetail = await compiler.getMissionDetail(awaiting.id);
    expect(['AWAITING_APPROVAL', 'APPROVED']).toContain(awaitingDetail.status);

    const leasedAwaiting = await store.acquireMissionLease(awaiting.id, { workerInstanceId: 'worker-aguardando', workerType: 'COMPILER', ttlMs: 60000 });
    expect(leasedAwaiting.acquired).toBe(true);
    await expireLease(awaiting.id);

    const expired = await store.findMissionsWithExpiredLease({ limit: 50 });
    expect(expired.map((m) => m.id)).not.toContain(awaiting.id);
    const resumableAfter = await store.findResumableMissions({ limit: 50 });
    expect(resumableAfter.map((m) => m.id)).not.toContain(awaiting.id);

    // Trabalho REAL abandonado: missão em execução cujo worker morreu (lease expirado).
    const executing = await newMission();
    const lease = await store.acquireMissionLease(executing.id, { workerInstanceId: 'worker-executando', workerType: 'ORCHESTRATOR', ttlMs: 60000 });
    await store.updateMissionGuarded(executing.id, { status: 'EXECUTING' }, { leaseToken: lease.lease.token, fence: lease.lease.fence });
    await expireLease(executing.id);

    const expired2 = await store.findMissionsWithExpiredLease({ limit: 50 });
    expect(expired2.map((m) => m.id)).toContain(executing.id);
    const reclaim = await store.acquireMissionLease(executing.id, { workerInstanceId: 'worker-recovery', workerType: 'RECOVERY', ttlMs: 60000 });
    expect(reclaim.acquired).toBe(true);
    expect(reclaim.lease.fence).toBeGreaterThan(lease.lease.fence);

    // Missões sem lease (crash antes de adquirir) são descobertas pelo complemento.
    const noLease = await store.findMissionsWithoutLease({ limit: 50 });
    expect(Array.isArray(noLease)).toBe(true);
    expect(noLease.every((m) => m.lease_token === null)).toBe(true);
    expect(noLease.every((m) => ['CREATED', 'ENRICHING', 'APPROVED', 'EXECUTING'].includes(m.status))).toBe(true);
  }, 60000);

  test('release libera o lease sem apagar o fence (fence nunca reaproveita valor)', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newMission();
    const lease = await store.acquireMissionLease(mission.id, { workerInstanceId: 'worker-rel', workerType: 'COMPILER', ttlMs: 60000 });
    const released = await store.releaseMissionLease(mission.id, { leaseToken: lease.lease.token });
    expect(released).toBe(true);

    const after = await store.getMissionLease(mission.id);
    expect(after.token).toBeNull();
    expect(after.fence).toBe(lease.lease.fence);

    const next = await store.acquireMissionLease(mission.id, { workerInstanceId: 'worker-outro', workerType: 'COMPILER', ttlMs: 60000 });
    expect(next.acquired).toBe(true);
    expect(next.lease.fence).toBeGreaterThan(lease.lease.fence);
  }, 60000);

  test('release com token errado não derruba o lease de outro worker', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newMission();
    const lease = await store.acquireMissionLease(mission.id, { workerInstanceId: 'worker-owner', workerType: 'COMPILER', ttlMs: 60000 });
    const released = await store.releaseMissionLease(mission.id, { leaseToken: 'token-de-outro-worker' });
    expect(released).toBe(false);
    const stillThere = await store.getMissionLease(mission.id);
    expect(stillThere.token).toBe(lease.lease.token);
  }, 60000);
});
