'use strict';

/**
 * api/services/engineeringRouter/leaseHeartbeat.js — agenda do HEARTBEAT durante a execução real.
 *
 * As primitivas de renovação já existiam (`engineeringTaskService.renewTaskLease`,
 * `missionStoreService.renewMissionLease`), mas nada as chamava durante o trabalho: o lease de uma
 * task longa simplesmente vencia no meio da execução e o recovery podia "roubar" trabalho de um
 * worker vivo. Este módulo NÃO é outro lease service — é só o relógio que chama a renovação
 * existente na cadência da política `HEARTBEAT` (registry), enquanto a execução durar.
 *
 * Regras:
 *   - heartbeat renova LIVENESS e NUNCA conta como progresso (quem chama registra progresso à
 *     parte, em eventos significativos);
 *   - perder o lease (`*_LEASE_LOST`) é terminal para ESTE worker: o `signal` é abortado, o que
 *     cancela a operação em curso (provider/child) — o worker para de escrever; quem continua é o
 *     novo dono;
 *   - falha transitória de renovação (ex.: banco lento) não derruba nada: a próxima batida tenta de
 *     novo; só a perda comprovada de posse aborta;
 *   - `onTick` roda após cada renovação bem-sucedida (ex.: watchdog de NO_PROGRESS), fora do
 *     caminho crítico da renovação.
 *
 * Timer em cadeia (`setTimeout` reagendado), nunca `setInterval`: uma renovação lenta nunca se
 * sobrepõe à seguinte.
 */

const logger = require('../../utils/logger');
const { policyMs, recordLivenessEvent } = require('../../utils/operationDeadline');

const LOST_CODES = new Set(['TASK_LEASE_LOST', 'MISSION_LEASE_LOST']);

function startLeaseHeartbeat({
  name,
  renew,
  onTick = null,
  onLost = null,
  intervalMs = null,
  meta = {},
} = {}) {
  if (typeof renew !== 'function') throw new Error('startLeaseHeartbeat: renew é obrigatório');
  const cadenceMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : policyMs('HEARTBEAT');
  const controller = new AbortController();
  const state = {
    beats: 0,
    failures: 0,
    lost: false,
    lostError: null,
    lastBeatAt: null,
    stopped: false,
  };
  let timer = null;

  const schedule = () => {
    if (state.stopped || state.lost) return;
    timer = setTimeout(beat, cadenceMs);
    if (typeof timer.unref === 'function') timer.unref();
  };

  async function beat() {
    if (state.stopped || state.lost) return;
    try {
      const lease = await renew();
      state.beats += 1;
      state.lastBeatAt = Date.now();
      if (typeof onTick === 'function') {
        try {
          await onTick(lease, state);
        } catch (error) {
          logger.warn('[leaseHeartbeat] onTick falhou (heartbeat segue)', { name, message: error.message });
        }
      }
    } catch (error) {
      if (LOST_CODES.has(error.code)) {
        state.lost = true;
        state.lostError = error;
        recordLivenessEvent('LEASE_LOST', { name, ...meta, code: error.code });
        logger.warn('[leaseHeartbeat] posse perdida — worker para de escrever', { name, ...meta, code: error.code });
        controller.abort(error);
        if (typeof onLost === 'function') {
          try { onLost(error); } catch (_) { /* notificação best-effort */ }
        }
        return;
      }
      state.failures += 1;
      logger.warn('[leaseHeartbeat] renovação falhou (transitório, nova tentativa na próxima batida)', { name, ...meta, message: error.message, code: error.code });
    }
    schedule();
  }

  schedule();

  return {
    signal: controller.signal,
    state,
    intervalMs: cadenceMs,
    /** Força uma batida imediata (usado antes de fases longas e por testes). */
    beatNow: async () => {
      if (timer) clearTimeout(timer);
      await beat();
    },
    stop() {
      state.stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

module.exports = { startLeaseHeartbeat };
