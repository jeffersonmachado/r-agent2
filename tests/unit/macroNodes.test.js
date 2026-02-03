describe('Macro nodes (semantic_router, rag_answer, business_entry)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  describe('semantic_router', () => {
    it('roteia para main quando confidence >= threshold', async () => {
      const { semanticRouterNodeHandler } = require('../../engine/nodes/semanticRouterNode');

      const node = {
        id: 'sr1',
        type: 'semantic_router',
        config: {
          confidenceThreshold: 0.6,
          examples: ['comprar', 'quero comprar'],
        },
        next: { main: 'n_main', fallback: 'n_fallback' },
      };

      const state = {
        sessionId: 's1',
        flowId: 'f1',
        tenantId: 't1',
        currentNodeId: 'sr1',
        variables: {},
        history: [],
        metadata: {},
      };

      const res = await semanticRouterNodeHandler(node, state, { text: 'quero comprar agora' });
      expect(res.output.type).toBe('semantic_router');
      expect(res.output.route).toBe('main');
      expect(res.nextState.currentNodeId).toBe('n_main');
      expect(res.nextState.variables['ai.sr1.value']).toBe('main');
      expect(res.nextState.variables['ai.sr1.confidence']).toBeGreaterThanOrEqual(0.6);
    });

    it('roteia para fallback quando não há match', async () => {
      const { semanticRouterNodeHandler } = require('../../engine/nodes/semanticRouterNode');

      const node = {
        id: 'sr2',
        type: 'semantic_router',
        config: {
          confidenceThreshold: 0.6,
          examples: ['comprar'],
        },
        next: { main: 'n_main', fallback: 'n_fallback' },
      };

      const state = {
        sessionId: 's1',
        flowId: 'f1',
        tenantId: 't1',
        currentNodeId: 'sr2',
        variables: {},
        history: [],
        metadata: {},
      };

      const res = await semanticRouterNodeHandler(node, state, { text: 'preciso de suporte' });
      expect(res.output.route).toBe('fallback');
      expect(res.nextState.currentNodeId).toBe('n_fallback');
      expect(res.nextState.variables['ai.sr2.value']).toBeNull();
      expect(res.nextState.variables['ai.sr2.confidence']).toBe(0);
    });
  });

  describe('rag_answer', () => {
    it('reutiliza aiNodeHandler com useRag=true e ragTopK', async () => {
      const aiNodeHandler = jest.fn().mockResolvedValue({
        nextState: { currentNodeId: 'n2', variables: {} },
        events: [],
        output: { type: 'ai', text: 'ok' },
      });

      jest.doMock('../../engine/nodes/aiNode', () => ({
        aiNodeHandler,
      }));

      const { ragAnswerNodeHandler } = require('../../engine/nodes/ragAnswerNode');

      const node = {
        id: 'r1',
        type: 'rag_answer',
        config: { topK: 7, promptTemplate: 'Pergunta: {{user_input}}', temperature: 0.2 },
        next: 'n2',
      };

      const state = { currentNodeId: 'r1', variables: { user_input: 'oi' } };

      await ragAnswerNodeHandler(node, state, { text: 'oi' });
      expect(aiNodeHandler).toHaveBeenCalledTimes(1);
      const calledNode = aiNodeHandler.mock.calls[0][0];
      expect(calledNode.type).toBe('ai');
      expect(calledNode.config.useRag).toBe(true);
      expect(calledNode.config.ragTopK).toBe(7);
      expect(calledNode.config.outputVariable).toBe('rag.r1.text');
    });
  });

  describe('business_entry', () => {
    it('sem executionId -> route skip', async () => {
      jest.doMock('../../api/services/business-entities.service', () => ({
        extractBusinessEntities: jest.fn(),
      }));

      const { businessEntryNodeHandler } = require('../../engine/nodes/businessEntryNode');

      const node = {
        id: 'b1',
        type: 'business_entry',
        config: {},
        next: { selected: 'n_sel', skip: 'n_skip' },
      };

      const state = {
        sessionId: 's1',
        flowId: 'f1',
        tenantId: 't1',
        currentNodeId: 'b1',
        variables: {},
        history: [],
        metadata: {},
      };

      const res = await businessEntryNodeHandler(node, state, { text: 'oi' });
      expect(res.output.type).toBe('business_entry');
      expect(res.output.route).toBe('skip');
      expect(res.nextState.currentNodeId).toBe('n_skip');
    });

    it('com services -> emite options e guarda options no state', async () => {
      const extractBusinessEntities = jest.fn().mockResolvedValue({
        ok: true,
        entities: { services: ['Corte', 'Barba'] },
      });

      jest.doMock('../../api/services/business-entities.service', () => ({
        extractBusinessEntities,
      }));

      const { businessEntryNodeHandler } = require('../../engine/nodes/businessEntryNode');

      const node = {
        id: 'b2',
        type: 'business_entry',
        config: {},
        next: { selected: 'n_sel', skip: 'n_skip' },
      };

      const state = {
        sessionId: 's1',
        flowId: 'f1',
        tenantId: 't1',
        currentNodeId: 'b2',
        variables: {},
        history: [],
        metadata: { executionId: 'exec-1', dryRun: true },
      };

      const res = await businessEntryNodeHandler(node, state, { text: 'oi' });
      expect(res.output.type).toBe('options');
      expect(Array.isArray(res.output.options)).toBe(true);
      expect(res.output.options.length).toBe(2);
      expect(res.nextState.variables['business_entry.b2.options']).toHaveLength(2);
      expect(extractBusinessEntities).toHaveBeenCalledWith({ tenantId: 't1', executionId: 'exec-1', dryRun: true });
    });
  });

  describe('runner + options waiting', () => {
    it('mantém currentNodeId no nó options até haver seleção', async () => {
      const { NodeRegistry } = require('../../engine/nodeRegistry');
      const { runStep } = require('../../engine/runner');
      const { optionsNodeHandler, endNodeHandler } = require('../../engine/nodes/basicNodes');

      const flow = {
        id: 'f1',
        nodes: [
          {
            id: 'opt',
            type: 'options',
            config: {
              message: 'Escolha',
              optionsType: 'button',
              options: [{ id: 'a', label: 'A' }],
              variable: 'choice',
            },
            next: 'end',
          },
          { id: 'end', type: 'end', config: {}, next: null },
        ],
        metadata: {},
      };

      const registry = new NodeRegistry();
      registry.register('options', optionsNodeHandler);
      registry.register('end', endNodeHandler);

      const state = {
        sessionId: 's1',
        flowId: 'f1',
        tenantId: 't1',
        currentNodeId: 'opt',
        variables: {},
        history: [],
        metadata: {},
      };

      const step1 = await runStep(flow, state, registry, undefined);
      expect(step1.output.type).toBe('options');
      expect(step1.nextState.currentNodeId).toBe('opt'); // aguardando seleção

      const step2 = await runStep(flow, step1.nextState, registry, { optionId: 'a' });
      expect(step2.nextState.currentNodeId).toBe('end');
      expect(step2.nextState.variables.choice).toBe('a');
    });
  });
});

