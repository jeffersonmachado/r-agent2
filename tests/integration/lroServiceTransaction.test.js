'use strict';

/**
 * Fase 2 do LRO — camada transacional (`api/services/lro/lroService.js`) em PostgreSQL REAL.
 *
 * Cobre a matriz adversarial do mandato:
 *   #2 worker morre entre transação e publicação → estado e evento/outbox são ATÔMICOS;
 *   #3 dois workers disputam lease e o token antigo não pode gravar;
 *   (+ ) concorrência otimista por `version` e sequência de eventos monotônica para o cursor do SSE.
 *
 * Isolamento: banco próprio da suíte, criado e destruído aqui.
 */

const crypto = require('crypto');
const { provisionSuiteDatabase } = require('../helpers/suiteDatabase');

let banco = null;
let sequelize = null;
let disponivel = false;
let motivo = null;
let lro = null;

function skipIfUnavailable() {
  if (disponivel) return false;
  return require('../helpers/infraGate').skipOrFail({
    suite: 'lro-service', available: false, reason: motivo, requirement: 'postgres',
  });
}

beforeAll(async () => {
  try {
    banco = await provisionSuiteDatabase('lro-service');
    if (!banco) { motivo = 'provisionamento indisponível'; return; }
    const { connect, getSequelize } = require('../../api/db/sequelize');
    await connect(2, 500);
    sequelize = getSequelize();
    lro = require('../../api/services/lro/lroService');
    disponivel = Boolean(sequelize && lro);
    if (!disponivel) motivo = 'sequelize/lroService não inicializou';
  } catch (error) {
    motivo = error.message;
  }
}, 300000);

afterAll(async () => {
  if (sequelize) await sequelize.close().catch(() => {});
  if (banco) await banco.cleanup().catch(() => {});
}, 120000);

async function novaOperacao(extra = {}) {
  return lro.createOperation({
    tenantId: 'system',
    operationType: 'qa_waves',
    visibilityClass: 'DEVELOPMENT',
    ownerActorId: 'jest',
    ...extra,
  });
}

