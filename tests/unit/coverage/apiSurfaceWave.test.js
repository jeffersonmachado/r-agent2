'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  probePolicy,
  evaluateApiItem,
  evaluateApiSurface,
} = require('../../../qa/coverage/apiSurfaceWave');
const { COVERAGE_STATES } = require('../../../qa/coverage/coverageStates');
const { loadApiSurfaceTechnicalExecutions } = require('../../../scripts/governance/validate-coverage-gate');

const FALLBACK_404 = { status: 404, notFoundFallback: true };

function apiItem(overrides = {}) {
  return {
    id: 'api:GET:/api/widgets',
    kind: 'api',
    method: 'GET',
    path: '/api/widgets',
    authRequired: true,
    classification: 'PRODUCTION',
    ...overrides,
  };
}

describe('apiSurfaceWave — probePolicy (política de probe seguro)', () => {
  test('GET: P1+P2 sempre; P3 apenas em SUPPORT/DEVELOPMENT', () => {
    expect(probePolicy(apiItem())).toMatchObject({ p1: true, p2: true, p3: false });
    expect(probePolicy(apiItem({ classification: 'DEVELOPMENT' }))).toMatchObject({ p1: true, p2: true, p3: true });
    expect(probePolicy(apiItem({ classification: 'SUPPORT' }))).toMatchObject({ p1: true, p2: true, p3: true });
  });

  test('método mutável com auth: apenas P1 anônimo', () => {
    expect(probePolicy(apiItem({ method: 'POST' }))).toMatchObject({ p1: true, p2: false, p3: false });
    expect(probePolicy(apiItem({ method: 'DELETE', classification: 'DEVELOPMENT' }))).toMatchObject({ p1: true, p2: false, p3: false });
  });

  test('método mutável sem auth declarada: nenhum probe (risco de efeito colateral)', () => {
    expect(probePolicy(apiItem({ method: 'POST', authRequired: false }))).toMatchObject({ p1: false, p2: false, p3: false });
  });
});

describe('apiSurfaceWave — evaluateApiItem', () => {
  test('rota PRODUCTION com auth: P1 401 → VALIDATED', () => {
    const result = evaluateApiItem(apiItem(), { p1: { status: 401 }, p2: { status: 200 } });
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
  });

  test('rota pública GET: P1 200 → VALIDATED (só routeRegistered se aplica)', () => {
    const result = evaluateApiItem(apiItem({ authRequired: false }), { p1: { status: 200 }, p2: { status: 200 } });
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
  });

  test('rota DEVELOPMENT: P1 401, P2 403, P3 200 → VALIDATED', () => {
    const result = evaluateApiItem(apiItem({ classification: 'DEVELOPMENT' }), {
      p1: { status: 401 },
      p2: { status: 403 },
      p3: { status: 200 },
    });
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
  });

  test('VIOLAÇÃO DE VISIBILIDADE: rota DEVELOPMENT acessível por papel PRODUCTION → FAILED', () => {
    const result = evaluateApiItem(apiItem({ classification: 'DEVELOPMENT' }), {
      p1: { status: 401 },
      p2: { status: 200 },
      p3: { status: 200 },
    });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
    const a = result.assertions.find((x) => x.name === 'classificationEnforced');
    expect(a.passed).toBe(false);
  });

  test('FALHA DE SEGURANÇA: rota com authRequired acessível anonimamente → FAILED', () => {
    const result = evaluateApiItem(apiItem(), { p1: { status: 200 }, p2: { status: 200 } });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
    const a = result.assertions.find((x) => x.name === 'authEnforced');
    expect(a.passed).toBe(false);
  });

  test('DRIFT DE INVENTÁRIO: 404 de fallback em todos os probes → FAILED', () => {
    const result = evaluateApiItem(apiItem({ authRequired: false }), { p1: FALLBACK_404, p2: FALLBACK_404 });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
    const a = result.assertions.find((x) => x.name === 'routeRegistered');
    expect(a.passed).toBe(false);
  });

  test('404 de handler (não fallback) conta como rota registrada', () => {
    const result = evaluateApiItem(apiItem({ authRequired: false }), {
      p1: { status: 404, notFoundFallback: false },
      p2: { status: 404, notFoundFallback: false },
    });
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
  });

  test('servidor inalcançável (erro de rede em todos os probes) → BLOCKED', () => {
    const result = evaluateApiItem(apiItem(), { p1: { error: true }, p2: { error: true } });
    expect(result.state).toBe(COVERAGE_STATES.BLOCKED);
  });

  test('método mutável com auth: P1 401 → VALIDATED (P2/P3 não se aplicam)', () => {
    const result = evaluateApiItem(apiItem({ method: 'DELETE', id: 'api:DELETE:/api/widgets/:id' }), {
      p1: { status: 401 },
    });
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
  });

  test('método mutável DEVELOPMENT: P1 401 → VISITED (classificationEnforced não avaliada com segurança)', () => {
    const result = evaluateApiItem(apiItem({ method: 'DELETE', classification: 'DEVELOPMENT', id: 'api:DELETE:/api/qa-waves/executions' }), {
      p1: { status: 401 },
    });
    expect(result.state).toBe(COVERAGE_STATES.VISITED);
    const a = result.assertions.find((x) => x.name === 'classificationEnforced');
    expect(a.notEvaluated).toBe(true);
  });

  test('método mutável público: sem probes → VISITED (inspecionado, não executado)', () => {
    const result = evaluateApiItem(apiItem({ method: 'POST', authRequired: false, id: 'api:POST:/webhooks/x' }), {});
    expect(result.state).toBe(COVERAGE_STATES.VISITED);
  });

  test('rota DEVELOPMENT sem tokens disponíveis: P1 401 → VISITED (P2/P3 pulados)', () => {
    const result = evaluateApiItem(apiItem({ classification: 'DEVELOPMENT' }), { p1: { status: 401 } });
    expect(result.state).toBe(COVERAGE_STATES.VISITED);
  });

  test('super_admin bloqueado na própria rota DEVELOPMENT → FAILED', () => {
    const result = evaluateApiItem(apiItem({ classification: 'DEVELOPMENT' }), {
      p1: { status: 401 },
      p2: { status: 403 },
      p3: { status: 403 },
    });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
    const a = result.assertions.find((x) => x.name === 'developmentReachable');
    expect(a.passed).toBe(false);
  });
});

