'use strict';

/**
 * Dispatcher da outbox de LRO — em PostgreSQL REAL (banco descartável).
 *
 * Prova a matriz adversarial #2 do mandato: "worker morre entre transação e publicação" não perde
 * estado nem evento; e publicação com falha volta para a fila com backoff, virando DLQ no limite.
 */

const { provisionSuiteDatabase } = require('../helpers/suiteDatabase');

let banco = null;
let sequelize = null;
let lro = null;
let dispatcher = null;
let disponivel = false;
let motivo = null;

function skipIfUnavailable() {
  if (disponivel) return false;
  return require('../helpers/infraGate').skipOrFail({
    suite: 'lro-outbox', available: false, reason: motivo, requirement: 'postgres',
  });
}

beforeAll(async () => {
  try {
    banco = await provisionSuiteDatabase('lro-outbox');
    if (!banco) { motivo = 'provisionamento indisponível'; return; }
    const { connect, getSequelize } = require('../../api/db/sequelize');
    await connect(2, 500);
    sequelize = getSequelize();
    lro = require('../../api/services/lro/lroService');
    dispatcher = require('../../api/services/lro/lroOutboxDispatcher');
    disponivel = Boolean(sequelize && lro && dispatcher);
    if (!disponivel) motivo = 'serviços não inicializaram';
  } catch (error) {
    motivo = error.message;
  }
}, 300000);

afterAll(async () => {
  if (sequelize) await sequelize.close().catch(() => {});
  if (banco) await banco.cleanup().catch(() => {});
}, 120000);

async function operacaoComEventos() {
  const op = await lro.createOperation({
    tenantId: 'system', operationType: 'qa_waves', visibilityClass: 'DEVELOPMENT', ownerActorId: 'jest',
  });
  await lro.transition(op.id, { to: 'QUEUED', actorId: 'jest' });
  return op;
}

describe('LRO outbox — publicação, backoff e DLQ', () => {
  test('publica as pendências e marca PUBLISHED', async () => {
    if (skipIfUnavailable()) return;
    const op = await operacaoComEventos();
    const recebidos = [];
    const r = await dispatcher.dispatch({
      publish: async (topico, payload) => { recebidos.push({ topico, payload }); },
      limit: 50,
    });
    expect(r.publicados).toBeGreaterThanOrEqual(2); // CREATED + QUEUED
    expect(r.mortos).toBe(0);
    expect(recebidos.every((x) => x.topico === 'lro.events')).toBe(true);
    expect(recebidos.some((x) => x.payload.operationId === op.id)).toBe(true);

    const models = require('../../api/db/models');
    const pendentes = await models.getLroOutbox().count({ where: { operation_id: op.id, status: 'PENDING' } });
    expect(pendentes).toBe(0);
  }, 60000);

  test('falha de publicação REAGENDA com backoff (a linha não é perdida)', async () => {
    if (skipIfUnavailable()) return;
    const op = await operacaoComEventos();
    const models = require('../../api/db/models');

    const r = await dispatcher.dispatch({
      publish: async () => { throw new Error('transporte fora'); },
      limit: 100,
    });
    expect(r.reagendados).toBeGreaterThan(0);

    const linhas = await models.getLroOutbox().findAll({ where: { operation_id: op.id } });
    expect(linhas.length).toBeGreaterThan(0);
    for (const linha of linhas) {
      expect(linha.status).toBe('PENDING');
      expect(Number(linha.attempts)).toBeGreaterThan(0);
      expect(new Date(linha.available_at).getTime()).toBeGreaterThan(Date.now() - 1000);
      expect(linha.last_error).toContain('transporte fora');
    }
  }, 60000);

  test('no limite de tentativas a linha vira DEAD (DLQ) e não é mais publicada', async () => {
    if (skipIfUnavailable()) return;
    const op = await operacaoComEventos();
    const models = require('../../api/db/models');

    // Uma linha só, já com attempts no limite: a próxima falha deve matá-la.
    const alvo = await models.getLroOutbox().findOne({ where: { operation_id: op.id }, order: [['id', 'ASC']] });
    await alvo.update({ attempts: 5, available_at: new Date(Date.now() - 1000) });
    await models.getLroOutbox().update({ available_at: new Date(Date.now() + 600000) }, { where: { operation_id: op.id, id: { [require('sequelize').Op.ne]: alvo.id } } });

    const r = await dispatcher.dispatch({
      publish: async () => { throw new Error('falha definitiva'); },
      limit: 10,
      maxAttempts: 6,
    });
    expect(r.mortos).toBe(1);

    await alvo.reload();
    expect(alvo.status).toBe('DEAD');

    // DEAD não é reclamada de novo.
    const r2 = await dispatcher.dispatch({ publish: async () => {}, limit: 10 });
    expect(r2.publicados).toBe(0);
  }, 60000);

  test('claimBatch não entrega a mesma linha duas vezes (SKIP LOCKED)', async () => {
    if (skipIfUnavailable()) return;
    const op = await operacaoComEventos();
    const loteA = await dispatcher.claimBatch({ limit: 5 });
    const idsA = new Set(loteA.map((l) => l.id));
    expect(idsA.size).toBeGreaterThan(0);

    const loteB = await dispatcher.claimBatch({ limit: 5 });
    for (const linha of loteB) {
      expect(idsA.has(linha.id)).toBe(false);
    }

    const models = require('../../api/db/models');
    const pendentes = await models.getLroOutbox().count({ where: { operation_id: op.id, status: 'PENDING' } });
    expect(pendentes).toBe(0); // todas reclamadas (PUBLISHING), nenhuma duplicada
  }, 60000);
});

