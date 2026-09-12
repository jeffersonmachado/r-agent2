'use strict';

/**
 * Regressão do incidente 2026-09-11 (saturação do Postgres → login em timeout).
 *
 * Causa: cada `vertical_*_journey_tick` percorria centenas de assuntos com
 * várias escritas/eventos cada (fitness: até 500 memberships × scoring ML +
 * insert + appendEvent) e estourava o timeout de 30s. O job ia para retry, o
 * handler abandonado continuava rodando e o tick nunca avançava — a fila
 * acumulou ~280k pendências.
 *
 * Prova aqui: o tick tem ORÇAMENTO de tempo, sempre conclui, trunca o restante
 * para o próximo tick e nunca dispara a etapa mais cara (retreino ML) quando o
 * orçamento já estourou.
 */

function loadHandler({ memberships = [], computeEngagementSignal = null, freshSignals = [] } = {}) {
  jest.resetModules();

  jest.doMock('../../api/db/sequelize', () => ({ getSequelize: () => ({}) }));
  jest.doMock('../../api/db/models', () => ({
    VerticalJourneyEvent: () => ({ findOne: jest.fn(async () => null) }),
    VerticalAttendance: () => ({ findAll: jest.fn(async () => []) }),
    AccessMembership: () => ({ findAll: jest.fn(async () => memberships) }),
    VerticalEngagementSignal: () => ({
      findAll: jest.fn(async () => freshSignals.map((sid) => ({ subject_id: sid }))),
    }),
  }));
  jest.doMock('../../api/services/vertical/churnModelService', () => ({
    getActiveModel: jest.fn(async () => null),
    trainFitnessChurnModel: jest.fn(async () => ({ version: 1, metrics: {} })),
  }));
  jest.doMock('../../api/services/vertical/fitnessAttendanceService', () => ({
    closeStaleOpenAttendances: jest.fn(async () => ({ closed: 0 })),
  }));
  if (computeEngagementSignal) {
    jest.doMock('../../api/services/vertical/engagementEngine', () => ({ computeEngagementSignal }));
  }

  // eslint-disable-next-line global-require
  const handler = require('../../api/services/vertical/verticalJourneyJobHandler');
  const churn = require('../../api/services/vertical/churnModelService');
  return { handler, churn };
}

function buildMemberships(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `m-${i}`,
    subject_id: `s-${i}`,
    billing_status: 'active',
    toJSON() { return { id: this.id, subject_id: this.subject_id, billing_status: this.billing_status }; },
  }));
}

describe('createTickBudget', () => {
  test('expira depois do intervalo informado', async () => {
    const { handler } = loadHandler();
    const budget = handler.createTickBudget(10);

    expect(budget.expired()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(budget.expired()).toBe(true);
    expect(budget.elapsedMs()).toBeGreaterThanOrEqual(10);
  });

  test('default fica abaixo do timeout do job (VERTICAL_JOB_TIMEOUT_MS)', () => {
    const { handler } = loadHandler();
    expect(handler.TICK_BUDGET_MS).toBeGreaterThan(0);
    expect(handler.TICK_BUDGET_MS).toBeLessThan(30000);
  });
});

describe('handleFitnessInactivityScan — truncamento por orçamento', () => {
  test('processa apenas o que cabe no orçamento e devolve o resto ao próximo tick', async () => {
    let computed = 0;
    const memberships = buildMemberships(50);
    const { handler } = loadHandler({
      memberships,
      computeEngagementSignal: jest.fn(async () => {
        computed += 1;
        // Cada sinal é caro (scoring ML + writes): simula o custo real.
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { signal_type: 'healthy' };
      }),
    });

    // Orçamento curto: cabem ~10 sinais, não 50.
    await handler.handleFitnessInactivityScan({ tenantId: 'tenant-a' }, handler.createTickBudget(150));

    expect(computed).toBeGreaterThan(0);
    expect(computed).toBeLessThan(memberships.length);
  });

  test('liveness: mesmo com orçamento já estourado o primeiro item é processado', async () => {
    let computed = 0;
    const { handler } = loadHandler({
      memberships: buildMemberships(10),
      computeEngagementSignal: jest.fn(async () => {
        computed += 1;
        return { signal_type: 'healthy' };
      }),
    });

    // Orçamento de 0ms: expira imediatamente (mais agressivo que o incidente).
    await handler.handleFitnessInactivityScan({ tenantId: 'tenant-a' }, handler.createTickBudget(1));
    expect(computed).toBeGreaterThanOrEqual(1);
  });

  test('sem orçamento explícito usa o default e conclui a varredura pequena', async () => {
    const computeEngagementSignal = jest.fn(async () => ({ signal_type: 'healthy' }));
    const { handler } = loadHandler({ memberships: buildMemberships(3), computeEngagementSignal });

    await handler.handleFitnessInactivityScan({ tenantId: 'tenant-a' });
    expect(computeEngagementSignal).toHaveBeenCalledTimes(3);
  });
});

describe('handleFitnessInactivityScan — varredura incremental por TTL', () => {
  test('assunto com sinal fresco NÃO é recalculado (convergência da carga)', async () => {
    const computeEngagementSignal = jest.fn(async () => ({ signal_type: 'healthy' }));
    const memberships = buildMemberships(5);
    // 3 dos 5 assuntos já têm sinal dentro do TTL.
    const { handler } = loadHandler({
      memberships,
      computeEngagementSignal,
      freshSignals: ['s-0', 's-1', 's-2'],
    });

    await handler.handleFitnessInactivityScan({ tenantId: 'tenant-a' });

    expect(computeEngagementSignal).toHaveBeenCalledTimes(2);
    const chamados = computeEngagementSignal.mock.calls.map((c) => c[0].subjectId);
    expect(chamados).toEqual(['s-3', 's-4']);
  });

  test('sem sinais prévios processa todos os assuntos', async () => {
    const computeEngagementSignal = jest.fn(async () => ({ signal_type: 'healthy' }));
    const { handler } = loadHandler({ memberships: buildMemberships(4), computeEngagementSignal });

    await handler.handleFitnessInactivityScan({ tenantId: 'tenant-a' });
    expect(computeEngagementSignal).toHaveBeenCalledTimes(4);
  });
});

describe('handleFitnessJourneyTick — tick sempre conclui', () => {
  test('orçamento estourado ⇒ retreino ML (etapa mais cara) é adiado, sem throw', async () => {
    const { handler, churn } = loadHandler({
      memberships: buildMemberships(20),
      computeEngagementSignal: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { signal_type: 'healthy' };
      }),
    });

    const budget = handler.createTickBudget(30);
    await handler.handleFitnessJourneyTick({ payload: { tenantId: 'tenant-a' } }, budget);

    expect(budget.expired()).toBe(true);
    expect(churn.trainFitnessChurnModel).not.toHaveBeenCalled();
  });

  test('orçamento folgado ⇒ tick completa todas as etapas incluindo retreino', async () => {
    const { handler, churn } = loadHandler({
      memberships: buildMemberships(2),
      computeEngagementSignal: jest.fn(async () => ({ signal_type: 'healthy' })),
    });

    await handler.handleFitnessJourneyTick({ payload: { tenantId: 'tenant-a' } }, handler.createTickBudget(5000));
    expect(churn.trainFitnessChurnModel).toHaveBeenCalledTimes(1);
  });
});
