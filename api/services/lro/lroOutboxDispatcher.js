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
/**
 * Recupera claims EXPIRADOS: linhas deixadas em `PUBLISHING` por um processo que morreu entre o claim
 * e a publicação voltam para `PENDING` (e `claimed_at` é limpo). Sem isto o evento ficava preso para
 * sempre — órfão invisível, nem entregue nem na DLQ.
 *
 * @returns {Promise<{recuperadas:number}>}
 */
async function reclaimStale({ olderThanMs = 60000, now = null, limit = 100 } = {}) {
  const models = modelos();
  const outbox = models.getLroOutbox();
  const sequelize = outbox.sequelize;
  const instante = now ? new Date(now) : new Date();
  const corte = new Date(instante.getTime() - Number(olderThanMs));

  const [recuperadas] = await sequelize.query(
    `UPDATE lro_outbox
        SET status = 'PENDING', claimed_at = NULL, available_at = :agora,
            last_error = COALESCE(last_error, 'CLAIM_EXPIRADO')
      WHERE id IN (
        SELECT id FROM lro_outbox
         WHERE status = 'PUBLISHING' AND claimed_at IS NOT NULL AND claimed_at < :corte
         ORDER BY id
         LIMIT :limite
      )
      RETURNING id`,
    { replacements: { agora: instante, corte, limite: Number(limit) || 100 } },
  );
  return { recuperadas: (recuperadas || []).length };
}

async function claimBatch({ limit = 20, now = null, topic = null } = {}) {
  const models = modelos();
  const outbox = models.getLroOutbox();
  const sequelize = outbox.sequelize;
  const instante = now ? new Date(now) : new Date();

  return sequelize.transaction(async (t) => {
    const [rows] = await sequelize.query(
      // Filtro de `topic` DENTRO do claim (P1-D). Antes ele era aplicado DEPOIS: a linha já tinha
      // virado PUBLISHING e as tentativas já tinham subido, e então era descartada do lote — ficava
      // presa em PUBLISHING para sempre, com attempts inflado.
      `SELECT id FROM lro_outbox
        WHERE status = 'PENDING' AND available_at <= :agora
          AND (:topico IS NULL OR topic = :topico)
        ORDER BY id
        LIMIT :limite
        FOR UPDATE SKIP LOCKED`,
      { replacements: { agora: instante, limite: Number(limit) || 20, topico: topic || null }, transaction: t },
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
        claimed_at: instante,
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

  // Claims EXPIRADOS voltam para a fila antes de reclamar (P1-D): publicação órfã não fica presa.
  const { recuperadas } = await reclaimStale({ now: instante });
  if (recuperadas > 0) logger.warn('[lro:outbox] claims expirados recuperados', { recuperadas });

  // O filtro de `topic` acontece DENTRO do claim: pós-filtro descartava linha já reclamada e a
  // deixava presa em PUBLISHING com attempts inflado.
  const reclamadas = await claimBatch({ limit, now: instante, topic });

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

module.exports = {
  reclaimStale, backoffMs, claimBatch, dispatch, BACKOFF_BASE_MS, BACKOFF_CAP_MS };
