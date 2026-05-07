import { describe, expect, it } from 'vitest';
import { canAccessPath, canAccessMenuItem, isSuperAdmin, menuItems } from './menuPermissions';

describe('menuPermissions', () => {
  const adminAgent = {
    id: 'agent-admin',
    username: 'admin',
    role: 'admin',
    tenantId: 'demo-tenant',
  };

  const superAdminAgent = {
    id: 'agent-root',
    username: 'systemadmin',
    role: 'owner',
    tenantId: 'system',
    originalTenantId: 'system',
  };

  it('permite papeis listados mesmo quando a rota tambem aceita super_admin', () => {
    expect(canAccessPath(adminAgent, '/bpmn-editor')).toBe(true);
    expect(canAccessPath(adminAgent, '/solutions')).toBe(true);
    expect(canAccessPath(adminAgent, '/node-marketplace')).toBe(true);
  });

  it('continua permitindo super admin nas rotas marcadas com super_admin', () => {
    const superAdminOnlyItem = menuItems.find((item) => item.path === '/super-admin');

    expect(isSuperAdmin(superAdminAgent)).toBe(true);
    expect(superAdminOnlyItem).toBeTruthy();
    expect(canAccessMenuItem(superAdminAgent, superAdminOnlyItem)).toBe(true);
  });

  it('permite super_admin acessar /qa diretamente', () => {
    const directSuperAdminAgent = {
      id: 'agent-direct-super-admin',
      username: 'root',
      role: 'super_admin',
      tenantId: 'tenant-x',
    };

    expect(isSuperAdmin(directSuperAdminAgent)).toBe(true);
    expect(canAccessPath(directSuperAdminAgent, '/qa')).toBe(true);
  });

  it('reconhece variacao de role SUPER-ADMIN como super admin', () => {
    const variantRoleAgent = {
      id: 'agent-variant-super-admin',
      username: 'root',
      role: 'SUPER-ADMIN',
      tenantId: 'tenant-y',
    };

    expect(isSuperAdmin(variantRoleAgent)).toBe(true);
    expect(canAccessPath(variantRoleAgent, '/qa')).toBe(true);
  });
});