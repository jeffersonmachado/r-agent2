'use strict';

/**
 * MISSÃO ASK_AI_AGENT — T-A3 (capacidades em contexto).
 *
 * RED medido em 2026-09-15:
 *   - `describeCapabilities` derivava o bullet das tools autorizadas por RBAC,
 *     mas IGNORAVA as capabilities do tenant (`tenant_settings.capabilities`) —
 *     uma tool cujo domínio o tenant desligou continuava sendo anunciada;
 *   - a resposta de capacidades era a mesma em qualquer tela — sem "aqui você
 *     pode..." mesmo com contexto de tela disponível;
 *   - a projeção de rótulos tinha fallback `tool.label || tool.id` — uma tool
 *     sem rótulo vazaria o identificador interno na resposta.
 *
 * Regras fixadas:
 *   (a) tool que declara `tenantCapability` só é anunciada quando a capability
 *       do tenant está ligada; capability desconhecida/ausente NÃO esconde a
 *       tool (o RBAC do ator já governa) — fail-safe, não bloqueio indevido;
 *   (b) com contexto de tela, a resposta é recortada para a tela ("Aqui, em
 *       <rótulo humano>, ...") sem expor rota, id de entidade ou tenant;
 *   (c) nenhum id de tool aparece na resposta — só rótulos humanos.
 */

const {
  buildAssistantSelfDescription,
  describeCapabilities,
  scopeToolsByTenantCapabilities,
} = require('../../../api/services/askAi/assistantSelfDescription');
const { runAskAiTurn } = require('../../../api/services/askAi/orchestrator');
const { INTENTS } = require('../../../api/services/askAi/intentRouter');

function buildStore() {
  const conversations = new Map();
  return {
    openConversation: async ({ conversationId, context }) => {
      const id = conversationId || 'conv_caps';
      if (!conversations.has(id)) {
        conversations.set(id, { id, messages: [], summary: null, context: context || {}, turnCount: 0 });
      }
      return conversations.get(id);
    },
    appendTurn: async ({ conversation, question, answer, ...rest }) => {
      conversation.messages.push(
        { role: 'user', content: question },
        { role: 'assistant', content: answer, ...rest },
      );
      return { conversation, window: conversation.messages, summary: null };
    },
  };
}

describe('T-A3a — escopo por capabilities do tenant', () => {
  const tools = [
    { id: 'askai.fitness.attendanceSummary', label: 'Frequência', kind: 'attendance' },
    { id: 'askai.cases.timeline', label: 'Linha do tempo do chamado', kind: 'workspace_timeline', tenantCapability: 'caseManagement' },
  ];

  it('tool cuja tenantCapability está desligada não é anunciada', () => {
    const scoped = scopeToolsByTenantCapabilities(tools, { caseManagement: false });
    expect(scoped.map((tool) => tool.id)).toEqual(['askai.fitness.attendanceSummary']);
  });

  it('capability ligada mantém a tool', () => {
    const scoped = scopeToolsByTenantCapabilities(tools, { caseManagement: true });
    expect(scoped.length).toBe(2);
  });

  it('capabilities desconhecidas (ausentes) não escondem nada — RBAC já governa', () => {
    expect(scopeToolsByTenantCapabilities(tools, null).length).toBe(2);
    expect(scopeToolsByTenantCapabilities(tools, {}).length).toBe(2);
  });

  it('tool sem tenantCapability declarada nunca é afetada', () => {
    const scoped = scopeToolsByTenantCapabilities(
      [{ id: 'askai.fitness.attendanceSummary', label: 'Frequência' }],
      { caseManagement: false, inbox: false },
    );
    expect(scoped.length).toBe(1);
  });

  it('orquestrador consulta as capabilities do tenant no turno de capacidades', async () => {
    const getTenantCapabilities = jest.fn(async () => ({ inbox: true, caseManagement: true }));
    const store = buildStore();
    const turn = await runAskAiTurn({
      payload: { question: 'O que você pode fazer?', context: {} },
      tenantId: 'tenant-x',
      actor: { id: 'u1', username: 'op', role: 'operator' },
      deps: { ...store, getTenantCapabilities },
    });

    expect(turn.intent).toBe(INTENTS.ASSISTANT_CAPABILITIES);
    expect(getTenantCapabilities).toHaveBeenCalledWith('tenant-x');
    // O operador tem crm:read: as consultas autorizadas aparecem por rótulo.
    expect(turn.answer).toContain('Frequência');
  });

  it('falha ao ler capabilities do tenant não derruba o turno (fail-safe com RBAC)', async () => {
    const getTenantCapabilities = jest.fn(async () => {
      throw new Error('capabilities_db_error');
    });
    const store = buildStore();
    const turn = await runAskAiTurn({
      payload: { question: 'O que você pode fazer?', context: {} },
      tenantId: 'tenant-x',
      actor: { id: 'u1', username: 'op', role: 'operator' },
      deps: { ...store, getTenantCapabilities },
    });
    expect(turn.intent).toBe(INTENTS.ASSISTANT_CAPABILITIES);
    expect(turn.answer).toContain('Frequência');
  });
});

describe('T-A3b — recorte pelo contexto de tela', () => {
  it('com contexto de tela a resposta é recortada ("Aqui, em ...")', () => {
    const { answer } = buildAssistantSelfDescription({
      intent: INTENTS.ASSISTANT_CAPABILITIES,
      availableTools: ['Frequência'],
      classification: 'PRODUCTION',
      screenContext: { module: 'inbox', pageType: 'list', route: '/inbox' },
    });
    expect(answer).toMatch(/Aqui, em atendimento \(caixa de entrada\)/);
  });

  it('o recorte NUNCA expõe rota, id de entidade ou tenant', () => {
    const { answer } = buildAssistantSelfDescription({
      intent: INTENTS.ASSISTANT_CAPABILITIES,
      availableTools: ['Frequência'],
      classification: 'PRODUCTION',
      screenContext: {
        module: 'inbox',
        pageType: 'detail',
        route: '/inbox',
        entityType: 'CONVERSATION',
        entityId: '550e8400-e29b-41d4-a716-446655440000',
      },
    });
    expect(answer).not.toContain('/inbox');
    expect(answer).not.toContain('550e8400');
    expect(answer).not.toMatch(/tenant/i);
  });

  it('sem contexto de tela a resposta genérica permanece', () => {
    const { answer } = buildAssistantSelfDescription({
      intent: INTENTS.ASSISTANT_CAPABILITIES,
      availableTools: ['Frequência'],
      classification: 'PRODUCTION',
    });
    expect(answer).toMatch(/Com o seu acesso atual, eu:/);
  });
});

describe('T-A3c — projeção de rótulos nunca vaza id de tool', () => {
  it('describeCapabilities ignora entrada sem rótulo (nunca cai no id)', () => {
    const lines = describeCapabilities(['Frequência', '', null, undefined]);
    const text = lines.join('\n');
    expect(text).toContain('Frequência');
    expect(text).not.toMatch(/askai\.|undefined|null/);
  });

  it('turno de capacidades não contém nenhum id askai.* mesmo com tools sem rótulo', async () => {
    const store = buildStore();
    const turn = await runAskAiTurn({
      payload: { question: 'O que você pode fazer?', context: {} },
      tenantId: 'tenant-x',
      actor: { id: 'u1', username: 'op', role: 'operator' },
      deps: { ...store, getTenantCapabilities: async () => ({}) },
    });
    expect(turn.answer).not.toMatch(/askai\./);
  });
});
