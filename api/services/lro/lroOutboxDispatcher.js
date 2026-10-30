'use strict';

/**
 * Dispatcher da outbox de LRO.
 *
 * Contrato: o evento é gravado na MESMA transação do estado (feito em `lroService`); publicar é
 * etapa SEPARADA e idempotente. Se o processo morrer entre o commit e a publicação, a linha
 * continua `PENDING` e o próximo ciclo a publica — é isso que evita "estado mudou e ninguém soube".
 *
 * Concorrência: `FOR UPDATE SKIP LOCKED` (Postgres) garante que dois dispatchers não pegam a mesma
 * linha, sem fila serial.
 *
 * Falha: backoff exponencial com jitter; ao atingir `maxAttempts` a linha vira `DEAD` (DLQ) e NÃO é
 * mais tentada automaticamente — reconciliação é ação explícita.
 */

const logger = require('../../utils/logger');

const BACKOFF_BASE_MS = 2000;
const BACKOFF_CAP_MS = 5 * 60 * 1000;

function backoffMs(attempts) {
  const exponencial = Math.min(Math.pow(2, Math.max(0, Number(attempts) || 0)) * BACKOFF_BASE_MS, BACKOFF_CAP_MS);
  const jitter = Math.floor(Math.random() * 250);
  return exponencial + jitter;
}

function modelos() {
  return require('../../db/models');
}

/**
 * Reclama um lote de pendências, incrementando tentativas e virando `PUBLISHING` (visível).
 * @returns {Promise<Array<object>>} linhas reclamadas (plain)
 */
async function claimBatch({ limit = 20, now = null } = {}) {
  const models = modelos();
  const outbox = models.getLroOutbox();
  const sequelize = outbox.sequelize;
  const instante = now ? new Date(now) : new Date();

  return sequelize.transaction(async (t) => {
    const [rows] = await sequelize.query(
      `SELECT id FROM lro_outbox
        WHERE status = 'PENDING' AND available_at <= :agora
        ORDER BY id
        LIMIT :limite
        FOR UPDATE SKIP LOCKED`,
      { replacements: { agora: instante, limite: Number(limit) || 20 }, transaction: t },
    );
    const ids = (rows || []).map((r) => r.id);
    if (ids.length === 0) return [];

    const reclamadas = [];
    for (const id of ids) {
      const linha = await outbox.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!linha || linha.status !== 'PENDING') continue;
      await linha.update({
        status: 'PUBLISHING',
        attempts: Number(linha.attempts || 0) + 1,
      }, { transaction: t });
      reclamadas.push(linha.get({ plain: true }));
    }
    return reclamadas;
  });
}

/**
 * Publica um lote. `publish(topic, payload)` é injetado (transporte real fica no adaptador).
 * @returns {Promise<{publicados:number, reagendados:number, mortos:number, erros:Array}>}
 */
async function dispatch({
  publish, limit = 20, maxAttempts = 5, now = null, topic = null,
} = {}) {
  if (typeof publish !== 'function') throw Object.assign(new Error('publish obrigatório'), { code: 'PUBLISH_OBRIGATORIO' });

  const models = modelos();
  const outbox = models.getLroOutbox();
  const sequelize = outbox.sequelize;
  const instante = now ? new Date(now) : new Date();

  let reclamadas = await claimBatch({ limit, now: instante });
  if (topic) reclamadas = reclamadas.filter((l) => l.topic === topic);

  const resultado = { publicados: 0, reagendados: 0, mortos: 0, erros: [] };

  for (const linha of reclamadas) {
    try {
      await publish(linha.topic, linha.payload, linha);
      await outbox.update(
        { status: 'PUBLISHED', published_at: new Date(), last_error: null },
        { where: { id: linha.id } },
      );
      resultado.publicados += 1;
    } catch (error) {
      const tentativas = Number(linha.attempts || 0);
      const mensagem = String(error && error.message ? error.message : error).slice(0, 500);
      if (tentativas >= Number(maxAttempts)) {
        await outbox.update(
          { status: 'DEAD', last_error: mensagem },
          { where: { id: linha.id } },
        );
        resultado.mortos += 1;
        logger.warn('[lro:outbox] linha movida para DEAD (DLQ)', { id: linha.id, attempts: tentativas });
      } else {
        const proxima = new Date(Date.now() + backoffMs(tentativas));
        await outbox.update(
          { status: 'PENDING', available_at: proxima, last_error: mensagem },
          { where: { id: linha.id } },
        );
        resultado.reagendados += 1;
      }
      resultado.erros.push({ id: linha.id, message: mensagem, attempts: tentativas });
    }
  }

  void sequelize;
  return resultado;
}

module.exports = { backoffMs, claimBatch, dispatch, BACKOFF_BASE_MS, BACKOFF_CAP_MS };
