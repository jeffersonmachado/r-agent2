'use strict';

/**
 * W2-A — Agent Factory governance (FASE 7) + tenant/principal fail-closed.
 *
 * Gaps cobertos:
 *  - GAP 1: publish exigia nada de lifecycle; agora exige 'approved' +
 *    approvedBy + publisher ≠ approver (agent_not_approved /
 *    publish_self_approval_denied).
 *  - GAP 4: /approve era inalcançável (gate de approval exigia approvedBy que
 *    só o approve cria); approve agora exige lifecycle 'validated' e CRIA a
 *    aprovação + assinatura de governança verificada no publish.
 *  - GAP 3: tenant/principal vêm de req.tenantId/req.agent; sem eles →
 *    400 tenant_required / 401 principal_required. Nunca 'system' implícito.
 *  - GAP 7: trilha registra o actor/actorRole reais.
 */

const fs = require('fs');

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

jest.mock('../../api/modules/journey-registry/service', () => ({
  createJourney: jest.fn(async (data) => ({ id: 'journey-1', ...data })),
}));

jest.mock('../../api/services/qaWavesScenarioService', () => ({
  saveScenario: jest.fn(({ scenario }) => ({ scenario })),
  upsertScenarioStore: jest.fn((scenario) => ({ scenario })),
  runScenarioExecution: jest.fn(() => ({ executionId: 'exec-qa-gov' })),
}));

const mockGetExecutionById = jest.fn();
jest.mock('../../api/services/qaMeshService', () => ({
  getExecutionById: (...args) => mockGetExecutionById(...args),
}));

const hardeningService = require('../../api/modules/agent-os/services/agent-hardening-service');
const { handleAgentFactoryRoutes } = require('../../api/modules/agent-os/routes/agent-factory');

function seedAgent(overrides = {}) {
  const agent = {
    id: overrides.id || 'agent-gov-1',
    slug: overrides.slug || 'gov-agent',
    name: 'Governance Agent',
    lifecycle: 'draft',
    status: 'draft',
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
      executionId: 'exec-qa-gov',
      evidenceId: 'agent_evd_gov',
      replayId: 'agent_replay_gov',
      validatedAt: new Date().toISOString(),
    },
  };
}

function makeReq(body, { tenantId = 'tenant-x', agent = { id: 'u-alice', username: 'alice', role: 'admin', tenantId: 'tenant-x' } } = {}) {
  const stream = require('stream');
  const payload = JSON.stringify(body || {});
  const req = new stream.Readable({
    read() {
      this.push(payload);
      this.push(null);
    },
  });
  req.headers = { 'content-type': 'application/json' };
  req.method = 'POST';
  req.url = '/';
  req.originalUrl = '/';
  req.query = {};
  // null explicito omite o campo (simula ausência de tenant/principal).
  if (tenantId) req.tenantId = tenantId;
  if (agent) req.agent = agent;
  return req;
}

function baseDeps() {
  return {
    requireAuth: () => ({ valid: true, agent: { id: 'u-alice', username: 'alice' } }),
    requirePermission: () => ({ allowed: true }),
    sendJson: (res, status, payload) => {
      res.statusCode = status;
      res.body = payload;
      res.writableEnded = true;
    },
    badRequest: (res, message) => {
      res.statusCode = 400;
      res.body = { error: 'bad_request', message };
      res.writableEnded = true;
    },
    hasJsonContentType: () => true,
    parseJsonBody: async (req) => {
      let data = '';
      for await (const chunk of req) data += chunk;
      return JSON.parse(data || '{}');
    },
    logAction: async () => {},
  };
}

let readSpy;
let writeSpy;
let mkdirSpy;
const realReadFileSync = fs.readFileSync;

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
  mockGetExecutionById.mockReturnValue({ status: 'completed', summary: { goNoGo: 'GO' } });

  // Pipeline de publish gera artefatos em disco — redirecionado para spies.
  writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
  readSpy = jest.spyOn(fs, 'readFileSync').mockImplementation((p, ...rest) => {
    const s = String(p);
    // Artefatos de validação usados pelos gates: existem e pertencem ao agente.
    const match = s.match(/(agent_(?:evd|replay)_[^/\\]+)\.json$/);
    if (match && (s.includes('meshEvidence') || s.includes(`replays${require('path').sep}agent-os`))) {
      const id = match[1];
      const payload = { agentId: 'agent-gov-1' };
      payload[id.startsWith('agent_evd') ? 'evidenceId' : 'replayId'] = id;
      // Integridade: contentHash válido, como gravado na criação real.
      payload.contentHash = hardeningService.computeArtifactContentHash(payload);
      return JSON.stringify(payload);
    }
    return realReadFileSync(p, ...rest);
  });
});

