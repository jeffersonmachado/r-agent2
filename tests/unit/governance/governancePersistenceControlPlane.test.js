'use strict';

jest.mock('../../../api/db/sequelize', () => ({ getSequelize: jest.fn() }));
jest.mock('../../../api/db/models/GovernanceRun', () => jest.fn());
jest.mock('../../../api/db/models/GovernanceGateResult', () => jest.fn());
jest.mock('../../../api/db/models/GovernanceFinalDecision', () => jest.fn());
jest.mock('../../../api/db/models/ScorecardEvaluation', () => jest.fn());
jest.mock('../../../api/db/models/GovernanceGap', () => jest.fn());

const { getSequelize } = require('../../../api/db/sequelize');
const getGovernanceRun = require('../../../api/db/models/GovernanceRun');
const getGate = require('../../../api/db/models/GovernanceGateResult');
const getDecision = require('../../../api/db/models/GovernanceFinalDecision');
const getEvaluation = require('../../../api/db/models/ScorecardEvaluation');
const getGap = require('../../../api/db/models/GovernanceGap');
const { createRun, recordGate, calculateFinalDecision } = require('../../../api/services/governance/certificationService');

const sourceFingerprint = 'a'.repeat(64);
const otherFingerprint = 'b'.repeat(64);

function transactionApi(...args) {
  const callback = args.at(-1);
  return callback({ LOCK: { UPDATE: 'UPDATE' } });
}

describe('Governance Persistence & Certification Control Plane', () => {
  beforeEach(() => {
    getSequelize.mockReturnValue({ transaction: transactionApi, constructor: { Transaction: { ISOLATION_LEVELS: { REPEATABLE_READ: 'REPEATABLE READ' } } } });
  });

  test('cria run persistido com source freeze', async () => {
    const created = { run_id: 'run-1', source_fingerprint: sourceFingerprint };
    getGovernanceRun.mockReturnValue({ create: jest.fn().mockResolvedValue(created) });
    await expect(createRun({ runId: 'run-1', sourceFingerprint })).resolves.toEqual(created);
  });

  test('invalida e rejeita gate quando a fonte diverge', async () => {
    const run = { source_fingerprint: sourceFingerprint, update: jest.fn() };
    getGovernanceRun.mockReturnValue({ findOne: jest.fn().mockResolvedValue(run) });
    await expect(recordGate({ runId: 'run-1', sourceFingerprint: otherFingerprint, gateKey: 'proof', status: 'PASS' })).rejects.toMatchObject({ code: 'RUN_SOURCE_DRIFT' });
    expect(run.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'INVALIDATED' }), expect.any(Object));
  });

  test('gate obrigatório FAIL impede decisão AUTONOMOUS_READY', async () => {
    const run = { source_fingerprint: sourceFingerprint, status: 'RUNNING', policy_id: 'RAP-AGENT-CONSTITUTION', policy_version: '1.0.0', policy_fingerprint: 'a'.repeat(64), update: jest.fn() };
    getGovernanceRun.mockReturnValue({ findOne: jest.fn().mockResolvedValue(run) });
    getGate.mockReturnValue({ findAll: jest.fn().mockResolvedValue([{ status: 'FAIL' }]) });
    getEvaluation.mockReturnValue({ findOne: jest.fn().mockResolvedValue({ dimensions_below_10: 0 }) });
    getGap.mockReturnValue({ findAll: jest.fn().mockResolvedValue([]) });
    getDecision.mockReturnValue({ upsert: jest.fn().mockImplementation((payload) => Promise.resolve([payload, false])) });
    await expect(calculateFinalDecision({ runId: 'run-1', sourceFingerprint })).resolves.toMatchObject({ decision: 'NO_GO', mandatoryGateFailures: 1 });
    expect(run.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }), expect.any(Object));
  });

  test('ausência de avaliação e gates falha fechado por evidência insuficiente', async () => {
    const run = { source_fingerprint: sourceFingerprint, status: 'RUNNING', policy_id: 'RAP-AGENT-CONSTITUTION', policy_version: '1.0.0', policy_fingerprint: 'a'.repeat(64), update: jest.fn() };
    getGovernanceRun.mockReturnValue({ findOne: jest.fn().mockResolvedValue(run) });
    getGate.mockReturnValue({ findAll: jest.fn().mockResolvedValue([]) });
    getEvaluation.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
    getGap.mockReturnValue({ findAll: jest.fn().mockResolvedValue([]) });
    getDecision.mockReturnValue({ upsert: jest.fn().mockImplementation((payload) => Promise.resolve([payload, false])) });
    await expect(calculateFinalDecision({ runId: 'run-1', sourceFingerprint })).resolves.toMatchObject({ decision: 'NO_GO', mandatoryGateFailures: 1, scorecardBelow10: 1 });
  });
});