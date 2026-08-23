'use strict';

/**
 * Testes do núcleo determinístico de resiliência do AI control plane
 * (`engine/aiControlPlaneResilience.js`).
 *
 * Cobrem as propriedades obrigatórias do ADENDO: fail-closed, circuit breaker
 * com probation, classificação de retry, buffer limitado/priorizado,
 * integridade/staleness de snapshot, agregação de status e safe mode.
 */

const {
  COMPONENT_CRITICALITY,
  COMPONENT_STATUS,
  SNAPSHOT_STALENESS,
  createCircuitBreaker,
  classifyProviderError,
  createBoundedEventBuffer,
  validateSnapshotIntegrity,
  classifySnapshotStaleness,
  aggregateControlPlaneStatus,
  canRunCriticalOperation,
  evaluateSafeModeEntry,
  evaluateSafeModeExit,
  evaluateBudgetRouting,
  resolveActiveRelease,
  evaluatePolicyContinuation,
  dedupeEventsByKey,
  replayEventsWithIdempotency,
  BUDGET_ROUTING,
  RELEASE_ROUTING,
  POLICY_ROUTING,
  EVENT_PRIORITY,
} = require('../../engine/aiControlPlaneResilience');

describe('createCircuitBreaker', () => {
  test('abre após N falhas consecutivas e bloqueia chamadas (fail closed)', () => {
    const cb = createCircuitBreaker({ failureThreshold: 3, resetMs: 10000 });
    expect(cb.acquire()).toBe(true);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(false);
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);
    // Circuito aberto dentro da janela: acquire nega sem ir à rede.
    expect(cb.acquire()).toBe(false);
    expect(cb.getState().state).toBe('open');
  });

  test('após reset, permite probe único (half-open) e reabre se probe falhar', () => {
    let t = 0;
    const cb = createCircuitBreaker({ failureThreshold: 1, resetMs: 1000, now: () => t });
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);

    t = 1500; // passou a janela
    expect(cb.acquire()).toBe(true);
    expect(cb.getState().state).toBe('half-open');
    // probe falha → reabre
    cb.recordFailure();
    expect(cb.getState().state).toBe('open');
  });

  test('só fecha após N probes de sucesso consecutivos (recovery probation)', () => {
    const cb = createCircuitBreaker({ failureThreshold: 1, resetMs: 1000, recoveryProbeSuccessThreshold: 2 });
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);

    // Força half-open via acquire após reset (usa time real; ok p/ teste curto).
    // Simula o fluxo: reseta o estado abrindo o slot de probe.
    // Como não injetamos now, chamamos acquire repetidamente até abrir.
    // Para determinismo, refazemos o breaker com now controlado.
    let t = 0;
    const cb2 = createCircuitBreaker({ failureThreshold: 1, resetMs: 1000, recoveryProbeSuccessThreshold: 2, now: () => t });
    cb2.recordFailure();
    t = 1500;
    expect(cb2.acquire()).toBe(true); // half-open
    cb2.recordSuccess();
    expect(cb2.getState().state).toBe('half-open'); // 1/2 probes, ainda probation
    expect(cb2.acquire()).toBe(true);
    cb2.recordSuccess();
    expect(cb2.getState().state).toBe('closed'); // 2/2 → fecha
  });

  test('sucesso com circuito fechado reseta contador de falhas', () => {
    const cb = createCircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(false);
  });
});

