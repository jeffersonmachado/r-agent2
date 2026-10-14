'use strict';


const clock = require('../shared/clock');
/**
 * engine/engineeringRouter/operationReconciler.js — ER-V1-SEAL-002 (Full Durable Resume).
 *
 * Módulo puro (sem I/O). Decide, a partir do estado JÁ PERSISTIDO de uma `EngineeringOperation`
 * (nunca de estado em memória — resume acontece depois de crash, memória não sobrevive),
 * qual ação tomar antes de (re)executar um efeito colateral não idempotente de uma fase do
 * Engineering Router: RESUME (reusar resultado já persistido, nunca re-executar), RETRY
 * (repetir do zero — falha anterior foi definitiva, sem efeito pendente perigoso), RECONCILE
 * (o efeito pode ter acontecido de verdade mas o registro não confirma — precisa checar
 * evidência externa real antes de decidir), FAIL_SAFE (não pode prosseguir com segurança agora)
 * ou MANUAL_REQUIRED (estado nunca deveria acontecer; exige intervenção humana, nunca uma
 * suposição automática).
 */

const OPERATION_STATUSES = Object.freeze([
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN_REQUIRES_RECONCILIATION',
]);

const RECONCILE_ACTIONS = Object.freeze(['RUN', 'RESUME', 'RETRY', 'RECONCILE', 'FAIL_SAFE', 'MANUAL_REQUIRED']);

const DEFAULT_STALE_RUNNING_MS = 10 * 60 * 1000; // 10min — acima disso, RUNNING é tratado como órfão de um crash.

/**
 * @param {{existingOperation: object|null, nowMs?: number, staleRunningMs?: number}} params
 * @returns {{action: string, reason?: string}}
 */
function reconcileOperation({ existingOperation, nowMs = clock.nowMs(), staleRunningMs = DEFAULT_STALE_RUNNING_MS }) {
  if (!existingOperation) {
    return { action: 'RUN' };
  }

  const { status } = existingOperation;

  if (status === 'SUCCEEDED') {
    return { action: 'RESUME' };
  }

  if (status === 'FAILED') {
    return { action: 'RETRY' };
  }

  if (status === 'UNKNOWN_REQUIRES_RECONCILIATION') {
    return { action: 'RECONCILE', reason: 'OPERATION_ALREADY_MARKED_UNKNOWN' };
  }

  if (status === 'RUNNING') {
    const startedAtMs = existingOperation.startedAt ? new Date(existingOperation.startedAt).getTime() : null;
    if (startedAtMs === null || Number.isNaN(startedAtMs)) {
      // RUNNING sem startedAt é, por definição, um registro incompleto/corrompido — nunca
      // assumir nada sobre ele automaticamente.
      return { action: 'MANUAL_REQUIRED', reason: 'RUNNING_WITHOUT_STARTED_AT' };
    }
    const ageMs = nowMs - startedAtMs;
    if (ageMs > staleRunningMs) {
      // RUNNING há tempo demais: o processo original quase certamente morreu no meio do efeito
      // colateral. Não dá para saber, só a partir deste registro, se o efeito chegou a
      // acontecer de verdade (ex.: chamada de IA completou mas o processo morreu antes de
      // persistir SUCCEEDED) — exige checar evidência externa real antes de decidir RUN de novo.
      return { action: 'RECONCILE', reason: 'RUNNING_STALE' };
    }
    // RUNNING recente: pode genuinamente estar em progresso em outro processo/worker agora
    // mesmo — nunca rodar concorrentemente o mesmo efeito colateral.
    return { action: 'FAIL_SAFE', reason: 'OPERATION_STILL_RUNNING' };
  }

  if (status === 'PENDING') {
    // PENDING nunca deveria sobreviver a um restart sem transicionar para RUNNING — se
    // aconteceu, é um estado intermediário anômalo (não corresponde a nenhum efeito colateral
    // real ainda iniciado), seguro tratar como se não existisse.
    return { action: 'RUN' };
  }

  return { action: 'MANUAL_REQUIRED', reason: `UNKNOWN_OPERATION_STATUS:${status}` };
}

module.exports = {
  OPERATION_STATUSES,
  RECONCILE_ACTIONS,
  DEFAULT_STALE_RUNNING_MS,
  reconcileOperation,
};
