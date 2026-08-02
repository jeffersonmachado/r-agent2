'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  probePolicy,
  evaluatePageItem,
  evaluatePageSurface,
} = require('../../../qa/coverage/pageSurfaceWave');
const { COVERAGE_STATES } = require('../../../qa/coverage/coverageStates');
const { loadPageSurfaceTechnicalExecutions } = require('../../../scripts/governance/validate-coverage-gate');

const LOGIN_PROBE = { loginSurface: true, denied: false, rendered: false, docStatus: 200, consoleErrors: 0, pageErrors: 0 };
const CONTENT_PROBE = { loginSurface: false, denied: false, rendered: true, docStatus: 200, consoleErrors: 0, pageErrors: 0 };
const DENIED_PROBE = { loginSurface: false, denied: true, rendered: false, docStatus: 200, consoleErrors: 0, pageErrors: 0 };

function pageItem(overrides = {}) {
  return {
    id: 'page:/agenda',
    kind: 'page',
    path: '/agenda',
    guarded: true,
    classification: 'PRODUCTION',
    ...overrides,
  };
}

describe('pageSurfaceWave — probePolicy', () => {
  test('página PRODUCTION comum: P1+P2, sem P3, pageLoads via P2', () => {
    expect(probePolicy(pageItem())).toMatchObject({
      p1: true, p2: true, p3: false, pageLoads: true, expectedProbe: 'p2',
    });
  });

  test('página DEVELOPMENT/SUPPORT: P3 habilitado e pageLoads via P3', () => {
    expect(probePolicy(pageItem({ classification: 'DEVELOPMENT' }))).toMatchObject({ p3: true, expectedProbe: 'p3' });
    expect(probePolicy(pageItem({ classification: 'SUPPORT' }))).toMatchObject({ p3: true, expectedProbe: 'p3' });
  });

  test('página pública: pageLoads via P1 anônimo', () => {
    expect(probePolicy(pageItem({ id: 'page:/login', path: '/login', guarded: false })).expectedProbe).toBe('p1');
    expect(probePolicy(pageItem({ id: 'page:/saas/pricing', path: '/saas/pricing', guarded: false })).expectedProbe).toBe('p1');
    expect(probePolicy(pageItem({ id: 'page:/kiosk', path: '/kiosk', guarded: false })).expectedProbe).toBe('p1');
  });

  test('path com :param: apenas P1/P2, sem pageLoads (máx. VISITED)', () => {
    const policy = probePolicy(pageItem({ id: 'page:/orders/:id', path: '/orders/:id', classification: 'DEVELOPMENT' }));
    expect(policy).toMatchObject({ p1: true, p2: true, p3: false, pageLoads: false, expectedProbe: null });
  });
});

