'use strict';

/**
 * Testes unitários: núcleo puro do Competency Engine (src/core/learning).
 */

const {
  computeCompetencies,
  buildProfile,
  isErrorEvent,
  MAX_EVIDENCE_REFS,
} = require('../../src/core/learning/competency-engine');

let seq = 0;
function ev(type, { route, durationMs, status, errorCode, at, id } = {}) {
  seq += 1;
  return {
    id: id || `evt-${seq}`,
    type: `learning.interaction.${type}`,
    occurredAt: at || '2026-07-20T10:00:00.000Z',
    payload: { route, durationMs, status, errorCode },
  };
}

const T = (minutes) => new Date(Date.UTC(2026, 6, 20, 10, minutes, 0)).toISOString();

describe('learning competency-engine (núcleo puro)', () => {
  test('precision: erros = error, api_call >= 400 e flow_abandoned', () => {
    const events = [
      ev('navigation', { route: '/inbox', durationMs: 1000, at: T(0) }),
      ev('navigation', { route: '/support', durationMs: 1000, at: T(1) }),
      ev('error', { route: '/inbox', at: T(2), id: 'evt-typed-error' }),
      ev('api_call', { route: '/support', status: 500, at: T(3), id: 'evt-api-500' }),
      ev('flow_completed', { route: '/inbox', at: T(4) }),
      ev('flow_abandoned', { route: '/support', at: T(5), id: 'evt-abandoned' }),
    ];

    const [tickets] = computeCompetencies({
      events,
      routeSkillMap: { '/inbox': 'tickets', '/support': 'tickets' },
      knownRoutesBySkill: { tickets: ['/inbox', '/support'] },
      now: new Date('2026-07-23T00:00:00Z'),
    });

    expect(tickets.skillKey).toBe('tickets');
    expect(tickets.eventCount).toBe(6);
    expect(tickets.components.precision).toBe(0.5);
    expect(tickets.components.coverage).toBe(1);
    expect(tickets.components.autonomia).toBe(0.3333);
    expect(tickets.components.tempo).toBe(1);
    expect(tickets.components.consistencia).toBe(1);
    // score = 0.35*0.5 + 0.25*(1/3) + 0.2*1 + 0.1*1 + 0.1*1
    expect(tickets.score).toBe(0.6583);
    expect(tickets.firstSeenAt).toBe(T(0));
    expect(tickets.lastSeenAt).toBe(T(5));
  });

  test('evidenceRefs prioriza erros (mais recentes primeiro), depois demais eventos', () => {
    const events = [
      ev('navigation', { route: '/inbox', durationMs: 1000, at: T(0), id: 'evt-nav-old' }),
      ev('error', { route: '/inbox', at: T(2), id: 'evt-err-old' }),
      ev('api_call', { route: '/inbox', status: 500, at: T(3), id: 'evt-err-new' }),
      ev('navigation', { route: '/inbox', durationMs: 900, at: T(4), id: 'evt-nav-new' }),
    ];

    const [tickets] = computeCompetencies({
      events,
      routeSkillMap: { '/inbox': 'tickets' },
      knownRoutesBySkill: { tickets: ['/inbox'] },
    });

    expect(tickets.evidenceRefs[0]).toBe('evt-err-new');
    expect(tickets.evidenceRefs[1]).toBe('evt-err-old');
    expect(tickets.evidenceRefs).toContain('evt-nav-new');
    expect(tickets.evidenceRefs).toHaveLength(4);
  });

  test('evidenceRefs respeita o limite de 20', () => {
    const events = [ev('error', { route: '/inbox', at: T(59), id: 'evt-err' })];
    for (let i = 0; i < 30; i += 1) {
      events.push(ev('navigation', { route: '/inbox', durationMs: 100 + i, at: T(i), id: `evt-nav-${i}` }));
    }

    const [tickets] = computeCompetencies({
      events,
      routeSkillMap: { '/inbox': 'tickets' },
      knownRoutesBySkill: {},
    });

    expect(tickets.evidenceRefs).toHaveLength(MAX_EVIDENCE_REFS);
    expect(tickets.evidenceRefs[0]).toBe('evt-err');
  });

  test('coverage parcial: rotas visitadas / rotas conhecidas da skill', () => {
    const events = [ev('navigation', { route: '/inbox', durationMs: 500, at: T(0) })];

    const [tickets] = computeCompetencies({
      events,
      routeSkillMap: { '/inbox': 'tickets' },
      knownRoutesBySkill: { tickets: ['/inbox', '/support', '/maintenance', '/failed-messages'] },
    });

    expect(tickets.components.coverage).toBe(0.25);
  });

  test('score renormaliza quando componentes sao null (skill sem rotas conhecidas e sem fluxo)', () => {
    const events = [
      ev('navigation', { route: '/x', durationMs: 500, at: T(0) }),
      ev('navigation', { route: '/x', durationMs: 500, at: T(1) }),
    ];

    const [custom] = computeCompetencies({
      events,
      routeSkillMap: { '/x': 'custom' },
      knownRoutesBySkill: {},
    });

    expect(custom.components.coverage).toBeNull();
    expect(custom.components.autonomia).toBeNull();
    expect(custom.components.precision).toBe(1);
    // (0.35*1 + 0.1*1 + 0.1*1) / 0.55 = 1
    expect(custom.score).toBe(1);
  });

  test('tempo: skill mais lenta que a mediana global do usuario pontua menos', () => {
    const events = [
      ev('navigation', { route: '/fast', durationMs: 500, at: T(0) }),
      ev('navigation', { route: '/fast', durationMs: 500, at: T(1) }),
      ev('navigation', { route: '/slow', durationMs: 2000, at: T(2) }),
      ev('navigation', { route: '/slow', durationMs: 2000, at: T(3) }),
    ];

    const result = computeCompetencies({
      events,
      routeSkillMap: { '/fast': 'fastSkill', '/slow': 'slowSkill' },
      knownRoutesBySkill: {},
    });

    const fast = result.find((c) => c.skillKey === 'fastSkill');
    const slow = result.find((c) => c.skillKey === 'slowSkill');
    // mediana global = 1250; fast = min(1, 1250/500) = 1; slow = 1250/2000 = 0.625
    expect(fast.components.tempo).toBe(1);
    expect(slow.components.tempo).toBe(0.625);
  });

  test('eventos sem rota ou sem skill mapeada sao ignorados', () => {
    const events = [
      ev('click', { at: T(0) }),
      ev('navigation', { route: '/desconhecida', durationMs: 100, at: T(1) }),
      ev('navigation', { route: '/inbox', durationMs: 100, at: T(2) }),
    ];

    const result = computeCompetencies({
      events,
      routeSkillMap: { '/inbox': 'tickets' },
      knownRoutesBySkill: {},
    });

    expect(result).toHaveLength(1);
    expect(result[0].skillKey).toBe('tickets');
    expect(result[0].eventCount).toBe(1);
  });

  test('isErrorEvent: api_call 200 sem errorCode nao e erro; errorCode torna erro', () => {
    expect(isErrorEvent(ev('api_call', { status: 200 }))).toBe(false);
    expect(isErrorEvent(ev('api_call', { status: 200, errorCode: 'TIMEOUT' }))).toBe(true);
    expect(isErrorEvent(ev('api_call', { status: 404 }))).toBe(true);
    expect(isErrorEvent(ev('flow_completed', {}))).toBe(false);
  });

  test('buildProfile: dominant (top 3, >= 10 eventos) e weak (< 0.5, >= 5 eventos)', () => {
    const profile = buildProfile([
      { skillKey: 'tickets', score: 0.9, eventCount: 12 },
      { skillKey: 'crm', score: 0.8, eventCount: 15 },
      { skillKey: 'flows', score: 0.7, eventCount: 10 },
      { skillKey: 'rag', score: 0.95, eventCount: 3 },
      { skillKey: 'pbx', score: 0.3, eventCount: 6 },
      { skillKey: 'reports', score: 0.4, eventCount: 4 },
    ]);

    expect(profile.dominantSkills.map((s) => s.skillKey)).toEqual(['tickets', 'crm', 'flows']);
    expect(profile.weakSkills.map((s) => s.skillKey)).toEqual(['pbx']);
    expect(profile.totals.skills).toBe(6);
    expect(profile.totals.events).toBe(50);
    expect(profile.totals.averageScore).toBe(0.675);
  });

  test('buildProfile vazio', () => {
    const profile = buildProfile([]);
    expect(profile.dominantSkills).toEqual([]);
    expect(profile.weakSkills).toEqual([]);
    expect(profile.totals).toEqual({ skills: 0, events: 0, averageScore: null });
  });
});
