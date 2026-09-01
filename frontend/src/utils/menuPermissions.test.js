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
    // O servidor (/auth/me) classifica o super-admin como DEVELOPMENT
    classification: 'DEVELOPMENT',
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

  it('nega /generate-system para operator (página de engenharia protegida)', () => {
    const operatorAgent = { id: 'agent-op', username: 'op', role: 'operator', tenantId: 'demo-tenant' };
    const managerAgent = { id: 'agent-mg', username: 'mg', role: 'manager', tenantId: 'demo-tenant' };

    expect(canAccessPath(operatorAgent, '/generate-system')).toBe(false);
    expect(canAccessPath(managerAgent, '/generate-system')).toBe(false);
    expect(canAccessPath(superAdminAgent, '/generate-system')).toBe(true);
  });

  it('auditor puro NÃO acessa /rpa-replays (classificação não deriva mais de role)', () => {
    // Política nova: acesso a replays é por classificação SUPPORT/DEVELOPMENT,
    // não pela role 'auditor'. Auditor sem classification/platformRole é PRODUCTION.
    const auditorAgent = { id: 'agent-au', username: 'au', role: 'auditor', tenantId: 'demo-tenant' };

    expect(canAccessPath(auditorAgent, '/rpa-replays')).toBe(false);
    expect(canAccessPath(auditorAgent, '/dev/rpa-replays')).toBe(false);
    expect(canAccessPath(auditorAgent, '/dev/rpa-test')).toBe(false);
    expect(canAccessPath(auditorAgent, '/rpa-seeds')).toBe(false);
    expect(canAccessPath(auditorAgent, '/dev/rpa-seeds')).toBe(false);
  });

  it('agent com classification SUPPORT acessa /rpa-replays, mas não /dev/* nem seeds', () => {
    // Segregação Replay×RPA: replay/leitura é ferramenta de investigação SUPPORT;
    // gravação, seeds e páginas /dev seguem DEVELOPMENT (super_admin).
    const supportAgent = { id: 'agent-su', username: 'su', role: 'auditor', tenantId: 'demo-tenant', classification: 'SUPPORT' };

    expect(canAccessPath(supportAgent, '/rpa-replays')).toBe(true);
    expect(canAccessPath(supportAgent, '/dev/rpa-replays')).toBe(false);
    expect(canAccessPath(supportAgent, '/dev/rpa-test')).toBe(false);
    expect(canAccessPath(supportAgent, '/rpa-seeds')).toBe(false);

    expect(canAccessPath(superAdminAgent, '/rpa-replays')).toBe(true);
    expect(canAccessPath(superAdminAgent, '/dev/rpa-replays')).toBe(true);
  });

  it('agent com platformRole interno acessa /rpa-replays via classificação derivada', () => {
    const platformSupportAgent = { id: 'agent-ps', username: 'ps', role: 'operator', tenantId: 'demo-tenant', platformRole: 'platform_support' };

    // platformRole platform_support → SUPPORT; role operator tem reports? não — mas
    // o gate de classificação é independente; permissão reports:read não consta para
    // operator, então o item exige classification E permission.
    expect(canAccessPath(platformSupportAgent, '/rpa-replays')).toBe(false);

    const supportWithReports = { ...platformSupportAgent, role: 'auditor' };
    expect(canAccessPath(supportWithReports, '/rpa-replays')).toBe(true);
  });

  it('nega /cases sem capability caseManagement e permite com ela', () => {
    const operatorAgent = { id: 'agent-op', username: 'op', role: 'operator', tenantId: 'demo-tenant' };

    // Sem capabilities informadas → fail-closed
    expect(canAccessPath(operatorAgent, '/cases')).toBe(false);
    // Capability desligada → negado
    expect(canAccessPath(operatorAgent, '/cases', { capabilities: { caseManagement: false } })).toBe(false);
    // Capability ligada + permissão tickets:read → permitido
    expect(canAccessPath(operatorAgent, '/cases', { capabilities: { caseManagement: true } })).toBe(true);
    expect(canAccessPath(operatorAgent, '/cases/123', { capabilities: { caseManagement: true } })).toBe(true);
  });

  it('filtra item com capability no menu apenas quando a capacidade está ligada', () => {
    const casesItem = menuItems.find((item) => item.path === '/cases');
    expect(casesItem).toBeTruthy();
    expect(casesItem.capability).toBe('caseManagement');

    expect(canAccessMenuItem(adminAgent, casesItem, { caseManagement: false })).toBe(false);
    expect(canAccessMenuItem(adminAgent, casesItem, { caseManagement: true })).toBe(true);
    // Capability é gate de tenant: vale inclusive para super_admin
    expect(canAccessMenuItem(superAdminAgent, casesItem, { caseManagement: false })).toBe(false);
    expect(canAccessMenuItem(superAdminAgent, casesItem, { caseManagement: true })).toBe(true);
  });

  it('nega /support (Central de Atendimento legada) sem capability caseManagement e permite com ela', () => {
    const operatorAgent = { id: 'agent-op', username: 'op', role: 'operator', tenantId: 'demo-tenant' };

    // Sem capabilities informadas → fail-closed
    expect(canAccessPath(operatorAgent, '/support')).toBe(false);
    // Capability desligada (tenant simple) → negado
    expect(canAccessPath(operatorAgent, '/support', { capabilities: { caseManagement: false } })).toBe(false);
    // Capability ligada + permissão tickets:read → permitido (compatibilidade legada)
    expect(canAccessPath(operatorAgent, '/support', { capabilities: { caseManagement: true } })).toBe(true);
    // Inbox continua acessível para o tenant simple (superfície canônica)
    expect(canAccessPath(operatorAgent, '/inbox', { capabilities: { caseManagement: false } })).toBe(true);
  });

  it('Central de Atendimento (/support) some do menu quando caseManagement está desligada', () => {
    // O nó-pai 'relacionamento' também tem path '/support'; o item real é o leaf.
    const supportItem = menuItems.find((item) => item.path === '/support' && item.label === 'Central de Atendimento');
    expect(supportItem).toBeTruthy();
    expect(supportItem.capability).toBe('caseManagement');

    expect(canAccessMenuItem(adminAgent, supportItem, { caseManagement: false })).toBe(false);
    expect(canAccessMenuItem(adminAgent, supportItem, { caseManagement: true })).toBe(true);
    // Capability é gate de tenant: vale inclusive para super_admin
    expect(canAccessMenuItem(superAdminAgent, supportItem, { caseManagement: false })).toBe(false);
    expect(canAccessMenuItem(superAdminAgent, supportItem, { caseManagement: true })).toBe(true);
  });
});