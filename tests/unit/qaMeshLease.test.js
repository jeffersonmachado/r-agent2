'use strict';

/**
 * qa-mesh/meshLease — LEASE com HEARTBEAT como autoridade de posse.
 *
 * Cobre a classe de defeito real corrigida em 2026-09-26 (§SLOW != STUCK != DEAD):
 *   1. PID NÃO É LIVENESS: PID reciclado por processo não relacionado mantinha o
 *      lock do mesh ATIVO para sempre (mesh wedged, nunca mais rodava).
 *   2. MTIME NÃO MEDE POSSE: o lock não é reescrito durante a execução, então num
 *      mesh longo o mtime envelhecia e o cleanup apagava o lock de um mesh
 *      SAUDÁVEL E EM ANDAMENTO — permitindo duas execuções concorrentes.
 *
 * A decisão precisa ser: heartbeat fresco ⇒ posse ativa (mesmo com PID morto);
 * heartbeat velho ⇒ posse expirada (mesmo com PID vivo).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const meshLease = require('../../qa-mesh/meshLease');

const nowMs = Date.parse('2026-09-26T12:00:00.000Z');
const TTL = 3 * 60 * 1000;

function lockAt({ heartbeatAgoMs = 0, pid = 1234, instanceId = 'mesh-A' }) {
  return {
    instanceId,
    pid,
    host: 'host-1',
    startedAt: new Date(nowMs - Math.max(heartbeatAgoMs, 1000)).toISOString(),
    heartbeatAt: new Date(nowMs - heartbeatAgoMs).toISOString(),
  };
}

describe('meshLease — heartbeat é a prova de LIVENESS (PID é só corroboração)', () => {
  test('PID VIVO com heartbeat velho → posse EXPIRADA (o caso que travava o mesh)', () => {
    const decision = meshLease.decideMeshLease(lockAt({ heartbeatAgoMs: TTL + 1000 }), {
      nowMs,
      ttlMs: TTL,
      pidAlive: true, // PID reciclado por outro processo
    });
    expect(decision.state).toBe(meshLease.LEASE_STATES.EXPIRED);
    expect(decision.running).toBe(false);
    expect(decision.takeoverAllowed).toBe(true);
    expect(decision.reason).toBe('lease_expired_pid_recycled');
  });

  test('PID MORTO com heartbeat fresco → posse ATIVA (liveness não é PID)', () => {
    const decision = meshLease.decideMeshLease(lockAt({ heartbeatAgoMs: 1000 }), {
      nowMs,
      ttlMs: TTL,
      pidAlive: false,
    });
    expect(decision.state).toBe(meshLease.LEASE_STATES.ACTIVE);
    expect(decision.running).toBe(true);
    expect(decision.takeoverAllowed).toBe(false);
    expect(decision.holder).toBe('mesh-A');
  });

  test('lock sem sinal de vida é FREE, não "ativo por omissão"', () => {
    expect(meshLease.resolveLeaseState({ pid: 1 }, nowMs, TTL)).toBe(meshLease.LEASE_STATES.FREE);
    expect(meshLease.resolveLeaseState(null, nowMs, TTL)).toBe(meshLease.LEASE_STATES.FREE);
  });

  test('heartbeat no LIMITE da lease ainda é ativo (liveness recente)', () => {
    const decision = meshLease.decideMeshLease(lockAt({ heartbeatAgoMs: TTL / 2 }), { nowMs, ttlMs: TTL });
    expect(decision.running).toBe(true);
    expect(decision.heartbeatAgeMs).toBe(TTL / 2);
  });

  test('mesh LONGO e saudável não é considerado stale (TIMEOUT-05: idade não derruba posse)', () => {
    // 4 horas de execução — muito além de qualquer threshold por idade — mas com
    // heartbeat renovado agora.
    const running = { ...lockAt({ heartbeatAgoMs: 0 }), startedAt: new Date(nowMs - 4 * 60 * 60 * 1000).toISOString() };
    const decision = meshLease.decideMeshLease(running, { nowMs, ttlMs: TTL, pidAlive: true });
    expect(decision.running).toBe(true);
    expect(decision.takeoverAllowed).toBe(false);
  });
});

describe('meshLease — I/O de posse (acquire/heartbeat/release)', () => {
  let dir;
  let lockPath;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-lease-'));
    lockPath = path.join(dir, 'mesh-running.lock');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('acquire grava identidade de INSTÂNCIA + heartbeat (nunca só PID)', () => {
    const payload = meshLease.acquireLease(lockPath, meshLease.buildLeasePayload({ instanceId: 'mesh-X', pid: 4321 }));
    expect(payload.instanceId).toBe('mesh-X');
    expect(payload.pid).toBe(4321);
    expect(payload.startedAt).toBeTruthy();
    expect(payload.heartbeatAt).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).instanceId).toBe('mesh-X');
  });

  test('heartbeat renova o sinal sem trocar de dono', () => {
    meshLease.acquireLease(lockPath, meshLease.buildLeasePayload({ instanceId: 'mesh-Y', nowMs: nowMs - 60000 }));
    const ok = meshLease.heartbeatLease(lockPath, { instanceId: 'mesh-Y', nowMs });
    expect(ok).toBe(true);
    const after = meshLease.readLease(lockPath);
    expect(after.instanceId).toBe('mesh-Y');
    expect(after.heartbeatAt).toBe(new Date(nowMs).toISOString());
    expect(after.heartbeatCount).toBe(1);
  });

  test('heartbeat de OUTRA instância é recusado (fencing de posse)', () => {
    meshLease.acquireLease(lockPath, meshLease.buildLeasePayload({ instanceId: 'mesh-dono', nowMs }));
    expect(meshLease.heartbeatLease(lockPath, { instanceId: 'mesh-intruso', nowMs })).toBe(false);
    expect(meshLease.readLease(lockPath).instanceId).toBe('mesh-dono');
  });

  test('release de OUTRA instância NÃO apaga a posse alheia', () => {
    meshLease.acquireLease(lockPath, meshLease.buildLeasePayload({ instanceId: 'mesh-dono', nowMs }));
    expect(meshLease.releaseLease(lockPath, { instanceId: 'mesh-intruso' })).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(meshLease.releaseLease(lockPath, { instanceId: 'mesh-dono' })).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('isPidAlive devolve null para pid inválido (nunca "vivo" por omissão)', () => {
    expect(meshLease.isPidAlive(0)).toBeNull();
    expect(meshLease.isPidAlive(-1)).toBeNull();
    expect(meshLease.isPidAlive('abc')).toBeNull();
  });
});
