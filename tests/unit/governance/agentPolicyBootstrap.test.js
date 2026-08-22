'use strict';

jest.mock('../../../api/db/sequelize', () => ({ getSequelize: jest.fn() }));
jest.mock('../../../api/db/models/AgentPolicy', () => jest.fn());
jest.mock('../../../api/db/models/AgentPolicyVersion', () => jest.fn());
jest.mock('../../../api/db/models/AgentPolicyAssignment', () => jest.fn());
jest.mock('../../../api/db/models/AgentPolicyAttestation', () => jest.fn());
jest.mock('../../../api/db/models/GovernanceRun', () => jest.fn());

const { getSequelize } = require('../../../api/db/sequelize');
const getPolicy = require('../../../api/db/models/AgentPolicy');
const getVersion = require('../../../api/db/models/AgentPolicyVersion');
const getAssignment = require('../../../api/db/models/AgentPolicyAssignment');
const getAttestation = require('../../../api/db/models/AgentPolicyAttestation');
const getRun = require('../../../api/db/models/GovernanceRun');
const { bootstrapAgentPolicy, readConstitution } = require('../../../api/services/governance/agentPolicyBootstrap');

describe('Universal Agent Policy bootstrap', () => {
  beforeEach(() => getSequelize.mockReturnValue({ transaction: async (...args) => args.at(-1)({ LOCK: { UPDATE: 'UPDATE' } }) }));

  test('carrega fingerprint canônico, atualiza run e persiste attestation', async () => {
    const run = { status: 'CREATED', policy_fingerprint: null, update: jest.fn().mockResolvedValue(undefined) };
    getRun.mockReturnValue({ findOne: jest.fn().mockResolvedValue(run) });
    getPolicy.mockReturnValue({ findOrCreate: jest.fn().mockResolvedValue([{ id: 'policy-db' }]) });
    getVersion.mockReturnValue({ findOrCreate: jest.fn().mockResolvedValue([{ id: 'version-db', content_fingerprint: readConstitution().fingerprint }]) });
    getAssignment.mockReturnValue({ findOrCreate: jest.fn().mockResolvedValue([{}]) });
    getAttestation.mockReturnValue({ create: jest.fn().mockResolvedValue({ id: 'attestation-1' }) });
    await expect(bootstrapAgentPolicy({ runId: 'run-1', agentId: 'agent-1' })).resolves.toMatchObject({ status: 'PASS', policyFingerprint: readConstitution().fingerprint });
    expect(run.update).toHaveBeenCalledWith(expect.objectContaining({ policy_id: 'RAP-AGENT-CONSTITUTION' }), expect.any(Object));
  });

  test('rejeita policy persistida com fingerprint divergente', async () => {
    getRun.mockReturnValue({ findOne: jest.fn().mockResolvedValue({ status: 'CREATED', policy_fingerprint: null }) });
    getPolicy.mockReturnValue({ findOrCreate: jest.fn().mockResolvedValue([{ id: 'policy-db' }]) });
    getVersion.mockReturnValue({ findOrCreate: jest.fn().mockResolvedValue([{ id: 'version-db', content_fingerprint: 'b'.repeat(64) }]) });
    await expect(bootstrapAgentPolicy({ runId: 'run-1', agentId: 'agent-1' })).rejects.toMatchObject({ code: 'AGENT_POLICY_STALE' });
  });
});