import { describe, it, expect } from 'vitest';
import { getNodeSchema } from './nodeSchemas';

describe('nodeSchemas - options.validate (fallback via port-map)', () => {
  it('não acusa OPTIONS_MISSING_FALLBACK quando next é port-map com fallback', () => {
    const schema = getNodeSchema('options');
    expect(schema).toBeTruthy();

    const node = {
      id: '3',
      type: 'options',
      config: {
        message: 'O que você deseja?',
        optionsType: 'button',
        variable: 'menu_option',
        allowMultiple: false,
        options: [
          { id: 'servicos', label: 'Serviços/Aulas' },
        ],
      },
      next: {
        out: '4',
        fallback: '20',
      },
    };

    const errors = schema.validate(node) || [];
    const codes = errors.map((e) => e && typeof e === 'object' ? e.code : e).filter(Boolean);

    expect(codes).not.toContain('OPTIONS_MISSING_FALLBACK');
  });

  it('acusa OPTIONS_MISSING_FALLBACK quando next é port-map sem fallback', () => {
    const schema = getNodeSchema('options');
    expect(schema).toBeTruthy();

    const node = {
      id: '3',
      type: 'options',
      config: {
        optionsType: 'button',
        options: [{ id: 'servicos', label: 'Serviços/Aulas' }],
      },
      next: {
        out: '4',
      },
    };

    const errors = schema.validate(node) || [];
    const codes = errors.map((e) => e && typeof e === 'object' ? e.code : e).filter(Boolean);

    expect(codes).toContain('OPTIONS_MISSING_FALLBACK');
  });
});

