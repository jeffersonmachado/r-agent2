'use strict';

/**
 * BLOCKER 6 — Agent Factory gates fail-closed.
 *
 * Regra: gates obrigatórios exigem artifact exists AND verifier available AND
 * artifact verified. Verificador indisponível → blocker verifier_unavailable
 * (NO_GO, nunca PASS). Artefato com contentHash adulterado →
 * artifact_integrity_failed; artefato legado sem hash → artifact_unverifiable.
 */

const fs = require('fs');
const path = require('path');

// Store em memória do Agent Registry (mock do service de domínio).
// ATENÇÃO: jest.config.cjs usa resetMocks:true — implementações precisam ser
// (re)definidas em beforeEach, nunca apenas na factory do jest.mock.
const mockStore = new Map();
const mockGetCorporateAgentById = jest.fn();
const mockUpdateCorporateAgent = jest.fn();

jest.mock('../../api/modules/agent-registry/service', () => ({
  getCorporateAgentById: (...args) => mockGetCorporateAgentById(...args),
  updateCorporateAgent: (...args) => mockUpdateCorporateAgent(...args),
  createCorporateAgent: jest.fn(),
  listCorporateAgents: jest.fn(),
  deleteCorporateAgent: jest.fn(),
}));

const mockLogGovernanceEvent = jest.fn(async () => ({}));
jest.mock('../../api/modules/ai-governance/service', () => ({
  logGovernanceEvent: (...args) => mockLogGovernanceEvent(...args),
}));

const hardeningService = require('../../api/modules/agent-os/services/agent-hardening-service');

const realReadFileSync = fs.readFileSync;
let readSpy;

function seedAgent(overrides = {}) {
  const agent = {
    id: overrides.id || 'agent-hc-1',
    slug: 'hardclosed-agent',
    name: 'Fail Closed Agent',
    lifecycle: 'validated',
    status: 'pending_approval',
    governance: { approvedBy: null, approvedAt: null, riskLevel: 'low', auditEnabled: false },
    ...overrides,
  };
  mockStore.set(agent.id, agent);
  return agent;
}

