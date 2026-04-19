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
});