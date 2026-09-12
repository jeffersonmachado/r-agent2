'use strict';

/**
 * Coerência dos dados do copiloto com a tela do aluno.
 *
 * Gap real (achado exercitando o browser em 2026-09-12): a tela publica o
 * `subjectId`, mas membership/billing/churn consultavam os serviços passando
 * esse valor como `membershipId`/`phone`. Efeito observável e INCOERENTE: a
 * pergunta "qual a situação financeira deste aluno?" respondia
 * "Eventos de cobrança: 0" enquanto a mesma tela mostrava transições reais de
 * cobrança (`delinquent → active`, `payment_confirmed`).
 *
 * Este teste fixa o contrato: cada runner resolve a MATRÍCULA a partir do
 * subjectId e usa a chave correta em cada serviço.
 */

function loadRegistry(overrides = {}) {
  jest.resetModules();

  const calls = [];
  const membership = {
    getMembershipAccessStatus: jest.fn(async (args) => {
      calls.push({ fn: 'getMembershipAccessStatus', args });
      if (overrides.accessStatus !== undefined) return overrides.accessStatus;
      return {
        allowed: true,
        effectiveBillingStatus: 'active',
        reasonCode: 'allowed',
        membership: {
          id: 'MEM-1',
          subject_id: 'STU-1',
          metadata: { phone: '+5511999990000' },
        },
      };
    }),
    getMembershipDetail: jest.fn(async (args) => {
      calls.push({ fn: 'getMembershipDetail', args });
      return overrides.detail === undefined
        ? {
          id: args.membershipId,
          status: 'ACTIVE',
          effectiveBillingStatus: 'CURRENT',
          accessAllowed: true,
          due_date: '2026-10-05',
        }
        : overrides.detail;
    }),
    getMembershipBillingHistory: jest.fn(async (args) => {
      calls.push({ fn: 'getMembershipBillingHistory', args });
      return overrides.billing === undefined
        ? { items: [{ status: 'PAID', created_at: '2026-08-30T10:00:00.000Z' }], total: 1 }
        : overrides.billing;
    }),
  };
  const attendance = {
    getAttendanceHistory: jest.fn(async (args) => {
      calls.push({ fn: 'getAttendanceHistory', args });
      return { items: [], total: 0, frequency7d: 0, frequency30d: 0 };
    }),
  };
  const churn = {
    latestFitnessSignalByPhone: jest.fn(async (args) => {
      calls.push({ fn: 'latestFitnessSignalByPhone', args });
      return overrides.churnSignal === undefined
        ? { signal_type: 'churn_risk', created_at: '2026-09-01T10:00:00.000Z' }
        : overrides.churnSignal;
    }),
  };

  jest.doMock('../../api/services/vertical/fitnessMembershipService', () => membership);
  jest.doMock('../../api/services/vertical/fitnessAttendanceService', () => attendance);
  jest.doMock('../../api/services/vertical/fitnessChurnSignalService', () => churn);

  // eslint-disable-next-line global-require
  const registry = require('../../api/services/askAi/toolRegistry');
  return { registry, calls, membership, attendance, churn };
}

const ENTITY = { type: 'FITNESS_STUDENT', id: 'STU-1' };

describe('runners do copiloto — chave correta por serviço (coerência com a tela)', () => {
  test('membershipSummary resolve a matrícula pelo subjectId', async () => {
    const { registry, calls } = loadRegistry();
    const out = await registry.RUNNERS.fitnessStudentSummary({ tenantId: 't1', entity: ENTITY });

    expect(calls[0]).toEqual({ fn: 'getMembershipAccessStatus', args: { tenantId: 't1', subjectId: 'STU-1' } });
    const detailCall = calls.find((c) => c.fn === 'getMembershipDetail');
    expect(detailCall.args).toEqual({ tenantId: 't1', membershipId: 'MEM-1' });
    expect(out.summary).toContain('ACTIVE');
    expect(out.facts.map((f) => f.key)).toContain('billingStatus');
  });

  test('billing.membershipHistory consulta a cobrança da MATRÍCULA (não do subjectId)', async () => {
    const { registry, calls } = loadRegistry();
    const out = await registry.RUNNERS.fitnessBillingSummary({ tenantId: 't1', entity: ENTITY });

    const billingCall = calls.find((c) => c.fn === 'getMembershipBillingHistory');
    expect(billingCall.args).toMatchObject({ tenantId: 't1', membershipId: 'MEM-1' });
    // O bug anterior devolvia 0 eventos mesmo havendo histórico real.
    expect(out.facts.find((f) => f.key === 'billingEvents').value).toBe(1);
    expect(out.facts.find((f) => f.key === 'latestBillingStatus').value).toBe('PAID');
  });

  test('churn usa o TELEFONE da matrícula (nunca o subjectId)', async () => {
    const { registry, calls } = loadRegistry();
    await registry.RUNNERS.fitnessChurnSignal({ tenantId: 't1', entity: ENTITY });

    const churnCall = calls.find((c) => c.fn === 'latestFitnessSignalByPhone');
    expect(churnCall.args).toEqual({ tenantId: 't1', phone: '+5511999990000' });
  });

  test('attendance continua por subjectId (já era a chave correta)', async () => {
    const { registry, calls } = loadRegistry();
    await registry.RUNNERS.fitnessAttendanceSummary({ tenantId: 't1', entity: ENTITY });

    const attendanceCall = calls.find((c) => c.fn === 'getAttendanceHistory');
    expect(attendanceCall.args).toMatchObject({ tenantId: 't1', subjectId: 'STU-1' });
  });

  test('aluno sem matrícula não inventa cobrança: found=false e sem fatos', async () => {
    const { registry } = loadRegistry({ accessStatus: { allowed: false, reasonCode: 'membership_not_found', membership: null } });
    const billing = await registry.RUNNERS.fitnessBillingSummary({ tenantId: 't1', entity: ENTITY });
    const summary = await registry.RUNNERS.fitnessStudentSummary({ tenantId: 't1', entity: ENTITY });

    expect(billing.found).toBe(false);
    expect(billing.facts).toEqual([]);
    expect(summary.found).toBe(false);
    expect(summary.facts).toEqual([]);
  });

  test('aluno sem telefone não consulta churn (não busca por id)', async () => {
    const { registry, calls } = loadRegistry({
      accessStatus: {
        allowed: true,
        membership: { id: 'MEM-1', subject_id: 'STU-1', metadata: {} },
      },
    });
    const out = await registry.RUNNERS.fitnessChurnSignal({ tenantId: 't1', entity: ENTITY });

    expect(calls.some((c) => c.fn === 'latestFitnessSignalByPhone')).toBe(false);
    expect(out.found).toBe(false);
  });
});