function validatedGovernance(agent) {
  return {
    approvedBy: null,
    approvedAt: null,
    riskLevel: 'low',
    auditEnabled: false,
    validation: {
      waveId: `agent-os-${agent.slug}`,
      executionId: 'exec-hc',
      evidenceId: 'agent_evd_hc',
      replayId: 'agent_replay_hc',
      validatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Mock de leitura dos artefatos de validação. `mutate` permite adulterar o
 * payload (ex.: contentHash inválido ou ausente) antes de serializar.
 */
function mockArtifactReads(mutate) {
  readSpy = jest.spyOn(fs, 'readFileSync').mockImplementation((p, ...rest) => {
    const s = String(p);
    const match = s.match(/(agent_(?:evd|replay)_[^/\\]+)\.json$/);
    if (match && (s.includes('meshEvidence') || s.includes(`replays${path.sep}agent-os`))) {
      const id = match[1];
      const payload = { agentId: 'agent-hc-1' };
      payload[id.startsWith('agent_evd') ? 'evidenceId' : 'replayId'] = id;
      payload.contentHash = hardeningService.computeArtifactContentHash(payload);
      if (mutate) mutate(payload, id);
      return JSON.stringify(payload);
    }
    return realReadFileSync(p, ...rest);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockGetCorporateAgentById.mockImplementation(async (id) => mockStore.get(id) || null);
  mockUpdateCorporateAgent.mockImplementation(async (id, data) => {
    const agent = mockStore.get(id);
    if (!agent) return null;
    Object.assign(agent, data);
    return agent;
  });
  mockArtifactReads(null);
});

afterEach(() => {
  if (readSpy) readSpy.mockRestore();
});

describe('gates fail-closed — verifier indisponível (agente sem slug)', () => {
  test('replay verifier unavailable → blocker verifier_unavailable', async () => {
    const agent = seedAgent({ slug: null });
    agent.governance = validatedGovernance({ slug: 'hardclosed-agent' });

    const gates = await hardeningService.validateGovernanceGates({ agent, requireApproval: false });

    expect(gates.passed).toBe(false);
    expect(gates.blockers).toContainEqual({ gate: 'replay', reason: 'verifier_unavailable' });
  });

  test('evidence verifier unavailable → blocker verifier_unavailable', async () => {
    const agent = seedAgent({ slug: null });
    agent.governance = validatedGovernance({ slug: 'hardclosed-agent' });

    const gates = await hardeningService.validateGovernanceGates({ agent, requireApproval: false });

    expect(gates.passed).toBe(false);
    expect(gates.blockers).toContainEqual({ gate: 'evidence', reason: 'verifier_unavailable' });
  });

  test('qa_wave verifier unavailable → blocker verifier_unavailable', async () => {
    const agent = seedAgent({ slug: null });
    agent.governance = validatedGovernance({ slug: 'hardclosed-agent' });

    const gates = await hardeningService.validateGovernanceGates({ agent, requireApproval: false });

    expect(gates.passed).toBe(false);
    expect(gates.blockers).toContainEqual({ gate: 'qa_wave', reason: 'verifier_unavailable' });
  });

  test('Agent Factory publish com verifier unavailable → NO_GO (replay e evidence)', async () => {
    const agent = seedAgent({ slug: null, lifecycle: 'approved', status: 'approved' });
    agent.governance = validatedGovernance({ slug: 'hardclosed-agent' });
    agent.governance.approvedBy = 'alice';
    agent.governance.approvedAt = new Date().toISOString();
    agent.governance.governanceSignature = hardeningService.computeGovernanceSignature(agent);

    const result = await hardeningService.validateAndPublishAgent({
      agentId: 'agent-hc-1', tenantId: 'tenant-x', actor: 'bob',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('governance_gates_failed');
    expect(result.governance.passed).toBe(false);
    expect(result.governance.blockers).toContainEqual({ gate: 'replay', reason: 'verifier_unavailable' });
    expect(result.governance.blockers).toContainEqual({ gate: 'evidence', reason: 'verifier_unavailable' });
    // Agente não pode ter sido publicado.
    expect(mockStore.get('agent-hc-1').lifecycle).toBe('approved');
  });
});

describe('gates fail-closed — integridade do artefato', () => {
  test('artefato com hash adulterado → NO_GO artifact_integrity_failed', async () => {
    mockArtifactReads((payload) => {
      // Adultera o conteúdo mantendo o hash original gravado na "criação".
      payload.assertions = [{ id: 'assertion_001', name: 'injected', status: 'passed' }];
    });
    const agent = seedAgent();
    agent.governance = validatedGovernance(agent);

    const gates = await hardeningService.validateGovernanceGates({ agent, requireApproval: false });

    expect(gates.passed).toBe(false);
    expect(gates.blockers).toContainEqual({ gate: 'replay', reason: 'artifact_integrity_failed' });
    expect(gates.blockers).toContainEqual({ gate: 'evidence', reason: 'artifact_integrity_failed' });
  });

  test('publish com replay adulterado → NO_GO artifact_integrity_failed', async () => {
    mockArtifactReads((payload, id) => {
      if (id.startsWith('agent_replay')) {
        payload.contentHash = '0'.repeat(64);
      }
    });
    const agent = seedAgent({ lifecycle: 'approved', status: 'approved' });
    agent.governance = validatedGovernance(agent);
    agent.governance.approvedBy = 'alice';
    agent.governance.approvedAt = new Date().toISOString();
    agent.governance.governanceSignature = hardeningService.computeGovernanceSignature(agent);

    const result = await hardeningService.validateAndPublishAgent({
      agentId: 'agent-hc-1', tenantId: 'tenant-x', actor: 'bob',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('governance_gates_failed');
    expect(result.governance.blockers).toContainEqual({ gate: 'replay', reason: 'artifact_integrity_failed' });
    expect(mockStore.get('agent-hc-1').lifecycle).toBe('approved');
  });

  test('artefato legado sem contentHash → NO_GO artifact_unverifiable', async () => {
    mockArtifactReads((payload) => {
      delete payload.contentHash;
    });
    const agent = seedAgent();
    agent.governance = validatedGovernance(agent);

    const gates = await hardeningService.validateGovernanceGates({ agent, requireApproval: false });

    expect(gates.passed).toBe(false);
    expect(gates.blockers).toContainEqual({ gate: 'replay', reason: 'artifact_unverifiable' });
    expect(gates.blockers).toContainEqual({ gate: 'evidence', reason: 'artifact_unverifiable' });
  });
});

describe('gates fail-closed — caminho feliz (regressão)', () => {
  test('artefatos íntegros com hash válido → gates PASS', async () => {
    const agent = seedAgent();
    agent.governance = validatedGovernance(agent);

    const gates = await hardeningService.validateGovernanceGates({ agent, requireApproval: false });

    expect(gates.blockers).toEqual([]);
    expect(gates.passed).toBe(true);
    const replayCheck = gates.checks.find((c) => c.gate === 'replay');
    const evidenceCheck = gates.checks.find((c) => c.gate === 'evidence');
    expect(replayCheck).toMatchObject({ passed: true, verified: true });
    expect(evidenceCheck).toMatchObject({ passed: true, verified: true });
  });

  test('criação grava contentHash verificável pelo gate', async () => {
    const agent = seedAgent();
    const waveResult = {
      waveId: `agent-os-${agent.slug}`,
      executionId: 'exec-hc',
      journeyId: 'journey-1',
      scenarioId: 'scenario-1',
      status: 'GO',
      checks: [{ name: 'qa_wave_verdict', status: 'PASSED' }],
    };
    const writes = [];
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation((p, content) => {
      writes.push({ path: String(p), content: String(content) });
    });
    const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    try {
      const { evidence } = await hardeningService.generateEvidence({ agent, waveResult, tenantId: 'tenant-x' });
      const { replay } = await hardeningService.generateReplayArtifact({ agent, waveResult, evidence, tenantId: 'tenant-x' });

      for (const artifact of [evidence, replay]) {
        expect(typeof artifact.contentHash).toBe('string');
        expect(artifact.contentHash).toBe(hardeningService.computeArtifactContentHash(artifact));
      }
      // O hash gravado em disco é o mesmo do objeto retornado.
      for (const write of writes) {
        const parsed = JSON.parse(write.content);
        expect(parsed.contentHash).toBe(hardeningService.computeArtifactContentHash(parsed));
      }
    } finally {
      writeSpy.mockRestore();
      mkdirSpy.mockRestore();
    }
  });
});