describe('pageSurfaceWave — evaluatePageItem', () => {
  test('página guardada PROTECTION sadia: P1 login, P2 renderiza → VALIDATED', () => {
    const result = evaluatePageItem(pageItem(), { p1: LOGIN_PROBE, p2: CONTENT_PROBE });
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
  });

  test('FALHA DE SEGURANÇA: página guardada renderiza para anônimo → FAILED', () => {
    const result = evaluatePageItem(pageItem(), { p1: CONTENT_PROBE, p2: CONTENT_PROBE });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
    const a = result.assertions.find((x) => x.name === 'authEnforced');
    expect(a.passed).toBe(false);
  });

  test('página DEVELOPMENT sadia: P1 login, P2 negado, P3 renderiza → VALIDATED', () => {
    const result = evaluatePageItem(pageItem({ classification: 'DEVELOPMENT' }), {
      p1: LOGIN_PROBE, p2: DENIED_PROBE, p3: CONTENT_PROBE,
    });
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
  });

  test('VIOLAÇÃO DE VISIBILIDADE: papel PRODUCTION acessa página DEVELOPMENT → FAILED', () => {
    const result = evaluatePageItem(pageItem({ classification: 'DEVELOPMENT' }), {
      p1: LOGIN_PROBE, p2: CONTENT_PROBE, p3: CONTENT_PROBE,
    });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
    const a = result.assertions.find((x) => x.name === 'classificationEnforced');
    expect(a.passed).toBe(false);
  });

  test('página SUPPORT: papel PRODUCTION com superfície de login também conta como bloqueado → VALIDATED', () => {
    const result = evaluatePageItem(pageItem({ classification: 'SUPPORT' }), {
      p1: LOGIN_PROBE, p2: LOGIN_PROBE, p3: CONTENT_PROBE,
    });
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
  });

  test('página PRODUCTION negada ao papel PRODUCTION → FAILED (operador bloqueado)', () => {
    const result = evaluatePageItem(pageItem(), { p1: LOGIN_PROBE, p2: DENIED_PROBE });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
    const a = result.assertions.find((x) => x.name === 'pageLoads');
    expect(a.passed).toBe(false);
  });

  test('console.error na carga da página → FAILED', () => {
    const result = evaluatePageItem(pageItem(), {
      p1: LOGIN_PROBE,
      p2: { ...CONTENT_PROBE, consoleErrors: 2, errorSamples: ['TypeError: x'] },
    });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
    const a = result.assertions.find((x) => x.name === 'pageLoads');
    expect(a.passed).toBe(false);
  });

  test('pageerror na carga da página → FAILED', () => {
    const result = evaluatePageItem(pageItem(), {
      p1: LOGIN_PROBE,
      p2: { ...CONTENT_PROBE, pageErrors: 1 },
    });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
  });

  test('documento principal 5xx → FAILED', () => {
    const result = evaluatePageItem(pageItem(), {
      p1: LOGIN_PROBE,
      p2: { ...CONTENT_PROBE, docStatus: 502 },
    });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
  });

  test('/login exibe superfície de login para anônimo → VALIDATED (é o conteúdo da página)', () => {
    const result = evaluatePageItem(pageItem({ id: 'page:/login', path: '/login', guarded: false }), {
      p1: LOGIN_PROBE, p2: LOGIN_PROBE,
    });
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
  });

  test('página pública (/kiosk) renderiza para anônimo → VALIDATED', () => {
    const result = evaluatePageItem(pageItem({ id: 'page:/kiosk', path: '/kiosk', guarded: false }), {
      p1: CONTENT_PROBE, p2: CONTENT_PROBE,
    });
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
  });

  test('path com :param → no máximo VISITED (pageLoads não avaliada)', () => {
    const result = evaluatePageItem(pageItem({ id: 'page:/orders/:id', path: '/orders/:id' }), {
      p1: LOGIN_PROBE, p2: CONTENT_PROBE,
    });
    expect(result.state).toBe(COVERAGE_STATES.VISITED);
    const a = result.assertions.find((x) => x.name === 'pageLoads');
    expect(a.notEvaluated).toBe(true);
  });

  test('frontend inalcançável (erro de navegação em todos os probes) → BLOCKED', () => {
    const result = evaluatePageItem(pageItem(), { p1: { error: true }, p2: { error: true } });
    expect(result.state).toBe(COVERAGE_STATES.BLOCKED);
  });

  test('nenhum probe executado → BLOCKED', () => {
    const result = evaluatePageItem(pageItem(), {});
    expect(result.state).toBe(COVERAGE_STATES.BLOCKED);
  });

  test('página DEVELOPMENT sem sessão super_admin: pageLoads não avaliada → VISITED', () => {
    const result = evaluatePageItem(pageItem({ classification: 'DEVELOPMENT' }), {
      p1: LOGIN_PROBE, p2: DENIED_PROBE,
    });
    expect(result.state).toBe(COVERAGE_STATES.VISITED);
  });

  test('página DEVELOPMENT sem sessão PRODUCTION: classificationEnforced não avaliada → VISITED', () => {
    const result = evaluatePageItem(pageItem({ classification: 'DEVELOPMENT' }), {
      p1: LOGIN_PROBE, p3: CONTENT_PROBE,
    });
    expect(result.state).toBe(COVERAGE_STATES.VISITED);
  });

  test('documento 401 para anônimo conta como enforcement de auth (barreira do servidor)', () => {
    const result = evaluatePageItem(pageItem(), {
      p1: { ...LOGIN_PROBE, loginSurface: false, docStatus: 401 },
      p2: CONTENT_PROBE,
    });
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
    const a = result.assertions.find((x) => x.name === 'authEnforced');
    expect(a.passed).toBe(true);
  });

  test('P1 inconclusivo (doc 200, sem login nem conteúdo) em página guardada → VISITED', () => {
    const result = evaluatePageItem(pageItem(), {
      p1: { loginSurface: false, denied: false, rendered: false, docStatus: 200, consoleErrors: 0, pageErrors: 0 },
      p2: CONTENT_PROBE,
    });
    expect(result.state).toBe(COVERAGE_STATES.VISITED);
    const a = result.assertions.find((x) => x.name === 'authEnforced');
    expect(a.notEvaluated).toBe(true);
  });

  test('P2 inconclusivo (doc 404 de proxy, sem conteúdo nem bloqueio) em página DEVELOPMENT → VISITED', () => {
    const result = evaluatePageItem(pageItem({ classification: 'DEVELOPMENT' }), {
      p1: LOGIN_PROBE,
      p2: { loginSurface: false, denied: false, rendered: false, docStatus: 404, consoleErrors: 0, pageErrors: 0 },
      p3: CONTENT_PROBE,
    });
    expect(result.state).toBe(COVERAGE_STATES.VISITED);
    const a = result.assertions.find((x) => x.name === 'classificationEnforced');
    expect(a.notEvaluated).toBe(true);
  });

  test('documento 403 para papel PRODUCTION em página DEVELOPMENT conta como bloqueio → VALIDATED', () => {
    const result = evaluatePageItem(pageItem({ classification: 'DEVELOPMENT' }), {
      p1: LOGIN_PROBE,
      p2: { ...DENIED_PROBE, denied: false, docStatus: 403 },
      p3: CONTENT_PROBE,
    });
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
  });
});

