'use strict';

/**
 * MATRIZ DE CENÁRIOS TIMEOUT-01..25 — arquitetura de timeouts (SLOW != STUCK != DEAD).
 *
 * Cada teste nomeia o cenário exigido pela missão de hardening. Os cenários que
 * dependem de processo real / banco real são provados ponta a ponta por
 * `npm run verify:timeout-architecture-e2e` (evidência em
 * `reports/timeout-architecture-evidence.json`); aqui ficam os que são
 * decidíveis no núcleo puro, com o mapeamento explícito do ID.
 */

const ed = require('../../engine/shared/executionDeadline');
const progress = require('../../engine/engineeringMission/progressPolicy');
const lease = require('../../engine/engineeringMission/leasePolicy');
const meshLease = require('../../qa-mesh/meshLease');

const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

describe('TIMEOUT-01/02 provider expira e a MISSÃO continua', () => {
  test('TIMEOUT-01: expiração de provider vira RETRY_THEN_FALLBACK — nunca kill', () => {
    const rec = ed.buildExpiryRecord({
      missionId: 'm1', taskId: 't1', phase: 'IMPLEMENTING', operation: 'provider_call',
      provider: 'anthropic', model: 'claude', startedAtMs: NOW - 120000, deadlineAtMs: NOW, nowMs: NOW,
      retryCount: 1, category: ed.EXPIRY_CATEGORIES.PROVIDER_TIMEOUT,
    });
    expect(rec.category).toBe('PROVIDER_TIMEOUT');
    expect(rec.onExpiry).toBe('RETRY_THEN_FALLBACK');
    expect(rec.killsMission).toBe(false);
    expect(rec.killsWorker).toBe(false);
    expect(rec.elapsedMs).toBe(120000);
  });

  test('TIMEOUT-02: o registry manda retry com fallback após esgotar tentativas', () => {
    const policy = ed.resolveTimeoutPolicy('PROVIDER_REQUEST');
    expect(policy.category).toBe('PROVIDER_TIMEOUT');
    expect(policy.retryable).toBe(true);
    expect(policy.retry.maxAttempts).toBe(3);
    expect(policy.fallback.enabled).toBe(true);
    expect(policy.fallback.onExhausted).toBe('PROVIDER_EXHAUSTED');
  });

  test('esgotar o provider é BLOCKED/REPLAN, não crash', () => {
    const rec = ed.buildExpiryRecord({
      startedAtMs: NOW - 1000, deadlineAtMs: NOW, nowMs: NOW,
      category: ed.EXPIRY_CATEGORIES.PROVIDER_EXHAUSTED,
    });
    expect(rec.onExpiry).toBe('REPLAN_OR_BLOCKED');
    expect(rec.killsMission).toBe(false);
  });
});

describe('TIMEOUT-03 retry storm / circuit breaker', () => {
  test('backoff cresce exponencialmente e é limitado pelo teto', () => {
    const b1 = ed.computeBackoffMs({ attempt: 1, baseMs: 1000, random: () => 0.5 });
    const b3 = ed.computeBackoffMs({ attempt: 3, baseMs: 1000, random: () => 0.5 });
    const b20 = ed.computeBackoffMs({ attempt: 20, baseMs: 1000, maxMs: 60000, random: () => 0.5 });
    expect(b3).toBeGreaterThan(b1);
    expect(b20).toBeLessThanOrEqual(60000);
  });

  test('jitter desloca o valor (evita sincronia de workers)', () => {
    const low = ed.computeBackoffMs({ attempt: 3, random: () => 0 });
    const high = ed.computeBackoffMs({ attempt: 3, random: () => 1 });
    expect(high).toBeGreaterThan(low);
  });

  test('auth/invalid input/política NÃO são retentáveis', () => {
    for (const message of ['AUTH_FAILURE', 'invalid_input: campo X', 'POLICY_VIOLATION', 'CONTEXT_LENGTH_EXCEEDED']) {
      const c = ed.classifyOperationError(new Error(message));
      expect(c.retryable).toBe(false);
    }
  });
});

