'use strict';

/**
 * Camada TRANSACIONAL de Long-Running Operations (Fase 2).
 *
 * Responsabilidade única: transformar intenção em estado DURÁVEL e auditável no PostgreSQL.
 * Regra de ouro do mandato (§10): transição de estado e evento/outbox no MESMO commit — nunca
 * "gravou e depois publicou" (é como se perde evidência quando o processo morre no meio).
 *
 * Toda decisão de legalidade vem de `lroStateMachine` (núcleo puro). Este arquivo só traduz para
 * SQL: lock de linha, versão otimista, fencing e sequência monotônica de eventos.
 */

const crypto = require('crypto');
const { STATES, evaluateTransition, normalizeProgress } = require('./lroStateMachine');

const TOPIC = 'lro.events';

function codigoErro(code, message, extra = {}) {
  return Object.assign(new Error(message || code), { code, ...extra });
}

function modelos() {
  // Resolvido em tempo de chamada: os models só existem depois de `connect()`.
  return require('../../db/models');
}

function agora() {
  return new Date();
}

/**
 * Cria a operação com estado inicial + evento + outbox no mesmo commit.
 * `idempotencyKey` (por tenant) devolve a operação existente em vez de duplicar.
 */
async function createOperation({
  tenantId,
  operationType,
  visibilityClass = 'DEVELOPMENT',
  ownerActorId = null,
  correlationId = null,
  idempotencyKey = null,
  retentionPolicy = null,
  phase = null,
  messageCode = null,
} = {}) {
  if (!tenantId) throw codigoErro('TENANT_OBRIGATORIO');
  if (!operationType) throw codigoErro('OPERATION_TYPE_OBRIGATORIO');

  const models = modelos();
  const { getLroOperation, getLroEvent, getLroOutbox } = models;
  const sequelize = getLroOperation().sequelize;

  if (idempotencyKey) {
    const existente = await getLroOperation().findOne({ where: { tenant_id: tenantId, idempotency_key: idempotencyKey } });
    if (existente) return existente.get({ plain: true });
  }

  const id = crypto.randomUUID();
  return sequelize.transaction(async (t) => {
    await getLroOperation().create({
      id,
      tenant_id: tenantId,
      owner_actor_id: ownerActorId,
      operation_type: operationType,
      visibility_class: visibilityClass,
      status: STATES.CREATED,
      phase,
      message_code: messageCode,
      version: 0,
      fencing_token: 0,
      progress_revision: 0,
      correlation_id: correlationId,
      idempotency_key: idempotencyKey,
      retention_policy: retentionPolicy,
    }, { transaction: t });

    const evento = await getLroEvent().create({
      operation_id: id,
      seq: 1,
      type: STATES.CREATED,
      payload: { operationType, visibilityClass },
      actor_id: ownerActorId,
    }, { transaction: t });

    await getLroOutbox().create({
      operation_id: id,
      event_id: evento.id,
      topic: TOPIC,
      payload: { operationId: id, seq: 1, type: STATES.CREATED },
      status: 'PENDING',
      available_at: agora(),
    }, { transaction: t });

    const criada = await getLroOperation().findByPk(id, { transaction: t });
    return criada.get({ plain: true });
  });
}

/** Leitura simples (sem lock) — usada por REST/SSE e por testes. */
async function getOperation(id, { tenantId = null } = {}) {
  const models = modelos();
  const where = { id };
  if (tenantId) where.tenant_id = String(tenantId);
  const op = await models.getLroOperation().findOne({ where });
  if (!op) throw codigoErro('OPERATION_NOT_FOUND', `operação inexistente: ${id}`);
  const plain = op.get({ plain: true });
  return {
    ...plain,
    fencingToken: plain.fencing_token,
    version: plain.version,
  };
}

/**
 * Transição legal de estado, com lock de linha, versão otimista e fencing.
 *
 * @returns {Promise<object>} operação atualizada (plain)
 * @throws {{code:string}} VERSION_CONFLICT, FENCE_STALE, ou o código do núcleo puro
 */