describe('apiSurfaceWave — evaluateApiSurface (totais)', () => {
  test('agrega por estado apenas itens kind=api', () => {
    const items = [
      apiItem({ id: 'api:GET:/a' }),
      apiItem({ id: 'api:GET:/b', authRequired: false }),
      { id: 'model:Widget', kind: 'model' },
    ];
    const probes = new Map([
      ['api:GET:/a', { p1: { status: 401 } }],
      ['api:GET:/b', { p1: { status: 200 } }],
    ]);
    const { perItem, totals } = evaluateApiSurface(items, probes);
    expect(perItem).toHaveLength(2);
    expect(totals.items).toBe(2);
    expect(totals.byState.VALIDATED).toBe(2);
  });
});

describe('apiSurfaceWave — isenções justificadas', () => {
  const exemption = {
    assertion: 'authEnforced',
    reason: 'endpoint público intencional',
    approvedBy: 'qa',
    date: '2026-07-28',
  };

  test('isenção válida marca assertiva NOT_APPLICABLE e item fica VALIDATED', () => {
    const result = evaluateApiItem(apiItem(), { p1: { status: 200 }, p2: { status: 200 } }, exemption);
    expect(result.state).toBe(COVERAGE_STATES.VALIDATED);
    const a = result.assertions.find((x) => x.name === 'authEnforced');
    expect(a.notApplicable).toBe(true);
    expect(result.exemption).toMatchObject({ item: 'api:GET:/api/widgets', assertion: 'authEnforced' });
  });

  test('isenção sem campos obrigatórios é IGNORADA (assertiva continua falhando)', () => {
    const result = evaluateApiItem(apiItem(), { p1: { status: 200 }, p2: { status: 200 } }, { assertion: 'authEnforced' });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
  });

  test('isenção para assertiva inexistente é IGNORADA', () => {
    const result = evaluateApiItem(apiItem(), { p1: { status: 200 }, p2: { status: 200 } }, { ...exemption, assertion: 'naoExiste' });
    expect(result.state).toBe(COVERAGE_STATES.FAILED);
  });

  test('evaluateApiSurface repassa isenções por item e registra aplicações', () => {
    const items = [apiItem({ id: 'api:GET:/a' })];
    const probes = new Map([['api:GET:/a', { p1: { status: 200 } }]]);
    const { perItem, exemptionsApplied } = evaluateApiSurface(items, probes, {
      'api:GET:/a': exemption,
    });
    expect(perItem[0].state).toBe(COVERAGE_STATES.VALIDATED);
    expect(exemptionsApplied).toHaveLength(1);
  });
});

describe('coverage-gate — loadApiSurfaceTechnicalExecutions', () => {
  function writeReport(payload) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apis-report-')), 'report.json');
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
    return file;
  }

  const INVENTORY = [
    { id: 'api:GET:/api/widgets', kind: 'api' },
    { id: 'api:POST:/api/widgets', kind: 'api' },
    { id: 'model:Widget', kind: 'model' },
  ];

  test('mapeia estados por id direto, apenas para itens api:', () => {
    const reportPath = writeReport({
      generatedAt: '2026-07-28T00:00:00Z',
      perItem: [
        { id: 'api:GET:/api/widgets', state: 'VALIDATED' },
        { id: 'api:POST:/api/widgets', state: 'VISITED' },
        { id: 'model:Widget', state: 'VALIDATED' }, // não é api: — ignorado
      ],
    });
    const { executions, source } = loadApiSurfaceTechnicalExecutions(INVENTORY, { reportPath });
    expect(source).toContain('api-surface-report.json');
    expect(executions).toEqual([
      { itemId: 'api:GET:/api/widgets', state: 'VALIDATED' },
      { itemId: 'api:POST:/api/widgets', state: 'VISITED' },
    ]);
  });

  test('relatório ausente → source missing, sem execuções', () => {
    const { executions, source } = loadApiSurfaceTechnicalExecutions(INVENTORY, {
      reportPath: path.join(os.tmpdir(), 'nao-existe-api-surface.json'),
    });
    expect(source).toBe('missing');
    expect(executions).toEqual([]);
  });

  test('itens do inventário sem entrada no relatório não recebem estado', () => {
    const reportPath = writeReport({
      perItem: [{ id: 'api:GET:/api/widgets', state: 'FAILED' }],
    });
    const { executions } = loadApiSurfaceTechnicalExecutions(INVENTORY, { reportPath });
    expect(executions).toEqual([{ itemId: 'api:GET:/api/widgets', state: 'FAILED' }]);
  });
});