describe('pageSurfaceWave — evaluatePageSurface (totais e determinismo)', () => {
  test('agrega por estado apenas itens kind=page', () => {
    const items = [
      pageItem({ id: 'page:/a', path: '/a' }),
      pageItem({ id: 'page:/login', path: '/login', guarded: false }),
      { id: 'api:GET:/x', kind: 'api' },
    ];
    const probes = new Map([
      ['page:/a', { p1: LOGIN_PROBE, p2: CONTENT_PROBE }],
      ['page:/login', { p1: LOGIN_PROBE, p2: LOGIN_PROBE }],
    ]);
    const { perItem, totals } = evaluatePageSurface(items, probes);
    expect(perItem).toHaveLength(2);
    expect(totals.items).toBe(2);
    expect(totals.byState.VALIDATED).toBe(2);
  });

  test('determinismo: mesma entrada produz relatório idêntico', () => {
    const items = [pageItem({ id: 'page:/a', path: '/a' }), pageItem({ id: 'page:/b', path: '/b', guarded: false })];
    const probes = new Map([
      ['page:/a', { p1: LOGIN_PROBE, p2: CONTENT_PROBE }],
      ['page:/b', { p1: CONTENT_PROBE, p2: CONTENT_PROBE }],
    ]);
    const first = evaluatePageSurface(items, probes);
    const second = evaluatePageSurface(items, probes);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.perItem.map((r) => r.id)).toEqual(['page:/a', 'page:/b']);
  });
});

