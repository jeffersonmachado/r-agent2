# Helpers de Teste

## dbMock.js

Helper para criar mocks de tenants e configurar testes com PostgreSQL mockado.

### Uso

```javascript
const { setupTenantMock, setupTenantNotFound, createMockTenant } = require('./helpers/dbMock');

// Configurar mock para retornar um tenant específico
const mockTenant = setupTenantMock(mockModels, {
  id: 'test-tenant-id',
  name: 'Test Tenant',
  status: 'active',
});

// Configurar mock para retornar null (tenant não encontrado)
setupTenantNotFound(mockModels);

// Criar um tenant mockado
const tenant = createMockTenant({
  name: 'Custom Tenant',
  plan: 'pro',
});
```

### Funções Disponíveis

- `createMockTenant(overrides)` - Cria um objeto tenant mockado
- `setupTenantMock(mockModels, tenantData)` - Configura mocks para retornar tenant
- `setupTenantNotFound(mockModels)` - Configura mocks para retornar null
- `setupMultipleTenants(mockModels, tenantsData)` - Configura mocks para múltiplos tenants

### Nota Importante

Os mocks do Sequelize (`jest.mock('../../db/index.js')`) devem ser configurados **ANTES** de importar os módulos que dependem do banco de dados. Veja `api/services/__tests__/tenantService.test.js` como exemplo.
