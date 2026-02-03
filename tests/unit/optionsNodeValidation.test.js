const { validateFlow } = require('../../engine/validator');

describe('engine/validator - options hardening', () => {
  test('options configurado deve exigir next (bloqueante)', () => {
    const flow = {
      tenantId: 't',
      id: 'f',
      name: 'n',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', next: 'opt' },
        {
          id: 'opt',
          type: 'options',
          config: {
            message: 'Selecione',
            optionsType: 'button',
            options: [{ id: 'confirmar', label: 'Confirmar' }],
            variable: 'confirmacao_nome',
            allowMultiple: false,
          },
          // next ausente (bug comum em geração por IA)
        },
        { id: 'end', type: 'end' },
      ],
    };

    const res = validateFlow(flow);
    expect(res.valid).toBe(false);
    const codes = res.errors.map((e) => e.code);
    expect(codes).toContain('OPTIONS_MISSING_NEXT');
  });

  test('options com next em port-map deve exigir out e fallback', () => {
    const flow = {
      tenantId: 't',
      id: 'f',
      name: 'n',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', next: 'opt' },
        {
          id: 'opt',
          type: 'options',
          config: {
            message: 'Selecione',
            optionsType: 'button',
            options: [{ id: 'confirmar', label: 'Confirmar' }],
            variable: 'confirmacao_nome',
            allowMultiple: false,
          },
          next: { out: 'end' }, // faltando fallback
        },
        { id: 'end', type: 'end' },
      ],
    };

    const res = validateFlow(flow);
    expect(res.valid).toBe(false);
    const codes = res.errors.map((e) => e.code);
    expect(codes).toContain('OPTIONS_MISSING_FALLBACK_PORT');
  });
});

