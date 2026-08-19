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

  it('nega /qa, /qa/stability e /qa-mesh para operator e manager (ferramentas de engenharia)', () => {
    const operatorAgent = { id: 'agent-op', username: 'op', role: 'operator', tenantId: 'demo-tenant' };
    const managerAgent = { id: 'agent-mg', username: 'mg', role: 'manager', tenantId: 'demo-tenant' };

    for (const agent of [operatorAgent, managerAgent]) {
      expect(canAccessPath(agent, '/qa')).toBe(false);
      expect(canAccessPath(agent, '/qa/stability')).toBe(false);
      expect(canAccessPath(agent, '/qa-mesh')).toBe(false);
      expect(canAccessPath(agent, '/dev/qa-waves')).toBe(false);
      expect(canAccessPath(agent, '/dev/rpa-replays')).toBe(false);
    }
  });

  it('nega path desconhecido sob prefixo protegido para não-super_admin mesmo com allowUnknown', () => {
    const managerAgent = { id: 'agent-mg', username: 'mg', role: 'manager', tenantId: 'demo-tenant' };

    expect(canAccessPath(managerAgent, '/dev/qualquer-coisa', { allowUnknown: true })).toBe(false);
    expect(canAccessPath(managerAgent, '/qa/qualquer-coisa', { allowUnknown: true })).toBe(false);
    expect(canAccessPath(managerAgent, '/rpa/qualquer-coisa', { allowUnknown: true })).toBe(false);
    expect(canAccessPath(superAdminAgent, '/dev/qualquer-coisa', { allowUnknown: true })).toBe(true);
  });

  it('mantém allowUnknown para paths fora dos prefixos protegidos', () => {
    expect(canAccessPath(adminAgent, '/alguma-rota-nova', { allowUnknown: true })).toBe(true);
  });

  it('nega aliases legados de páginas de engenharia para não-super_admin', () => {
    // Regressão: /system-status (alias legado de /dev/system-status) não tem prefixo
    // protegido nem entrada de menu — qualquer usuário autenticado abria a página de
    // diagnóstico por URL direta (bypass da segregação DEVELOPMENT).
    const operatorAgent = { id: 'agent-op', username: 'op', role: 'operator', tenantId: 'demo-tenant' };
    const managerAgent = { id: 'agent-mg', username: 'mg', role: 'manager', tenantId: 'demo-tenant' };

    for (const agent of [operatorAgent, managerAgent]) {
      expect(canAccessPath(agent, '/system-status')).toBe(false);
      expect(canAccessPath(agent, '/rpa-replays')).toBe(false);
      expect(canAccessPath(agent, '/rpa-seeds')).toBe(false);
    }
    expect(canAccessPath(superAdminAgent, '/system-status')).toBe(true);
  });

  it('permite auditor (SUPPORT) na página de replays /rpa-replays, mas não em /dev/* nem seeds', () => {
    // Segregação Replay×RPA (W2-B): replay/leitura é ferramenta de investigação
    // SUPPORT; gravação, seeds e páginas /dev seguem DEVELOPMENT (super_admin).
    const auditorAgent = { id: 'agent-au', username: 'au', role: 'auditor', tenantId: 'demo-tenant' };

    expect(canAccessPath(auditorAgent, '/rpa-replays')).toBe(true);
    expect(canAccessPath(auditorAgent, '/dev/rpa-replays')).toBe(false);
    expect(canAccessPath(auditorAgent, '/dev/rpa-test')).toBe(false);
    expect(canAccessPath(auditorAgent, '/rpa-seeds')).toBe(false);
    expect(canAccessPath(auditorAgent, '/dev/rpa-seeds')).toBe(false);

    expect(canAccessPath(superAdminAgent, '/rpa-replays')).toBe(true);
    expect(canAccessPath(superAdminAgent, '/dev/rpa-replays')).toBe(true);
  });
});