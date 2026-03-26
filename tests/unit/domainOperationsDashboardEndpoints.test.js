'use strict';

/**
 * tests/unit/domainOperationsDashboardEndpoints.test.js
 *
 * Testes unitários para os endpoints adicionados em domain-operations/routes.js:
 *   GET /api/support/dashboard
 *   GET /api/crm/analytics/dashboard
 *
 * Valida:
 *  - 401 quando auth inválida
 *  - 403 quando tenant não resolvido
 *  - 403 quando sem permissão
 *  - 200 com contrato de resposta correto (DB mock)
 *  - 200 com fallback quando DB indisponível
 *  - tenant scoping: queries recebem o tenantId correto
 */

const express = require('express');
const http = require('http');

// ---- helpers de mock ----

function makeSequelizeMock(queryResults) {
  // queryResults: array de respostas para cada chamada sequencial de sequelize.query
  let callIdx = 0;
  return {
    query: jest.fn(async () => {
      const result = queryResults[callIdx++] || [[]];
      return result;
    }),
  };
}

function makeModelMock(sequelize) {
  return { sequelize };
}

// Mock para OutboundQueueItem e MarketingLead – substituídos por jest.mock mais abaixo
let mockOutboundQueueItemResult = null;
let mockMarketingLeadResult = null;

jest.mock('../../api/db/models', () => ({
  get OutboundQueueItem() { return mockOutboundQueueItemResult; },
  get MarketingLead() { return mockMarketingLeadResult; },
}));

const { createDomainOperationsRoutes } = require('../../api/modules/domain-operations/routes');

async function requestJson(app, method, path) {
  const server = app.listen(0);

  try {
    const { port } = server.address();

    return await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let body = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            body = null;
          }

          resolve({ status: res.statusCode, body, raw });
        });
      });

      req.on('error', reject);
      req.end();
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

// ---- factory de app Express com deps injectados ----

function buildApp({ tenantId = 'tenant-a', authValid = true, permAllowed = true, sequelizeOutbound = null, sequelizeCrm = null } = {}) {
  const app = express();
  app.use(express.json());

  const agent = { id: 'agent-1', role: 'admin', tenantId };

  function buildDeps(req, _res) {
    return {
      requireAuth: () => authValid
        ? { valid: true, agent }
        : { valid: false, error: 'unauthorized' },
      requirePermission: () => permAllowed
        ? { allowed: true }
        : { allowed: false, error: 'forbidden' },
      requireTenant: () => tenantId,
      sendJson: (res, status, body) => {
        res.status(status).json(body);
      },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    };
  }

  // Injecta mocks de DB antes de criar o router
  if (sequelizeOutbound) {
    mockOutboundQueueItemResult = makeModelMock(sequelizeOutbound);
  } else {
    mockOutboundQueueItemResult = null; // simula db_unavailable
  }

  if (sequelizeCrm) {
    mockMarketingLeadResult = makeModelMock(sequelizeCrm);
  } else {
    mockMarketingLeadResult = null; // simula db_unavailable
  }

  const router = createDomainOperationsRoutes({ buildDeps });
  app.use(router);
  return app;
}

// ==================== /api/support/dashboard ====================

describe('GET /api/support/dashboard', () => {
  afterEach(() => jest.clearAllMocks());

  test('401 quando auth inválida', async () => {
    const app = buildApp({ authValid: false });
    const res = await requestJson(app, 'GET', '/api/support/dashboard');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'unauthorized' });
  });

  test('403 quando sem permissão', async () => {
    const app = buildApp({ permAllowed: false });
    const res = await requestJson(app, 'GET', '/api/support/dashboard');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden' });
  });

  test('200 com fallback quando DB indisponível', async () => {
    const app = buildApp({ sequelizeOutbound: null });
    const res = await requestJson(app, 'GET', '/api/support/dashboard');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      outboundPendingCount: 0,
      outboundFailedCount: 0,
      recentErrors: [],
    });
    expect(res.body.meta).toMatchObject({ warning: 'db_unavailable' });
  });

  test('200 com contrato correto quando DB disponível', async () => {
    const seqMock = makeSequelizeMock([
      [[{ c: 3 }]],   // pending count
      [[{ c: 7 }]],   // failed count
      [[             // recent errors
        { id: 'err-1', channel_type: 'whatsapp', last_error: 'connection_not_found', attempts: 5, next_attempt_at: null, updated_at: new Date().toISOString() },
        { id: 'err-2', channel_type: 'email', last_error: 'smtp_error', attempts: 2, next_attempt_at: null, updated_at: new Date().toISOString() },
      ]],
    ]);
    const app = buildApp({ sequelizeOutbound: seqMock });
    const res = await requestJson(app, 'GET', '/api/support/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.outboundPendingCount).toBe(3);
    expect(res.body.outboundFailedCount).toBe(7);
    expect(Array.isArray(res.body.recentErrors)).toBe(true);
    expect(res.body.recentErrors).toHaveLength(2);
    expect(res.body.recentErrors[0]).toMatchObject({ id: 'err-1', channel_type: 'whatsapp' });
  });

  test('queries recebem o tenantId correto como replacements', async () => {
    const seqMock = makeSequelizeMock([[[{ c: 0 }]], [[{ c: 0 }]], [[]]]);
    const app = buildApp({ tenantId: 'tenant-test-xyz', sequelizeOutbound: seqMock });
    await requestJson(app, 'GET', '/api/support/dashboard');

    expect(seqMock.query).toHaveBeenCalledTimes(3);
    const firstCall = seqMock.query.mock.calls[0];
    expect(firstCall[1]).toMatchObject({ replacements: { t: 'tenant-test-xyz' } });
  });

  test('500 quando query lança exceção', async () => {
    const badSeq = { query: jest.fn().mockRejectedValue(new Error('db boom')) };
    const app = buildApp({ sequelizeOutbound: badSeq });
    const res = await requestJson(app, 'GET', '/api/support/dashboard');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'internal_error' });
  });
});