describe('classifyProviderError', () => {
  test.each([
    [{ status: 401 }, 'AUTH', false],
    [{ status: 403 }, 'POLICY_DENIAL', false],
    [{ status: 404 }, 'RETIRED_MODEL', false],
    [{ status: 402 }, 'BUDGET_BLOCK', false],
    [{ status: 429 }, 'RATE_LIMIT', true],
    [{ status: 408 }, 'TIMEOUT', true],
    [{ status: 500 }, 'TRANSIENT', true],
    [{ status: 502 }, 'TRANSIENT', true],
    [{ code: 'ai_timeout' }, 'TIMEOUT', true],
    [{ code: 'budget_blocked' }, 'BUDGET_BLOCK', false],
    [{ code: 'policy_denied' }, 'POLICY_DENIAL', false],
    [{ code: 'retired_model' }, 'RETIRED_MODEL', false],
  ])('classifica %j como %s (retryable=%s)', (err, category, retryable) => {
    expect(classifyProviderError(err)).toEqual({ category, retryable });
  });

  test('classifica por mensagem: budget e modelo aposentado nunca retry', () => {
    expect(classifyProviderError({ message: 'insufficient_quota exceeded' })).toEqual({ category: 'BUDGET_BLOCK', retryable: false });
    expect(classifyProviderError({ message: 'model is deprecated' })).toEqual({ category: 'RETIRED_MODEL', retryable: false });
    expect(classifyProviderError({ message: 'rate limit exceeded' })).toEqual({ category: 'RATE_LIMIT', retryable: true });
    expect(classifyProviderError({ message: 'connection timed out' })).toEqual({ category: 'TIMEOUT', retryable: true });
  });

  test('erro desconhecido é conservador: não retry', () => {
    expect(classifyProviderError({ message: 'algo totalmente novo' })).toEqual({ category: 'UNKNOWN', retryable: false });
    expect(classifyProviderError(null)).toEqual({ category: 'UNKNOWN', retryable: false });
  });
});

describe('createBoundedEventBuffer', () => {
  test('aceita eventos abaixo do limite e drena em ordem de prioridade', () => {
    const buf = createBoundedEventBuffer({ maxEntries: 5 });
    buf.push({ id: 'low' }, EVENT_PRIORITY.TELEMETRY);
    buf.push({ id: 'crit' }, EVENT_PRIORITY.POLICY_VIOLATION);
    buf.push({ id: 'mid' }, EVENT_PRIORITY.ROUTING_DECISION);
    const drained = buf.drain();
    expect(drained.map((e) => e.id)).toEqual(['crit', 'mid', 'low']);
  });

  test('nunca cresce além do limite: evicta o de menor prioridade', () => {
    const buf = createBoundedEventBuffer({ maxEntries: 2 });
    buf.push({ id: 'a' }, EVENT_PRIORITY.TELEMETRY);
    buf.push({ id: 'b' }, EVENT_PRIORITY.TELEMETRY);
    const res = buf.push({ id: 'c' }, EVENT_PRIORITY.POLICY_VIOLATION);
    expect(res.accepted).toBe(true);
    expect(buf.getState().size).toBe(2);
    expect(buf.drain().map((e) => e.id)).toContain('c');
  });

  test('evento crítico não é evictado por telemetria quando cheio', () => {
    const buf = createBoundedEventBuffer({ maxEntries: 1 });
    buf.push({ id: 'crit' }, EVENT_PRIORITY.POLICY_VIOLATION);
    const res = buf.push({ id: 'tele' }, EVENT_PRIORITY.TELEMETRY);
    expect(res.accepted).toBe(false);
    expect(buf.drain().map((e) => e.id)).toEqual(['crit']);
  });

  test('descartar evento crítico incrementa droppedCritical', () => {
    const buf = createBoundedEventBuffer({ maxEntries: 1 });
    buf.push({ id: 'crit1' }, EVENT_PRIORITY.CRITICAL_AUDIT);
    const res = buf.push({ id: 'crit2' }, EVENT_PRIORITY.CRITICAL_AUDIT);
    expect(res.accepted).toBe(false);
    expect(buf.getState().droppedCritical).toBe(1);
  });
});