describe('LRO Fase 2 — transação, lease e fencing', () => {
  test('criar operação grava estado + evento + outbox no MESMO commit', async () => {
    if (skipIfUnavailable()) return;
    const op = await novaOperacao();
    expect(op.status).toBe('CREATED');

    const eventos = await lro.listEvents(op.id, { afterSeq: 0 });
    expect(eventos.map((e) => e.type)).toEqual(['CREATED']);
    expect(eventos[0].seq).toBe(1);

    const models = require('../../api/db/models');
    const pendentes = await models.getLroOutbox().count({ where: { operation_id: op.id } });
    expect(pendentes).toBe(1);
  }, 60000);

  test('#3 dois workers disputam o lease: um vence, o outro recebe LEASE_HELD', async () => {
    if (skipIfUnavailable()) return;
    const op = await novaOperacao();
    await lro.transition(op.id, { to: 'QUEUED', actorId: 'jest' });

    const a = await lro.claimLease(op.id, { owner: 'worker-a', ttlMs: 60000 });
    expect(a.fencingToken).toBe(1);

    await expect(lro.claimLease(op.id, { owner: 'worker-b', ttlMs: 60000 }))
      .rejects.toMatchObject({ code: 'LEASE_HELD' });
  }, 60000);

  test('#3 o token de fencing antigo NÃO pode gravar (heartbeat e transição)', async () => {
    if (skipIfUnavailable()) return;
    const op = await novaOperacao();
    await lro.transition(op.id, { to: 'QUEUED', actorId: 'jest' });
    const primeiro = await lro.claimLease(op.id, { owner: 'worker-a', ttlMs: 300 });

    // Espera o lease do worker A VENCER de verdade (nada de atalho): só então B pode tomar posse.
    await new Promise((resolve) => setTimeout(resolve, 450));
    await lro.claimLease(op.id, { owner: 'worker-b', ttlMs: 60000 });
    const { fencingToken } = await lro.getOperation(op.id);
    expect(fencingToken).toBeGreaterThan(primeiro.fencingToken);

    await expect(lro.heartbeat(op.id, { owner: 'worker-a', fencingToken: primeiro.fencingToken }))
      .rejects.toMatchObject({ code: 'FENCE_STALE' });

    await expect(lro.transition(op.id, {
      to: 'RUNNING', actorId: 'worker-a', fencingToken: primeiro.fencingToken,
    })).rejects.toMatchObject({ code: 'FENCE_STALE' });
  }, 60000);

  test('concorrência otimista: versão errada é recusada, versão certa passa', async () => {
    if (skipIfUnavailable()) return;
    const op = await novaOperacao();
    const v0 = op.version;

    await lro.transition(op.id, { to: 'QUEUED', actorId: 'jest', expectedVersion: v0 });

    await expect(lro.transition(op.id, { to: 'RUNNING', actorId: 'jest', expectedVersion: v0 }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    const atual = await lro.getOperation(op.id);
    await expect(lro.transition(op.id, { to: 'RUNNING', actorId: 'jest', expectedVersion: atual.version }))
      .resolves.toMatchObject({ status: 'RUNNING' });
  }, 60000);

  test('sequência de eventos é monotônica e serve de cursor (afterSeq)', async () => {
    if (skipIfUnavailable()) return;
    const op = await novaOperacao();
    await lro.transition(op.id, { to: 'QUEUED', actorId: 'jest' });
    await lro.transition(op.id, { to: 'RUNNING', actorId: 'jest' });
    await lro.transition(op.id, { to: 'COMPLETED', actorId: 'jest', context: { outcome: 'NO_GO' } });

    const todos = await lro.listEvents(op.id, { afterSeq: 0 });
    expect(todos.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    const apenasNovos = await lro.listEvents(op.id, { afterSeq: 2 });
    expect(apenasNovos.map((e) => e.seq)).toEqual([3, 4]);
  }, 60000);

  test('COMPLETED com NO_GO não vira sucesso e o desfecho fica registrado', async () => {
    if (skipIfUnavailable()) return;
    const op = await novaOperacao();
    await lro.transition(op.id, { to: 'QUEUED', actorId: 'jest' });
    await lro.transition(op.id, { to: 'RUNNING', actorId: 'jest' });
    const concluida = await lro.transition(op.id, {
      to: 'COMPLETED', actorId: 'jest', context: { outcome: 'NO_GO' },
    });
    expect(concluida.status).toBe('COMPLETED');
    expect(concluida.outcome).toBe('NO_GO');

    // terminal imutável: nova transição é recusada sem reconciliação
    await expect(lro.transition(op.id, { to: 'RUNNING', actorId: 'jest' }))
      .rejects.toMatchObject({ code: 'TERMINAL_IMUTAVEL' });
  }, 60000);

  test('idempotência: mesma chave no mesmo tenant devolve a MESMA operação', async () => {
    if (skipIfUnavailable()) return;
    const chave = `qa-waves-${crypto.randomBytes(4).toString('hex')}`;
    const a = await novaOperacao({ idempotencyKey: chave });
    const b = await novaOperacao({ idempotencyKey: chave });
    expect(b.id).toBe(a.id);
  }, 60000);

  test('atomicidade: falha ao gravar evento NÃO deixa o status alterado', async () => {
    if (skipIfUnavailable()) return;
    const op = await novaOperacao();
    const models = require('../../api/db/models');

    // Força a falha no INSERT do evento: o serviço deve reverter a transação inteira.
    const originalCreate = models.getLroEvent().create;
    models.getLroEvent().create = async () => { throw new Error('falha injetada no evento'); };
    try {
      await expect(lro.transition(op.id, { to: 'QUEUED', actorId: 'jest' })).rejects.toThrow();
    } finally {
      models.getLroEvent().create = originalCreate;
    }

    const depois = await lro.getOperation(op.id);
    expect(depois.status).toBe('CREATED');
    expect(depois.version).toBe(op.version);
  }, 60000);
});

describe('LRO Fase 2 — progresso real (sem mudar de estado)', () => {
  test('recordProgress grava progresso, emite evento PROGRESS e mantém o status', async () => {
    if (skipIfUnavailable()) return;
    const op = await novaOperacao();
    await lro.transition(op.id, { to: 'QUEUED', actorId: 'jest' });
    await lro.transition(op.id, { to: 'RUNNING', actorId: 'jest' });

    const comProgresso = await lro.recordProgress(op.id, {
      current: 3, total: 10, unit: 'scenario', phase: 'execution', actorId: 'jest', origin: 'human',
    });
    expect(comProgresso.status).toBe('RUNNING');
    expect(comProgresso.progressCurrent).toBe(3);
    expect(comProgresso.progressTotal).toBe(10);

    const eventos = await lro.listEvents(op.id, { afterSeq: 0 });
    expect(eventos.map((e) => e.type)).toEqual(['CREATED', 'QUEUED', 'RUNNING', 'PROGRESS']);
    expect(eventos[3].payload).toMatchObject({ current: 3, total: 10, percent: 30, indeterminate: false });
  }, 60000);

  test('progresso com total desconhecido é INDETERMINADO e nunca vira 100%', async () => {
    if (skipIfUnavailable()) return;
    const op = await novaOperacao();
    const r = await lro.recordProgress(op.id, { current: 7, total: null, unit: 'scenario', origin: 'human', actorId: 'jest' });
    expect(r.progressTotal).toBeNull();
    expect(r.indeterminate).toBe(true);

    const eventos = await lro.listEvents(op.id, { afterSeq: 0 });
    const progresso = eventos.find((e) => e.type === 'PROGRESS');
    expect(progresso.payload).toMatchObject({ percent: null, indeterminate: true });
  }, 60000);
});

/**
 * P1-E (prompt duro 2026-10-31): fencing era OPCIONAL — `recordProgress` só comparava quando o
 * token vinha; `null`/`undefined` pulava a checagem (bypass genérico) e `heartbeat` com token
 * ausente comparava `NaN < fence` (sempre false) e renovava o lease de qualquer um. Comando de
 * worker sem fencing tem de ser RECUSADO, e comando humano autorizado tem de ser distinguível.
 */
describe('P1-E — fencing obrigatório para worker, humano explícito', () => {
  const preparar = async () => {
    const op = await novaOperacao({ idempotencyKey: `p1e-${Date.now()}-${Math.random()}` });
    await lro.transition(op.id, { to: 'QUEUED', actorId: 'jest', context: {} });
    await lro.transition(op.id, { to: 'RUNNING', actorId: 'jest', context: {} });
    const lease = await lro.claimLease(op.id, { owner: 'worker-fence', ttlMs: 60000 });
    return { op, lease };
  };

  test('recordProgress de WORKER sem fencingToken é recusado', async () => {
    if (skipIfUnavailable()) return;
    const { op } = await preparar();
    await expect(lro.recordProgress(op.id, { current: 1, total: 2, unit: 'scenario' }))
      .rejects.toMatchObject({ code: 'FENCE_OBRIGATORIO' });
  });

  test('recordProgress com fencing OBSOLETO é recusado', async () => {
    if (skipIfUnavailable()) return;
    const { op, lease } = await preparar();
    // Mesmo dono retoma o lease: o fence AVANÇA e o token anterior deixa de valer. (Outro dono
    // receberia LEASE_HELD — lease ainda não venceu, e isso é o comportamento correto.)
    await lro.claimLease(op.id, { owner: 'worker-fence', ttlMs: 60000 });
    await expect(lro.recordProgress(op.id, { current: 1, total: 2, fencingToken: lease.fencingToken }))
      .rejects.toMatchObject({ code: 'FENCE_STALE' });
  });

  test('recordProgress com fencing válido é aceito', async () => {
    if (skipIfUnavailable()) return;
    const { op, lease } = await preparar();
    const r = await lro.recordProgress(op.id, { current: 1, total: 2, fencingToken: lease.fencingToken });
    expect(r.progressCurrent).toBe(1);
  });

  test('comando HUMANO explícito (origin=human) exige ator e dispensa fencing', async () => {
    if (skipIfUnavailable()) return;
    const { op } = await preparar();
    await expect(lro.recordProgress(op.id, { current: 1, total: 2, origin: 'human' }))
      .rejects.toMatchObject({ code: 'ATOR_OBRIGATORIO' });
    const r = await lro.recordProgress(op.id, { current: 1, total: 2, origin: 'human', actorId: 'humano@results' });
    expect(r.progressCurrent).toBe(1);
  });

  test('heartbeat sem fencingToken é recusado (NaN não pode passar na comparação)', async () => {
    if (skipIfUnavailable()) return;
    const { op } = await preparar();
    await expect(lro.heartbeat(op.id, { owner: 'worker-fence' }))
      .rejects.toMatchObject({ code: 'FENCE_OBRIGATORIO' });
  });

  test('heartbeat com fencing obsoleto é recusado', async () => {
    if (skipIfUnavailable()) return;
    const { op, lease } = await preparar();
    await lro.claimLease(op.id, { owner: 'worker-fence', ttlMs: 60000 }); // fence avança
    await expect(lro.heartbeat(op.id, { owner: 'worker-fence', fencingToken: lease.fencingToken }))
      .rejects.toMatchObject({ code: 'FENCE_STALE' });
  });

  test('heartbeat com fencing válido renova o lease', async () => {
    if (skipIfUnavailable()) return;
    const { op, lease } = await preparar();
    const r = await lro.heartbeat(op.id, { owner: 'worker-fence', fencingToken: lease.fencingToken });
    expect(r.fencingToken).toBe(lease.fencingToken);
  });
});
