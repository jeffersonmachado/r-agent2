'use strict';

/**
 * Agent Supervisor — seleção governada de especialistas.
 * Cobre os testes obrigatórios 6–10, 12–14 e 28–29 da especificação.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { createAgentSupervisor } = require('../../src/core/cognitive/agent-supervisor');
const { createCapabilityRegistry } = require('../../src/core/cognitive/capability-registry');
const { createToolRegistry, registerDefaultTools } = require('../../src/core/cognitive/tool-registry');

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function agent(overrides = {}) {
  return {
    id: overrides.id || `agent-${overrides.slug}`,
    slug: 'scheduling-agent',
    name: 'Scheduling Agent',
    tenant_id: 'tenant-a',
    classification: 'PRODUCTION',
    lifecycle: 'active',
    capabilities: ['schedule.read', 'schedule.manage', 'crm.read', 'messaging.send'],
    permissions: [],
    config: {},
    ...overrides,
  };
}

function buildSupervisor(agents, { toolRegistry } = {}) {
  return createAgentSupervisor({
    logger: silent,
    capabilityRegistry: createCapabilityRegistry(),
    toolRegistry: toolRegistry || registerDefaultTools(createToolRegistry({ logger: silent })),
    agentDirectory: {
      listActiveAgents: jest.fn(async ({ tenantId }) =>
        agents.filter((a) => a.tenant_id === tenantId)),
    },
  });
}

const PROD_ACTOR = { userId: 'u1', classification: 'PRODUCTION', permissions: ['*'] };

describe('Agent Supervisor', () => {
  test('6. seleciona o especialista correto para o intent', async () => {
    const supervisor = buildSupervisor([
      agent({ id: 'a-sched', slug: 'scheduling-agent' }),
      agent({ id: 'a-crm', slug: 'crm-agent', capabilities: ['crm.read', 'crm.write'] }),
    ]);
    const decision = await supervisor.route({
      intent: 'agendar', tenantId: 'tenant-a', actor: PROD_ACTOR,
    });
    expect(decision.status).toBe('routed');
    expect(decision.agentSlug).toBe('scheduling-agent');
    expect(decision.capabilities).toContain('schedule.manage');
    expect(decision.allowedTools).toContain('schedule.createAppointment');
    expect(decision.knowledgeScope.domain).toBe('OPERATIONAL');
    expect(decision.confidence).toBeGreaterThan(0.5);
  });

  test('7. rejeita agente inativo (lifecycle != active)', async () => {
    const supervisor = buildSupervisor([
      agent({ id: 'a-draft', slug: 'scheduling-agent', lifecycle: 'draft' }),
    ]);
    // O diretório real filtra por active; aqui o stub retorna e o supervisor elimina.
    const decision = await supervisor.route({
      intent: 'agendar', tenantId: 'tenant-a', actor: PROD_ACTOR,
    });
    expect(decision.status).toBe('no_specialist');
  });

  test('8/12. respeita classificação: PRODUCTION não vê agentes SUPPORT/DEVELOPMENT', async () => {
    const supervisor = buildSupervisor([
      agent({ id: 'a-qa', slug: 'qa-engineering-agent', classification: 'DEVELOPMENT', capabilities: ['qa.waves'] }),
      agent({ id: 'a-inc', slug: 'incident-diagnostic-agent', classification: 'SUPPORT', capabilities: ['support.diagnose'] }),
    ]);
    const { candidates, eliminated } = await supervisor.discoverEligible({
      tenantId: 'tenant-a', actor: PROD_ACTOR,
    });
    expect(candidates).toHaveLength(0);
    expect(eliminated.map((e) => e.reason)).toEqual(['classification_denied', 'classification_denied']);
  });

  test('9. respeita tenant (diretório só retorna o tenant do contexto)', async () => {
    const supervisor = buildSupervisor([
      agent({ id: 'a1', slug: 'scheduling-agent', tenant_id: 'tenant-a' }),
      agent({ id: 'a2', slug: 'scheduling-agent', tenant_id: 'tenant-b' }),
    ]);
    const decisionA = await supervisor.route({ intent: 'agendar', tenantId: 'tenant-a', actor: PROD_ACTOR });
    expect(decisionA.agentId).toBe('a1');
    const decisionB = await supervisor.route({ intent: 'agendar', tenantId: 'tenant-b', actor: PROD_ACTOR });
    expect(decisionB.agentId).toBe('a2');
  });

  test('13. SUPPORT não acessa QA Waves (delegação não é bypass para DEVELOPMENT)', async () => {
    const qaAgent = agent({
      id: 'a-qa', slug: 'qa-engineering-agent', classification: 'DEVELOPMENT', capabilities: ['qa.waves'],
    });
    const incidentAgent = agent({
      id: 'a-inc', slug: 'incident-diagnostic-agent', classification: 'SUPPORT',
      capabilities: ['support.diagnose'],
      config: { delegation: { allowed: ['qa-engineering-agent'] } },
    });
    const supervisor = buildSupervisor([incidentAgent, qaAgent]);
    const result = await supervisor.delegate({
      fromAgent: incidentAgent,
      intent: 'consultar_metricas',
      tenantId: 'tenant-a',
      actor: { classification: 'SUPPORT', permissions: ['*'] },
    });
    // QA agent é DEVELOPMENT → invisível para SUPPORT: nunca roteado.
    expect(result.status).not.toBe('routed');
    expect(['no_specialist', 'denied']).toContain(result.status);
  });

  test('10/29. delegação passa pelo Supervisor com cycle detection e depth máximo', async () => {
    const a = agent({ id: 'a1', slug: 'scheduling-agent' });
    const supervisor = buildSupervisor([a]);

    // Ciclo: fromAgent já está na cadeia.
    const cycle = await supervisor.delegate({
      fromAgent: a, intent: 'agendar', tenantId: 'tenant-a', actor: PROD_ACTOR, chain: ['a1'],
    });
    expect(cycle.status).toBe('denied');
    expect(cycle.reason).toBe('delegation_cycle_detected');

    // Profundidade máxima.
    const deep = await supervisor.delegate({
      fromAgent: a, intent: 'agendar', tenantId: 'tenant-a', actor: PROD_ACTOR, chain: ['x', 'y'],
    });
    expect(deep.status).toBe('denied');
    expect(deep.reason).toBe('delegation_depth_exceeded');
  });

  test('29. PRODUCTION nunca delega para DEVELOPMENT (classification boundary)', async () => {
    const source = agent({ id: 'a-prod', slug: 'scheduling-agent', classification: 'PRODUCTION' });
    const target = agent({
      id: 'a-dev', slug: 'dev-agent', classification: 'DEVELOPMENT',
      capabilities: ['schedule.manage', 'crm.read', 'schedule.read', 'messaging.send'],
    });
    const supervisor = buildSupervisor([source, target]);
    const result = await supervisor.delegate({
      fromAgent: source, intent: 'agendar', tenantId: 'tenant-a', actor: PROD_ACTOR,
    });
    expect(result.status).not.toBe('routed');
  });

  test('28. vertical: especialista genérico + policy pack (sem duplicar agente por vertical)', async () => {
    const generic = agent({ id: 'a1', slug: 'scheduling-agent', config: { verticals: { inherited: true } } });
    const restricted = agent({ id: 'a2', slug: 'sched-2', capabilities: ['schedule.manage'], config: { verticals: { list: ['beauty'] } } });
    const supervisor = buildSupervisor([generic, restricted]);

    const fitness = await supervisor.route({
      intent: 'agendar', tenantId: 'tenant-a', actor: PROD_ACTOR, vertical: 'fitness',
    });
    expect(fitness.status).toBe('routed');
    expect(fitness.agentId).toBe('a1'); // herdado cobre fitness

    const beauty = await supervisor.route({
      intent: 'agendar', tenantId: 'tenant-a', actor: PROD_ACTOR, vertical: 'beauty',
    });
    expect(beauty.status).toBe('routed');
    // Não existe BeautySchedulingAgent/FitnessSchedulingAgent: mesmo especialista.
    expect(['a1', 'a2']).toContain(beauty.agentId);
  });

  test('canal incompatível elimina o agente', async () => {
    const voiceOnly = agent({ id: 'a-voice', slug: 'voice-agent', capabilities: ['schedule.manage'], config: { channels: ['voice'] } });
    const supervisor = buildSupervisor([voiceOnly]);
    const decision = await supervisor.route({
      intent: 'agendar', tenantId: 'tenant-a', actor: PROD_ACTOR, channel: 'whatsapp',
    });
    expect(decision.status).toBe('no_specialist');
  });

  test('delegation policy: destino fora de delegation.allowed é negado', async () => {
    const source = agent({
      id: 'a1', slug: 'scheduling-agent',
      config: { delegation: { allowed: ['crm-agent'] } },
    });
    const other = agent({ id: 'a2', slug: 'campaign-agent', capabilities: ['campaign.manage', 'crm.read'] });
    const supervisor = buildSupervisor([source, other]);
    const result = await supervisor.delegate({
      fromAgent: source,
      intent: 'iniciar_campanha',
      targetAgentSlug: 'campaign-agent',
      tenantId: 'tenant-a',
      actor: PROD_ACTOR,
    });
    expect(result.status).toBe('denied');
    expect(result.reason).toBe('delegation_target_not_allowed');
  });

  test('diretório indisponível é falha explícita (directory_unavailable), nunca fake routing', async () => {
    const supervisor = createAgentSupervisor({
      logger: silent,
      capabilityRegistry: createCapabilityRegistry(),
      agentDirectory: {
        listActiveAgents: jest.fn(async () => { throw new Error('db_down'); }),
      },
    });
    const decision = await supervisor.route({ intent: 'agendar', tenantId: 'tenant-a', actor: PROD_ACTOR });
    expect(decision.status).toBe('directory_unavailable');
    expect(decision.error).toBe('db_down');
  });
});