describe('validateSnapshotIntegrity + classifySnapshotStaleness', () => {
  const valid = {
    version: '1',
    created_at: new Date(Date.now() - 1000).toISOString(),
    hash: 'abc123',
    scope: 'MODEL_REGISTRY',
    source: 'engine/aiProviderManager',
  };

  test('aceita snapshot íntegro e rejeita corrompido', () => {
    expect(validateSnapshotIntegrity(valid).valid).toBe(true);
    expect(validateSnapshotIntegrity({ ...valid, hash: undefined }).valid).toBe(false);
    expect(validateSnapshotIntegrity({ ...valid, version: undefined }).valid).toBe(false);
    expect(validateSnapshotIntegrity({ ...valid, scope: undefined }).valid).toBe(false);
    expect(validateSnapshotIntegrity({ ...valid, source: undefined }).valid).toBe(false);
    expect(validateSnapshotIntegrity(null).valid).toBe(false);
  });

  test('classifica staleness por idade e expiração explícita', () => {
    const now = Date.now();
    const fresh = { ...valid, created_at: new Date(now - 1000).toISOString() };
    const acceptable = { ...valid, created_at: new Date(now - 10 * 60 * 1000).toISOString() };
    const unsafe = { ...valid, created_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() };

    expect(classifySnapshotStaleness(fresh, { now })).toBe(SNAPSHOT_STALENESS.FRESH);
    expect(classifySnapshotStaleness(acceptable, { now })).toBe(SNAPSHOT_STALENESS.STALE_ACCEPTABLE);
    expect(classifySnapshotStaleness(unsafe, { now })).toBe(SNAPSHOT_STALENESS.STALE_UNSAFE);
    expect(classifySnapshotStaleness(null, { now })).toBe(SNAPSHOT_STALENESS.UNKNOWN);

    // expiração explícita vence
    const expired = { ...fresh, expires_at: new Date(now - 1000).toISOString() };
    expect(classifySnapshotStaleness(expired, { now })).toBe(SNAPSHOT_STALENESS.STALE_UNSAFE);
  });
});

describe('aggregateControlPlaneStatus', () => {
  const H = (id, criticality, status) => ({ id, criticality, status });

  test('todos saudáveis → HEALTHY; degradado → DEGRADED', () => {
    expect(aggregateControlPlaneStatus([
      H('A', COMPONENT_CRITICALITY.SAFETY_CRITICAL, COMPONENT_STATUS.HEALTHY),
      H('B', COMPONENT_CRITICALITY.ECONOMIC_CRITICAL, COMPONENT_STATUS.HEALTHY),
    ])).toBe('HEALTHY');

    expect(aggregateControlPlaneStatus([
      H('A', COMPONENT_CRITICALITY.SAFETY_CRITICAL, COMPONENT_STATUS.HEALTHY),
      H('B', COMPONENT_CRITICALITY.ECONOMIC_CRITICAL, COMPONENT_STATUS.DEGRADED),
    ])).toBe('DEGRADED');
  });

  test('safety-critical BLOCKED domina → BLOCKED', () => {
    expect(aggregateControlPlaneStatus([
      H('POLICY_ENGINE', COMPONENT_CRITICALITY.SAFETY_CRITICAL, COMPONENT_STATUS.BLOCKED),
      H('MARKET', COMPONENT_CRITICALITY.ECONOMIC_CRITICAL, COMPONENT_STATUS.HEALTHY),
    ])).toBe('BLOCKED');
  });

  test('OPTIONAL BLOCKED não derruba além de DEGRADED', () => {
    expect(aggregateControlPlaneStatus([
      H('BENCHMARK', COMPONENT_CRITICALITY.OPTIONAL, COMPONENT_STATUS.BLOCKED),
      H('MODEL_REGISTRY', COMPONENT_CRITICALITY.ROUTING_CRITICAL, COMPONENT_STATUS.HEALTHY),
    ])).toBe('DEGRADED');
  });

  test('tudo UNKNOWN → UNKNOWN; safety-critical UNKNOWN não é HEALTHY', () => {
    expect(aggregateControlPlaneStatus([
      H('A', COMPONENT_CRITICALITY.SAFETY_CRITICAL, COMPONENT_STATUS.UNKNOWN),
    ])).toBe('UNKNOWN');
  });
});

