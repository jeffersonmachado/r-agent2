import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import logger from '../utils/logger';
import { engineFlowToReteJson } from './engineMapper';

describe('engineFlowToReteJson - portas/conexões', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('fallback.next como objeto conecta pela saída "end" (não "out")', () => {
    const flow = {
      tenantId: 't1',
      id: 'f1',
      name: 'Teste',
      version: 1,
      nodes: [
        { id: '1', type: 'fallback', config: { escalationMode: 'ticket' }, next: { end: '2' } },
        { id: '2', type: 'end', config: {} },
      ],
      metadata: {},
    };

    const rete = engineFlowToReteJson(flow);

    expect(rete.nodes['1'].data.type).toBe('fallback');
    expect(rete.nodes['2'].data.type).toBe('end');

    // Fallback não possui saída "out" no schema
    expect(rete.nodes['1'].outputs.out).toBeUndefined();

    // Conexão deve sair por "end"
    expect(rete.nodes['1'].outputs.end.connections).toEqual([{ node: 2, input: 'in' }]);
  });

  test('fallback.next legado como string conecta pela saída "end" (compatibilidade)', () => {
    const flow = {
      tenantId: 't1',
      id: 'f1',
      name: 'Teste',
      version: 1,
      nodes: [
        { id: '1', type: 'fallback', config: { escalationMode: 'ticket' }, next: '2' },
        { id: '2', type: 'end', config: {} },
      ],
      metadata: {},
    };

    const rete = engineFlowToReteJson(flow);

    expect(rete.nodes['1'].data.type).toBe('fallback');
    expect(rete.nodes['2'].data.type).toBe('end');

    // Conexão deve sair por "end" (não tenta usar "out")
    expect(rete.nodes['1'].outputs.end.connections).toEqual([{ node: 2, input: 'in' }]);
  });

  test('não cria conexão cujo destino é start (evita input inexistente)', () => {
    const flow = {
      tenantId: 't1',
      id: 'f1',
      name: 'Teste',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', next: 'n1' },
        { id: 'n1', type: 'message', config: { text: 'oi' }, next: 'start' }, // inválido: volta pro start
        { id: 'end', type: 'end' },
      ],
      metadata: {},
    };

    const rete = engineFlowToReteJson(flow);

    // IDs numéricos: start=1, n1=2, end=3 (por ordem)
    expect(rete.nodes['1'].data.type).toBe('start');
    expect(rete.nodes['2'].data.type).toBe('message');

    // Start -> n1 deve existir
    expect(rete.nodes['1'].outputs.out.connections).toEqual([{ node: 2, input: 'in' }]);

    // n1 -> start deve ser ignorado
    expect(rete.nodes['2'].outputs.out.connections).toEqual([]);

    // Loga warning ao ignorar conexão para start
    expect(logger.warn).toHaveBeenCalled();
  });
});

