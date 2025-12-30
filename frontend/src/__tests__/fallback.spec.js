/**
 * Testes automatizados para sistema de fallback.
 * 
 * Cenários obrigatórios:
 * 1. Texto sem intenção reconhecida
 * 2. Confiança abaixo do threshold
 * 3. Nó desconectado
 * 4. Erro simulado de API
 * 5. 3 falhas consecutivas → escalada humana
 * 6. Loop detectado
 * 7. Log de fallback gerado corretamente
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  processFallback,
  createFallbackContext,
  FALLBACK_TYPES,
  FALLBACK_ACTIONS,
} from '../core/FallbackController';
import { validateFlow } from '../editor/flowValidator';
import logger from '../utils/logger';

// Mock do logger para verificar chamadas
vi.mock('../utils/logger', () => ({
  default: {
    event: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Sistema de Fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('FallbackController', () => {
    describe('processFallback', () => {
      it('deve retornar RETRY na primeira tentativa', () => {
        const context = createFallbackContext('session-1', 'node-1');
        const result = processFallback(FALLBACK_TYPES.INTENT, context);
        
        expect(result.action).toBe(FALLBACK_ACTIONS.RETRY);
        expect(result.metadata.attempt).toBe(1);
        expect(logger.event).toHaveBeenCalledWith(
          'fallback_triggered',
          expect.objectContaining({
            fallbackType: FALLBACK_TYPES.INTENT,
            attempt: 1,
            action: FALLBACK_ACTIONS.RETRY,
          })
        );
      });

      it('deve retornar OPTIONS na segunda tentativa', () => {
        const previousFallbacks = [{ nodeId: 'node-1', timestamp: Date.now() }];
        const context = createFallbackContext('session-1', 'node-1', null, previousFallbacks);
        const result = processFallback(FALLBACK_TYPES.INTENT, context);
        
        expect(result.action).toBe(FALLBACK_ACTIONS.OPTIONS);
        expect(result.metadata.attempt).toBe(2);
      });

      it('deve retornar HUMAN na terceira tentativa ou mais', () => {
        const previousFallbacks = [
          { nodeId: 'node-1', timestamp: Date.now() - 2000 },
          { nodeId: 'node-1', timestamp: Date.now() - 1000 },
        ];
        const context = createFallbackContext('session-1', 'node-1', null, previousFallbacks);
        const result = processFallback(FALLBACK_TYPES.INTENT, context);
        
        expect(result.action).toBe(FALLBACK_ACTIONS.HUMAN);
        expect(result.metadata.attempt).toBe(3);
      });

      it('deve escalar para HUMAN quando maxAttempts é atingido', () => {
        const previousFallbacks = [
          { nodeId: 'node-1', timestamp: Date.now() - 2000 },
          { nodeId: 'node-1', timestamp: Date.now() - 1000 },
        ];
        const context = createFallbackContext('session-1', 'node-1', null, previousFallbacks);
        const config = { maxAttempts: 3 };
        const result = processFallback(FALLBACK_TYPES.INTENT, context, config);
        
        expect(result.action).toBe(FALLBACK_ACTIONS.HUMAN);
        expect(logger.event).toHaveBeenCalledWith(
          'fallback_max_attempts_reached',
          expect.objectContaining({
            attempt: 3,
            maxAttempts: 3,
          })
        );
      });

      it('deve detectar frustração e escalar para HUMAN', () => {
        const context = createFallbackContext('session-1', 'node-1', 'não entendi nada');
        const config = { enableEmotionCheck: true };
        const result = processFallback(FALLBACK_TYPES.INTENT, context, config);
        
        expect(result.action).toBe(FALLBACK_ACTIONS.HUMAN);
        expect(logger.event).toHaveBeenCalledWith(
          'fallback_frustration_detected',
          expect.objectContaining({
            userMessage: expect.stringContaining('não entendi'),
          })
        );
      });

      it('deve detectar loop e escalar para HUMAN imediatamente', () => {
        const previousFallbacks = [
          { nodeId: 'node-1', timestamp: Date.now() - 2000 },
          { nodeId: 'node-1', timestamp: Date.now() - 1000 },
          { nodeId: 'node-2', timestamp: Date.now() - 500 },
        ];
        const context = createFallbackContext('session-1', 'node-1', null, previousFallbacks);
        const result = processFallback(FALLBACK_TYPES.INTENT, context);
        
        expect(result.action).toBe(FALLBACK_ACTIONS.HUMAN);
        expect(logger.event).toHaveBeenCalledWith(
          'fallback_loop_detected',
          expect.objectContaining({
            nodeId: 'node-1',
          })
        );
      });

      it('deve processar diferentes tipos de fallback', () => {
        const types = [
          FALLBACK_TYPES.INTENT,
          FALLBACK_TYPES.FLOW,
          FALLBACK_TYPES.DATA,
          FALLBACK_TYPES.SYSTEM,
          FALLBACK_TYPES.TIMEOUT,
          FALLBACK_TYPES.NO_MATCH,
        ];

        types.forEach(type => {
          const context = createFallbackContext('session-1', 'node-1');
          const result = processFallback(type, context);
          
          expect(result.action).toBeDefined();
          expect(result.metadata.fallbackType).toBe(type);
        });
      });
    });

    describe('createFallbackContext', () => {
      it('deve criar contexto inicial com attempt 1', () => {
        const context = createFallbackContext('session-1', 'node-1');
        
        expect(context.sessionId).toBe('session-1');
        expect(context.nodeId).toBe('node-1');
        expect(context.attempt).toBe(1);
        expect(context.recentFallbacks).toHaveLength(1);
      });

      it('deve incrementar attempt baseado em fallbacks anteriores', () => {
        const previousFallbacks = [
          { nodeId: 'node-1', timestamp: Date.now() - 2000 },
          { nodeId: 'node-1', timestamp: Date.now() - 1000 },
        ];
        const context = createFallbackContext('session-1', 'node-1', null, previousFallbacks);
        
        expect(context.attempt).toBe(3);
        expect(context.recentFallbacks).toHaveLength(3);
      });

      it('deve manter apenas últimos 5 fallbacks no histórico', () => {
        const previousFallbacks = Array.from({ length: 10 }, (_, i) => ({
          nodeId: 'node-1',
          timestamp: Date.now() - (10 - i) * 1000,
        }));
        const context = createFallbackContext('session-1', 'node-1', null, previousFallbacks);
        
        expect(context.recentFallbacks.length).toBeLessThanOrEqual(5);
      });
    });
  });

  describe('flowValidator', () => {
    describe('validateFlow', () => {
      it('deve rejeitar fluxo sem FallbackNode', () => {
        const flow = {
          nodes: [
            { id: '1', type: 'start' },
            { id: '2', type: 'message', config: { text: 'Olá' } },
          ],
          connections: [
            { source: '1', target: '2' },
          ],
        };

        const result = validateFlow(flow);
        
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.code === 'NO_FALLBACK_NODE')).toBe(true);
      });

      it('deve aceitar fluxo com FallbackNode', () => {
        const flow = {
          nodes: [
            { id: '1', type: 'start' },
            { id: '2', type: 'message', config: { text: 'Olá' } },
            { id: '3', type: 'fallback' },
          ],
          connections: [
            { source: '1', target: '2' },
            { source: '2', target: '3' },
          ],
        };

        const result = validateFlow(flow);
        
        // Pode ter outros erros, mas não deve ter erro de falta de FallbackNode
        expect(result.errors.some(e => e.code === 'NO_FALLBACK_NODE')).toBe(false);
      });

      it('deve detectar nós órfãos', () => {
        const flow = {
          nodes: [
            { id: '1', type: 'start' },
            { id: '2', type: 'message', config: { text: 'Olá' } },
            { id: '3', type: 'fallback' },
            { id: '4', type: 'message', config: { text: 'Órfão' } }, // Nó desconectado
          ],
          connections: [
            { source: '1', target: '2' },
            { source: '2', target: '3' },
          ],
        };

        const result = validateFlow(flow);
        
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.code === 'ORPHAN_NODE')).toBe(true);
      });

      it('deve detectar caminhos sem término adequado', () => {
        const flow = {
          nodes: [
            { id: '1', type: 'start' },
            { id: '2', type: 'message', config: { text: 'Olá' } },
            { id: '3', type: 'message', config: { text: 'Sem saída' } }, // Dead end
          ],
          connections: [
            { source: '1', target: '2' },
            { source: '2', target: '3' },
            // Nó 3 não tem saída e não é fallback nem end
          ],
        };

        const result = validateFlow(flow);
        
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.code === 'PATH_WITHOUT_TERMINATION')).toBe(true);
      });

      it('deve detectar loops estruturais', () => {
        const flow = {
          nodes: [
            { id: '1', type: 'start' },
            { id: '2', type: 'message', config: { text: 'A' } },
            { id: '3', type: 'message', config: { text: 'B' } },
            { id: '4', type: 'fallback' },
          ],
          connections: [
            { source: '1', target: '2' },
            { source: '2', target: '3' },
            { source: '3', target: '2' }, // Loop: 2 -> 3 -> 2
            { source: '3', target: '4' },
          ],
        };

        const result = validateFlow(flow);
        
        // Loop é warning, não erro crítico
        expect(result.errors.some(e => e.code === 'STRUCTURAL_LOOP' && e.severity === 'warning')).toBe(true);
      });

      it('deve validar estrutura básica do fluxo', () => {
        const invalidFlows = [
          null,
          undefined,
          {},
          { nodes: null },
          { nodes: [] },
        ];

        invalidFlows.forEach(flow => {
          const result = validateFlow(flow);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.code === 'INVALID_FLOW_STRUCTURE')).toBe(true);
        });
      });

      it('deve aceitar fluxo válido com FallbackNode e término adequado', () => {
        const flow = {
          nodes: [
            { id: '1', type: 'start' },
            { id: '2', type: 'message', config: { text: 'Olá' } },
            { id: '3', type: 'fallback' },
          ],
          connections: [
            { source: '1', target: '2' },
            { source: '2', target: '3' },
          ],
        };

        const result = validateFlow(flow);
        
        // Deve ser válido (sem erros críticos)
        expect(result.valid).toBe(true);
        expect(result.errors.length).toBe(0);
      });
    });
  });

  describe('Integração', () => {
    it('deve processar fallback e validar fluxo corretamente', () => {
      // Simula cenário completo
      const flow = {
        nodes: [
          { id: '1', type: 'start' },
          { id: '2', type: 'user_input' },
          { id: '3', type: 'fallback' },
        ],
        connections: [
          { source: '1', target: '2' },
          { source: '2', target: '3' },
        ],
      };

      const validationResult = validateFlow(flow);
      expect(validationResult.valid).toBe(true);

      // Simula fallback após erro
      const context = createFallbackContext('session-1', '2', 'texto sem intenção');
      const fallbackResult = processFallback(FALLBACK_TYPES.NO_MATCH, context);
      
      expect(fallbackResult.action).toBe(FALLBACK_ACTIONS.RETRY);
      expect(logger.event).toHaveBeenCalled();
    });
  });
});

