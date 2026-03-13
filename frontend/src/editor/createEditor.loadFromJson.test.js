import { describe, expect, test, vi, beforeAll, beforeEach } from 'vitest';
import { act } from 'react';

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import logger from '../utils/logger';
import { createEditor } from './createEditor';

describe('createEditor.loadFromJson - robustez', () => {
  beforeAll(() => {
    // Polyfills mínimos para plugins do Rete em ambiente de teste
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('não lança ao tentar criar conexão para nó sem inputs (ex.: start)', async () => {
    const container = document.createElement('div');
    // alguns plugins consultam dimensões
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    let instance;
    await act(async () => {
      instance = await createEditor(container, {});
      await Promise.resolve();
    });

    // JSON: message -> start (destino sem input "in")
    const reteJson = {
      id: 'chatbot-flow@0.1.0',
      nodes: {
        1: {
          id: 1,
          name: 'FlowNode',
          data: { type: 'start', config: {} },
          position: [0, 0],
          outputs: {
            out: { socket: { name: 'socket' }, label: 'Próximo', connections: [] },
          },
        },
        2: {
          id: 2,
          name: 'FlowNode',
          data: { type: 'message', config: { text: 'oi' } },
          position: [200, 0],
          outputs: {
            out: {
              socket: { name: 'socket' },
              label: 'Próximo',
              connections: [{ node: 1, input: 'in' }],
            },
          },
        },
      },
    };

    await act(async () => {
      await expect(instance.loadFromJson(reteJson)).resolves.toBeUndefined();
      await Promise.resolve();
    });

    // Deve ter logado warning (best-effort) ao falhar criar conexão
    expect(logger.warn).toHaveBeenCalled();

    await act(async () => {
      instance.destroy?.();
      await Promise.resolve();
    });
    container.remove();
  });

  test('aplica fallback de posição quando JSON não contém position', async () => {
    const container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    let instance;
    await act(async () => {
      instance = await createEditor(container, {});
      await Promise.resolve();
    });
    const translateSpy = vi.spyOn(instance.area, 'translate');

    // JSON mínimo: 2 nós sem "position"
    const reteJson = {
      id: 'chatbot-flow@0.1.0',
      nodes: {
        1: {
          id: 1,
          name: 'FlowNode',
          data: { type: 'start', config: {} },
        },
        2: {
          id: 2,
          name: 'FlowNode',
          data: { type: 'message', config: { text: 'oi' } },
        },
      },
    };

    await act(async () => {
      await expect(instance.loadFromJson(reteJson)).resolves.toBeUndefined();
      await Promise.resolve();
    });

    // Deve ter aplicado translate com posições diferentes (grade)
    const positions = translateSpy.mock.calls
      .map((call) => call?.[1])
      .filter(Boolean)
      .map((p) => `${Math.round(Number(p.x))},${Math.round(Number(p.y))}`);

    expect(positions.length).toBeGreaterThanOrEqual(2);
    expect(new Set(positions).size).toBeGreaterThan(1);

    await act(async () => {
      instance.destroy?.();
      await Promise.resolve();
    });
    container.remove();
  });
});
