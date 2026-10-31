'use strict';

/**
 * Feedback humano de operações longas (mandato LRO §7).
 *
 * Regras que este módulo garante — todas provadas em teste adversarial:
 *  1. `WAITING_FEEDBACK` só existe com solicitação identificada (a transição exige o id);
 *  2. resposta é escopada por TENANT: pedido de outro tenant é "não encontrado" (não vaza existência);
 *  3. resposta obsoleta (versão da operação mudou) é recusada;
 *  4. resposta tardia (prazo vencido) NÃO aprova: pedido vira `EXPIRED` e a operação não avança;
 *  5. reenvio com a mesma `idempotency_key` devolve a resposta existente, sem duplicar efeito;
 *  6. ator sem autorização (não é o destinatário nem tem o papel exigido) é recusado.
 *
 * Silêncio nunca é aprovação: nada aqui avança a operação sem uma resposta explícita.
 */

const crypto = require('crypto');
const lroService = require('./lroService');

const CODIGOS = Object.freeze({
  FEEDBACK_NAO_ENCONTRADO: 'FEEDBACK_NAO_ENCONTRADO',
  FEEDBACK_JA_RESPONDIDO: 'FEEDBACK_JA_RESPONDIDO',
  FEEDBACK_ENCERRADO: 'FEEDBACK_ENCERRADO',
  FEEDBACK_EXPIRADO: 'FEEDBACK_EXPIRADO',
  FEEDBACK_VERSAO_OBSOLETA: 'FEEDBACK_VERSAO_OBSOLETA',
  FEEDBACK_NAO_AUTORIZADO: 'FEEDBACK_NAO_AUTORIZADO',
  FEEDBACK_IDEMPOTENCIA_OBRIGATORIA: 'FEEDBACK_IDEMPOTENCIA_OBRIGATORIA',
  FEEDBACK_DECISAO_INVALIDA: 'FEEDBACK_DECISAO_INVALIDA',
  FEEDBACK_OPERACAO_NAO_ESTA_RUNNING: 'FEEDBACK_OPERACAO_NAO_ESTA_RUNNING',
});

const DECISOES = Object.freeze(['approve', 'reject', 'choose', 'defer']);

function erro(code, message, extra = {}) {
  return Object.assign(new Error(message || code), { code, ...extra });
}

function modelos() {
  return require('../../db/models');
}

/**
 * Abre um pedido de decisão e move a operação para WAITING_FEEDBACK (mesma transação).
 */