describe('canRunCriticalOperation', () => {
  const H = (id, criticality, status) => ({ id, criticality, status });

  test('safety-critical BLOCKED ou UNKNOWN impede operação crítica', () => {
    expect(canRunCriticalOperation([
      H('POLICY_ENGINE', COMPONENT_CRITICALITY.SAFETY_CRITICAL, COMPONENT_STATUS.BLOCKED),
    ])).toBe(false);
    expect(canRunCriticalOperation([
      H('POLICY_ENGINE', COMPONENT_CRITICALITY.SAFETY_CRITICAL, COMPONENT_STATUS.UNKNOWN),
    ])).toBe(false);
  });

  test('MARKET_INTELLIGENCE DEGRADED não impede; healthy permite', () => {
    expect(canRunCriticalOperation([
      H('POLICY_ENGINE', COMPONENT_CRITICALITY.SAFETY_CRITICAL, COMPONENT_STATUS.HEALTHY),
      H('MARKET_INTELLIGENCE', COMPONENT_CRITICALITY.ECONOMIC_CRITICAL, COMPONENT_STATUS.DEGRADED),
    ])).toBe(true);
    expect(canRunCriticalOperation([
      H('POLICY_ENGINE', COMPONENT_CRITICALITY.SAFETY_CRITICAL, COMPONENT_STATUS.HEALTHY),
      H('DATABASE', COMPONENT_CRITICALITY.SAFETY_CRITICAL, COMPONENT_STATUS.HEALTHY),
    ])).toBe(true);
  });
});

describe('safe mode', () => {
  test('sem gatilho conhecido não entra em safe mode', () => {
    expect(evaluateSafeModeEntry([])).toBe(false);
    expect(evaluateSafeModeEntry(['NADA_CONHECIDO'])).toBe(false);
  });

  test('major provider outage e multiple failures entram em safe mode', () => {
    expect(evaluateSafeModeEntry(['MAJOR_PROVIDER_OUTAGE'])).toBe(true);
    expect(evaluateSafeModeEntry(['MULTIPLE_CONTROL_PLANE_FAILURES'])).toBe(true);
    expect(evaluateSafeModeEntry(['REGISTRY_CORRUPTION'])).toBe(true);
  });

  test('saída do safe mode exige health + consistency + policy + release', () => {
    expect(evaluateSafeModeExit({ healthRestored: true, consistencyCheckPassed: true, policyIntegrity: true, releaseIntegrity: true })).toBe(true);
    expect(evaluateSafeModeExit({ healthRestored: true, consistencyCheckPassed: true, policyIntegrity: true, releaseIntegrity: false })).toBe(false);
    expect(evaluateSafeModeExit({})).toBe(false);
  });
});

describe('evaluateBudgetRouting', () => {
  test('soft budget continua (budget status UNKNOWN/DEGRADED)', () => {
    expect(evaluateBudgetRouting({ hardBudgetActive: false, budgetManagerAvailable: false }).decision).toBe(BUDGET_ROUTING.PROCEED);
    expect(evaluateBudgetRouting({ hardBudgetActive: false, budgetManagerAvailable: true }).decision).toBe(BUDGET_ROUTING.PROCEED);
  });

  test('hard budget + manager down → FAIL CLOSED (nunca orçamento infinito)', () => {
    const out = evaluateBudgetRouting({ hardBudgetActive: true, budgetManagerAvailable: false });
    expect(out.decision).toBe(BUDGET_ROUTING.BUDGET_BLOCKED);
    expect(out.reason).toBe('budget_manager_unavailable_hard_budget');
  });

  test('hard budget + custo certo + manager ok → PROCEED', () => {
    expect(evaluateBudgetRouting({ hardBudgetActive: true, budgetManagerAvailable: true, costCertain: true }).decision).toBe(BUDGET_ROUTING.PROCEED);
  });

  test('hard budget + custo incerto → alternativa ou bloqueio (nunca assumir que cabe)', () => {
    expect(evaluateBudgetRouting({ hardBudgetActive: true, budgetManagerAvailable: true, costCertain: false, conservativeAlternativeAvailable: true }).decision).toBe(BUDGET_ROUTING.BUDGET_COST_UNCERTAIN);
    expect(evaluateBudgetRouting({ hardBudgetActive: true, budgetManagerAvailable: true, costCertain: false, conservativeAlternativeAvailable: false }).decision).toBe(BUDGET_ROUTING.BUDGET_BLOCKED);
  });
});

