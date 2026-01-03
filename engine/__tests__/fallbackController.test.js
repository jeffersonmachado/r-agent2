/**
 * Testes para fallbackController.js
 */

const {
  FALLBACK_TYPES,
  FALLBACK_ACTIONS,
  ESCALATION_MODES,
  processFallback,
  createFallbackContext,
  decideFallbackAction,
} = require('../fallbackController');

describe('fallbackController', () => {
  describe('FALLBACK_TYPES', () => {
    test('deve ter todos os tipos de fallback definidos', () => {
      expect(FALLBACK_TYPES.INTENT).toBe('intent');
      expect(FALLBACK_TYPES.FLOW).toBe('flow');
      expect(FALLBACK_TYPES.DATA).toBe('data');
      expect(FALLBACK_TYPES.SYSTEM).toBe('system');
      expect(FALLBACK_TYPES.TIMEOUT).toBe('timeout');
      expect(FALLBACK_TYPES.NO_MATCH).toBe('no_match');
    });
  });

  describe('FALLBACK_ACTIONS', () => {
    test('deve ter todas as ações de fallback definidas', () => {
      expect(FALLBACK_ACTIONS.RETRY).toBe('retry');
      expect(FALLBACK_ACTIONS.OPTIONS).toBe('options');
      expect(FALLBACK_ACTIONS.HUMAN).toBe('human');
      expect(FALLBACK_ACTIONS.END).toBe('end');
    });
  });

  describe('ESCALATION_MODES', () => {
    test('deve ter todos os modos de escalada definidos', () => {
      expect(ESCALATION_MODES.TICKET).toBe('ticket');
      expect(ESCALATION_MODES.HUMAN).toBe('human');
    });
  });

  describe('createFallbackContext', () => {
    test('deve criar contexto inicial com attempt 1', () => {
      const context = createFallbackContext('session-1', 'node-1');

      expect(context.sessionId).toBe('session-1');
      expect(context.nodeId).toBe('node-1');
      expect(context.attempt).toBe(1);
      expect(context.recentFallbacks).toHaveLength(1);
      expect(context.userMessage).toBeNull();
    });

    test('deve incrementar attempt baseado em fallbacks anteriores', () => {
      const previousFallbacks = [
        { nodeId: 'node-1', timestamp: Date.now() },
        { nodeId: 'node-1', timestamp: Date.now() },
      ];

      const context = createFallbackContext('session-1', 'node-1', null, previousFallbacks);

      expect(context.attempt).toBe(3);
      expect(context.recentFallbacks).toHaveLength(3);
    });

    test('deve incluir userMessage quando fornecido', () => {
      const context = createFallbackContext('session-1', 'node-1', 'Hello');

      expect(context.userMessage).toBe('Hello');
    });

    test('deve manter apenas últimos 5 fallbacks', () => {
      const previousFallbacks = Array.from({ length: 10 }, (_, i) => ({
        nodeId: `node-${i}`,
        timestamp: Date.now(),
      }));

      const context = createFallbackContext('session-1', 'node-new', null, previousFallbacks);

      expect(context.recentFallbacks).toHaveLength(5);
    });
  });

  describe('decideFallbackAction', () => {
    test('deve retornar RETRY na primeira tentativa', () => {
      const context = {
        attempt: 1,
        nodeId: 'node-1',
        sessionId: 'session-1',
        recentFallbacks: [],
      };

      const action = decideFallbackAction(FALLBACK_TYPES.INTENT, context);

      expect(action).toBe(FALLBACK_ACTIONS.RETRY);
    });

    test('deve retornar OPTIONS na segunda tentativa', () => {
      const context = {
        attempt: 2,
        nodeId: 'node-1',
        sessionId: 'session-1',
        recentFallbacks: [],
      };

      const action = decideFallbackAction(FALLBACK_TYPES.INTENT, context);

      expect(action).toBe(FALLBACK_ACTIONS.OPTIONS);
    });

    test('deve retornar HUMAN quando maxAttempts é atingido', () => {
      const context = {
        attempt: 3,
        nodeId: 'node-1',
        sessionId: 'session-1',
        recentFallbacks: [],
      };

      const config = { maxAttempts: 3 };
      const action = decideFallbackAction(FALLBACK_TYPES.INTENT, context, config);

      expect(action).toBe(FALLBACK_ACTIONS.HUMAN);
    });

    test('deve detectar loop e retornar HUMAN', () => {
      const context = {
        attempt: 1,
        nodeId: 'node-1',
        sessionId: 'session-1',
        recentFallbacks: [
          { nodeId: 'node-1', timestamp: Date.now() },
          { nodeId: 'node-1', timestamp: Date.now() },
        ],
      };

      const action = decideFallbackAction(FALLBACK_TYPES.INTENT, context);

      expect(action).toBe(FALLBACK_ACTIONS.HUMAN);
    });

    test('deve detectar frustração e retornar HUMAN', () => {
      const context = {
        attempt: 1,
        nodeId: 'node-1',
        sessionId: 'session-1',
        userMessage: 'não entendi nada',
        recentFallbacks: [],
      };

      const config = { enableEmotionCheck: true };
      const action = decideFallbackAction(FALLBACK_TYPES.INTENT, context, config);

      expect(action).toBe(FALLBACK_ACTIONS.HUMAN);
    });

    test('deve ignorar frustração quando enableEmotionCheck é false', () => {
      const context = {
        attempt: 1,
        nodeId: 'node-1',
        sessionId: 'session-1',
        userMessage: 'não entendi nada',
        recentFallbacks: [],
      };

      const config = { enableEmotionCheck: false };
      const action = decideFallbackAction(FALLBACK_TYPES.INTENT, context, config);

      expect(action).toBe(FALLBACK_ACTIONS.RETRY);
    });

    test('deve retornar HUMAN na terceira tentativa ou mais', () => {
      const context = {
        attempt: 3,
        nodeId: 'node-1',
        sessionId: 'session-1',
        recentFallbacks: [],
      };

      const action = decideFallbackAction(FALLBACK_TYPES.INTENT, context);

      expect(action).toBe(FALLBACK_ACTIONS.HUMAN);
    });
  });

  describe('processFallback', () => {
    test('deve processar fallback e retornar ação e modo de escalada', () => {
      const context = {
        attempt: 1,
        nodeId: 'node-1',
        sessionId: 'session-1',
        recentFallbacks: [],
      };

      const result = processFallback(FALLBACK_TYPES.INTENT, context);

      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('escalationMode');
      expect(result).toHaveProperty('metadata');
      expect(result.action).toBe(FALLBACK_ACTIONS.RETRY);
      expect(result.escalationMode).toBe(ESCALATION_MODES.TICKET);
    });

    test('deve usar modo de escalada configurado', () => {
      const context = {
        attempt: 3,
        nodeId: 'node-1',
        sessionId: 'session-1',
        recentFallbacks: [],
      };

      const config = { escalationMode: ESCALATION_MODES.HUMAN };
      const result = processFallback(FALLBACK_TYPES.INTENT, context, config);

      expect(result.escalationMode).toBe(ESCALATION_MODES.HUMAN);
    });

    test('deve usar TICKET como padrão quando modo inválido', () => {
      const context = {
        attempt: 3,
        nodeId: 'node-1',
        sessionId: 'session-1',
        recentFallbacks: [],
      };

      const config = { escalationMode: 'invalid' };
      const result = processFallback(FALLBACK_TYPES.INTENT, context, config);

      expect(result.escalationMode).toBe(ESCALATION_MODES.TICKET);
    });

    test('deve incluir metadata completo', () => {
      const context = {
        attempt: 2,
        nodeId: 'node-1',
        sessionId: 'session-1',
        recentFallbacks: [],
      };

      const result = processFallback(FALLBACK_TYPES.SYSTEM, context);

      expect(result.metadata).toHaveProperty('fallbackType', FALLBACK_TYPES.SYSTEM);
      expect(result.metadata).toHaveProperty('attempt', 2);
      expect(result.metadata).toHaveProperty('nodeId', 'node-1');
      expect(result.metadata).toHaveProperty('sessionId', 'session-1');
      expect(result.metadata).toHaveProperty('timestamp');
    });

    test('deve processar diferentes tipos de fallback', () => {
      const context = {
        attempt: 1,
        nodeId: 'node-1',
        sessionId: 'session-1',
        recentFallbacks: [],
      };

      const types = [
        FALLBACK_TYPES.INTENT,
        FALLBACK_TYPES.FLOW,
        FALLBACK_TYPES.DATA,
        FALLBACK_TYPES.SYSTEM,
        FALLBACK_TYPES.TIMEOUT,
        FALLBACK_TYPES.NO_MATCH,
      ];

      types.forEach(type => {
        const result = processFallback(type, context);
        expect(result.metadata.fallbackType).toBe(type);
      });
    });
  });
});

