/**
 * Testes unitários para os endpoints GET /api/cc/reports/:reportType
 * em pbxContactCenterRoutes.js, usando ccQueueReportsService mockado.
 *
 * Cobre:
 *  - Roteamento (reportType inválido → 404)
 *  - Todos os 6 tipos de relatório mapeados
 *  - Auth (401) e permissão (403)
 *  - Passagem de filtros (from, to, queueName, limit)
 *  - Erro de serviço → 500
 */

const REPORT_TYPES = [
  'atendidas',
  'abandonadas',
  'agentes',
  'por-hora',
  'resumo-campanha',
  'pesquisa',
];

const SERVICE_FN_MAP = {
  atendidas: 'getAnsweredReport',
  abandonadas: 'getAbandonedReport',
  agentes: 'getAgentsReport',
  'por-hora': 'getHourlyReport',
  'resumo-campanha': 'getCampaignSummaryReport',
  pesquisa: 'getSurveyReport',
};

function makeReportPayload(type) {
  return { report: type, from: '2026-01-01T00:00:00.000Z', to: '2026-01-08T00:00:00.000Z' };
}

const mockReports = {};
for (const type of REPORT_TYPES) {
  const fn = SERVICE_FN_MAP[type];
  mockReports[fn] = jest.fn(async () => makeReportPayload(type));
}

jest.mock('../../api/services/cc/ccQueueReportsService', () => mockReports);

const { handlePbxContactCenterRoutes } = require('../../api/modules/pbx/pbx/pbxContactCenterRoutes');
const ccReports = require('../../api/services/cc/ccQueueReportsService');

beforeEach(() => {
  jest.clearAllMocks();
  for (const type of REPORT_TYPES) {
    const fn = SERVICE_FN_MAP[type];
    mockReports[fn].mockResolvedValue(makeReportPayload(type));
  }
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildCtx({ method = 'GET', url = '/api/cc/reports/atendidas', tenantId = 'tenant-x', query = {} } = {}) {
  const req = {
    method,
    url,
    headers: {},
    tenantId,
    query,
    user: { id: 'user-1' },
    on: jest.fn(),
  };
  const res = {};

  return {
    req,
    res,
    method,
    pathname: url.split('?')[0],
    deps: {
      sendJson: (r, status, data) => { r._status = status; r._body = data; },
      badRequest: jest.fn((r, msg) => { r._status = 400; r._body = { error: msg }; }),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      requireTenant: jest.fn(() => tenantId),
      logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      buildApiError: jest.fn((opts) => ({ error: opts.code, message: opts.message })),
    },
  };
}

// ─── roteamento básico ────────────────────────────────────────────────────────

describe('GET /api/cc/reports – roteamento', () => {
  test('retorna false para rotas fora de /api/cc', async () => {
    const ctx = buildCtx({ url: '/api/other/route' });
    const result = await handlePbxContactCenterRoutes(ctx);
    expect(result).toBe(false);
  });

  test('retorna 404 para reportType desconhecido', async () => {
    const ctx = buildCtx({ url: '/api/cc/reports/inexistente' });
    await handlePbxContactCenterRoutes(ctx);
    expect(ctx.res._status).toBe(404);
    expect(ctx.res._body).toMatchObject({ error: 'not_found' });
  });
});

// ─── autenticação e permissão ─────────────────────────────────────────────────

describe('GET /api/cc/reports – auth e permissao', () => {
  test('retorna 401 quando nao autenticado', async () => {
    const ctx = buildCtx({ url: '/api/cc/reports/atendidas' });
    ctx.deps.requireAuth = jest.fn(() => ({ valid: false, error: 'no token' }));
    await handlePbxContactCenterRoutes(ctx);
    expect(ctx.res._status).toBe(401);
  });

  test('retorna 403 quando sem permissao', async () => {
    const ctx = buildCtx({ url: '/api/cc/reports/atendidas' });
    ctx.deps.requirePermission = jest.fn(() => ({ allowed: false, error: 'forbidden' }));
    await handlePbxContactCenterRoutes(ctx);
    expect(ctx.res._status).toBe(403);
  });
});

// ─── todos os tipos de relatório ──────────────────────────────────────────────

describe('GET /api/cc/reports – todos os tipos', () => {
  for (const type of REPORT_TYPES) {
    test(`tipo '${type}' chama ${SERVICE_FN_MAP[type]} e retorna 200`, async () => {
      const ctx = buildCtx({ url: `/api/cc/reports/${type}` });
      await handlePbxContactCenterRoutes(ctx);

      expect(ctx.res._status).toBe(200);
      expect(ctx.res._body).toMatchObject({ ok: true, data: expect.objectContaining({ report: type }) });
      expect(ccReports[SERVICE_FN_MAP[type]]).toHaveBeenCalledWith(
        expect.objectContaining({ tenantKey: 'tenant-x' }),
      );
    });
  }
});

// ─── passagem de filtros ──────────────────────────────────────────────────────

describe('GET /api/cc/reports – passagem de filtros', () => {
  test('repassa from, to, queueName e limit para o servico', async () => {
    const query = { from: '2026-04-01', to: '2026-04-30', queueName: 'suporte', limit: '100' };
    const ctx = buildCtx({ url: '/api/cc/reports/atendidas', query });
    await handlePbxContactCenterRoutes(ctx);

    expect(ccReports.getAnsweredReport).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: 'tenant-x',
        filters: expect.objectContaining({
          from: '2026-04-01',
          to: '2026-04-30',
          queueName: 'suporte',
          limit: '100',
        }),
      }),
    );
  });
});

// ─── erro de serviço ──────────────────────────────────────────────────────────

describe('GET /api/cc/reports – erro de servico', () => {
  test('retorna 500 quando o servico lanca excecao', async () => {
    mockReports.getAnsweredReport.mockRejectedValueOnce(new Error('db_error'));
    const ctx = buildCtx({ url: '/api/cc/reports/atendidas' });
    await handlePbxContactCenterRoutes(ctx);

    expect(ctx.res._status).toBe(500);
    expect(ctx.deps.logger.error).toHaveBeenCalled();
  });
});
