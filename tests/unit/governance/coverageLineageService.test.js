'use strict';

const { createCoverageLineageService } = require('../../../api/services/governance/coverageLineageService');

function makeRow(data) {
  return {
    ...data,
    toJSON() {
      const { toJSON, update, ...plain } = this;
      return { ...plain };
    },
    async update(patch) {
      Object.assign(this, patch);
      return this;
    },
  };
}

function makeHarness() {
  const run = makeRow({
    run_id: 'run-1',
    tenant_id: 'tenant-a',
    source_fingerprint: 'a'.repeat(64),
    status: 'RUNNING',
  });
  const records = [];
  const evidences = [
    makeRow({ id: 'evidence-1', tenant_key: 'tenant-a' }),
    makeRow({ id: 'foreign-evidence', tenant_key: 'tenant-b' }),
  ];
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const sequelize = {
    transaction: jest.fn(async (work) => work(transaction)),
    query: jest.fn(async () => [[], null]),
  };

  const GovernanceRun = {
    sequelize,
    findOne: jest.fn(async ({ where }) => (
      run.run_id === where.run_id && run.tenant_id === where.tenant_id ? run : null
    )),
  };
  const CoverageEvidence = {
    sequelize,
    findOne: jest.fn(async (options = {}) => {
      const where = options.where || null;
      const candidates = where
        ? records.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value))
        : [...records];
      return candidates[candidates.length - 1] || null;
    }),
    findAll: jest.fn(async (options = {}) => {
      const where = options.where || {};
      return records.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
    }),
    create: jest.fn(async (values) => {
      const row = makeRow({ id: `coverage-${records.length + 1}`, created_at: new Date(values.record.timestamp), ...values });
      records.push(row);
      return row;
    }),
  };
  const Evidence = {
    sequelize,
    findOne: jest.fn(async ({ where }) => evidences.find((row) => (
      row.id === where.id && row.tenant_key === where.tenant_key
    )) || null),
  };

  const service = createCoverageLineageService({
    sequelize,
    GovernanceRun,
    CoverageEvidence,
    Evidence,
    clock: () => new Date('2026-08-21T12:00:00.000Z'),
  });
  const context = {
    tenantId: 'tenant-a',
    runId: 'run-1',
    sourceFingerprint: 'a'.repeat(64),
    journeyId: 'support_ticket_flow',
    scenarioId: 'scenario-1',
    stepId: 'step-1',
    inventoryItemId: 'api:POST:/tickets',
  };
  return { service, context, run, records, evidences, sequelize };
}

function transition(context, coverageState, index, extra = {}) {
  return {
    ...context,
    coverageState,
    occurredAt: `2026-08-21T12:00:0${index}.000Z`,
    evidenceId: null,
    metadata: { producer: 'runtime:qa-wave' },
    ...extra,
  };
}

describe('governance/coverageLineageService', () => {
  test('persiste a progressão completa e mantém hash chain append-only', async () => {
    const h = makeHarness();
    const states = ['DISCOVERED', 'INFERRED', 'TARGETED', 'EXECUTED'];
    for (let index = 0; index < states.length; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await h.service.recordTransition(transition(h.context, states[index], index + 1));
    }
    await h.service.recordTransition(transition(h.context, 'VALIDATED', 5, { evidenceId: 'evidence-1' }));

    expect(h.records.map((row) => row.coverage_state)).toEqual([
      'DISCOVERED', 'INFERRED', 'TARGETED', 'EXECUTED', 'VALIDATED',
    ]);
    expect(h.records[0].prev_hash).toBe('GENESIS');
    for (let index = 1; index < h.records.length; index += 1) {
      expect(h.records[index].prev_hash).toBe(h.records[index - 1].hash);
    }
    expect(h.records[4]).toMatchObject({ evidence_id: 'evidence-1' });
    expect(h.records[4].validated_at).toEqual(new Date('2026-08-21T12:00:05.000Z'));
  });

  test('rejeita saltos e transições fora da máquina de estados', async () => {
    const h = makeHarness();
    await expect(h.service.recordTransition(transition(h.context, 'EXECUTED', 1)))
      .rejects.toMatchObject({ code: 'COVERAGE_INVALID_TRANSITION' });

    await h.service.recordTransition(transition(h.context, 'DISCOVERED', 1));
    await expect(h.service.recordTransition(transition(h.context, 'VALIDATED', 2, { evidenceId: 'evidence-1' })))
      .rejects.toMatchObject({ code: 'COVERAGE_INVALID_TRANSITION' });
  });

  test('VALIDATED exige evidence real do mesmo tenant', async () => {
    const h = makeHarness();
    for (const [index, state] of ['DISCOVERED', 'INFERRED', 'TARGETED', 'EXECUTED'].entries()) {
      // eslint-disable-next-line no-await-in-loop
      await h.service.recordTransition(transition(h.context, state, index + 1));
    }

    await expect(h.service.recordTransition(transition(h.context, 'VALIDATED', 5)))
      .rejects.toMatchObject({ code: 'COVERAGE_EVIDENCE_REQUIRED' });
    await expect(h.service.recordTransition(transition(h.context, 'VALIDATED', 5, { evidenceId: 'foreign-evidence' })))
      .rejects.toMatchObject({ code: 'COVERAGE_EVIDENCE_NOT_FOUND' });
    expect(h.records).toHaveLength(4);
  });

  test('rejeita source estrangeiro, tenant estrangeiro e run não RUNNING', async () => {
    const h = makeHarness();
    await expect(h.service.recordTransition(transition({
      ...h.context, sourceFingerprint: 'b'.repeat(64),
    }, 'DISCOVERED', 1))).rejects.toMatchObject({ code: 'RUN_SOURCE_DRIFT' });

    await expect(h.service.recordTransition(transition({
      ...h.context, tenantId: 'tenant-b',
    }, 'DISCOVERED', 1))).rejects.toMatchObject({ code: 'GOVERNANCE_RUN_NOT_FOUND' });

    h.run.status = 'COMPLETED';
    await expect(h.service.recordTransition(transition(h.context, 'DISCOVERED', 1)))
      .rejects.toMatchObject({ code: 'GOVERNANCE_RUN_NOT_RUNNING' });
  });

  test('lineage vazio permanece vazio e nunca fabrica evidence', async () => {
    const h = makeHarness();
    const lineage = await h.service.getLineage(h.context);
    expect(lineage).toEqual(expect.objectContaining({ items: [], currentState: null, total: 0 }));
    expect(h.records).toHaveLength(0);
  });
});

