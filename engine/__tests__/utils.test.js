/**
 * Testes para utils.js
 */

const {
  nowIso,
  createEngineEvent,
  findNode,
  normalizeNext,
  getAllNextConnections,
} = require('../utils');

describe('utils', () => {
  describe('nowIso', () => {
    test('deve retornar uma string ISO válida', () => {
      const iso = nowIso();
      expect(typeof iso).toBe('string');
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(() => new Date(iso)).not.toThrow();
    });

    test('deve retornar timestamps diferentes em chamadas diferentes', async () => {
      const iso1 = nowIso();
      await new Promise(resolve => setTimeout(resolve, 10));
      const iso2 = nowIso();
      expect(iso1).not.toBe(iso2);
    });
  });

  describe('createEngineEvent', () => {
    test('deve criar um evento com campos obrigatórios', () => {
      const event = createEngineEvent({
        sessionId: 'session-1',
        flowId: 'flow-1',
        type: 'TEST_EVENT',
      });

      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('timestamp');
      expect(event.sessionId).toBe('session-1');
      expect(event.flowId).toBe('flow-1');
      expect(event.type).toBe('TEST_EVENT');
      expect(event.nodeId).toBeNull();
      expect(event.payload).toEqual({});
    });

    test('deve incluir nodeId quando fornecido', () => {
      const event = createEngineEvent({
        sessionId: 'session-1',
        flowId: 'flow-1',
        nodeId: 'node-1',
        type: 'TEST_EVENT',
      });

      expect(event.nodeId).toBe('node-1');
    });

    test('deve incluir payload quando fornecido', () => {
      const payload = { key: 'value', number: 42 };
      const event = createEngineEvent({
        sessionId: 'session-1',
        flowId: 'flow-1',
        type: 'TEST_EVENT',
        payload,
      });

      expect(event.payload).toEqual(payload);
    });

    test('deve usar payload vazio quando não fornecido', () => {
      const event = createEngineEvent({
        sessionId: 'session-1',
        flowId: 'flow-1',
        type: 'TEST_EVENT',
      });

      expect(event.payload).toEqual({});
    });

    test('deve gerar IDs únicos para eventos diferentes', () => {
      const event1 = createEngineEvent({
        sessionId: 'session-1',
        flowId: 'flow-1',
        type: 'TEST_EVENT',
      });
      const event2 = createEngineEvent({
        sessionId: 'session-1',
        flowId: 'flow-1',
        type: 'TEST_EVENT',
      });

      expect(event1.id).not.toBe(event2.id);
    });
  });

  describe('findNode', () => {
    const flow = {
      id: 'flow-1',
      nodes: [
        { id: 'node-1', type: 'message' },
        { id: 'node-2', type: 'router' },
        { id: 'node-3', type: 'end' },
      ],
    };

    test('deve encontrar um nó existente', () => {
      const node = findNode(flow, 'node-2');
      expect(node).toEqual({ id: 'node-2', type: 'router' });
    });

    test('deve retornar null para nó inexistente', () => {
      const node = findNode(flow, 'node-999');
      expect(node).toBeNull();
    });

    test('deve retornar null para fluxo sem nós', () => {
      const emptyFlow = { id: 'flow-empty', nodes: [] };
      const node = findNode(emptyFlow, 'node-1');
      expect(node).toBeNull();
    });

    test('deve encontrar o primeiro nó', () => {
      const node = findNode(flow, 'node-1');
      expect(node).toEqual({ id: 'node-1', type: 'message' });
    });

    test('deve encontrar o último nó', () => {
      const node = findNode(flow, 'node-3');
      expect(node).toEqual({ id: 'node-3', type: 'end' });
    });
  });

  describe('normalizeNext', () => {
    test('deve retornar string quando next é string', () => {
      expect(normalizeNext('node-1')).toBe('node-1');
    });

    test('deve retornar primeiro elemento quando next é array', () => {
      expect(normalizeNext(['node-1', 'node-2'])).toBe('node-1');
    });

    test('deve retornar null quando next é null', () => {
      expect(normalizeNext(null)).toBeNull();
    });

    test('deve retornar null quando next é undefined', () => {
      expect(normalizeNext(undefined)).toBeNull();
    });

    test('deve retornar null quando next é array vazio', () => {
      expect(normalizeNext([])).toBeNull();
    });

    test('deve retornar null quando next é string vazia', () => {
      expect(normalizeNext('')).toBeNull();
    });
  });

  describe('getAllNextConnections', () => {
    test('deve retornar array com string quando next é string', () => {
      expect(getAllNextConnections('node-1')).toEqual(['node-1']);
    });

    test('deve retornar array completo quando next é array', () => {
      expect(getAllNextConnections(['node-1', 'node-2', 'node-3'])).toEqual([
        'node-1',
        'node-2',
        'node-3',
      ]);
    });

    test('deve retornar array vazio quando next é null', () => {
      expect(getAllNextConnections(null)).toEqual([]);
    });

    test('deve retornar array vazio quando next é undefined', () => {
      expect(getAllNextConnections(undefined)).toEqual([]);
    });

    test('deve retornar array vazio quando next é array vazio', () => {
      expect(getAllNextConnections([])).toEqual([]);
    });

    test('deve filtrar elementos não-string do array', () => {
      expect(getAllNextConnections(['node-1', 123, 'node-2', null, 'node-3'])).toEqual([
        'node-1',
        'node-2',
        'node-3',
      ]);
    });
  });
});

