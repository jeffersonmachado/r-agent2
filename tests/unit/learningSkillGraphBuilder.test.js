'use strict';

/**
 * Testes unitários: montagem pura do Skill Graph (buildSkillGraphData).
 */

const { buildSkillGraphData } = require('../../scripts/learning/build-skill-graph');

const NOW = new Date('2026-07-23T00:00:00.000Z');

function buildInputs() {
  return {
    capabilities: [
      { id: 'omnichannel_whatsapp' },
      { id: 'omnichannel_pbx' },
      { id: 'support_ticket_flow' },
      { id: 'crm_update' },
      { id: 'mystery_capability' },
    ],
    journeys: {
      support_ticket_flow: { requiredCapabilities: ['support_ticket_flow', 'unknown_journey_cap'] },
      omnichannel_engagement: { requiredCapabilities: ['omnichannel_whatsapp', 'omnichannel_pbx'] },
    },
    menuEntries: [
      { path: '/inbox', permission: { resource: 'tickets', action: 'read' } },
      { path: '/support', permission: { resource: 'tickets', action: 'read' } },
      { path: '/crm', permission: { resource: 'crm', action: 'read' } },
      { path: '/dev' },
    ],
    now: NOW,
  };
}

describe('learning skill-graph builder (buildSkillGraphData)', () => {
  test('deriva skills de recurso do menu com rotas agrupadas', () => {
    const { artifact } = buildSkillGraphData(buildInputs());

    const tickets = artifact.skills.find((s) => s.key === 'tickets');
    expect(tickets).toBeDefined();
    expect(tickets.kind).toBe('resource');
    expect(tickets.routes).toEqual(['/inbox', '/support']);

    const crm = artifact.skills.find((s) => s.key === 'crm');
    expect(crm.kind).toBe('resource');
    expect(crm.routes).toEqual(['/crm']);
  });

  test('deriva skills de canal a partir de capabilities omnichannel_*', () => {
    const { artifact } = buildSkillGraphData(buildInputs());

    const whatsapp = artifact.skills.find((s) => s.key === 'whatsapp');
    expect(whatsapp).toBeDefined();
    expect(whatsapp.kind).toBe('channel');
    expect(whatsapp.capabilities).toEqual(['omnichannel_whatsapp']);

    expect(artifact.skills.some((s) => s.key === 'pbx' && s.kind === 'channel')).toBe(true);
  });

  test('liga capabilities a skills via mapa estático explícito', () => {
    const { artifact } = buildSkillGraphData(buildInputs());

    const tickets = artifact.skills.find((s) => s.key === 'tickets');
    expect(tickets.capabilities).toContain('support_ticket_flow');

    const crm = artifact.skills.find((s) => s.key === 'crm');
    expect(crm.capabilities).toContain('crm_update');
  });

  test('routeSkillMap mapeia rotas do menu para o resource', () => {
    const { artifact } = buildSkillGraphData(buildInputs());
    expect(artifact.routeSkillMap).toEqual({
      '/crm': 'crm',
      '/inbox': 'tickets',
      '/support': 'tickets',
    });
  });

  test('jornadas ligadas às requiredCapabilities', () => {
    const { artifact } = buildSkillGraphData(buildInputs());

    const support = artifact.journeys.find((j) => j.key === 'support_ticket_flow');
    expect(support.requiredCapabilities).toEqual(['support_ticket_flow', 'unknown_journey_cap']);
    expect(artifact.journeys).toHaveLength(2);
  });

  test('reporta o que ficou fora do mapeamento explícito', () => {
    const { report } = buildSkillGraphData(buildInputs());

    expect(report.unmappedCapabilities).toEqual(['mystery_capability']);
    expect(report.unregisteredCapabilities).toEqual(['unknown_journey_cap']);
    expect(report.unmappedRoutes).toEqual(['/dev']);
  });

  test('skill de domínio access_control tem rotas declaradas e capabilities de acesso/presença', () => {
    const inputs = buildInputs();
    inputs.capabilities.push(
      { id: 'access_decision' },
      { id: 'customer_identification' },
      { id: 'attendance_record' },
    );
    const { artifact } = buildSkillGraphData(inputs);

    const accessControl = artifact.skills.find((s) => s.key === 'access_control');
    expect(accessControl).toBeDefined();
    expect(accessControl.kind).toBe('domain');
    expect(accessControl.routes).toEqual(['/access-control', '/fitness/attendance']);
    expect(accessControl.capabilities).toEqual(['access_decision', 'attendance_record', 'customer_identification']);

    // rotas declaradas NÃO entram no routeSkillMap (atribuição via menu)
    expect(artifact.routeSkillMap['/access-control']).toBeUndefined();
    expect(artifact.routeSkillMap['/fitness/attendance']).toBeUndefined();
  });

  test('skills de domínio scheduling e billing cobrem agenda e plano/cobrança', () => {
    const inputs = buildInputs();
    inputs.menuEntries.push({ path: '/onboarding', permission: { resource: 'tenant', action: 'read' } });
    inputs.capabilities.push(
      { id: 'scheduling' },
      { id: 'notifications' },
      { id: 'billing_validation' },
      { id: 'payment' },
      { id: 'lead_capture' },
      { id: 'crm_updates' },
      { id: 'onboarding' },
    );
    const { artifact, report } = buildSkillGraphData(inputs);

    const scheduling = artifact.skills.find((s) => s.key === 'scheduling');
    expect(scheduling.routes).toEqual(['/agenda']);
    expect(scheduling.capabilities).toEqual(['notifications', 'scheduling']);

    const billing = artifact.skills.find((s) => s.key === 'billing');
    expect(billing.routes).toEqual(['/plan-usage']);
    expect(billing.capabilities).toEqual(['billing_validation', 'payment']);

    const crm = artifact.skills.find((s) => s.key === 'crm');
    expect(crm.capabilities).toEqual(expect.arrayContaining(['crm_update', 'crm_updates', 'lead_capture']));

    const tenant = artifact.skills.find((s) => s.key === 'tenant');
    expect(tenant.capabilities).toContain('onboarding');

    expect(report.unmappedCapabilities).toEqual(['mystery_capability']);
  });

  test('artefato é determinístico e versionado', () => {
    const { artifact } = buildSkillGraphData(buildInputs());
    expect(artifact.version).toBe(1);
    expect(artifact.generatedAt).toBe(NOW.toISOString());

    const again = buildSkillGraphData(buildInputs()).artifact;
    expect(again).toEqual(artifact);
  });
});