describe('resolveActiveRelease', () => {
  test('manager ok + release ativa conhecida → CURRENT_KNOWN_ACTIVE_RELEASE', () => {
    const out = resolveActiveRelease({ releaseManagerAvailable: true, knownActiveRelease: 'rel-123' });
    expect(out.releaseId).toBe('rel-123');
    expect(out.status).toBe(RELEASE_ROUTING.CURRENT_KNOWN_ACTIVE_RELEASE);
  });

  test('manager down → usa CURRENT_KNOWN_ACTIVE validada, NUNCA LATEST', () => {
    const out = resolveActiveRelease({ releaseManagerAvailable: false, knownActiveRelease: 'rel-123', latestRelease: 'rel-999' });
    expect(out.releaseId).toBe('rel-123');
    expect(out.status).toBe(RELEASE_ROUTING.USING_KNOWN_ACTIVE_DEGRADED);
  });

  test('release ativa indeterminável → UNKNOWN_ACTIVE_RELEASE (condição crítica)', () => {
    const out = resolveActiveRelease({ releaseManagerAvailable: true, knownActiveRelease: null, latestRelease: 'rel-999' });
    expect(out.releaseId).toBeNull();
    expect(out.status).toBe(RELEASE_ROUTING.UNKNOWN_ACTIVE_RELEASE);
    expect(out.latestReleaseIgnored).toBe(true);
  });
});

describe('evaluatePolicyContinuation', () => {
  test('policy engine disponível → POLICY_ENFORCED', () => {
    expect(evaluatePolicyContinuation({ policyEngineAvailable: true }).decision).toBe(POLICY_ROUTING.POLICY_ENFORCED);
  });

  test('policy engine down + snapshot válido/fresh/coberto + offline permitido → CONTINUE_LIMITED', () => {
    const out = evaluatePolicyContinuation({
      policyEngineAvailable: false,
      snapshotValid: true,
      snapshotFresh: true,
      scopeCoversTask: true,
      policyAllowsOffline: true,
    });
    expect(out.decision).toBe(POLICY_ROUTING.CONTINUE_LIMITED);
  });

  test.each([
    ['sem snapshot válido', { snapshotValid: false, snapshotFresh: true, scopeCoversTask: true, policyAllowsOffline: true }],
    ['snapshot stale', { snapshotValid: true, snapshotFresh: false, scopeCoversTask: true, policyAllowsOffline: true }],
    ['escopo não coberto', { snapshotValid: true, snapshotFresh: true, scopeCoversTask: false, policyAllowsOffline: true }],
    ['offline não permitido', { snapshotValid: true, snapshotFresh: true, scopeCoversTask: true, policyAllowsOffline: false }],
  ])('policy engine down + %s → GOVERNANCE_ROUTING_BLOCKED', (_name, overrides) => {
    const out = evaluatePolicyContinuation({ policyEngineAvailable: false, ...overrides });
    expect(out.decision).toBe(POLICY_ROUTING.GOVERNANCE_ROUTING_BLOCKED);
  });
});

describe('recovery idempotente', () => {
  test('dedupeEventsByKey remove duplicatas por chave', () => {
    const events = [{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }];
    expect(dedupeEventsByKey(events).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  test('replayEventsWithIdempotency não reaplica eventos já vistos', () => {
    const seen = new Set(['a']);
    const events = [{ id: 'a' }, { id: 'b' }, { id: 'a' }];
    const out = replayEventsWithIdempotency(events, { seenKeys: seen });
    expect(out.toApply.map((e) => e.id)).toEqual(['b']);
    expect(out.duplicates.map((e) => e.id)).toEqual(['a', 'a']);
    expect(out.seenKeys.has('b')).toBe(true);
  });

  test('evento sem chave não é descartado silenciosamente', () => {
    const out = replayEventsWithIdempotency([{ noId: true }]);
    expect(out.toApply).toHaveLength(1);
    expect(out.duplicates).toHaveLength(0);
  });
});
