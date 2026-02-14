/**
 * Helper para mockar PostgreSQL/Sequelize em testes
 * 
 * Este helper fornece funções utilitárias para configurar mocks de tenants
 * em testes. Os mocks do Sequelize devem ser configurados nos arquivos de teste
 * ANTES de importar os módulos que dependem do banco de dados.
 */

// Mock do módulo sequelize.js (deve ser chamado antes de importar módulos)
const mockSequelizeInstance = {
  authenticate: jest.fn().mockResolvedValue(true),
  close: jest.fn().mockResolvedValue(true),
  getQueryInterface: jest.fn().mockReturnValue({
    sequelize: {
      query: jest.fn(),
      constructor: {
        QueryTypes: {
          SELECT: 'SELECT',
          INSERT: 'INSERT',
          UPDATE: 'UPDATE',
          DELETE: 'DELETE',
        },
      },
    },
  }),
  connectionManager: {
    pool: {},
  },
};

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => mockSequelizeInstance),
  connect: jest.fn().mockResolvedValue(mockSequelizeInstance),
  close: jest.fn().mockResolvedValue(true),
  Sequelize: jest.fn(),
}));

// Mock do módulo models/index.js (deve ser chamado antes de importar módulos)
// Cria models mockados inline para evitar problemas de escopo
const mockTenantModel = {
  findOne: jest.fn(),
  findByPk: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  destroy: jest.fn(),
  count: jest.fn(),
};

const mockUserModel = {
  findOne: jest.fn(),
  findByPk: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockTenantUserModel = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
};

const mockTenantSettingModel = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
};

const mockTenantAISettingModel = {
  findOne: jest.fn(),
  create: jest.fn(),
};

const mockTenantAICredentialModel = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
};

const mockTenantContextModel = {
  findByPk: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  destroy: jest.fn(),
};

const mockFlowModel = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  destroy: jest.fn(),
};

const mockAuditLogModel = {
  create: jest.fn(),
  findAll: jest.fn(),
};

const mockModelsFactory = () => {
  return {
    Tenant: () => mockTenantModel,
    User: () => mockUserModel,
    TenantUser: () => mockTenantUserModel,
    TenantSetting: () => mockTenantSettingModel,
    TenantAISetting: () => mockTenantAISettingModel,
    TenantAICredential: () => mockTenantAICredentialModel,
    TenantContext: () => mockTenantContextModel,
    Flow: () => mockFlowModel,
    AuditLog: () => mockAuditLogModel,
    defineRelationships: jest.fn(),
    getTenant: () => mockTenantModel,
    getUser: () => mockUserModel,
    getTenantUser: () => mockTenantUserModel,
    getTenantSetting: () => mockTenantSettingModel,
    getTenantAISetting: () => mockTenantAISettingModel,
    getTenantAICredential: () => mockTenantAICredentialModel,
    getTenantContext: () => mockTenantContextModel,
    getFlow: () => mockFlowModel,
    getAuditLog: () => mockAuditLogModel,
  };
};

jest.mock('../../api/db/models', () => mockModelsFactory());

/**
 * Retorna os mocks dos models para uso nos testes
 */
function mockDatabase() {
  return {
    mockSequelize: mockSequelizeInstance,
    mockModels: {
      Tenant: mockTenantModel,
      User: mockUserModel,
      TenantUser: mockTenantUserModel,
      TenantSetting: mockTenantSettingModel,
      TenantAISetting: mockTenantAISettingModel,
      TenantAICredential: mockTenantAICredentialModel,
      TenantContext: mockTenantContextModel,
      Flow: mockFlowModel,
      AuditLog: mockAuditLogModel,
    },
  };
}

/**
 * Limpa todos os mocks do banco de dados
 * @deprecated - Use jest.clearAllMocks() diretamente
 */
function clearDatabaseMocks() {
  jest.clearAllMocks();
}

/**
 * Cria um tenant mockado para retornar em queries
 */
function createMockTenant(overrides = {}) {
  const tenant = {
    id: overrides.id || overrides.tenant_key || 'test-tenant-id',
    tenant_key: overrides.tenant_key || overrides.id || 'test-tenant',
    name: overrides.name || 'Test Tenant',
    site: overrides.site || 'https://test.com',
    ramo_atividade: overrides.ramo_atividade || 'Teste',
    objetivo: overrides.objetivo || 'Testar',
    status: overrides.status || 'active',
    plan: overrides.plan || 'trial',
    limits: overrides.limits || {
      usuarios: 5,
      agentes_ia: 3,
      execucoes_rpa: 100,
      tokens_ia: 100000,
      documentos_rag: 50,
      storage_mb: 100,
    },
    settings: overrides.settings || {},
    branding: overrides.branding || {},
    suspended_at: overrides.suspended_at || null,
    trial_expires_at: overrides.trial_expires_at || null,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    toJSON: jest.fn(function() {
      return this;
    }),
    update: jest.fn(async (data = {}) => {
      Object.assign(tenant, data);
      return tenant;
    }),
    reload: jest.fn(async () => tenant),
    destroy: jest.fn(async () => true),
    ...overrides,
  };
  return tenant;
}

/**
 * Configura o mock do Tenant para retornar um tenant específico
 */
function setupTenantMock(mockModels, tenantData) {
  const mockTenant = createMockTenant(tenantData);
  
  mockModels.Tenant.findOne.mockResolvedValue(mockTenant);
  mockModels.Tenant.findByPk.mockResolvedValue(mockTenant);
  mockModels.Tenant.findAll.mockResolvedValue([mockTenant]);
  mockModels.Tenant.create.mockResolvedValue(mockTenant);
  mockModels.Tenant.update.mockResolvedValue([1, [mockTenant]]);
  
  return mockTenant;
}

/**
 * Configura o mock do Tenant para retornar null (não encontrado)
 */
function setupTenantNotFound(mockModels) {
  mockModels.Tenant.findOne.mockResolvedValue(null);
  mockModels.Tenant.findByPk.mockResolvedValue(null);
}

/**
 * Configura o mock do Tenant para retornar múltiplos tenants
 */
function setupMultipleTenants(mockModels, tenantsData = []) {
  const mockTenants = tenantsData.map(data => createMockTenant(data));
  
  mockModels.Tenant.findAll.mockResolvedValue(mockTenants);
  
  return mockTenants;
}

module.exports = {
  mockDatabase,
  mockModelsFactory,
  clearDatabaseMocks,
  createMockTenant,
  setupTenantMock,
  setupTenantNotFound,
  setupMultipleTenants,
};
