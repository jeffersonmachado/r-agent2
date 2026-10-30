'use strict';

/**
 * Recuperação de operações ÓRFÃS de LRO.
 *
 * Órfã = operação em execução cujo dono (lease) sumiu: `lease_owner` preenchido e
 * `lease_expires_at` no passado. `SLOW != STUCK != DEAD` (docs/architecture/timeout-architecture.md):
 * só o vencimento do lease autoriza agir — ausência de progresso NÃO é prova de morte.
 *
 * Política (determinística e auditada):
 *   1. a operação vai para `PAUSED` — nunca direto para `COMPLETED`, nunca "concluída por timeout";
 *   2. o lease é liberado (`lease_owner = NULL`) e o `fencing_token` AVANÇA, de modo que um worker
 *      antigo que volte não consiga escrever nada;
 *   3. o motivo entra em evento próprio (`ORPHAN_RECOVERED`) — reconciliação sem registro é
 *      indistinguível de adulteração.
 *
 * Nada aqui publica release nem decide GO; é saneamento de estado.
 */

const lroService = require('./lroService');

const CODIGOS = Object.freeze({
  OPERACAO_NAO_ORFA: 'OPERACAO_NAO_ORFA',
  MOTIVO_OBRIGATORIO: 'MOTIVO_OBRIGATORIO',
});

function erro(code, message) {
  return Object.assign(new Error(message || code), { code });
}

function modelos() {
  return require('../../db/models');
}

/**
 * Lista operações órfãs (lease vencido). Somente leitura.
 * @returns {Promise<Array<{id:string, tenantId:string, status:string, leaseOwner:string, leaseExpiresAt:Date}>>}
 */
async function findOrphans({ tenantId = null, now = null, limit = 100 } = {}) {
  const { getLroOperation } = modelos();
  const { Op } = require('sequelize');
  const instante = now ? new Date(now) : new Date();

  const where = {
    status: { [Op.in]: ['QUEUED', 'RUNNING', 'WAITING_FEEDBACK', 'PAUSED'] },
    lease_owner: { [Op.ne]: null },
    lease_expires_at: { [Op.lt]: instante },
  };
  if (tenantId) where.tenant_id = String(tenantId);

  const linhas = await getLroOperation().findAll({ where, order: [['lease_expires_at', 'ASC']], limit });
  return linhas.map((l) => {
    const p = l.get({ plain: true });
    return {
      id: p.id,
      tenantId: p.tenant_id,
      status: p.status,
      leaseOwner: p.lease_owner,
      leaseExpiresAt: p.lease_expires_at,
    };
  });
}

/**
 * Reconcilia UMA operação órfã: pausa, libera lease, avança fencing e registra o motivo.
 * @throws {code:'OPERACAO_NAO_ORFA'} quando a operação não está mais órfã (lease válido/terminal)
 */
async function recoverOperation(operationId, { reason, actorId = 'lro-recovery', now = null } = {}) {
  if (!reason || String(reason).trim() === '') throw erro(CODIGOS.MOTIVO_OBRIGATORIO);

  const { getLroOperation } = modelos();
  const sequelize = getLroOperation().sequelize;
  const instante = now ? new Date(now) : new Date();

  return sequelize.transaction(async (t) => {
    const op = await getLroOperation().findByPk(operationId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!op) throw erro('OPERATION_NOT_FOUND');
    const atual = op.get({ plain: true });
    // Capturado ANTES de qualquer update desta transação: é o que a auditoria precisa registrar.
    const donoAnterior = atual.lease_owner;
    const leaseAnterior = atual.lease_expires_at;
    const statusAnterior = atual.status;
    const fencingAnterior = Number(atual.fencing_token || 0);

    const terminal = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(atual.status);
    const semLease = !atual.lease_owner;
    const leaseVencido = atual.lease_expires_at && new Date(atual.lease_expires_at).getTime() < instante.getTime();
    if (terminal || semLease || !leaseVencido) {
      throw erro(CODIGOS.OPERACAO_NAO_ORFA, `status=${atual.status} lease=${atual.lease_owner || 'nenhum'}`);
    }

    // Pausa primeiro (transição legal a partir de RUNNING/WAITING_FEEDBACK/QUEUED/PAUSED?).
    // QUEUED/RUNNING/WAITING_FEEDBACK aceitam PAUSED pela máquina de estados.
    let operacao = atual;
    if (atual.status !== 'PAUSED') {
      operacao = await lroService.transition(operationId, {
        to: 'PAUSED',
        actorId,
        context: { phase: 'recovered_from_orphan', reason: String(reason) },
        transaction: t,
      });
    }

    // Libera a posse e AVANÇA o fencing: quem voltar com token antigo não escreve mais.
    const fencing = fencingAnterior + 1;
    await op.update({
      lease_owner: null,
      lease_expires_at: null,
      fencing_token: fencing,
      version: Number(operacao.version || atual.version) + 1,
      message_code: 'ORPHAN_RECOVERED',
    }, { transaction: t });

    const { getLroEvent, getLroOutbox } = modelos();
    const [linhasSeq] = await sequelize.query(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS proximo FROM lro_events WHERE operation_id = :id',
      { replacements: { id: operationId }, transaction: t },
    );
    const seq = linhasSeq && linhasSeq[0] ? Number(linhasSeq[0].proximo) : 1;

    const evento = await getLroEvent().create({
      operation_id: operationId,
      seq,
      type: 'ORPHAN_RECOVERED',
      payload: {
        reason: String(reason),
        previousLeaseOwner: donoAnterior,
        previousLeaseExpiresAt: leaseAnterior,
        previousStatus: statusAnterior,
        previousFencingToken: fencingAnterior,
        fencingToken: fencing,
      },
      actor_id: actorId,
    }, { transaction: t });

    await getLroOutbox().create({
      operation_id: operationId,
      event_id: evento.id,
      topic: 'lro.events',
      payload: { operationId, seq, type: 'ORPHAN_RECOVERED' },
      status: 'PENDING',
      available_at: new Date(),
    }, { transaction: t });

    const depois = await getLroOperation().findByPk(operationId, { transaction: t });
    const plain = depois.get({ plain: true });
    return { ...plain, fencingToken: plain.fencing_token, recovered: true };
  });
}

/** Varre e reconcilia órfãs. Falha de uma não impede as demais (o resumo diz o que passou). */
async function recoverOrphans({ tenantId = null, now = null, limit = 100, actorId = 'lro-recovery' } = {}) {
  const orfas = await findOrphans({ tenantId, now, limit });
  const recuperadas = [];
  const falhas = [];
  for (const orfa of orfas) {
    try {
      const r = await recoverOperation(orfa.id, {
        reason: `lease de ${orfa.leaseOwner} venceu em ${orfa.leaseExpiresAt}`,
        actorId,
        now,
      });
      recuperadas.push({ id: r.id, status: r.status, fencingToken: r.fencingToken });
    } catch (error) {
      falhas.push({ id: orfa.id, code: error.code || null });
    }
  }
  return { encontradas: orfas.length, recuperadas, falhas };
}

module.exports = { CODIGOS, findOrphans, recoverOperation, recoverOrphans };
