'use strict';

/**
 * RAG segregation para agentes (teste obrigatório 11 e complementos):
 *  - PRODUCTION nunca acessa o domínio SYSTEM — nem pela tool de conhecimento
 *    de plataforma, nem por override de escopo no input.
 *  - O knowledge scope é calculado pelo Policy/Domain Router, nunca pelo
 *    prompt/input do agente.
 *  - Operational Knowledge Agent (PRODUCTION) e Platform Knowledge Agent
 *    (DEVELOPMENT) são agentes distintos sem troca silenciosa de domínio.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { createToolRegistry, registerDefaultTools } = require('../../src/core/cognitive/tool-registry');
const { resolveRetrievalScope } = require('../../api/services/rag/domainRouter');
const { knowledgeScopeFor } = require('../../src/core/cognitive/agent-supervisor');
const { getAgentBySlug } = require('../../api/modules/agent-marketplace/service');

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

describe('RAG segregation — agentes e cross-domain', () => {
  test('11. PRODUCTION não executa knowledge.searchSystem (visibility denied)', async () => {
    const registry = registerDefaultTools(createToolRegistry({ logger: silent }));
    await expect(registry.execute('knowledge.searchSystem', { query: 'arquitetura interna' }, {
      tenantId: 't1',
      actor: { classification: 'PRODUCTION', permissions: ['*'] },
    })).rejects.toThrow('cognitive_tool_visibility_denied');
  });

  test('11. Domain Router nega SYSTEM para ator PRODUCTION mesmo com domain explícito', () => {
    const denied = resolveRetrievalScope({
      actor: { role: 'user' }, // PRODUCTION
      requestedDomain: 'SYSTEM',
    });
    expect(denied.allowed).toBe(false);
    expect(denied.retrievalPolicy).toBe('deny');

    // Input/prompt nunca escolhe domínio: sem ator, sempre OPERATIONAL restritivo.
    const anonymous = resolveRetrievalScope({ actor: null, requestedDomain: 'SYSTEM' });
    expect(anonymous.allowed).toBe(false);
  });

  test('knowledge scope do especialista é derivado da classificação (não do prompt)', () => {
    expect(knowledgeScopeFor('PRODUCTION').domain).toBe('OPERATIONAL');
    expect(knowledgeScopeFor('PRODUCTION').classifications).toEqual(['PRODUCTION']);
    expect(knowledgeScopeFor('SUPPORT').classifications).toContain('SUPPORT');
    expect(knowledgeScopeFor('DEVELOPMENT').domain).toBeDefined();
  });

  test('Operational Knowledge Agent e Platform Knowledge Agent são perfis distintos', () => {
    const operational = getAgentBySlug('operational-knowledge-agent');
    const platform = getAgentBySlug('platform-knowledge-agent');
    expect(operational.classification).toBe('PRODUCTION');
    expect(operational.profile.knowledge.domain).toBe('OPERATIONAL');
    expect(operational.capabilities).not.toContain('knowledge.system');
    expect(platform.classification).toBe('DEVELOPMENT');
    expect(platform.profile.knowledge.domain).toBe('SYSTEM');
    expect(platform.capabilities).not.toContain('knowledge.operational');
  });

  test('14. DEVELOPMENT executa tools de engenharia permitidas', async () => {
    const qaWavesService = { getExecutionStatus: jest.fn(async () => ({ status: 'completed' })) };
    const registry = registerDefaultTools(createToolRegistry({ logger: silent }), { qaWavesService });
    const result = await registry.execute('qa.getWaveStatus', { executionId: 'exec-1' }, {
      tenantId: 't1',
      actor: { classification: 'DEVELOPMENT', permissions: ['qa.waves'] },
    });
    expect(result.success).toBe(true);
    expect(qaWavesService.getExecutionStatus).toHaveBeenCalledWith('exec-1', 't1');
  });

  test('audit.listReplays sobrescreve tenant controlado pelo input com o tenant cognitivo', async () => {
    const testExecutionService = { listReplayFiles: jest.fn(() => ({ total: 0, files: [] })) };
    const registry = registerDefaultTools(createToolRegistry({ logger: silent }), { testExecutionService });

    await registry.execute('audit.listReplays', { query: { tenantId: 'tenant-b', limit: 5 } }, {
      tenantId: 'tenant-a',
      actor: { classification: 'SUPPORT', permissions: ['audit.replay'] },
    });

    expect(testExecutionService.listReplayFiles).toHaveBeenCalledWith({ tenantId: 'tenant-a', limit: 5 });
  });

  test('knowledge.searchOperational usa o Domain Router (scope vem do ator, não do input)', async () => {
    const queryRag = jest.fn(async () => ({ success: true, response: 'ok', sources: [], confidence: 0.9 }));
    const registry = registerDefaultTools(createToolRegistry({ logger: silent }), {
      ragService: { queryRag },
    });
    await registry.execute('knowledge.searchOperational', { query: 'horário de funcionamento' }, {
      tenantId: 't1',
      actor: { classification: 'PRODUCTION', permissions: ['knowledge.read'] },
    });
    // A tool NÃO passa filters.domain do input: o escopo é resolvido pelo router.
    const [, tenantId, context, filters] = queryRag.mock.calls[0];
    expect(tenantId).toBe('t1');
    expect(filters).toEqual({});
    expect(context.actor.classification).toBe('PRODUCTION');
  });
});