async function transition(operationId, {
  to, actorId = null, context = {}, expectedVersion = null, fencingToken = null,
} = {}) {
  const models = modelos();
  const { getLroOperation, getLroEvent, getLroOutbox } = models;
  const sequelize = getLroOperation().sequelize;

  return sequelize.transaction(async (t) => {
    const op = await getLroOperation().findByPk(operationId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!op) throw codigoErro('OPERATION_NOT_FOUND', `operação inexistente: ${operationId}`);

    const atual = op.get({ plain: true });

    if (expectedVersion !== null && expectedVersion !== undefined && Number(expectedVersion) !== Number(atual.version)) {
      throw codigoErro('VERSION_CONFLICT', `versão esperada ${expectedVersion}, atual ${atual.version}`);
    }

    // Fencing: quem apresenta token antigo não escreve, mesmo que o lease ainda pareça válido.
    if (fencingToken !== null && fencingToken !== undefined
        && Number(fencingToken) < Number(atual.fencing_token)) {
      throw codigoErro('FENCE_STALE', `fence ${fencingToken} < atual ${atual.fencing_token}`);
    }

    const decisao = evaluateTransition({
      from: atual.status,
      to,
      operation: atual,
      context,
      currentFence: atual.fencing_token,
      now: agora(),
    });
    if (!decisao.ok) throw codigoErro(decisao.code, decisao.detail || decisao.code);

    const patch = {
      ...decisao.patch,
      version: Number(atual.version) + 1,
    };
    if (decisao.patch.updated_at === null) delete patch.updated_at;
    if (decisao.patch.completed_at === null) delete patch.completed_at;
    if (decisao.patch.started_at === null) delete patch.started_at;
    if (decisao.reconciliation) patch.fencing_token = decisao.patch.fence;
    delete patch.fence;

    if (context.progress) {
      const progresso = normalizeProgress(context.progress);
      patch.progress_current = progresso.current;
      patch.progress_total = progresso.total;
      patch.progress_unit = progresso.unit;
      if (context.progress.revision !== undefined) patch.progress_revision = context.progress.revision;
    }
    if (context.phase) patch.phase = context.phase;
    if (context.messageCode) patch.message_code = context.messageCode;

    await op.update(patch, { transaction: t });

    // `sequelize.query` devolve [rows, metadata]: destruturar um nível raso fazia `proximo` ser
    // `undefined` -> `seq` NaN -> violação de NOT NULL. Medido 2026-10-30 na primeira execução.
    const [linhasSeq] = await sequelize.query(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS proximo FROM lro_events WHERE operation_id = :id',
      { replacements: { id: operationId }, transaction: t },
    );
    const proximo = linhasSeq && linhasSeq[0] ? linhasSeq[0].proximo : 1;

    const evento = await getLroEvent().create({
      operation_id: operationId,
      seq: Number(proximo),
      type: to,
      payload: {
        from: atual.status,
        to,
        outcome: patch.outcome || null,
        warnings: decisao.warnings,
        reconciliation: decisao.reconciliation ? (context.reconciliation || null) : null,
      },
      actor_id: actorId,
    }, { transaction: t });

    await getLroOutbox().create({
      operation_id: operationId,
      event_id: evento.id,
      topic: TOPIC,
      payload: { operationId, seq: Number(proximo), type: to },
      status: 'PENDING',
      available_at: agora(),
    }, { transaction: t });

    const depois = await getLroOperation().findByPk(operationId, { transaction: t });
    const plain = depois.get({ plain: true });
    return { ...plain, fencingToken: plain.fencing_token, warnings: decisao.warnings };
  });
}

/**
 * Toma o lease da operação, avançando o fencing.
 * `forceAfterExpiry` permite tomar lease de dono cujo prazo já venceu.
 */
async function claimLease(operationId, { owner, ttlMs = 60000 } = {}) {
  if (!owner) throw codigoErro('LEASE_OWNER_OBRIGATORIO');
  const models = modelos();
  const { getLroOperation } = models;
  const sequelize = getLroOperation().sequelize;

  return sequelize.transaction(async (t) => {
    const op = await getLroOperation().findByPk(operationId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!op) throw codigoErro('OPERATION_NOT_FOUND', `operação inexistente: ${operationId}`);

    const atual = op.get({ plain: true });
    const expirado = !atual.lease_expires_at || new Date(atual.lease_expires_at).getTime() <= Date.now();
    // Fail-closed: só há takeover quando o lease do dono atual REALMENTE venceu. Não existe
    // atalho "forçar agora" — quem precisa disso usa reconciliação, que é auditada.
    if (atual.lease_owner && atual.lease_owner !== owner && !expirado) {
      throw codigoErro('LEASE_HELD', `lease em poder de ${atual.lease_owner}`);
    }

    const fencing = Number(atual.fencing_token || 0) + 1;
    const expiraEm = new Date(Date.now() + Number(ttlMs));
    await op.update({
      lease_owner: owner,
      lease_expires_at: expiraEm,
      fencing_token: fencing,
      heartbeat_at: agora(),
      version: Number(atual.version) + 1,
    }, { transaction: t });

    return { fencingToken: fencing, leaseOwner: owner, leaseExpiresAt: expiraEm };
  });
}

/** Renova o lease; token antigo é recusado (quem perdeu a posse não pode seguir escrevendo). */
async function heartbeat(operationId, { owner, fencingToken, ttlMs = 60000 } = {}) {
  const models = modelos();
  const { getLroOperation } = models;
  const sequelize = getLroOperation().sequelize;

  return sequelize.transaction(async (t) => {
    const op = await getLroOperation().findByPk(operationId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!op) throw codigoErro('OPERATION_NOT_FOUND', `operação inexistente: ${operationId}`);

    const atual = op.get({ plain: true });
    if (Number(fencingToken) < Number(atual.fencing_token)) {
      throw codigoErro('FENCE_STALE', `fence ${fencingToken} < atual ${atual.fencing_token}`);
    }
    if (atual.lease_owner !== owner) {
      throw codigoErro('LEASE_HELD', `lease em poder de ${atual.lease_owner}`);
    }

    const expiraEm = new Date(Date.now() + Number(ttlMs));
    await op.update({ lease_expires_at: expiraEm, heartbeat_at: agora() }, { transaction: t });
    return { leaseExpiresAt: expiraEm, fencingToken: Number(atual.fencing_token) };
  });
}

/** Eventos em ordem de `seq`; `afterSeq` é o cursor de replay (Last-Event-ID). */
async function listEvents(operationId, { afterSeq = 0, limit = 500, tenantId = null } = {}) {
  const models = modelos();
  if (tenantId) {
    const op = await models.getLroOperation().findOne({ where: { id: operationId, tenant_id: String(tenantId) } });
    if (!op) throw codigoErro('OPERATION_NOT_FOUND', 'operação inexistente para o tenant');
  }
  const rows = await models.getLroEvent().findAll({
    where: {
      operation_id: operationId,
      seq: { [require('sequelize').Op.gt]: Number(afterSeq) },
    },
    order: [['seq', 'ASC']],
    limit: Math.min(Number(limit) || 500, 1000),
  });
  return rows.map((r) => r.get({ plain: true }));
}

module.exports = {
  TOPIC,
  createOperation,
  getOperation,
  transition,
  claimLease,
  heartbeat,
  listEvents,
};