describe('TIMEOUT-04/05/06/07/08 lease: posse por heartbeat, não por tempo', () => {
  const base = { token: 'tok', workerInstanceId: 'w1', fence: 7, acquiredAt: NOW - 60000, expiresAt: NOW + 60000, heartbeatAt: NOW };

  test('TIMEOUT-04: lease ATIVO dentro da validade não é roubável', () => {
    const l = lease.normalizeLease({ lease_token: 'tok', lease_worker_instance_id: 'w1', lease_fence: 7, lease_expires_at: iso(NOW + 60000) });
    expect(lease.resolveLeaseState(l, NOW)).toBe(lease.LEASE_STATES.ACTIVE);
    expect(lease.canAcquire(l, NOW, { workerInstanceId: 'w2' })).toBe(false);
  });

  test('TIMEOUT-05/06: ultrapassar qualquer limite de idade NÃO concede posse', () => {
    // Lease válido por 60s: mesmo que a missão tenha horas de vida, quem manda é a validade.
    const l = lease.normalizeLease({ lease_token: 'tok', lease_worker_instance_id: 'w1', lease_fence: 7, lease_expires_at: iso(NOW + 1) });
    expect(lease.canAcquire(l, NOW, { workerInstanceId: 'w2' })).toBe(false);
    expect(lease.shouldTakeOver(l, NOW)).toBe(false);
  });

  test('TIMEOUT-07: sem heartbeat a validade vence e o takeover é permitido', () => {
    const l = lease.normalizeLease({ lease_token: 'tok', lease_worker_instance_id: 'w1', lease_fence: 7, lease_expires_at: iso(NOW - 1000) });
    expect(lease.resolveLeaseState(l, NOW)).toBe(lease.LEASE_STATES.EXPIRED);
    expect(lease.shouldTakeOver(l, NOW)).toBe(true);
    expect(lease.canAcquire(l, NOW, { workerInstanceId: 'w2' })).toBe(true);
  });

  test('TIMEOUT-08: fence é monotônico e o worker antigo é recusado', () => {
    const active = lease.normalizeLease({ lease_token: 'novo', lease_worker_instance_id: 'w2', lease_fence: 8, lease_expires_at: iso(NOW + 60000) });
    expect(lease.nextFence({ fence: 7 })).toBe(8);
    expect(lease.assertWriterAuthorized({ lease: active, nowMs: NOW, leaseToken: 'antigo', fence: 7 }).code)
      .toBe('MISSION_STALE_WORKER_WRITE');
    expect(lease.assertWriterAuthorized({ lease: active, nowMs: NOW, leaseToken: 'novo', fence: 8 }).authorized).toBe(true);
  });

  test('TIMEOUT-07/08 (mesh): PID vivo com heartbeat velho NÃO mantém a posse', () => {
    const lock = { instanceId: 'mesh-A', pid: 999999, startedAt: iso(NOW - 10 * 60 * 1000), heartbeatAt: iso(NOW - 10 * 60 * 1000) };
    const d = meshLease.decideMeshLease(lock, { nowMs: NOW, pidAlive: true });
    expect(d.running).toBe(false);
    expect(d.takeoverAllowed).toBe(true);
    expect(d.reason).toBe('lease_expired_pid_recycled');
  });
});

describe('TIMEOUT-09/10/11 progresso: vivo ≠ avançando', () => {
  test('TIMEOUT-09: regressão longa com progresso continua PROGRESSING', () => {
    const rec = { lastMeaningfulProgressAt: iso(NOW - 40 * 60 * 1000) };
    const out = progress.evaluateProgress(rec, { nowMs: NOW - 39 * 60 * 1000, phase: 'REGRESSION' });
    expect(out.state).toBe(progress.PROGRESS_STATES.PROGRESSING);
  });

  test('TIMEOUT-10: vivo sem progresso → NO_PROGRESS (não LEASE_EXPIRED)', () => {
    const rec = { lastMeaningfulProgressAt: iso(NOW - 31 * 60 * 1000) };
    const out = progress.evaluateProgress(rec, { nowMs: NOW, phase: 'TESTING', heartbeatAgeMs: 1000 });
    expect(out.state).toBe(progress.PROGRESS_STATES.NO_PROGRESS);
    expect(out.livenessFresh).toBe(true);
  });

  test('TIMEOUT-11: NO_PROGRESS não mata — só diagnostica', () => {
    const rec = { lastMeaningfulProgressAt: iso(NOW - 60 * 60 * 1000) };
    const out = progress.evaluateProgress(rec, { nowMs: NOW, phase: 'TESTING' });
    expect(out.diagnosis.classifyBeforeActing).toBe(true);
    expect(out.actions).not.toContain('kill');
    expect(out.actions).not.toContain('fail_mission');
  });
});

