'use strict';

/**
 * qa-mesh/meshLease.js — LEASE do mesh com HEARTBEAT (núcleo puro + I/O fino).
 *
 * Substitui DUAS implementações duplicadas que decidiam execução simultânea por
 * PID (`process.kill(pid, 0)`) e por IDADE DE MTIME do arquivo de lock:
 *   - `api/services/qaMeshService.js::isMeshAlreadyRunning`
 *   - `qa-mesh/meshScheduler.js::isMeshAlreadyRunning`
 *   - `qa-mesh/meshRunner.js::cleanStaleLocks` (removia lock por mtime)
 *
 * DEFEITOS REAIS corrigidos (missão de hardening 2026-09-26):
 *
 *  1. PID NÃO É IDENTIDADE DE LIVENESS. Se o mesh morre e o PID é reciclado por
 *     um processo não relacionado, `process.kill(pid, 0)` responde "vivo" e o
 *     lock fica ATIVO PARA SEMPRE — o mesh nunca mais roda. Não era hipótese:
 *     é o comportamento do sistema operacional.
 *
 *  2. IDADE DE MTIME NÃO MEDE POSSE. O lock não é reescrito durante a execução,
 *     então num mesh longo o mtime envelhece e `cleanStaleLocks` apagava o lock
 *     de um mesh SAUDÁVEL E EM ANDAMENTO, permitindo duas execuções simultâneas
 *     sobre a mesma malha.
 *
 * MODELO CORRETO (o mesmo de `engineeringMission/leasePolicy`):
 *   - HEARTBEAT  = prova de liveness (quem está vivo renova);
 *   - LEASE TTL  = validade da posse (heartbeat velho ⇒ posse expirada);
 *   - PID/mtime  = APENAS metadata/corroboração, nunca autoridade.
 *
 * Regra central: `heartbeat fresco ⇒ lock ativo` (independentemente do PID);
 * `heartbeat velho ⇒ posse expirada` (independentemente do PID estar vivo).
 */

const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_LEASE_TTL_MS = Number(process.env.QA_MESH_LEASE_TTL_MS || 3 * 60 * 1000);
const DEFAULT_HEARTBEAT_MS = Number(process.env.QA_MESH_HEARTBEAT_MS || 30 * 1000);
const MIN_LEASE_TTL_MS = 30 * 1000;

const LEASE_STATES = Object.freeze({
  FREE: 'FREE',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
});

function toMs(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Instante do último sinal de vida: heartbeat explícito, senão o início. */
function leaseSignalMs(lock) {
  if (!lock) return null;
  return toMs(lock.heartbeatAt) ?? toMs(lock.startedAt) ?? null;
}

/** Estado do lease — decisão pura, sem ler o relógio (recebe `nowMs`). */
function resolveLeaseState(lock, nowMs, ttlMs = DEFAULT_LEASE_TTL_MS) {
  if (!lock || typeof lock !== 'object') return LEASE_STATES.FREE;
  const signal = leaseSignalMs(lock);
  if (signal === null) return LEASE_STATES.FREE; // lock sem sinal de vida = livre
  const ttl = Number.isFinite(ttlMs) && ttlMs >= MIN_LEASE_TTL_MS ? ttlMs : DEFAULT_LEASE_TTL_MS;
  return nowMs - signal < ttl ? LEASE_STATES.ACTIVE : LEASE_STATES.EXPIRED;
}

/**
 * Decisão de "posso executar agora?".
 *
 * @param {object|null} lock conteúdo do lock em disco (ou null se não existe)
 * @param {{ nowMs:number, ttlMs?:number, pidAlive?:boolean|null }} ctx
 *   `pidAlive` é CORROBORAÇÃO opcional (diagnóstico em log/relatório); a decisão
 *   NÃO depende dele — é exatamente o que a arquitetura exige.
 */
function decideMeshLease(lock, { nowMs, ttlMs = DEFAULT_LEASE_TTL_MS, pidAlive = null } = {}) {
  const state = resolveLeaseState(lock, nowMs, ttlMs);
  const heartbeatAgeMs = lock ? (() => {
    const s = leaseSignalMs(lock);
    return s === null ? null : Math.max(0, nowMs - s);
  })() : null;

  if (state === LEASE_STATES.FREE) {
    return { running: false, state, reason: 'clear', takeoverAllowed: true, pidAlive, heartbeatAgeMs };
  }
  if (state === LEASE_STATES.ACTIVE) {
    // Posse vigente: NUNCA roubar, mesmo que o PID pareça morto — a posse é o
    // lease, e o dono pode estar vivo em outro host/container.
    return {
      running: true,
      state,
      reason: 'lease_active',
      takeoverAllowed: false,
      pidAlive,
      heartbeatAgeMs,
      holder: lock.instanceId || lock.workerInstanceId || null,
      pid: lock.pid ?? null,
    };
  }
  // EXPIRED: posse vencida por ausência de heartbeat. PID vivo é irrelevante
  // (pode ser PID reciclado) — é justamente o caso que travava o mesh.
  return {
    running: false,
    state,
    reason: pidAlive === true ? 'lease_expired_pid_recycled' : 'lease_expired',
    takeoverAllowed: true,
    pidAlive,
    heartbeatAgeMs,
    holder: lock.instanceId || lock.workerInstanceId || null,
    pid: lock.pid ?? null,
  };
}

function readLease(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

function newInstanceId() {
  return `mesh-${crypto.randomUUID()}`;
}

/** Payload do lease: identidade de INSTÂNCIA + sinais temporais. PID é metadata. */
function buildLeasePayload({ instanceId, pid = process.pid, host = os.hostname(), nowMs = Date.now() } = {}) {
  const iso = new Date(nowMs).toISOString();
  return {
    instanceId: instanceId || newInstanceId(),
    pid,
    host,
    startedAt: iso,
    heartbeatAt: iso,
    leaseTtlMs: DEFAULT_LEASE_TTL_MS,
    heartbeatIntervalMs: DEFAULT_HEARTBEAT_MS,
  };
}

function acquireLease(lockPath, payload) {
  const data = payload || buildLeasePayload({});
  fs.writeFileSync(lockPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return data;
}

/** Renova a posse. Devolve false quando o lease NÃO é mais nosso (fence perdido). */
function heartbeatLease(lockPath, { instanceId, nowMs = Date.now() } = {}) {
  const current = readLease(lockPath);
  if (!current) return false;
  if (instanceId && current.instanceId && current.instanceId !== instanceId) return false;
  const next = { ...current, heartbeatAt: new Date(nowMs).toISOString(), heartbeatCount: Number(current.heartbeatCount || 0) + 1 };
  try {
    fs.writeFileSync(lockPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function releaseLease(lockPath, { instanceId } = {}) {
  const current = readLease(lockPath);
  // Só libera o PRÓPRIO lease: não apagar a posse de outro dono.
  if (current && instanceId && current.instanceId && current.instanceId !== instanceId) return false;
  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

/** PID vivo — corroboração de diagnóstico. NUNCA autoridade de posse. */
function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

module.exports = {
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_HEARTBEAT_MS,
  MIN_LEASE_TTL_MS,
  LEASE_STATES,
  leaseSignalMs,
  resolveLeaseState,
  decideMeshLease,
  readLease,
  newInstanceId,
  buildLeasePayload,
  acquireLease,
  heartbeatLease,
  releaseLease,
  isPidAlive,
};
