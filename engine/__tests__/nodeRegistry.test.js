/**
 * Testes para NodeRegistry
 */

const { NodeRegistry } = require('../nodeRegistry');

describe('NodeRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new NodeRegistry();
  });

  describe('register', () => {
    test('deve registrar um handler para um tipo de nó', () => {
      const handler = jest.fn();
      registry.register('test_node', handler);
      
      expect(registry.get('test_node')).toBe(handler);
    });

    test('deve lançar erro se tentar registrar o mesmo tipo duas vezes', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      registry.register('test_node', handler1);
      
      expect(() => {
        registry.register('test_node', handler2);
      }).toThrow('Node type already registered: test_node');
    });

    test('deve permitir registrar múltiplos tipos diferentes', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();
      
      registry.register('node1', handler1);
      registry.register('node2', handler2);
      registry.register('node3', handler3);
      
      expect(registry.get('node1')).toBe(handler1);
      expect(registry.get('node2')).toBe(handler2);
      expect(registry.get('node3')).toBe(handler3);
    });
  });

  describe('get', () => {
    test('deve retornar o handler registrado', () => {
      const handler = jest.fn();
      registry.register('test_node', handler);
      
      const retrieved = registry.get('test_node');
      expect(retrieved).toBe(handler);
    });

    test('deve lançar erro se o tipo não estiver registrado', () => {
      expect(() => {
        registry.get('non_existent');
      }).toThrow('No handler registered for node type: non_existent');
    });

    test('deve retornar handlers diferentes para tipos diferentes', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      registry.register('type1', handler1);
      registry.register('type2', handler2);
      
      expect(registry.get('type1')).toBe(handler1);
      expect(registry.get('type2')).toBe(handler2);
      expect(registry.get('type1')).not.toBe(handler2);
    });
  });
});