describe('TIMEOUT-12/13 comando: só o CHILD morre', () => {
  test('TIMEOUT-12: o plano termina o child em 4 passos, começando por cancelamento cooperativo', () => {
    const plan = ed.buildChildTerminationPlan({ gracePeriodMs: 5000 });
    expect(plan.map((s) => s.action)).toEqual(['request_cancel', 'sigterm', 'wait_grace', 'sigkill']);
    expect(plan[0].signal).toBeNull(); // nunca começa por SIGKILL
    expect(plan[3].signal).toBe('SIGKILL');
  });

  test('TIMEOUT-13: expiração de comando não mata worker nem missão', () => {
    const rec = ed.buildExpiryRecord({
      startedAtMs: NOW - 600000, deadlineAtMs: NOW, nowMs: NOW,
      category: ed.EXPIRY_CATEGORIES.COMMAND_TIMEOUT,
    });
    expect(rec.onExpiry).toBe('TERMINATE_CHILD_THEN_REPLAN');
    expect(rec.killsWorker).toBe(false);
    expect(rec.killsMission).toBe(false);
  });
});

describe('TIMEOUT-14/15 banco: classificado e isolado', () => {
  test('TIMEOUT-14: timeout de query é DB_TIMEOUT retentável, sem matar worker', () => {
    const c = ed.classifyOperationError(Object.assign(new Error('query timeout'), { name: 'SequelizeTimeoutError' }));
    expect(c.category).toBe('DB_TIMEOUT');
    expect(c.retryable).toBe(true);
    const rec = ed.buildExpiryRecord({ startedAtMs: NOW - 15000, deadlineAtMs: NOW, nowMs: NOW, category: c.category });
    expect(rec.killsWorker).toBe(false);
    expect(rec.onExpiry).toBe('CANCEL_OPERATION_THEN_BLOCKED_INFRA');
  });

  test('TIMEOUT-15: indisponibilidade vira DB_CONNECTION → BLOCKED_INFRA (fail-closed, não crash)', () => {
    const c = ed.classifyOperationError(Object.assign(new Error('connection acquire timeout'), { name: 'SequelizeConnectionAcquireTimeoutError' }));
    expect(c.category).toBe('DB_CONNECTION');
    const rec = ed.buildExpiryRecord({ startedAtMs: NOW - 30000, deadlineAtMs: NOW, nowMs: NOW, category: c.category });
    expect(rec.onExpiry).toBe('BLOCKED_INFRA');
  });
});

