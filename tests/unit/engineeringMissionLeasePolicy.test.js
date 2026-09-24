'use strict';

/**
 * LeasePolicy — decisão de lease distribuído (§30–§32).
 *
 * O que estava errado antes: a autoridade de "worker vivo" era `process.kill(pid, 0)`. PID não é
 * identidade global e não havia fencing — um worker antigo podia gravar por cima do novo. Estes
 * testes provam as regras puras: quem pode assumir, quando o lease vence, e por que uma escrita de
 * worker antigo é recusada.
 */

const lease = require('../../engine/engineeringMission/leasePolicy');

const NOW = Date.parse('2026-09-24T12:00:00.000Z');

function row(overrides = {}) {
  return {
    lease_token: 'token-a',
    lease_fence: 3,
    lease_worker_instance_id: 'worker-a',
    lease_worker_type: 'COMPILER',
    lease_host: 'host-a',
    lease_acquired_at: new Date(NOW - 60_000).toISOString(),
    lease_expires_at: new Date(NOW + 60_000).toISOString(),
    lease_heartbeat_at: new Date(NOW - 5_000).toISOString(),
    ...overrides,
  };
}

describe('leasePolicy — estado do lease', () => {
  test('linha sem token é FREE (nunca "ativo por omissão")', () => {
    expect(lease.resolveLeaseState(lease.normalizeLease({}), NOW)).toBe(lease.LEASE_STATES.FREE);
    expect(lease.resolveLeaseState(null, NOW)).toBe(lease.LEASE_STATES.FREE);
    expect(lease.isLeaseActive(lease.normalizeLease({ lease_token: 't', lease_expires_at: null }), NOW)).toBe(false);
  });

  test('lease com validade futura é ACTIVE e com validade passada é EXPIRED', () => {
    expect(lease.resolveLeaseState(lease.normalizeLease(row()), NOW)).toBe(lease.LEASE_STATES.ACTIVE);
    const expired = row({ lease_expires_at: new Date(NOW - 1).toISOString() });
    expect(lease.resolveLeaseState(lease.normalizeLease(expired), NOW)).toBe(lease.LEASE_STATES.EXPIRED);
    expect(lease.shouldTakeOver(lease.normalizeLease(expired), NOW)).toBe(true);
  });

  test('expiração exatamente no instante atual NÃO é ativa (borda fail-closed)', () => {
    const edge = row({ lease_expires_at: new Date(NOW).toISOString() });
    expect(lease.isLeaseActive(lease.normalizeLease(edge), NOW)).toBe(false);
  });
});

describe('leasePolicy — aquisição e takeover', () => {
  test('outro worker NÃO assume lease ativo (fail-closed, independente de PID)', () => {
    const current = lease.normalizeLease(row());
    expect(lease.canAcquire(current, NOW, { workerInstanceId: 'worker-b' })).toBe(false);
    expect(lease.canAcquire(current, NOW, { workerInstanceId: 'worker-a' })).toBe(true);
  });

  test('lease expirado é reassumível por qualquer worker', () => {
    const current = lease.normalizeLease(row({ lease_expires_at: new Date(NOW - 1).toISOString() }));
    expect(lease.canAcquire(current, NOW, { workerInstanceId: 'worker-b' })).toBe(true);
  });

  test('fence é monotônico e nunca reaproveita valor', () => {
    expect(lease.nextFence(lease.normalizeLease(row({ lease_fence: 7 })))).toBe(8);
    expect(lease.nextFence(null)).toBe(1);
    // Duas aquisições consecutivas SEMPRE avançam, mesmo partindo do mesmo estado.
    let current = lease.normalizeLease(row({ lease_fence: 0 }));
    for (let i = 1; i <= 5; i += 1) {
      const fence = lease.nextFence(current);
      expect(fence).toBe(i);
      current = lease.normalizeLease(row({ lease_fence: fence }));
    }
  });

  test('renovação nunca encurta validade em curso', () => {
    const currentExpiry = NOW + 120_000;
    expect(lease.computeExpiry(NOW, 30_000, currentExpiry)).toBe(currentExpiry);
    expect(lease.computeExpiry(NOW, 300_000, currentExpiry)).toBe(NOW + 300_000);
    // TTL absurdo cai no default em vez de criar lease eterno.
    expect(lease.computeExpiry(NOW, 1, null)).toBe(NOW + lease.DEFAULT_LEASE_TTL_MS);
  });

  test('lease perto de vencer pede heartbeat', () => {
    const soon = lease.normalizeLease(row({ lease_expires_at: new Date(NOW + 10_000).toISOString() }));
    expect(lease.isLeaseExpiringSoon(soon, NOW, 60_000)).toBe(true);
    const fresh = lease.normalizeLease(row({ lease_expires_at: new Date(NOW + 300_000).toISOString() }));
    expect(lease.isLeaseExpiringSoon(fresh, NOW, 60_000)).toBe(false);
  });
});

describe('leasePolicy — fencing de escrita (§32)', () => {
  test('dono vigente escreve', () => {
    const current = lease.normalizeLease(row());
    const result = lease.assertWriterAuthorized({ lease: current, nowMs: NOW, leaseToken: 'token-a', fence: 3 });
    expect(result.authorized).toBe(true);
  });

  test('worker ANTIGO (token antigo) é recusado com MISSION_STALE_WORKER_WRITE', () => {
    const current = lease.normalizeLease(row({ lease_token: 'token-novo', lease_fence: 9 }));
    const result = lease.assertWriterAuthorized({ lease: current, nowMs: NOW, leaseToken: 'token-antigo', fence: 4 });
    expect(result.authorized).toBe(false);
    expect(result.code).toBe('MISSION_STALE_WORKER_WRITE');
  });

  test('mesmo token com fence antigo é recusado (takeover aconteceu)', () => {
    const current = lease.normalizeLease(row({ lease_token: 'token-a', lease_fence: 5 }));
    const result = lease.assertWriterAuthorized({ lease: current, nowMs: NOW, leaseToken: 'token-a', fence: 4 });
    expect(result.authorized).toBe(false);
    expect(result.code).toBe('MISSION_STALE_WORKER_WRITE');
  });

  test('lease expirado não autoriza escrita nem para o próprio dono', () => {
    const expired = lease.normalizeLease(row({ lease_expires_at: new Date(NOW - 1).toISOString() }));
    const result = lease.assertWriterAuthorized({ lease: expired, nowMs: NOW, leaseToken: 'token-a', fence: 3 });
    expect(result.authorized).toBe(false);
    expect(result.code).toBe('MISSION_LEASE_EXPIRED');
  });

  test('escrita sem lease nenhum é recusada explicitamente', () => {
    const result = lease.assertWriterAuthorized({ lease: null, nowMs: NOW, leaseToken: 'x' });
    expect(result.authorized).toBe(false);
    expect(result.code).toBe('MISSION_LEASE_NOT_HELD');
  });
});

describe('leasePolicy — núcleo puro (determinismo)', () => {
  test('nenhuma leitura de relógio ou aleatoriedade dentro do motor', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../engine/engineeringMission/leasePolicy.js'), 'utf8');
    expect(src).not.toMatch(/Date\.now\(|new Date\(/);
    expect(src).not.toMatch(/Math\.random\(/);
    expect(src).not.toMatch(/require\(['"](fs|child_process|http|https)['"]\)/);
  });
});