afterEach(() => {
  readSpy.mockRestore();
  writeSpy.mockRestore();
  mkdirSpy.mockRestore();
});

describe('validateAndPublishAgent — enforcement de lifecycle (GAP 1)', () => {
  test('publish de agente em draft é rejeitado com agent_not_approved', async () => {
    seedAgent({ lifecycle: 'draft' });
    const result = await hardeningService.validateAndPublishAgent({
      agentId: 'agent-gov-1', tenantId: 'tenant-x', actor: 'bob',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('agent_not_approved');
  });

  test('publish de agente validated (não approved) é rejeitado', async () => {
    const agent = seedAgent({ lifecycle: 'validated' });
    agent.governance = validatedGovernance(agent);
    const result = await hardeningService.validateAndPublishAgent({
      agentId: 'agent-gov-1', tenantId: 'tenant-x', actor: 'bob',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('agent_not_approved');
  });

  test('publish de agente approved sem approvedBy registrado é rejeitado', async () => {
    seedAgent({ lifecycle: 'approved' });
    const result = await hardeningService.validateAndPublishAgent({
      agentId: 'agent-gov-1', tenantId: 'tenant-x', actor: 'bob',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('agent_not_approved');
  });

  test('publish com approvedBy === publisher é rejeitado (segregação de funções)', async () => {
    const agent = seedAgent({ lifecycle: 'approved' });
    agent.governance = validatedGovernance(agent);
    agent.governance.approvedBy = 'alice';
    agent.governance.approvedAt = new Date().toISOString();
    agent.governance.governanceSignature = hardeningService.computeGovernanceSignature(agent);

    const result = await hardeningService.validateAndPublishAgent({
      agentId: 'agent-gov-1', tenantId: 'tenant-x', actor: 'alice',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('publish_self_approval_denied');
  });

  test('publish rejeita assinatura adulterada após o approve', async () => {
    const agent = seedAgent({ lifecycle: 'approved' });
    agent.governance = validatedGovernance(agent);
    agent.governance.approvedBy = 'alice';
    agent.governance.approvedAt = new Date().toISOString();
    agent.governance.governanceSignature = hardeningService.computeGovernanceSignature(agent);
    // Adulteração: trocar o approvedBy sem re-emitir a assinatura.
    agent.governance.approvedBy = 'mallory';

    const result = await hardeningService.validateAndPublishAgent({
      agentId: 'agent-gov-1', tenantId: 'tenant-x', actor: 'bob',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('governance_gates_failed');
    expect(result.governance.blockers.some((b) => b.gate === 'governance_signature')).toBe(true);
  });
});

describe('approveAgent — approve alcançável e cria a aprovação (GAP 4)', () => {
  test('approve de agente não validado é rejeitado com agent_not_validated', async () => {
    seedAgent({ lifecycle: 'draft' });
    const result = await hardeningService.approveAgent({
      agentId: 'agent-gov-1', tenantId: 'tenant-x', actor: 'alice',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('agent_not_validated');
  });

  test('approve de agente validated sem approvedBy pré-existente funciona', async () => {
    const agent = seedAgent({ lifecycle: 'validated' });
    agent.governance = validatedGovernance(agent);

    const result = await hardeningService.approveAgent({
      agentId: 'agent-gov-1', tenantId: 'tenant-x', actor: 'alice', actorRole: 'admin',
    });

    expect(result.ok).toBe(true);
    const updated = mockStore.get('agent-gov-1');
    expect(updated.lifecycle).toBe('approved');
    expect(updated.governance.approvedBy).toBe('alice');
    expect(updated.governance.approvedAt).toBeDefined();
    expect(updated.governance.governanceSignature).toBe(
      hardeningService.computeGovernanceSignature(updated)
    );
    // Trilha de auditoria com o principal real (GAP 7).
    expect(mockLogGovernanceEvent).toHaveBeenCalledTimes(1);
    const trail = mockLogGovernanceEvent.mock.calls[0][0];
    expect(trail.actor).toBe('alice');
    expect(trail.actorRole).toBe('admin');
    expect(trail.eventType).toBe('approve');
  });
});

describe('fluxo feliz: validated → approve → publish → active', () => {
  test('approve por alice + publish por bob ativa o agente', async () => {
    const agent = seedAgent({ lifecycle: 'validated' });
    agent.governance = validatedGovernance(agent);

    const approveResult = await hardeningService.approveAgent({
      agentId: 'agent-gov-1', tenantId: 'tenant-x', actor: 'alice', actorRole: 'admin',
    });
    expect(approveResult.ok).toBe(true);
    expect(mockStore.get('agent-gov-1').lifecycle).toBe('approved');

    const publishResult = await hardeningService.validateAndPublishAgent({
      agentId: 'agent-gov-1', tenantId: 'tenant-x', actor: 'bob', actorRole: 'admin',
    });

    expect(publishResult.ok).toBe(true);
    expect(publishResult.status).toBe('GO');
    const published = mockStore.get('agent-gov-1');
    expect(published.lifecycle).toBe('active');
    expect(published.status).toBe('active');
    // Aprovação preservada — publish não aprova, só ativa.
    expect(published.governance.approvedBy).toBe('alice');
    expect(published.governance.publishedBy).toBe('bob');
    // Assinatura re-emitida sobre o novo linkage de validação.
    expect(published.governance.governanceSignature).toBe(
      hardeningService.computeGovernanceSignature(published)
    );
  });
});

describe('rotas agent-factory — tenant/principal fail-closed (GAP 3)', () => {
  test('rota sem tenant retorna 400 tenant_required', async () => {
    const res = {};
    await handleAgentFactoryRoutes({
      req: makeReq({ name: 'A', slug: 'a' }, { tenantId: null, agent: null }),
      res,
      method: 'POST',
      pathname: '/api/agent-factory/create',
      deps: baseDeps(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error', 'tenant_required');
  });

  test('approve sem principal retorna 401 principal_required', async () => {
    const res = {};
    await handleAgentFactoryRoutes({
      req: makeReq({ id: 'agent-gov-1' }, { agent: null }),
      res,
      method: 'POST',
      pathname: '/api/agent-factory/approve',
      deps: baseDeps(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).toHaveProperty('error', 'principal_required');
  });

  test('approve grava o actor real (nunca "system")', async () => {
    const agent = seedAgent({ lifecycle: 'validated' });
    agent.governance = validatedGovernance(agent);

    const res = {};
    await handleAgentFactoryRoutes({
      req: makeReq({ id: 'agent-gov-1' }),
      res,
      method: 'POST',
      pathname: '/api/agent-factory/approve',
      deps: baseDeps(),
    });

    expect(res.statusCode).toBe(200);
    const updated = mockStore.get('agent-gov-1');
    expect(updated.lifecycle).toBe('approved');
    expect(updated.governance.approvedBy).toBe('alice');
    expect(updated.governance.approvedBy).not.toBe('system');
  });

  test('publish de agente não aprovado via rota retorna 400 agent_not_approved', async () => {
    seedAgent({ lifecycle: 'draft' });
    const res = {};
    await handleAgentFactoryRoutes({
      req: makeReq({ id: 'agent-gov-1' }),
      res,
      method: 'POST',
      pathname: '/api/agent-factory/publish',
      deps: baseDeps(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error', 'agent_not_approved');
  });

  test('publish com approvedBy === publisher via rota retorna 403 publish_self_approval_denied', async () => {
    const agent = seedAgent({ lifecycle: 'approved' });
    agent.governance = validatedGovernance(agent);
    agent.governance.approvedBy = 'alice';
    agent.governance.approvedAt = new Date().toISOString();
    agent.governance.governanceSignature = hardeningService.computeGovernanceSignature(agent);

    const res = {};
    await handleAgentFactoryRoutes({
      req: makeReq({ id: 'agent-gov-1' }),
      res,
      method: 'POST',
      pathname: '/api/agent-factory/publish',
      deps: baseDeps(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toHaveProperty('error', 'publish_self_approval_denied');
  });
});

describe('RBAC — agents:approve / agents:publish na matriz (GAP 6)', () => {
  const { hasPermission } = require('../../api/services/rbacService');

  test('owner e admin podem aprovar e publicar', () => {
    expect(hasPermission({ role: 'owner' }, 'agents', 'approve')).toBe(true);
    expect(hasPermission({ role: 'owner' }, 'agents', 'publish')).toBe(true);
    expect(hasPermission({ role: 'admin' }, 'agents', 'approve')).toBe(true);
    expect(hasPermission({ role: 'admin' }, 'agents', 'publish')).toBe(true);
  });

  test('super_admin mantém bypass global', () => {
    expect(hasPermission({ role: 'super_admin' }, 'agents', 'approve')).toBe(true);
    expect(hasPermission({ role: 'super_admin' }, 'agents', 'publish')).toBe(true);
  });

  test('papéis operacionais não aprovam nem publicam', () => {
    for (const role of ['manager', 'supervisor', 'operator', 'agent', 'auditor', 'readonly']) {
      expect(hasPermission({ role }, 'agents', 'approve')).toBe(false);
      expect(hasPermission({ role }, 'agents', 'publish')).toBe(false);
    }
  });
});
