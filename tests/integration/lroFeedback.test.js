'use strict';

/**
 * Fase 2/4 — feedback humano de operações longas, em PostgreSQL REAL (banco descartável).
 *
 * Cobre a matriz adversarial #4 do mandato: resposta duplicada, tardia, sem permissão, de outro
 * tenant e com versão obsoleta — todas recusadas SEM efeito. E o caso base: só resposta explícita
 * move a operação; silêncio/prazo vencido NUNCA aprova.
 */

const { provisionSuiteDatabase } = require('../helpers/suiteDatabase');

let banco = null;
let sequelize = null;
let lro = null;
let feedback = null;
let disponivel = false;
let motivo = null;

function skipIfUnavailable() {
  if (disponivel) return false;
  return require('../helpers/infraGate').skipOrFail({
    suite: 'lro-feedback', available: false, reason: motivo, requirement: 'postgres',
  });
}

beforeAll(async () => {
  try {
    banco = await provisionSuiteDatabase('lro-feedback');
    if (!banco) { motivo = 'provisionamento indisponível'; return; }
    const { connect, getSequelize } = require('../../api/db/sequelize');
    await connect(2, 500);
    sequelize = getSequelize();
    lro = require('../../api/services/lro/lroService');
    feedback = require('../../api/services/lro/lroFeedbackService');
    disponivel = Boolean(sequelize && lro && feedback);
    if (!disponivel) motivo = 'serviços não inicializaram';
  } catch (error) {
    motivo = error.message;
  }
}, 300000);

afterAll(async () => {
  if (sequelize) await sequelize.close().catch(() => {});
  if (banco) await banco.cleanup().catch(() => {});
}, 120000);

async function operacaoRodando(tenantId = 'system') {
  const op = await lro.createOperation({
    tenantId, operationType: 'qa_waves', visibilityClass: 'DEVELOPMENT', ownerActorId: 'jest',
  });
  await lro.transition(op.id, { to: 'QUEUED', actorId: 'jest' });
  await lro.transition(op.id, { to: 'RUNNING', actorId: 'jest' });
  return op;
}

