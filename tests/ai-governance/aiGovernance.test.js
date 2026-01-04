/**
 * Testes automatizados de governança IA.
 * 
 * Valida O CONTRATO, não o modelo de IA.
 * 
 * Os testes DEVEM cobrir:
 * - RPA falha se action não estiver na whitelist
 * - RPA falha se mode !== "test-only"
 * - RPA falha se não houver assertions
 * - Chatbot falha se fluxo violar regras estruturais
 * - Chatbot falha se tipo de nó não existir
 * 
 * 📌 Os testes DEVEM chamar diretamente:
 * - validateGeneratedPlan(...)
 * - validadores de fluxo existentes
 * 
 * 🚫 NÃO chamar IA real
 * 🚫 NÃO mockar executor
 */

const { validateGeneratedPlan } = require('../../engine/ai/validateGeneratedPlan');
const { validateFlowPlan } = require('../../api/utils/validateFlowPlan');
const { validateRpaPlan } = require('../../api/utils/validateRpaPlan');
const fs = require('fs');
const path = require('path');

// Carrega whitelist de ações RPA
const actionsPath = path.join(__dirname, '../../api/data/rag/rpa/rpa.actions.json');
const rpaActions = JSON.parse(fs.readFileSync(actionsPath, 'utf8'));

// Carrega tipos de nós válidos do chatbot
const nodesPath = path.join(__dirname, '../../api/data/rag/chatbot/nodes/node.types.json');
const nodeTypes = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));
const validNodeTypes = [
  ...Object.keys(nodeTypes.nodeTypes.core || {}),
  ...Object.keys(nodeTypes.nodeTypes.system || {})
];

