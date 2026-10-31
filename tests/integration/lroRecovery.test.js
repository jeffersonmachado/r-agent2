'use strict';

/**
 * Recuperação de operações órfãs de LRO — PostgreSQL real (banco descartável).
 *
 * Prova a matriz adversarial #6 do mandato: worker morre / heartbeat perdido / timeout ⇒ resultado
 * DETERMINÍSTICO. E que `SLOW != STUCK != DEAD`: só o vencimento do LEASE autoriza agir; operação
 * sem lease ou com lease válido nunca é tocada, e terminal nunca é reaberta.
 */

const { provisionSuiteDatabase } = require('../helpers/suiteDatabase');

let banco = null;
let sequelize = null;
let lro = null;
let recovery = null;
let disponivel = false;
let motivo = null;

function skipIfUnavailable() {
  if (disponivel) return false;
  return require('../helpers/infraGate').skipOrFail({
    suite: 'lro-recovery', available: false, reason: motivo, requirement: 'postgres',
  });
}

beforeAll(async () => {
  try {
    banco = await provisionSuiteDatabase('lro-recovery');
    if (!banco) { motivo = 'provisionamento indisponível'; return; }
    const { connect, getSequelize } = require('../../api/db/sequelize');
    await connect(2, 500);
    sequelize = getSequelize();
    lro = require('../../api/services/lro/lroService');
    recovery = require('../../api/services/lro/lroRecoveryService');
    disponivel = Boolean(sequelize && lro && recovery);
    if (!disponivel) motivo = 'serviços não inicializaram';
  } catch (error) {
    motivo = error.message;
  }
}, 300000);

afterAll(async () => {
  if (sequelize) await sequelize.close().catch(() => {});
  if (banco) await banco.cleanup().catch(() => {});
}, 120000);

async function rodandoComLease(ttlMs) {
  const op = await lro.createOperation({
    tenantId: 'system', operationType: 'qa_waves', visibilityClass: 'DEVELOPMENT', ownerActorId: 'jest',
  });
  await lro.transition(op.id, { to: 'QUEUED', actorId: 'jest' });
  await lro.transition(op.id, { to: 'RUNNING', actorId: 'jest' });
  const lease = await lro.claimLease(op.id, { owner: 'worker-a', ttlMs });
  return { op, lease };
}

describe('LRO recuperação de órfãs', () => {
  test('lease VÁLIDO não é órfã; lease vencido é', async () => {
    if (skipIfUnavailable()) return;
    const { op: vivo } = await rodandoComLease(60000);
    const { op: morto } = await rodandoComLease(50);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const orfas = await recovery.findOrphans({ limit: 100 });
    const ids = orfas.map((o) => o.id);
    expect(ids).toContain(morto.id);
    expect(ids).not.toContain(vivo.id);
  }, 60000);

  test('recuperar órfã: pausa, libera lease, AVANÇA fencing e registra motivo em evento', async () => {
    if (skipIfUnavailable()) return;
    const { op, lease } = await rodandoComLease(50);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const recuperada = await recovery.recoverOperation(op.id, { reason: 'worker desapareceu' });
    expect(recuperada.status).toBe('PAUSED');
    expect(recuperada.leaseOwner).toBeNull();
    expect(recuperada.fencingToken).toBeGreaterThan(lease.fencingToken);

    const eventos = await lro.listEvents(op.id, { afterSeq: 0 });
    const recuperacao = eventos.find((e) => e.type === 'ORPHAN_RECOVERED');
    expect(recuperacao).toBeTruthy();
    expect(recuperacao.payload).toMatchObject({ reason: 'worker desapareceu', previousLeaseOwner: 'worker-a' });
  }, 60000);

  test('worker antigo NÃO escreve depois da recuperação (fencing vencido)', async () => {
    if (skipIfUnavailable()) return;
    const { op, lease } = await rodandoComLease(50);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await recovery.recoverOperation(op.id, { reason: 'lease vencido' });

    await expect(lro.heartbeat(op.id, { owner: 'worker-a', fencingToken: lease.fencingToken }))
      .rejects.toMatchObject({ code: 'FENCE_STALE' });
  }, 60000);

  test('segunda recuperação da MESMA operação é recusada (não é mais órfã)', async () => {
    if (skipIfUnavailable()) return;
    const { op } = await rodandoComLease(50);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await recovery.recoverOperation(op.id, { reason: 'primeira' });

    await expect(recovery.recoverOperation(op.id, { reason: 'segunda' }))
      .rejects.toMatchObject({ code: 'OPERACAO_NAO_ORFA' });
  }, 60000);

  test('operações SEM lease e TERMINAIS nunca são tocadas', async () => {
    if (skipIfUnavailable()) return;
    const semLease = await lro.createOperation({
      tenantId: 'system', operationType: 'qa_waves', visibilityClass: 'DEVELOPMENT', ownerActorId: 'jest',
    });
    await lro.transition(semLease.id, { to: 'QUEUED', actorId: 'jest' });

    const { op: terminada } = await rodandoComLease(50);
    await lro.transition(terminada.id, {
      to: 'COMPLETED', actorId: 'jest', context: { outcome: 'NO_GO' }, fencingToken: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 120));

    const orfas = await recovery.findOrphans({ limit: 100 });
    const ids = orfas.map((o) => o.id);
    expect(ids).not.toContain(semLease.id);
    expect(ids).not.toContain(terminada.id);
  }, 60000);

  test('recoverOrphans reconcilia todas e devolve resumo; motivo é obrigatório', async () => {
    if (skipIfUnavailable()) return;
    const a = await rodandoComLease(50);
    const b = await rodandoComLease(50);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const resumo = await recovery.recoverOrphans({ limit: 100 });
    const ids = resumo.recuperadas.map((r) => r.id);
    expect(ids).toContain(a.op.id);
    expect(ids).toContain(b.op.id);
    expect(resumo.falhas).toEqual([]);

    await expect(recovery.recoverOperation(a.op.id, {})).rejects.toMatchObject({ code: 'MOTIVO_OBRIGATORIO' });
  }, 60000);
});
