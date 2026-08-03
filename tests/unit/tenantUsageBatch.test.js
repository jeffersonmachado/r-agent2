'use strict';

/**
 * Regressão N+1 (tenantService.getTenantsUsageBatch + superAdminService):
 * listAllTenants chamava getTenantUsage por tenant (~8 queries por tenant:
 * getTenant + 5 COUNTs sequenciais + 2 do getSetting). Agora as métricas são
 * agregadas com GROUP BY tenant_key para todos os tenants de uma vez
 * (6 queries no total), cruzadas em memória.
 */

const { mockDatabase, createMockTenant } = require('../helpers/dbMock');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));
jest.mock('../../api/utils/config', () => ({
  get: jest.fn((key, defaultValue) => defaultValue || null),
}));
jest.mock('../../api/services/webScrapingService');
jest.mock('../../api/services/ragDocumentsService');
jest.mock('../../api/db/models', () => require('../helpers/dbMock').mockModelsFactory());

const { mockModels } = mockDatabase();
const { getSequelize } = require('../../api/db/sequelize');

const {
  getTenantsUsageBatch,
  getTenantUsage,
  _internal,
} = require('../../api/services/tenantService');

function currentMonthStartISO() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString();
}

function makeQueryMock() {
  return jest.fn(async (sql) => {
    if (sql.includes('FROM users')) return [[{ tenant_key: 't1', count: 3 }, { tenant_key: 't2', count: 5 }]];
    if (sql.includes('FROM channel_accounts')) return [[{ tenant_key: 't1', count: 2 }]];
    if (sql.includes('FROM channel_conversations')) return [[{ tenant_key: 't2', count: 7 }]];
    if (sql.includes('FROM tickets')) return [[{ tenant_key: 't1', count: 11 }]];
    if (sql.includes('FROM rag_documents')) return [[{ tenant_key: 't1', count: 4 }]];
    if (sql.includes('FROM tenant_settings')) {
      return [[{
        tenant_key: 't1',
        value: { monthStart: currentMonthStartISO(), counters: { agentes_ia: 2, tokens_ia: 100 } },
      }]];
    }
    return [[]];
  });
}

const sequelizeInstance = { connectionManager: { pool: {} }, query: null };

describe('tenantService.getTenantsUsageBatch — métricas agregadas sem N+1', () => {
  beforeEach(() => {
    // resetMocks global remove implementações — reestabelece o sequelize "up".
    _internal.clearTenantCache();
    sequelizeInstance.query = makeQueryMock();
    getSequelize.mockReturnValue(sequelizeInstance);
  });

  it('agrega todas as métricas em 6 queries independente do número de tenants', async () => {
    const sequelize = getSequelize();
    const usage = await getTenantsUsageBatch(['t1', 't2', 't3']);

    // Antes: 3 tenants × (1 getTenant + 5 COUNTs + 2 getSetting) = 24 queries.
    expect(sequelize.query).toHaveBeenCalledTimes(6);

    expect(usage.get('t1')).toMatchObject({
      tenantId: 't1',
      usuarios: 3,
      max_agentes: 3,
      max_canais: 2,
      max_conversas_mes: 11,
      conversas_canais_mes: 0,
      agentes_ia: 2,
      tokens_ia: 100,
      documentos_rag: 4,
      storage_mb: 0,
      periodo: 'mensal',
    });
    expect(usage.get('t2')).toMatchObject({
      usuarios: 5,
      max_canais: 0,
      conversas_canais_mes: 7,
      agentes_ia: 0,
      documentos_rag: 0,
    });
    // Tenant sem nenhuma linha nas agregações recebe zeros (não undefined).
    expect(usage.get('t3')).toMatchObject({
      usuarios: 0,
      max_canais: 0,
      max_conversas_mes: 0,
      documentos_rag: 0,
      periodo: 'mensal',
    });

    // As 5 queries de contagem agregam por tenant_key (GROUP BY); a 6ª
    // (tenant_settings) é um JOIN único para todos os tenants.
    const countQueries = sequelize.query.mock.calls.filter(([sql]) => !sql.includes('FROM tenant_settings'));
    expect(countQueries).toHaveLength(5);
    for (const [sql] of countQueries) {
      expect(sql).toContain('GROUP BY tenant_key');
    }
  });

  it('contadores de usage_metrics fora do mês corrente são zerados', async () => {
    const sequelize = getSequelize();
    sequelize.query = jest.fn(async (sql) => {
      if (sql.includes('FROM tenant_settings')) {
        return [[{ tenant_key: 't1', value: { monthStart: '2000-01-01T00:00:00.000Z', counters: { agentes_ia: 9 } } }]];
      }
      return [[]];
    });

    const usage = await getTenantsUsageBatch(['t1']);
    expect(usage.get('t1').agentes_ia).toBe(0);
  });

  it('getTenantUsage (1 tenant) continua funcionando reusando a query agregada', async () => {
    const sequelize = getSequelize();
    mockModels.Tenant.findOne.mockResolvedValue(
      createMockTenant({ tenant_key: 't1', id: 't1', name: 'Tenant Um' }),
    );

    const usage = await getTenantUsage('t1');

    expect(usage).toMatchObject({ tenantId: 't1', usuarios: 3, agentes_ia: 2, documentos_rag: 4 });
    expect(sequelize.query).toHaveBeenCalledTimes(6);
  });
});