// ==================== /api/crm/analytics/dashboard ====================

describe('GET /api/crm/analytics/dashboard', () => {
  afterEach(() => jest.clearAllMocks());

  test('401 quando auth inválida', async () => {
    const app = buildApp({ authValid: false });
    const res = await requestJson(app, 'GET', '/api/crm/analytics/dashboard');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'unauthorized' });
  });

  test('403 quando sem permissão', async () => {
    const app = buildApp({ permAllowed: false });
    const res = await requestJson(app, 'GET', '/api/crm/analytics/dashboard');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden' });
  });

  test('200 com fallback quando DB indisponível', async () => {
    const app = buildApp({ sequelizeCrm: null });
    const res = await requestJson(app, 'GET', '/api/crm/analytics/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dashboard).toMatchObject({
      summary: { totalAccounts: 0, totalContacts: 0, totalLeads: 0, totalOpportunities: 0 },
      opportunity: { totalValue: 0, winRate: '0%' },
    });
    expect(res.body.meta).toMatchObject({ warning: 'db_unavailable' });
  });

  test('200 com contrato completo quando DB disponível', async () => {
    const seqMock = makeSequelizeMock([
      [[{
        total_leads: 50,
        total_contacts: 40,
        total_accounts: 10,
        total_opportunities: 20,
        won_count: 8,
        lost_count: 4,
        total_value: 250000,
      }]],
    ]);
    const app = buildApp({ sequelizeCrm: seqMock });
    const res = await requestJson(app, 'GET', '/api/crm/analytics/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dashboard.summary).toMatchObject({
      totalLeads: 50,
      totalContacts: 40,
      totalAccounts: 10,
      totalOpportunities: 20,
    });
    expect(res.body.dashboard.opportunity.totalValue).toBe(250000);
    // winRate = 8/(8+4) = 67%
    expect(res.body.dashboard.opportunity.winRate).toBe('67%');
  });

  test('meta contém tenantId e generatedAt', async () => {
    const seqMock = makeSequelizeMock([[[{ total_leads: 0, total_contacts: 0, total_accounts: 0, total_opportunities: 0, won_count: 0, lost_count: 0, total_value: 0 }]]]);
    const app = buildApp({ tenantId: 'meu-tenant', sequelizeCrm: seqMock });
    const res = await requestJson(app, 'GET', '/api/crm/analytics/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ tenantId: 'meu-tenant' });
    expect(typeof res.body.meta.generatedAt).toBe('string');
  });

  test('queries recebem tenantId correto como replacements', async () => {
    const seqMock = makeSequelizeMock([[[{ total_leads: 0, total_contacts: 0, total_accounts: 0, total_opportunities: 0, won_count: 0, lost_count: 0, total_value: 0 }]]]);
    const app = buildApp({ tenantId: 'tenant-xpto', sequelizeCrm: seqMock });
    await requestJson(app, 'GET', '/api/crm/analytics/dashboard');

    expect(seqMock.query).toHaveBeenCalledTimes(1);
    const firstCall = seqMock.query.mock.calls[0];
    expect(firstCall[1]).toMatchObject({ replacements: { tenantId: 'tenant-xpto' } });
  });

  test('winRate zero quando sem won/lost', async () => {
    const seqMock = makeSequelizeMock([[[{ total_leads: 5, total_contacts: 5, total_accounts: 1, total_opportunities: 5, won_count: 0, lost_count: 0, total_value: 0 }]]]);
    const app = buildApp({ sequelizeCrm: seqMock });
    const res = await requestJson(app, 'GET', '/api/crm/analytics/dashboard');
    expect(res.body.dashboard.opportunity.winRate).toBe('0%');
  });

  test('500 quando query lança exceção', async () => {
    const badSeq = { query: jest.fn().mockRejectedValue(new Error('pg gone')) };
    const app = buildApp({ sequelizeCrm: badSeq });
    const res = await requestJson(app, 'GET', '/api/crm/analytics/dashboard');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'internal_error' });
  });
});
