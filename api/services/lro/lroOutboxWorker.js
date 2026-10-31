'use strict';

/**
 * Worker da outbox de LRO.
 *
 * Sem ele, `lro_outbox` é uma tabela que ninguém drena: o evento fica `PENDING` para sempre e o
 * cliente nunca recebe o que aconteceu. Com ele, a publicação é contínua e o `dispatch` já garante
 * backoff e DLQ.
 *
 * Regras:
 *  - OPT-IN por `LRO_OUTBOX_WORKER=1`: um worker ligado por acidente em ambiente de teste é pior que
 *    um worker desligado (publicaria eventos de teste para clientes reais);
 *  - sem timer global escondido: `start` recebe `setIntervalFn`/`setTimeoutFn` injetáveis para o teste
 *    ser determinístico (nada de esperar segundos reais);
 *  - falha de publicação NÃO derruba o processo: `dispatch` registra backoff/DLQ;
 *  - `stop()` devolve promessa e é idempotente.
 */

const logger = require('../../utils/logger');

const FLAG = 'LRO_OUTBOX_WORKER';
const INTERVALO_PADRAO_MS = 1000;

function workerHabilitado() {
  return String(process.env[FLAG] || '').trim() === '1';
}

/**
 * Publicador padrão: empurra o evento para o WebSocket do TENANT dono da operação.
 * Sem tenant resolvível, o evento NÃO é publicado (fail-closed: melhor ficar na fila do que vazar).
 */
function criarPublicadorWebSocket({ broadcastToTenant, obterOperacao } = {}) {
  return async (topico, payload) => {
    const operationId = payload && payload.operationId;
    if (!operationId) throw Object.assign(new Error('payload sem operationId'), { code: 'PAYLOAD_SEM_OPERACAO' });
    const operacao = await obterOperacao(operationId);
    // `getOperation` respeita o contrato público (`serializarOperacao` → camelCase). Ler
    // `tenant_id` aqui já custou 5 eventos DEAD em execução real: o campo não existia e o
    // publicador recusava tudo como TENANT_NAO_RESOLVIDO.
    if (!operacao || !operacao.tenantId) {
      throw Object.assign(new Error('tenant da operação não resolvido'), { code: 'TENANT_NAO_RESOLVIDO' });
    }
    broadcastToTenant(operacao.tenantId, {
      type: 'lro.event',
      operationId,
      seq: payload.seq || null,
      eventType: payload.type || null,
    });
  };
}

/**
 * Cria o worker. `depends` é injetado para teste (dispatch/publish/agenda).
 * @returns {{start:Function, stop:Function, tick:Function, isRunning:Function}}
 */
function criarWorker({
  dispatch,
  publish,
  intervalMs = INTERVALO_PADRAO_MS,
  limit = 50,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  habilitado = null,
  loggerRef = logger,
  // Varredura periódica opcional (prazos de feedback vencidos). Roda no MESMO tick para não criar
  // um segundo mecanismo de agenda; é ISOLADA — falha dela nunca impede o dreno da outbox.
  sweep = null,
} = {}) {
  if (typeof dispatch !== 'function' || typeof publish !== 'function') {
    throw Object.assign(new Error('dispatch e publish são obrigatórios'), { code: 'WORKER_INCOMPLETO' });
  }

  let timer = null;
  let rodando = false;
  let emExecucao = false;

  const tick = async () => {
    if (emExecucao) return { skipped: true, reason: 'tick_anterior_em_andamento' };
    emExecucao = true;
    try {
      const resultado = await dispatch({ publish, limit });
      if (typeof sweep === 'function') {
        try {
          await sweep();
        } catch (erroSweep) {
          loggerRef.warn('[lro:outbox-worker] falha na varredura de prazos', { code: erroSweep.code || null });
        }
      }
      return resultado;
    } catch (error) {
      loggerRef.warn('[lro:outbox-worker] falha no ciclo', { code: error.code || null });
      return { publicados: 0, reagendados: 0, mortos: 0, erros: [{ message: String(error && error.message) }] };
    } finally {
      emExecucao = false;
    }
  };

  const start = () => {
    const ligado = habilitado === null ? workerHabilitado() : Boolean(habilitado);
    if (!ligado) return { started: false, reason: 'LRO_OUTBOX_WORKER_desligado' };
    if (rodando) return { started: false, reason: 'ja_rodando' };

    rodando = true;
    timer = setIntervalFn(() => { void tick(); }, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    loggerRef.info('[lro:outbox-worker] iniciado', { intervalMs, limit });
    return { started: true };
  };

  const stop = async () => {
    if (!rodando) return { stopped: false, reason: 'nao_estava_rodando' };
    rodando = false;
    if (timer) clearIntervalFn(timer);
    timer = null;
    loggerRef.info('[lro:outbox-worker] parado', {});
    return { stopped: true };
  };

  return { start, stop, tick, isRunning: () => rodando };
}

module.exports = {
  FLAG,
  INTERVALO_PADRAO_MS,
  workerHabilitado,
  criarPublicadorWebSocket,
  criarWorker,
};