describe('TIMEOUT-16 HTTP é local à chamada', () => {
  test('TIMEOUT-16: HTTP_TIMEOUT apenas cancela a requisição', () => {
    const c = ed.classifyOperationError(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
    expect(c.category).toBe('HTTP_TIMEOUT');
    const rec = ed.buildExpiryRecord({ startedAtMs: NOW - 30000, deadlineAtMs: NOW, nowMs: NOW, category: c.category });
    expect(rec.onExpiry).toBe('CANCEL_REQUEST');
    expect(rec.killsMission).toBe(false);
  });
});

describe('TIMEOUT-17/18 retry com limites', () => {
  test('TIMEOUT-17: maxAttempts vem do registry e é finito', () => {
    const policy = ed.resolveTimeoutPolicy('DATABASE_QUERY');
    expect(policy.retry.maxAttempts).toBe(2);
    expect(policy.retryable).toBe(true);
  });

  test('TIMEOUT-18: storm é contido — backoff tem teto e jitter', () => {
    const policy = ed.resolveTimeoutPolicy('RETRY_BACKOFF');
    expect(policy.resolved).toBeGreaterThan(0);
    const registry = ed.loadPolicyRegistry();
    expect(registry.policies.RETRY_BACKOFF.stormProtection.circuitBreaker).toBe(true);
    expect(registry.policies.RETRY_BACKOFF.stormProtection.openAfterConsecutiveTimeouts).toBeGreaterThan(0);
    expect(ed.computeBackoffMs({ attempt: 50, maxMs: 60000, random: () => 0.5 })).toBeLessThanOrEqual(60000);
  });
});

describe('TIMEOUT-19/20/21 deadlines hierárquicas', () => {
  test('TIMEOUT-19: sem deadline de usuário a missão não tem wall-clock', () => {
    const registry = ed.loadPolicyRegistry();
    expect(registry.missionPolicy.wallClockMissionTimeout).toBeNull();
    expect(registry.missionPolicy.prohibited).toContain('MISSION_TIMEOUT');
  });

  test('TIMEOUT-20: deadline explícito de usuário é a ÚNICA categoria que encerra a missão', () => {
    const rec = ed.buildExpiryRecord({
      startedAtMs: NOW - 1800000, deadlineAtMs: NOW, nowMs: NOW,
      category: ed.EXPIRY_CATEGORIES.USER_DEADLINE_EXCEEDED,
    });
    expect(rec.killsMission).toBe(true);
    expect(rec.onExpiry).toBe('STOP_MISSION');
  });

  test('TIMEOUT-21: filho é CLAMPADO pelo orçamento restante do pai', () => {
    const out = ed.computeEffectiveDeadline({ nowMs: NOW, policyMs: 20 * 60 * 1000, parentDeadlineAtMs: NOW + 5000 });
    expect(out.clampedByParent).toBe(true);
    expect(out.deadlineAtMs).toBe(NOW + 5000);
    expect(out.budgetMs).toBe(5000);
  });

  test('filho NÃO inicia quando o orçamento do pai é insuficiente', () => {
    const out = ed.computeEffectiveDeadline({ nowMs: NOW, policyMs: 600000, parentDeadlineAtMs: NOW + 100 });
    expect(out.usable).toBe(false);
    expect(out.reason).toBe('parent_budget_below_min_useful');
  });
});

describe('TIMEOUT-24/25 telemetria e classificação nunca genérica', () => {
  test('TIMEOUT-24: registro de expiração tem todos os campos exigidos', () => {
    const rec = ed.buildExpiryRecord({
      missionId: 'm', taskId: 't', phase: 'TESTING', operation: 'provider_call',
      provider: 'deepseek', model: 'v3', startedAtMs: NOW - 1000, deadlineAtMs: NOW, nowMs: NOW,
      lastHeartbeatAtMs: NOW - 100, lastProgressAtMs: NOW - 500, retryCount: 2,
      previousErrors: ['PROVIDER_TIMEOUT', 'NETWORK_ERROR'], leaseOwner: 'w1', fence: 4,
      diagnostics: { attempt: 3 }, category: ed.EXPIRY_CATEGORIES.PROVIDER_TIMEOUT,
    });
    for (const field of ['missionId', 'taskId', 'phase', 'operation', 'provider', 'model',
      'startedAt', 'deadlineAt', 'elapsedMs', 'lastHeartbeatAt', 'lastProgressAt',
      'retryCount', 'previousErrors', 'leaseOwner', 'fence', 'diagnostics', 'category', 'onExpiry']) {
      expect(rec[field]).toBeDefined();
    }
    expect(rec.previousErrors).toHaveLength(2);
  });

  test('TIMEOUT-25: categoria CONHECIDA nunca cai em genérico', () => {
    const cases = [
      [Object.assign(new Error('x'), { name: 'SequelizeTimeoutError' }), 'DB_TIMEOUT'],
      [Object.assign(new Error('x'), { name: 'SequelizeConnectionAcquireTimeoutError' }), 'DB_CONNECTION'],
      [new Error('deadlock detected'), 'DB_DEADLOCK'],
      [new Error('ai_timeout ao chamar provider'), 'PROVIDER_TIMEOUT'],
      [new Error('COMMAND_TIMEOUT: npm test'), 'COMMAND_TIMEOUT'],
      [new Error('TASK_LEASE_EXPIRED'), 'LEASE_EXPIRED'],
      [new Error('NO_PROGRESS detectado'), 'NO_PROGRESS'],
    ];
    for (const [err, expected] of cases) {
      expect(ed.classifyOperationError(err).category).toBe(expected);
    }
    // Todo categoria tem uma ação definida — nada fica órfão em UNKNOWN.
    for (const category of Object.values(ed.EXPIRY_CATEGORIES)) {
      expect(Object.keys(ed.EXPIRY_ON_ACTION)).toContain(category);
    }
  });
});

describe('registry: coerência da hierarquia (política absurda é recusada)', () => {
  test('heartbeat deve ser menor que a lease (senão a posse nunca renova a tempo)', () => {
    const registry = ed.loadPolicyRegistry();
    const leasePolicyCfg = registry.policies.LEASE;
    const hb = registry.policies.HEARTBEAT;
    expect(hb.default).toBeLessThan(leasePolicyCfg.default / 2);
  });

  test('clamp de [min,max] é aplicado sobre env/override', () => {
    const tooBig = ed.resolveTimeoutPolicy('LEASE', { envValue: 999999999 });
    expect(tooBig.resolved).toBe(tooBig.max);
    expect(tooBig.clamp.reason).toBe('above_max');
    const tooSmall = ed.resolveTimeoutPolicy('LEASE', { envValue: 1 });
    expect(tooSmall.resolved).toBe(tooSmall.min);
    expect(tooSmall.clamp.reason).toBe('below_min');
  });

  test('todas as políticas declaram ação no disparo (nenhuma ambígua)', () => {
    const registry = ed.loadPolicyRegistry();
    for (const [name, p] of Object.entries(registry.policies)) {
      expect(`${name}:${Boolean(p.onExpiry)}`).toBe(`${name}:true`);
      expect(`${name}:${Boolean(p.category)}`).toBe(`${name}:true`);
    }
  });
});