/**
 * P1-D (prompt duro 2026-10-31): dois buracos no despacho da outbox.
 *
 * 1. O filtro de `topic` era aplicado DEPOIS do claim: a linha já estava `PUBLISHING` com
 *    `attempts` incrementado quando era descartada do lote — presa para sempre e nunca entregue.
 * 2. Não havia recuperação de claim EXPIRADO: processo morto entre claim e publicação deixava a
 *    linha em `PUBLISHING` indefinidamente (nem entregue, nem na DLQ).
 */
describe('P1-D — filtro de tópico no claim e recuperação de claim expirado', () => {
  test('dispatch com topic NÃO toca linhas de outro tópico (nem attempts)', async () => {
    if (skipIfUnavailable()) return;
    const alvo = await lro.createOperation({
      tenantId: 'system', operationType: 'qa_waves', visibilityClass: 'DEVELOPMENT',
      ownerActorId: 'jest', idempotencyKey: `p1d-alvo-${Date.now()}`,
    });
    const outro = await lro.createOperation({
      tenantId: 'system', operationType: 'qa_waves', visibilityClass: 'DEVELOPMENT',
      ownerActorId: 'jest', idempotencyKey: `p1d-outro-${Date.now()}`,
    });
    const models = require('../../api/db/models');
    const outbox = models.getLroOutbox();
    await outbox.update({ status: 'PENDING' }, { where: { operation_id: alvo.id } });
    await outbox.update({ status: 'PENDING', topic: 'outro.topico' }, { where: { operation_id: outro.id } });

    const publicados = [];
    const r = await dispatcher.dispatch({
      publish: async (topico) => { publicados.push(topico); },
      limit: 50,
      topic: 'lro.events',
    });

    expect(r.publicados).toBeGreaterThan(0);
    const linhasOutro = await outbox.findAll({ where: { operation_id: outro.id } });
    for (const l of linhasOutro) {
      expect(l.status).toBe('PENDING');   // não foi reclamada
      expect(Number(l.attempts)).toBe(0); // attempts não foi inflado
      expect(l.claimed_at).toBeNull();
    }
  });

  test('claim expirado em PUBLISHING volta para PENDING e é publicável depois', async () => {
    if (skipIfUnavailable()) return;
    const op = await lro.createOperation({
      tenantId: 'system', operationType: 'qa_waves', visibilityClass: 'DEVELOPMENT',
      ownerActorId: 'jest', idempotencyKey: `p1d-stale-${Date.now()}`,
    });
    const models = require('../../api/db/models');
    const outbox = models.getLroOutbox();
    // Simula processo morto entre claim e publicação.
    await outbox.update(
      { status: 'PUBLISHING', claimed_at: new Date(Date.now() - 10 * 60_000), attempts: 1 },
      { where: { operation_id: op.id } },
    );

    const recuperacao = await dispatcher.reclaimStale({ olderThanMs: 60_000 });
    expect(recuperacao.recuperadas).toBeGreaterThan(0);

    const linhas = await outbox.findAll({ where: { operation_id: op.id } });
    expect(linhas.every((l) => l.status === 'PENDING' && l.claimed_at === null)).toBe(true);

    const r = await dispatcher.dispatch({ publish: async () => {}, limit: 50 });
    expect(r.publicados).toBeGreaterThan(0);
    const depois = await outbox.findAll({ where: { operation_id: op.id } });
    expect(depois.every((l) => l.status === 'PUBLISHED')).toBe(true);
  });

  test('claim RECENTE não é recuperado (não rouba publicação em voo)', async () => {
    if (skipIfUnavailable()) return;
    const op = await lro.createOperation({
      tenantId: 'system', operationType: 'qa_waves', visibilityClass: 'DEVELOPMENT',
      ownerActorId: 'jest', idempotencyKey: `p1d-voo-${Date.now()}`,
    });
    const models = require('../../api/db/models');
    const outbox = models.getLroOutbox();
    await outbox.update({ status: 'PUBLISHING', claimed_at: new Date() }, { where: { operation_id: op.id } });

    await dispatcher.reclaimStale({ olderThanMs: 60_000 });
    const linhas = await outbox.findAll({ where: { operation_id: op.id } });
    expect(linhas.every((l) => l.status === 'PUBLISHING')).toBe(true);
  });
});