describe('Governança IA - Validação de Contratos', () => {
  
  describe('RPA - Validação de Whitelist de Ações', () => {
    test('deve falhar se action não estiver na whitelist', () => {
      const invalidPlan = {
        version: '1.0',
        type: 'rpa_test_plan',
        context: {
          application: 'chatbot',
          mode: 'test-only'
        },
        steps: [
          {
            action: 'invalid_action_not_in_whitelist',
            target: 'body',
            value: 'test'
          }
        ],
        assertions: [
          {
            type: 'visible',
            selector: 'body',
            expected: true
          }
        ]
      };

      const result = validateGeneratedPlan(invalidPlan, 'rpa');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: expect.stringMatching(/ACTION|WHITELIST/i)
          })
        ])
      );
    });

    test('deve passar se todas as actions estiverem na whitelist', () => {
      const validAction = rpaActions.allowed[0]; // Pega primeira ação válida
      
      const validPlan = {
        version: '1.0',
        type: 'rpa_test_plan',
        context: {
          application: 'chatbot',
          mode: 'test-only'
        },
        steps: [
          {
            action: validAction,
            target: 'body',
            value: 'test'
          }
        ],
        assertions: [
          {
            type: 'visible',
            selector: 'body',
            expected: true
          }
        ]
      };

      const result = validateGeneratedPlan(validPlan, 'rpa');
      
      // Pode ter outros erros de estrutura, mas não deve ter erro de whitelist
      const hasWhitelistError = result.errors.some(err => 
        err.type && err.type.includes('ACTION') && err.type.includes('WHITELIST')
      );
      expect(hasWhitelistError).toBe(false);
    });
  });

  describe('RPA - Validação de Mode Test-Only', () => {
    test('deve falhar se mode !== "test-only"', () => {
      const invalidPlan = {
        version: '1.0',
        type: 'rpa_test_plan',
        context: {
          application: 'chatbot',
          mode: 'production' // ❌ Inválido
        },
        steps: [
          {
            action: 'navigate',
            target: 'body',
            value: process.env.TEST_API_URL || process.env.API_BASE_URL || 'http://localhost:3000'
          }
        ],
        assertions: [
          {
            type: 'visible',
            selector: 'body',
            expected: true
          }
        ]
      };

      const result = validateGeneratedPlan(invalidPlan, 'rpa');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'TEST_ONLY_REQUIRED'
          })
        ])
      );
    });

    test('deve passar se mode === "test-only"', () => {
      const validPlan = {
        version: '1.0',
        type: 'rpa_test_plan',
        context: {
          application: 'chatbot',
          mode: 'test-only' // ✅ Válido
        },
        steps: [
          {
            action: 'navigate',
            target: 'body',
            value: process.env.TEST_API_URL || process.env.API_BASE_URL || 'http://localhost:3000'
          }
        ],
        assertions: [
          {
            type: 'visible',
            selector: 'body',
            expected: true
          }
        ]
      };

      const result = validateGeneratedPlan(validPlan, 'rpa');
      
      // Não deve ter erro de TEST_ONLY_REQUIRED
      const hasTestOnlyError = result.errors.some(err => 
        err.type === 'TEST_ONLY_REQUIRED'
      );
      expect(hasTestOnlyError).toBe(false);
    });
  });

  describe('RPA - Validação de Assertions Obrigatórias', () => {
    test('deve falhar se não houver assertions', () => {
      const invalidPlan = {
        version: '1.0',
        type: 'rpa_test_plan',
        context: {
          application: 'chatbot',
          mode: 'test-only'
        },
        steps: [
          {
            action: 'navigate',
            target: 'body',
            value: process.env.TEST_API_URL || process.env.API_BASE_URL || 'http://localhost:3000'
          }
        ],
        assertions: [] // ❌ Vazio
      };

      const result = validateGeneratedPlan(invalidPlan, 'rpa');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'ASSERTIONS_REQUIRED'
          })
        ])
      );
    });

    test('deve passar se houver pelo menos uma assertion', () => {
      const validPlan = {
        version: '1.0',
        type: 'rpa_test_plan',
        context: {
          application: 'chatbot',
          mode: 'test-only'
        },
        steps: [
          {
            action: 'navigate',
            target: 'body',
            value: process.env.TEST_API_URL || process.env.API_BASE_URL || 'http://localhost:3000'
          }
        ],
        assertions: [
          {
            type: 'visible',
            selector: 'body',
            expected: true
          }
        ]
      };

      const result = validateGeneratedPlan(validPlan, 'rpa');
      
      // Não deve ter erro de ASSERTIONS_REQUIRED
      const hasAssertionsError = result.errors.some(err => 
        err.type === 'ASSERTIONS_REQUIRED'
      );
      expect(hasAssertionsError).toBe(false);
    });
  });

  describe('Chatbot - Validação de Regras Estruturais', () => {
    test('deve falhar se fluxo violar regras estruturais (sem nó start)', () => {
      const invalidFlow = {
        id: 'flow-1',
        nodes: [
          {
            id: 'message_1',
            type: 'message',
            config: {
              text: 'Olá'
            }
          }
        ],
        edges: []
      };

      const result = validateGeneratedPlan(invalidFlow, 'chatbot');
      
      expect(result.valid).toBe(false);
      // Deve ter erros de validação estrutural
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('deve falhar se tipo de nó não existir', () => {
      const invalidFlow = {
        id: 'flow-1',
        nodes: [
          {
            id: 'start_1',
            type: 'invalid_node_type_that_does_not_exist', // ❌ Tipo inválido
            config: {}
          }
        ],
        edges: []
      };

      const result = validateGeneratedPlan(invalidFlow, 'chatbot');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: expect.stringMatching(/NODE_TYPE|INVALID/i)
          })
        ])
      );
    });

    test('deve passar se fluxo seguir regras estruturais e tipos válidos', () => {
      const validFlow = {
        id: 'flow-1',
        nodes: [
          {
            id: 'start_1',
            type: 'start', // ✅ Tipo válido
            config: {
              message: 'Bem-vindo'
            },
            next: 'message_1'
          },
          {
            id: 'message_1',
            type: 'message', // ✅ Tipo válido
            config: {
              text: 'Olá! Como posso ajudar?'
            },
            next: 'end_1'
          },
          {
            id: 'end_1',
            type: 'end', // ✅ Tipo válido
            config: {}
          }
        ],
        edges: []
      };

      const result = validateGeneratedPlan(validFlow, 'chatbot');
      
      // Não deve ter erros de tipo de nó inválido
      const hasInvalidNodeTypeError = result.errors.some(err => 
        err.type === 'INVALID_NODE_TYPE'
      );
      expect(hasInvalidNodeTypeError).toBe(false);
    });
  });

  describe('Validação Direta dos Validadores', () => {
    test('validateRpaPlan deve rejeitar action fora da whitelist', () => {
      const invalidPlan = {
        version: '1.0',
        type: 'rpa_test_plan',
        context: {
          application: 'chatbot',
          mode: 'test-only'
        },
        steps: [
          {
            action: 'invalid_action',
            target: 'body'
          }
        ],
        assertions: [
          {
            type: 'visible',
            selector: 'body',
            expected: true
          }
        ]
      };

      const result = validateRpaPlan(invalidPlan);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: expect.stringMatching(/ACTION|WHITELIST/i)
          })
        ])
      );
    });

    test('validateFlowPlan deve rejeitar tipo de nó inválido', () => {
      const invalidFlow = {
        id: 'flow-1',
        nodes: [
          {
            id: 'node_1',
            type: 'invalid_type',
            config: {}
          }
        ],
        edges: []
      };

      const result = validateFlowPlan(invalidFlow);
      
      expect(result.valid).toBe(false);
      // Deve ter erro relacionado a tipo de nó
      const hasNodeTypeError = result.errors.some(err => 
        err.type && err.type.includes('NODE_TYPE')
      );
      expect(hasNodeTypeError).toBe(true);
    });
  });
});

