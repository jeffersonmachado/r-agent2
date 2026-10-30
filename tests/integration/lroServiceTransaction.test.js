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
