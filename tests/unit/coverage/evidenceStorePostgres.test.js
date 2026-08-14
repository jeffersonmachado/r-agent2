'use strict';

const { createPostgresEvidenceStore } = require('../../../qa/coverage/evidenceStorePostgres');
const { computeRecordHash, GENESIS } = require('../../../qa/coverage/evidenceStore');

function makeEvidence(overrides = {}) {
  return {
    evidenceId: 'ev-1',
    executionId: 'ex-1',
    waveId: 'w-1',
    journeyId: 'j-1',
    journeyFingerprint: 'fp-1',
    commit: 'abc123',
    environment: 'ci',
    status: 'VALIDATED',
    assertions: [],
    observedElements: [],
    expectedElements: [],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('coverage/evidenceStorePostgres', () => {
  let model;
  let store;

  beforeEach(() => {
    model = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
    };
    store = createPostgresEvidenceStore({ model });
  });

  it('append valida, redige e encadeia hash com GENESIS na cadeia vazia', async () => {
    model.findOne.mockResolvedValue(null);
    model.create.mockResolvedValue({});

    const record = await store.append(makeEvidence({ apiKey: 'secret' }));

    expect(record.prevHash).toBe(GENESIS);
    expect(record.hash).toBe(computeRecordHash(record));
    expect(JSON.stringify(record)).not.toContain('secret');
    expect(model.create).toHaveBeenCalledWith({
      record,
      hash: record.hash,
      prev_hash: GENESIS,
    });
  });

  it('append encadeia com o hash do último registro', async () => {
    model.findOne.mockResolvedValue({ hash: 'h1' });
    model.create.mockResolvedValue({});

    const record = await store.append(makeEvidence());

    expect(record.prevHash).toBe('h1');
    expect(record.hash).toBe(computeRecordHash(record));
  });

  it('append rejeita campos obrigatórios ausentes', async () => {
    await expect(store.append({ evidenceId: 'x' }))
      .rejects.toThrow(/evidence_missing_required_fields/);
  });

  it('appendRaw exige type e timestamp', async () => {
    await expect(store.appendRaw({ timestamp: 'x' }))
      .rejects.toThrow(/evidence_raw_type_required/);
    await expect(store.appendRaw({ type: 't' }))
      .rejects.toThrow(/evidence_raw_timestamp_required/);
  });

  it('markStale anexa stale-marker sem alterar registro original', async () => {
    model.findOne.mockResolvedValue(null);
    model.create.mockResolvedValue({});

    const record = await store.markStale('ev-9', 'fingerprint changed');

    expect(record.type).toBe('stale-marker');
    expect(record.staleOf).toBe('ev-9');
    expect(record.prevHash).toBe(GENESIS);
  });

  it('verify devolve valid true para cadeia íntegra', async () => {
    const r1 = makeEvidence({ evidenceId: 'e1' });
    r1.prevHash = GENESIS;
    r1.hash = computeRecordHash(r1);

    const r2 = makeEvidence({ evidenceId: 'e2' });
    r2.prevHash = r1.hash;
    r2.hash = computeRecordHash(r2);

    model.findAll.mockResolvedValue([
      { record: r1, hash: r1.hash, prev_hash: r1.prevHash },
      { record: r2, hash: r2.hash, prev_hash: r2.prevHash },
    ]);

    expect(await store.verify()).toEqual({ valid: true, brokenAt: null });
  });

  it('verify detecta cadeia quebrada no linkage', async () => {
    const r1 = makeEvidence({ evidenceId: 'e1' });
    r1.prevHash = GENESIS;
    r1.hash = computeRecordHash(r1);

    const r2 = makeEvidence({ evidenceId: 'e2' });
    r2.prevHash = 'WRONG';
    r2.hash = computeRecordHash(r2);

    model.findAll.mockResolvedValue([
      { record: r1, hash: r1.hash, prev_hash: r1.prevHash },
      { record: r2, hash: r2.hash, prev_hash: r2.prevHash },
    ]);

    expect(await store.verify()).toEqual({ valid: false, brokenAt: 1 });
  });

  it('readAll mapeia linhas para registros', async () => {
    model.findAll.mockResolvedValue([
      { record: { evidenceId: 'e1' }, hash: 'h', prev_hash: 'p' },
    ]);

    const records = await store.readAll();
    expect(records).toHaveLength(1);
    expect(records[0].evidenceId).toBe('e1');
    expect(records[0].hash).toBe('h');
    expect(records[0].prevHash).toBe('p');
  });

  it('verify é válido mesmo com linhas fora de ordem de created_at (ordena pela cadeia)', async () => {
    const r1 = makeEvidence({ evidenceId: 'e1' });
    r1.prevHash = GENESIS;
    r1.hash = computeRecordHash(r1);

    const r2 = makeEvidence({ evidenceId: 'e2' });
    r2.prevHash = r1.hash;
    r2.hash = computeRecordHash(r2);

    // Simula empate de created_at com desempate por UUID aleatório: o banco
    // devolve r2 antes de r1, mas a cadeia prevHash→hash define a ordem real.
    model.findAll.mockResolvedValue([
      { record: r2, hash: r2.hash, prev_hash: r2.prevHash },
      { record: r1, hash: r1.hash, prev_hash: r1.prevHash },
    ]);

    expect(await store.verify()).toEqual({ valid: true, brokenAt: null });
  });

  it('append com sequelize real usa transação + advisory lock', async () => {
    const transaction = { id: 'tx-1' };
    model.sequelize = {
      transaction: jest.fn(async (fn) => fn(transaction)),
      query: jest.fn().mockResolvedValue([{}]),
    };
    model.findOne.mockResolvedValue(null);
    model.create.mockResolvedValue({});

    const record = await store.append(makeEvidence());

    expect(model.sequelize.transaction).toHaveBeenCalled();
    expect(model.sequelize.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(894737271)',
      { transaction },
    );
    expect(model.create).toHaveBeenCalledWith(
      { record, hash: record.hash, prev_hash: GENESIS },
      { transaction },
    );
  });
});
