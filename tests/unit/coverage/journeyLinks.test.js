'use strict';

const {
  LINKABLE_SCENARIO_STATUSES,
  containsToken,
  resolveDomainAliases,
  canonicalDomain,
  journeyMatchesDomain,
  buildJourneyScenarioLinks,
} = require('../../../qa/coverage/journeyLinks');

const ALIASES = { mercado: 'market', servicos: 'services', clinica: 'clinic', varejo: 'market' };

function verticalFile(vertical, journeys) {
  return { vertical, journeys: journeys.map(([journey, scenarios]) => ({ journey, scenarios })) };
}

function sc(scenarioId, status) {
  return { scenarioId, status };
}

describe('coverage/journeyLinks', () => {
  describe('resolveDomainAliases', () => {
    test('extrai domainAliases da config do registry', () => {
      expect(resolveDomainAliases({ domainAliases: ALIASES })).toEqual(ALIASES);
    });

    test('config ausente/inválida → mapa vazio', () => {
      expect(resolveDomainAliases(null)).toEqual({});
      expect(resolveDomainAliases({})).toEqual({});
    });
  });

  describe('journeyMatchesDomain', () => {
    test('sem aliases: comportamento original (includes)', () => {
      expect(journeyMatchesDomain('beauty_booking', 'beauty')).toBe(true);
      expect(journeyMatchesDomain('market_default_journey', 'mercado')).toBe(false);
    });

    test('alias PT do mesh → canônico EN da jornada (mercado↔market)', () => {
      expect(journeyMatchesDomain('market_default_journey', 'mercado', ALIASES)).toBe(true);
      expect(journeyMatchesDomain('clinic_default_journey', 'clinica', ALIASES)).toBe(true);
      expect(journeyMatchesDomain('services_default_journey', 'servicos', ALIASES)).toBe(true);
    });

    test('jornada contendo alias do mesmo grupo canônico também casa', () => {
      expect(journeyMatchesDomain('varejo_checkout', 'mercado', ALIASES)).toBe(true);
    });

    test('sem relação real continua falso mesmo com aliases', () => {
      expect(journeyMatchesDomain('booking_flow', 'mercado', ALIASES)).toBe(false);
      expect(journeyMatchesDomain('payment_charge_flow', 'servicos', ALIASES)).toBe(false);
      expect(journeyMatchesDomain('j', '', ALIASES)).toBe(false);
      expect(journeyMatchesDomain(null, 'mercado', ALIASES)).toBe(false);
    });

    test('canonicalDomain: alias resolve, desconhecido permanece', () => {
      expect(canonicalDomain('mercado', ALIASES)).toBe('market');
      expect(canonicalDomain('fitness', ALIASES)).toBe('fitness');
    });
  });

  describe('containsToken (delimitadores - e _)', () => {
    test('casa como segmento delimitado', () => {
      expect(containsToken('fitness-matricula-checkin', 'checkin')).toBe(true);
      expect(containsToken('fitness-matricula-agendamento-ui', 'agendamento')).toBe(true);
      expect(containsToken('business-fit-flow-checkin', 'checkin')).toBe(true);
      expect(containsToken('checkin', 'checkin')).toBe(true);
    });

    test('anti-falso-positivo: não casa dentro de palavra maior', () => {
      expect(containsToken('academia-checkins', 'checkin')).toBe(false);
      expect(containsToken('fast-checkin2', 'checkin')).toBe(false);
      expect(containsToken('precheckin-ui', 'checkin')).toBe(false);
      expect(containsToken('fitness-matricula-checkin', 'check')).toBe(false);
    });

    test('token multi-segmento (com _) casa literalmente', () => {
      expect(containsToken('x-fitness_active_customer-y', 'fitness_active_customer')).toBe(true);
      expect(containsToken('x-fitness_active-y', 'fitness_active_customer')).toBe(false);
    });
  });

  describe('buildJourneyScenarioLinks', () => {
    const mesh = [
      { id: 'fitness-matricula-agendamento-ui', domain: 'fitness' },
      { id: 'fitness-matricula-checkin', domain: 'fitness' },
      { id: 'business-fit-flow-checkin', domain: 'fitness' },
      { id: 'fitness-matricula-leads', domain: 'omnichannel' },
      { id: 'business-market-flow-node', domain: 'mercado' },
      { id: 'academia-checkins', domain: 'fitness' }, // falso positivo potencial
    ];

    test('(a) link direto: cenário active presente no mesh → journey-coverage', () => {
      const files = [verticalFile('fitness', [
        ['agendamento', [sc('fitness-matricula-agendamento-ui', 'active'), sc('fitness-matricula-agendamento', 'deprecated'), sc('fitness_full_agendamento_e2e', 'active')]],
      ])];
      const links = buildJourneyScenarioLinks({ journeyCoverageFiles: files, meshScenarioIds: mesh, aliases: ALIASES });
      // deprecated não liga; active fora do mesh não liga
      expect(links.agendamento.source).toBe('journey-coverage');
      expect(links.agendamento.scenarioIds).toEqual(['fitness-matricula-agendamento-ui']);
    });

    test("status 'approved' também liga (status ligável documentado)", () => {
      expect(LINKABLE_SCENARIO_STATUSES).toEqual(['active', 'approved']);
      const files = [verticalFile('market', [
        ['market_default_journey', [sc('business-market-flow-node', 'approved'), sc('market-publicacao-no', 'approved')]],
      ])];
      const links = buildJourneyScenarioLinks({ journeyCoverageFiles: files, meshScenarioIds: mesh, aliases: ALIASES });
      expect(links.market_default_journey).toEqual({
        scenarioIds: ['business-market-flow-node'],
        source: 'journey-coverage',
      });
    });

    test('(b) convenção de nome com preferência de domínio da vertical', () => {
      const files = [verticalFile('fitness', [['checkin', []]])];
      const links = buildJourneyScenarioLinks({ journeyCoverageFiles: files, meshScenarioIds: mesh, aliases: ALIASES });
      expect(links.checkin.source).toBe('scenario-name');
      expect(links.checkin.scenarioIds.sort()).toEqual(['business-fit-flow-checkin', 'fitness-matricula-checkin']);
      // 'academia-checkins' NÃO entra (token não delimitado)
      expect(links.checkin.scenarioIds).not.toContain('academia-checkins');
    });

    test('domínio é preferência, não requisito: leads vive em omnichannel', () => {
      const files = [verticalFile('fitness', [['leads', []]])];
      const links = buildJourneyScenarioLinks({ journeyCoverageFiles: files, meshScenarioIds: mesh, aliases: ALIASES });
      expect(links.leads).toEqual({ scenarioIds: ['fitness-matricula-leads'], source: 'scenario-name' });
    });

    test('preferência de domínio filtra candidatos de outros domínios', () => {
      const meshCross = [
        { id: 'fitness-matricula-checkin', domain: 'fitness' },
        { id: 'clinic-recepcao-checkin', domain: 'clinica' },
      ];
      const files = [verticalFile('fitness', [['checkin', []]])];
      const links = buildJourneyScenarioLinks({ journeyCoverageFiles: files, meshScenarioIds: meshCross, aliases: ALIASES });
      expect(links.checkin.scenarioIds).toEqual(['fitness-matricula-checkin']);
    });

    test('vertical clinic corresponde ao domínio clinica via aliases', () => {
      const meshClinic = [{ id: 'clinic-ticket-abertura', domain: 'clinica' }];
      const files = [verticalFile('clinic', [['abertura', []]])];
      const links = buildJourneyScenarioLinks({ journeyCoverageFiles: files, meshScenarioIds: meshClinic, aliases: ALIASES });
      expect(links.abertura.scenarioIds).toEqual(['clinic-ticket-abertura']);
    });

    test('precedência: (a) existe → união (a)+(b) com source journey-coverage', () => {
      const files = [verticalFile('fitness', [
        ['checkin', [sc('fitness-matricula-checkin', 'active')]],
      ])];
      const links = buildJourneyScenarioLinks({ journeyCoverageFiles: files, meshScenarioIds: mesh, aliases: ALIASES });
      expect(links.checkin.source).toBe('journey-coverage');
      expect(links.checkin.scenarioIds.sort()).toEqual(['business-fit-flow-checkin', 'fitness-matricula-checkin']);
    });

    test('jornada sem nenhum link não aparece no resultado', () => {
      const files = [verticalFile('fitness', [
        ['suporte', [sc('nao-existe-no-mesh', 'active')]],
        ['vazia', []],
      ])];
      const links = buildJourneyScenarioLinks({ journeyCoverageFiles: files, meshScenarioIds: mesh, aliases: ALIASES });
      expect(links.suporte).toBeUndefined();
      expect(links.vazia).toBeUndefined();
    });

    test('aceita meshScenarioIds como strings (sem domínio: sem preferência)', () => {
      const files = [verticalFile('fitness', [['checkin', []]])];
      const links = buildJourneyScenarioLinks({
        journeyCoverageFiles: files,
        meshScenarioIds: ['fitness-matricula-checkin', 'other-checkin'],
        aliases: ALIASES,
      });
      expect(links.checkin.scenarioIds.sort()).toEqual(['fitness-matricula-checkin', 'other-checkin']);
    });

    test('entradas vazias → sem links', () => {
      expect(buildJourneyScenarioLinks()).toEqual({});
      expect(buildJourneyScenarioLinks({ journeyCoverageFiles: [null, { journeys: null }], meshScenarioIds: mesh })).toEqual({});
    });
  });
});