async function requestFeedback(operationId, {
  tenantId,
  requestedBy = null,
  assigneeActorId = null,
  assigneeRole = null,
  options = null,
  responseSchema = null,
  deadlineAt = null,
  actorId = null,
} = {}) {
  if (!tenantId) throw erro('TENANT_OBRIGATORIO');
  const models = modelos();
  const { getLroOperation, getLroFeedbackRequest } = models;
  const sequenciais = getLroOperation().sequelize;

  return sequenciais.transaction(async (t) => {
    const op = await getLroOperation().findOne({
      where: { id: operationId, tenant_id: String(tenantId) },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!op) throw erro('OPERATION_NOT_FOUND', 'operação inexistente para o tenant');
    const atual = op.get({ plain: true });
    if (atual.status !== 'RUNNING') {
      throw erro(CODIGOS.FEEDBACK_OPERACAO_NAO_ESTA_RUNNING, `status atual ${atual.status}`);
    }

    const id = crypto.randomUUID();
    await getLroFeedbackRequest().create({
      id,
      operation_id: operationId,
      tenant_id: String(tenantId),
      requested_by: requestedBy || actorId,
      assignee_actor_id: assigneeActorId,
      assignee_role: assigneeRole,
      status: 'PENDING',
      options,
      response_schema: responseSchema,
      // Versão da operação NO MOMENTO do pedido: é contra ela que a resposta será validada.
      operation_version: Number(atual.version),
      deadline_at: deadlineAt,
    }, { transaction: t });

    const operacao = await lroService.transition(operationId, {
      to: 'WAITING_FEEDBACK',
      actorId: actorId || requestedBy || 'lro',
      context: { feedbackRequestId: id, phase: 'awaiting_feedback' },
      transaction: t,
    });

    // DEFEITO CORRIGIDO (2026-10-30): a versão era gravada ANTES da transição, então o próprio
    // ato de abrir o pedido já a deixava obsoleta ("pedido v2, operação v3") e nenhuma resposta
    // podia ser aceita. A versão de referência é a do estado que o humano vê: pós-transição.
    await getLroFeedbackRequest().update(
      { operation_version: Number(operacao.version) },
      { where: { id }, transaction: t },
    );

    return { requestId: id, operation: { ...operacao, operation_version: Number(operacao.version) } };
  });
}

/**
 * Responde um pedido. Só uma resposta explícita e válida move a operação de volta para RUNNING.
 */
async function respond(requestId, {
  tenantId,
  actorId,
  decision,
  optionId = null,
  payload = null,
  idempotencyKey,
  actorRoles = [],
  now = null,
} = {}) {
  if (!tenantId) throw erro('TENANT_OBRIGATORIO');
  if (!idempotencyKey) throw erro(CODIGOS.FEEDBACK_IDEMPOTENCIA_OBRIGATORIA);
  if (!DECISOES.includes(String(decision))) {
    throw erro(CODIGOS.FEEDBACK_DECISAO_INVALIDA, String(decision));
  }

  const models = modelos();
  const { getLroOperation, getLroFeedbackRequest, getLroFeedbackResponse } = models;
  const sequelize = getLroOperation().sequelize;
  const instante = now ? new Date(now) : new Date();

  // DEFEITO CORRIGIDO (2026-10-30): marcar EXPIRED e lançar DENTRO da transação principal fazia o
  // rollback desfazer a marcação. Abrir uma SEGUNDA transação segurando o lock da mesma linha
  // travava tudo (deadlock de si mesmo). O prazo é verificado ANTES do lock, em transação própria
  // que commita, e a recusa vem depois.
  const preLeitura = await getLroFeedbackRequest().findOne({
    where: { id: requestId, tenant_id: String(tenantId) },
  });
  if (preLeitura) {
    const pre = preLeitura.get({ plain: true });
    const vencido = pre.status === 'PENDING' && pre.deadline_at
      && instante.getTime() > new Date(pre.deadline_at).getTime();
    if (vencido) {
      await sequelize.transaction(async (tExpira) => {
        await getLroFeedbackRequest().update(
          { status: 'EXPIRED' },
          { where: { id: requestId, status: 'PENDING' }, transaction: tExpira },
        );
      });
      throw erro(CODIGOS.FEEDBACK_EXPIRADO);
    }
  }

  return sequelize.transaction(async (t) => {
    const pedido = await getLroFeedbackRequest().findOne({
      where: { id: requestId, tenant_id: String(tenantId) },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    // Pedido de outro tenant é indistinguível de inexistente.
    if (!pedido) throw erro(CODIGOS.FEEDBACK_NAO_ENCONTRADO);
    const req = pedido.get({ plain: true });

    // Reenvio idempotente: devolve o que já existe, sem repetir efeito.
    const existente = await getLroFeedbackResponse().findOne({
      where: { request_id: requestId, idempotency_key: String(idempotencyKey) },
      transaction: t,
    });
    if (existente) {
      return { response: existente.get({ plain: true }), replayed: true, operation: null };
    }
    if (req.status === 'ANSWERED') throw erro(CODIGOS.FEEDBACK_JA_RESPONDIDO);
    if (req.status === 'EXPIRED' || req.status === 'CANCELLED') throw erro(CODIGOS.FEEDBACK_ENCERRADO);

    // Prazo vencido NÃO aprova: encerra o pedido e a operação permanece como está.
    // DEFEITO CORRIGIDO (2026-10-30): marcar EXPIRED e lançar na MESMA transação fazia o rollback
    // desfazer a marcação (pedido voltava a PENDING). A expiração é registrada em transação
    // própria, que COMMITA, e só então a recusa é levantada.
    // Defensivo: se o prazo venceu entre a pré-checagem e o lock, recusa sem tocar no status
    // (quem marca EXPIRED é a pré-checagem ou `expireOverdue`, nunca no meio desta transação).
    if (req.deadline_at && instante.getTime() > new Date(req.deadline_at).getTime()) {
      throw erro(CODIGOS.FEEDBACK_EXPIRADO);
    }

    // Autorização: destinatário explícito OU papel exigido.
    const autorizado = (req.assignee_actor_id && String(req.assignee_actor_id) === String(actorId))
      || (req.assignee_role && Array.from(actorRoles || []).includes(String(req.assignee_role)));
    if (!autorizado) throw erro(CODIGOS.FEEDBACK_NAO_AUTORIZADO);

    const op = await getLroOperation().findByPk(req.operation_id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!op) throw erro('OPERATION_NOT_FOUND');
    const operacaoAtual = op.get({ plain: true });
    if (Number(operacaoAtual.version) !== Number(req.operation_version)) {
      throw erro(CODIGOS.FEEDBACK_VERSAO_OBSOLETA, `pedido v${req.operation_version}, operação v${operacaoAtual.version}`);
    }

    const respostaId = crypto.randomUUID();
    await getLroFeedbackResponse().create({
      id: respostaId,
      request_id: requestId,
      operation_id: req.operation_id,
      tenant_id: String(tenantId),
      actor_id: actorId || null,
      decision: String(decision),
      option_id: optionId,
      payload,
      operation_version: Number(req.operation_version),
      idempotency_key: String(idempotencyKey),
    }, { transaction: t });

    await pedido.update({ status: 'ANSWERED' }, { transaction: t });

    // Somente resposta explícita move a operação; `defer` mantém em WAITING_FEEDBACK.
    let operacao = null;
    if (String(decision) !== 'defer') {
      operacao = await lroService.transition(req.operation_id, {
        to: 'RUNNING',
        actorId: actorId || 'lro',
        context: { phase: 'after_feedback' },
        transaction: t,
      });
    }

    return {
      response: {
        id: respostaId, decision: String(decision), optionId, operationVersion: Number(req.operation_version),
      },
      replayed: false,
      operation: operacao,
    };
  });
}

/** Expira pedidos vencidos sem resposta. Devolve os ids afetados (silêncio nunca vira aprovação). */
async function expireOverdue({ tenantId = null, now = null, limit = 100 } = {}) {
  const models = modelos();
  const { getLroFeedbackRequest } = models;
  const sequelize = getLroFeedbackRequest().sequelize;
  const instante = now ? new Date(now) : new Date();
  const { Op } = require('sequelize');

  const where = { status: 'PENDING', deadline_at: { [Op.lt]: instante } };
  if (tenantId) where.tenant_id = String(tenantId);

  const vencidos = await getLroFeedbackRequest().findAll({ where, limit });
  const ids = [];
  for (const pedido of vencidos) {
    await sequelize.transaction(async (t) => {
      const atual = await getLroFeedbackRequest().findByPk(pedido.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!atual || atual.status !== 'PENDING') return;
      await atual.update({ status: 'EXPIRED' }, { transaction: t });
      ids.push(pedido.id);

      // BURACO MEDIDO (2026-10-31): marcar só o pedido deixava a OPERAÇÃO presa em
      // WAITING_FEEDBACK para sempre — o estado declarado TIMED_OUT não tinha caminho de runtime, e
      // um bloqueio obrigatório sem prazo é um bloqueio eterno. Prazo vencido NÃO aprova: termina em
      // TIMED_OUT, que é terminal e imutável. Só toca a operação que está esperando ESTE pedido.
      const op = await lroService.getOperation(atual.operation_id, {
        tenantId: atual.tenant_id,
      }).catch(() => null);
      if (!op || op.status !== 'WAITING_FEEDBACK' || op.feedbackRequestId !== atual.id) return;

      await lroService.transition(atual.operation_id, {
        to: 'TIMED_OUT',
        actorId: 'lro-feedback-sweep',
        context: {
          errorCode: CODIGOS.FEEDBACK_EXPIRADO,
          reason: `deadline_exceeded:${atual.deadline_at ? new Date(atual.deadline_at).toISOString() : 'sem_prazo'}`,
          phase: 'awaiting_feedback',
        },
        transaction: t,
      });
    });
  }
  return ids;
}

module.exports = { CODIGOS, DECISOES, requestFeedback, respond, expireOverdue };