describe('LRO feedback humano', () => {
  test('pedido move a operação para WAITING_FEEDBACK e grava a versão do momento', async () => {
    if (skipIfUnavailable()) return;
    const op = await operacaoRodando();
    const { requestId, operation } = await feedback.requestFeedback(op.id, {
      tenantId: 'system', requestedBy: 'jest', assigneeActorId: 'supervisor-1', actorId: 'jest',
      options: [{ id: 'aprovar' }, { id: 'rejeitar' }],
    });
    expect(requestId).toBeTruthy();
    expect(operation.status).toBe('WAITING_FEEDBACK');
    expect(operation.feedback_request_id).toBe(requestId);
  }, 60000);

  test('#4 resposta de OUTRO tenant é "não encontrada" e não tem efeito', async () => {
    if (skipIfUnavailable()) return;
    const op = await operacaoRodando();
    const { requestId } = await feedback.requestFeedback(op.id, {
      tenantId: 'system', assigneeActorId: 'supervisor-1', actorId: 'jest',
    });

    await expect(feedback.respond(requestId, {
      tenantId: 'tenant-alheio', actorId: 'supervisor-1', decision: 'approve', idempotencyKey: 'k1',
    })).rejects.toMatchObject({ code: 'FEEDBACK_NAO_ENCONTRADO' });

    const depois = await lro.getOperation(op.id);
    expect(depois.status).toBe('WAITING_FEEDBACK');
  }, 60000);

  test('#4 ator sem autorização é recusado sem efeito', async () => {
    if (skipIfUnavailable()) return;
    const op = await operacaoRodando();
    const { requestId } = await feedback.requestFeedback(op.id, {
      tenantId: 'system', assigneeActorId: 'supervisor-1', actorId: 'jest',
    });

    await expect(feedback.respond(requestId, {
      tenantId: 'system', actorId: 'intruso', decision: 'approve', idempotencyKey: 'k2',
    })).rejects.toMatchObject({ code: 'FEEDBACK_NAO_AUTORIZADO' });

    expect((await lro.getOperation(op.id)).status).toBe('WAITING_FEEDBACK');
  }, 60000);

  test('#4 resposta tardia NÃO aprova: pedido vira EXPIRED e a operação não avança', async () => {
    if (skipIfUnavailable()) return;
    const op = await operacaoRodando();
    const { requestId } = await feedback.requestFeedback(op.id, {
      tenantId: 'system', assigneeActorId: 'supervisor-1', actorId: 'jest',
      deadlineAt: new Date(Date.now() + 50),
    });
    await new Promise((resolve) => setTimeout(resolve, 120));

    await expect(feedback.respond(requestId, {
      tenantId: 'system', actorId: 'supervisor-1', decision: 'approve', idempotencyKey: 'k3',
    })).rejects.toMatchObject({ code: 'FEEDBACK_EXPIRADO' });

    const models = require('../../api/db/models');
    const pedido = await models.getLroFeedbackRequest().findByPk(requestId);
    expect(pedido.status).toBe('EXPIRED');
    expect((await lro.getOperation(op.id)).status).toBe('WAITING_FEEDBACK');
  }, 60000);

  test('#4 versão obsoleta é recusada (operação andou depois do pedido)', async () => {
    if (skipIfUnavailable()) return;
    const op = await operacaoRodando();
    const { requestId } = await feedback.requestFeedback(op.id, {
      tenantId: 'system', assigneeActorId: 'supervisor-1', actorId: 'jest',
    });

    // Progresso muda a versão da operação sem mudar de estado.
    await lro.recordProgress(op.id, { current: 1, total: 5, unit: 'scenario', actorId: 'jest' });

    await expect(feedback.respond(requestId, {
      tenantId: 'system', actorId: 'supervisor-1', decision: 'approve', idempotencyKey: 'k4',
    })).rejects.toMatchObject({ code: 'FEEDBACK_VERSAO_OBSOLETA' });
  }, 60000);

  test('resposta válida move a operação de volta para RUNNING e encerra o pedido', async () => {
    if (skipIfUnavailable()) return;
    const op = await operacaoRodando();
    const { requestId } = await feedback.requestFeedback(op.id, {
      tenantId: 'system', assigneeActorId: 'supervisor-1', actorId: 'jest',
    });

    const r = await feedback.respond(requestId, {
      tenantId: 'system', actorId: 'supervisor-1', decision: 'approve', idempotencyKey: 'k5',
    });
    expect(r.replayed).toBe(false);
    expect(r.operation.status).toBe('RUNNING');

    const models = require('../../api/db/models');
    expect((await models.getLroFeedbackRequest().findByPk(requestId)).status).toBe('ANSWERED');
  }, 60000);

  test('#4 reenvio com a MESMA idempotency key não duplica efeito', async () => {
    if (skipIfUnavailable()) return;
    const op = await operacaoRodando();
    const { requestId } = await feedback.requestFeedback(op.id, {
      tenantId: 'system', assigneeActorId: 'supervisor-1', actorId: 'jest',
    });

    const primeira = await feedback.respond(requestId, {
      tenantId: 'system', actorId: 'supervisor-1', decision: 'approve', idempotencyKey: 'mesma-chave',
    });
    const segunda = await feedback.respond(requestId, {
      tenantId: 'system', actorId: 'supervisor-1', decision: 'approve', idempotencyKey: 'mesma-chave',
    });

    expect(segunda.replayed).toBe(true);
    expect(segunda.response.id).toBe(primeira.response.id);

    const models = require('../../api/db/models');
    const total = await models.getLroFeedbackResponse().count({ where: { request_id: requestId } });
    expect(total).toBe(1);
  }, 60000);

  test('segunda resposta com OUTRA chave é recusada (pedido já respondido)', async () => {
    if (skipIfUnavailable()) return;
    const op = await operacaoRodando();
    const { requestId } = await feedback.requestFeedback(op.id, {
      tenantId: 'system', assigneeActorId: 'supervisor-1', actorId: 'jest',
    });
    await feedback.respond(requestId, {
      tenantId: 'system', actorId: 'supervisor-1', decision: 'reject', idempotencyKey: 'a',
    });

    await expect(feedback.respond(requestId, {
      tenantId: 'system', actorId: 'supervisor-1', decision: 'approve', idempotencyKey: 'b',
    })).rejects.toMatchObject({ code: 'FEEDBACK_JA_RESPONDIDO' });
  }, 60000);

  test('defer mantém WAITING_FEEDBACK (não é aprovação nem libera a operação)', async () => {
    if (skipIfUnavailable()) return;
    const op = await operacaoRodando();
    const { requestId } = await feedback.requestFeedback(op.id, {
      tenantId: 'system', assigneeActorId: 'supervisor-1', actorId: 'jest',
    });

    const r = await feedback.respond(requestId, {
      tenantId: 'system', actorId: 'supervisor-1', decision: 'defer', idempotencyKey: 'd1',
    });
    expect(r.operation).toBeNull();
    expect((await lro.getOperation(op.id)).status).toBe('WAITING_FEEDBACK');
  }, 60000);
});