describe('pageSurfaceWave — isenções justificadas', () => {
  const exemption = {
    assertion: 'pageLoads',
    reason: 'erro de console benigno conhecido (extensão de terceiro)',
    approvedBy: 'qa',
    date: '2026-07-28',
  };

  test('isenção válida marca assertiva NOT_APPLICABLE e item fica VALIDATED', () => {
    const result = evaluatePageItem(pageItem(), {
      p1: LOGIN_PROBE,
      p2: { ...CONTENT_PROBE, consoleErrors: 1 },
    }, exemption);
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
    const a = result.assertions.find((x) => x.name === 'pageLoads');
    expect(a.notApplicable).toBe(true);
    expect(result.exemption).toMatchObject({ item: 'page:/agenda', assertion: 'pageLoads' });
  });

  test('isenção sem campos obrigatórios é IGNORADA (assertiva continua falhando)', () => {
    const result = evaluatePageItem(pageItem(), {
      p1: LOGIN_PROBE,
      p2: { ...CONTENT_PROBE, consoleErrors: 1 },
    }, { assertion: 'pageLoads' });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
  });

  test('isenção para assertiva inexistente é IGNORADA', () => {
    const result = evaluatePageItem(pageItem(), {
      p1: LOGIN_PROBE,
      p2: { ...CONTENT_PROBE, consoleErrors: 1 },
    }, { ...exemption, assertion: 'naoExiste' });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
  });

  test('evaluatePageSurface repassa isenções por item e registra aplicações', () => {
    const items = [pageItem({ id: 'page:/a', path: '/a' })];
    const probes = new Map([['page:/a', { p1: LOGIN_PROBE, p2: { ...CONTENT_PROBE, pageErrors: 1 } }]]);
    const { perItem, exemptionsApplied } = evaluatePageSurface(items, probes, { 'page:/a': exemption });
    expect(perItem[0].state).toBe(COVERAGE_STATES.VALIDATED);
    expect(exemptionsApplied).toHaveLength(1);
  });
});

describe('coverage-gate — loadPageSurfaceTechnicalExecutions', () => {
  function writeReport(payload) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pages-report-')), 'report.json');
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
    return file;
  }

  const INVENTORY = [
    { id: 'page:/agenda', kind: 'page' },
    { id: 'page:/dev', kind: 'page' },
    { id: 'api:GET:/api/widgets', kind: 'api' },
  ];

  test('mapeia estados por id direto, apenas para itens page:', () => {
    const reportPath = writeReport({
      generatedAt: new Date().toISOString(), // relatório fresco — data fixa vira bomba-relógio com a política STALE de 7 dias
      perItem: [
        { id: 'page:/agenda', state: 'VALIDATED' },
        { id: 'page:/dev', state: 'VISITED' },
        { id: 'api:GET:/api/widgets', state: 'VALIDATED' }, // não é page: — ignorado
      ],
    });
    const { executions, source } = loadPageSurfaceTechnicalExecutions(INVENTORY, { reportPath });
    expect(source).toContain('page-surface-report.json');
    expect(executions).toEqual([
      { itemId: 'page:/agenda', state: 'VALIDATED' },
      { itemId: 'page:/dev', state: 'VISITED' },
    ]);
  });

  test('relatório ausente → source missing, sem execuções', () => {
    const { executions, source } = loadPageSurfaceTechnicalExecutions(INVENTORY, {
      reportPath: path.join(os.tmpdir(), 'nao-existe-page-surface.json'),
    });
    expect(source).toBe('missing');
    expect(executions).toEqual([]);
  });

  test('itens do inventário sem entrada no relatório não recebem estado', () => {
    const reportPath = writeReport({
      perItem: [{ id: 'page:/agenda', state: 'FAILED' }],
    });
    const { executions } = loadPageSurfaceTechnicalExecutions(INVENTORY, { reportPath });
    expect(executions).toEqual([{ itemId: 'page:/agenda', state: 'FAILED' }]);
  });
});
