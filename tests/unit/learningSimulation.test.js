'use strict';

const { buildSimulationScenario, SEED_TYPES, PERSONAS } = require('../../src/core/learning/simulation-engine');

const baseTemplate = [
  { type: 'navigate', step: 'abrir-tela', value: { route: '/inbox' } },
  { type: 'fill', step: 'preencher-busca', selector: 'input[name="q"]', value: 'texto real' },
  { type: 'click', step: 'abrir-ticket', selector: '[data-testid="ticket-1"]' },
];

describe('learning-core simulation-engine', () => {
  test('monta cenario happy_path com persona sintetica aplicada aos fills', () => {
    const scenario = buildSimulationScenario({
      journeyKey: 'support_ticket_flow',
      seedType: 'happy_path',
      personaKey: 'cliente_vip',
      stepsTemplate: baseTemplate,
      now: new Date('2026-07-23T12:00:00Z'),
    });

    expect(scenario.journeyKey).toBe('support_ticket_flow');
    expect(scenario.falhaEsperada).toBe(false);
    expect(scenario.steps).toHaveLength(3);
    // fill recebe dados da persona sintetica, nunca o valor real do template
    expect(scenario.steps[1].value.persona).toBe('Cliente Simulado VIP');
    expect(JSON.stringify(scenario)).not.toContain('texto real');
    expect(scenario.persona.documento).toBe('000.000.000-00');
  });

  test('rejeita seedType e persona invalidos', () => {
    expect(() => buildSimulationScenario({ journeyKey: 'j', seedType: 'nope', personaKey: 'cliente_vip' })).toThrow(/seedType invalido/);
    expect(() => buildSimulationScenario({ journeyKey: 'j', seedType: 'happy_path', personaKey: 'nope' })).toThrow(/personaKey invalida/);
    expect(() => buildSimulationScenario({ seedType: 'happy_path', personaKey: 'cliente_vip' })).toThrow(/journeyKey obrigatorio/);
  });

  test('seedTypes de falha marcam falhaEsperada e assertion de falha controlada', () => {
    const scenario = buildSimulationScenario({
      journeyKey: 'payment_charge_flow',
      seedType: 'external_failure',
      personaKey: 'cliente_inadimplente',
      stepsTemplate: baseTemplate,
    });
    expect(scenario.falhaEsperada).toBe(true);
    expect(scenario.assertions.some((a) => a.tipo === 'falha_controlada')).toBe(true);
  });

  test('sem template gera passo inicial de navegacao; assertion sem_dados_reais sempre presente', () => {
    const scenario = buildSimulationScenario({
      journeyKey: 'booking_flow',
      seedType: 'edge_case',
      personaKey: 'usuario_iniciante',
    });
    expect(scenario.steps).toHaveLength(1);
    expect(scenario.steps[0].type).toBe('navigate');
    expect(scenario.assertions.some((a) => a.tipo === 'sem_dados_reais')).toBe(true);
  });

  test('todos os seedTypes e personas do catalogo montam cenarios validos', () => {
    for (const seedType of SEED_TYPES) {
      for (const personaKey of Object.keys(PERSONAS)) {
        const scenario = buildSimulationScenario({
          journeyKey: 'jornada_x',
          seedType,
          personaKey,
          stepsTemplate: baseTemplate,
        });
        expect(scenario.steps).toHaveLength(3);
        expect(scenario.persona.email).toContain('.invalid');
      }
    }
  });
});
