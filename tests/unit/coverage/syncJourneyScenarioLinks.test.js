'use strict';

/**
 * Regressão: o sync de journey-scenario-links deve preservar jornadas
 * marcadas "manual": true DENTRO de uma vertical regenerada.
 *
 * Falha observada (2026-07-27): `npm run coverage-gate:links` regenerou
 * config/journey-scenario-links.json a partir de qa-waves/journey-coverage
 * e removeu a jornada `calendar` (declaração manual ligada a
 * business-core-cap-scheduling — o mesh não tem cenário com journeyId
 * 'calendar', então ela nunca aparece nos artefatos gerados). O coverage
 * gate perdeu o link e o teste de config quebrou. A preservação por
 * VERTICAL inteira já existia; faltava por JORNADA.
 */

const { preserveManualEntries } = require('../../../qa/coverage/journeyLinksManualPreserve');

describe('preserveManualEntries', () => {
  test('preserva jornada manual dentro de vertical regenerada', () => {
    const generated = [
      {
        vertical: 'core',
        journeys: [
          { journey: 'capability_scheduling', scenarios: [{ scenarioId: 'business-core-cap-scheduling', status: 'active' }] },
          { journey: 'login', scenarios: [{ scenarioId: 'business-core-biz-login', status: 'active' }] },
        ],
      },
    ];
    const existing = {
      verticals: [
        {
          vertical: 'core',
          journeys: [
            { journey: 'capability_scheduling', scenarios: [{ scenarioId: 'business-core-cap-scheduling', status: 'active' }] },
            { journey: 'calendar', manual: true, scenarios: [{ scenarioId: 'business-core-cap-scheduling', status: 'active' }] },
          ],
        },
      ],
    };
    const { verticals, journeyCount, scenarioRefCount } = preserveManualEntries(generated, existing);
    const core = verticals.find((v) => v.vertical === 'core');
    const names = core.journeys.map((j) => j.journey);
    expect(names).toContain('capability_scheduling');
    expect(names).toContain('login');
    expect(names).toContain('calendar');
    const calendar = core.journeys.find((j) => j.journey === 'calendar');
    expect(calendar.manual).toBe(true);
    expect(calendar.scenarios[0].scenarioId).toBe('business-core-cap-scheduling');
    expect(journeyCount).toBe(3);
    expect(scenarioRefCount).toBe(3);
  });

  test('jornada NÃO manual que some dos artefatos é removida (comportamento atual)', () => {
    const generated = [{ vertical: 'core', journeys: [{ journey: 'a', scenarios: [] }] }];
    const existing = {
      verticals: [{ vertical: 'core', journeys: [{ journey: 'a', scenarios: [] }, { journey: 'b', scenarios: [{ scenarioId: 's-b', status: 'active' }] }] }],
    };
    const { verticals } = preserveManualEntries(generated, existing);
    const core = verticals.find((v) => v.vertical === 'core');
    expect(core.journeys.map((j) => j.journey)).toEqual(['a']);
  });

  test('vertical manual inteira continua preservada quando não é regenerada', () => {
    const generated = [{ vertical: 'core', journeys: [{ journey: 'a', scenarios: [] }] }];
    const existing = {
      verticals: [
        { vertical: 'legacy-manual', manual: true, journeys: [{ journey: 'z', scenarios: [{ scenarioId: 's-z', status: 'active' }] }] },
      ],
    };
    const { verticals, journeyCount } = preserveManualEntries(generated, existing);
    expect(verticals.map((v) => v.vertical)).toEqual(['core', 'legacy-manual']);
    expect(journeyCount).toBe(2);
  });

  test('vertical manual NÃO duplica quando a regeneração já cobre a vertical', () => {
    const generated = [{ vertical: 'core', journeys: [{ journey: 'a', scenarios: [] }] }];
    const existing = {
      verticals: [{ vertical: 'core', manual: true, journeys: [{ journey: 'z', scenarios: [] }] }],
    };
    const { verticals } = preserveManualEntries(generated, existing);
    expect(verticals).toHaveLength(1);
    expect(verticals[0].journeys.map((j) => j.journey)).toEqual(['a']);
  });

  test('sem config existente, retorna o gerado intacto', () => {
    const generated = [{ vertical: 'core', journeys: [{ journey: 'a', scenarios: [] }] }];
    const { verticals, journeyCount, scenarioRefCount } = preserveManualEntries(generated, null);
    expect(verticals).toEqual(generated);
    expect(journeyCount).toBe(1);
    expect(scenarioRefCount).toBe(0);
  });
});
