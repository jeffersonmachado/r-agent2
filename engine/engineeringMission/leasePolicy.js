'use strict';

/**
 * engine/engineeringMission/leasePolicy.js — política de LEASE distribuído (núcleo puro).
 *
 * Achado real (auditoria V2): a autoridade de "quem está vivo" era `process.kill(pid, 0)` sobre o
 * PID embutido no `locked_by` (`mission-compiler-<pid>`). Isso NÃO é identidade global: dois
 * containers/workers na mesma máquina podem ter o mesmo PID, e a mesma instância em outra máquina
 * tem PID sem nenhum significado local. Pior: um worker antigo que perdeu o lease podia voltar e
 * gravar por cima da execução do worker novo (não havia fencing).
 *
 * Aqui vive APENAS a decisão determinística (sem I/O e SEM ler o relógio): quem recebe o instante
 * decide. O `process.kill(pid, 0)` continua existindo como OTIMIZAÇÃO LOCAL de diagnóstico, nunca
 * como autoridade — quem decide takeover é `lease_expires_at` + fencing token.
 *
 * Invariantes:
 *   1. lease ativo = token presente E expires_at > agora; expirado é reassumível;
 *   2. heartbeat renova, nunca "libera";
 *   3. `lease_fence` é monotônico por missão: só cresce, nunca reaproveita valor;
 *   4. escrita de worker exige (token atual E fence atual) — worker antigo é rejeitado.
 */

const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60 * 1000;
const MIN_LEASE_TTL_MS = 30 * 1000;

const WORKER_TYPES = Object.freeze(['COMPILER', 'ORCHESTRATOR', 'RECOVERY', 'ROUTER_SUBAGENT', 'APPROVAL']);

/** Estado de lease derivado (vocabulário único, usado também por evidência e relatório). */
const LEASE_STATES = Object.freeze({
  FREE: 'FREE',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  HELD_BY_OTHER: 'HELD_BY_OTHER',
});

function toMs(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normaliza a linha persistida (snake_case) no shape de lease usado pelas decisões.
 * Ausência de colunas de lease (linha legada, anterior à migration) devolve lease FREE — nunca
 * "ativo por omissão", que bloquearia a missão para sempre.
 */
function normalizeLease(row) {
  if (!row) return null;
  const token = row.lease_token ?? row.leaseToken ?? null;
  return Object.freeze({
    workerInstanceId: row.lease_worker_instance_id ?? row.leaseWorkerInstanceId ?? null,
    workerType: row.lease_worker_type ?? row.leaseWorkerType ?? null,
    host: row.lease_host ?? row.leaseHost ?? null,
    token,
    fence: Number(row.lease_fence ?? row.leaseFence ?? 0) || 0,
    acquiredAt: toMs(row.lease_acquired_at ?? row.leaseAcquiredAt ?? null),
    expiresAt: toMs(row.lease_expires_at ?? row.leaseExpiresAt ?? null),
    heartbeatAt: toMs(row.lease_heartbeat_at ?? row.leaseHeartbeatAt ?? null),
  });
}

/** Lease é considerada ATIVA apenas com token E validade futura. */
function isLeaseActive(lease, nowMs) {
  if (!lease || !lease.token) return false;
  if (lease.expiresAt === null) return false;
  return lease.expiresAt > nowMs;
}

function leaseRemainingMs(lease, nowMs) {
  if (!lease || lease.expiresAt === null) return 0;
  return Math.max(0, lease.expiresAt - nowMs);
}

/**
 * Estado observável do lease. `holderIsOther` é o ponto que decide fail-closed: um worker vivo e
 * dentro da validade não pode ser roubado, independentemente de PID.
 */
function resolveLeaseState(lease, nowMs) {
  if (!lease || !lease.token) return LEASE_STATES.FREE;
  return isLeaseActive(lease, nowMs) ? LEASE_STATES.ACTIVE : LEASE_STATES.EXPIRED;
}

/** Pode assumir AGORA? Occupado por outro (ativo) nunca; expirado sempre; do próprio worker idem. */
function canAcquire(lease, nowMs, { workerInstanceId = null } = {}) {
  if (!lease || !lease.token) return true;
  if (!isLeaseActive(lease, nowMs)) return true;
  if (workerInstanceId && lease.workerInstanceId === workerInstanceId) return true;
  return false;
}

function shouldTakeOver(lease, nowMs) {
  return resolveLeaseState(lease, nowMs) === LEASE_STATES.EXPIRED;
}

/** Fence monotônico: nunca reaproveita valor, nunca anda para trás. */
function nextFence(lease) {
  const current = Number(lease?.fence || 0);
  return Number.isFinite(current) && current >= 0 ? current + 1 : 1;
}

function isLeaseExpiringSoon(lease, nowMs, thresholdMs = DEFAULT_HEARTBEAT_INTERVAL_MS) {
  if (!isLeaseActive(lease, nowMs)) return true;
  return leaseRemainingMs(lease, nowMs) <= thresholdMs;
}

/**
 * Validação de escrita de worker (fencing). Um worker que perdeu o lease tem token/fence
 * desatualizados e é rejeitado ANTES de qualquer efeito — nunca "grava e depois avisa".
 */
function assertWriterAuthorized({ lease, nowMs, leaseToken, fence }) {
  if (!lease || !lease.token) {
    return { authorized: false, code: 'MISSION_LEASE_NOT_HELD', detail: 'missão sem lease ativo' };
  }
  if (leaseToken && lease.token !== leaseToken) {
    return { authorized: false, code: 'MISSION_STALE_WORKER_WRITE', detail: 'lease token não corresponde ao vigente' };
  }
  if (fence !== undefined && fence !== null && Number(fence) !== lease.fence) {
    return { authorized: false, code: 'MISSION_STALE_WORKER_WRITE', detail: `fence ${fence} != vigente ${lease.fence}` };
  }
  if (!isLeaseActive(lease, nowMs)) {
    return { authorized: false, code: 'MISSION_LEASE_EXPIRED', detail: 'lease expirado — worker não pode mais escrever' };
  }
  return { authorized: true };
}

/**
 * Expiração efetiva a persistir em uma renovação: sempre maior que o instante atual, nunca
 * encurta uma validade em curso (renovação com TTL menor não pode "piorar" o lease).
 */
function computeExpiry(nowMs, ttlMs, currentExpiresAtMs = null) {
  const ttl = Number.isFinite(ttlMs) && ttlMs >= MIN_LEASE_TTL_MS ? ttlMs : DEFAULT_LEASE_TTL_MS;
  const candidate = nowMs + ttl;
  if (currentExpiresAtMs !== null && currentExpiresAtMs > candidate) return currentExpiresAtMs;
  return candidate;
}

module.exports = {
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  MIN_LEASE_TTL_MS,
  WORKER_TYPES,
  LEASE_STATES,
  normalizeLease,
  isLeaseActive,
  leaseRemainingMs,
  resolveLeaseState,
  canAcquire,
  shouldTakeOver,
  nextFence,
  isLeaseExpiringSoon,
  assertWriterAuthorized,
  computeExpiry,
};
