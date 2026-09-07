import { describe, expect, it } from 'vitest';
import { navigationMenu, flattenNavigationLeaves, getWorkspaceKeysForPath, inferWorkspaceKeyFromTenantContext, inferWorkspaceKeyFromTenantProfile } from './menu';

describe('vertical workspace resolution', () => {
  it('infere beauty pelo contexto do tenant', () => {
    expect(inferWorkspaceKeyFromTenantContext({ ramo_atividade: 'Salao de beleza com foco em estetica' })).toBe('beauty');
  });

  it('infere fitness pelo contexto do tenant', () => {
    expect(inferWorkspaceKeyFromTenantContext({ ramo_atividade: 'Academia fitness com pilates e musculacao' })).toBe('fitness');
  });

  it('usa a vertical inferida no dashboard vertical', () => {
    expect(getWorkspaceKeysForPath('/vertical/dashboard', {
      tenantContext: { ramo_atividade: 'Academia boutique fitness' },
    })).toEqual(['fitness']);
  });

  it('prioriza settings do tenant quando houver segmento canonico', () => {
    expect(inferWorkspaceKeyFromTenantProfile({
      tenant: { settings: { segment: 'academia' } },
      context: { ramo_atividade: 'Salao de beleza' },
    })).toBe('fitness');
  });

  it('resolve outras verticais conhecidas por settings do tenant', () => {
    expect(inferWorkspaceKeyFromTenantProfile({
      tenant: { settings: { vertical: 'ecommerce' } },
      context: null,
    })).toBe('ecommerce');
  });

  it('mostra todas as verticais para super-admin no dashboard vertical', () => {
    expect(getWorkspaceKeysForPath('/vertical/dashboard', {
      includeAllVerticals: true,
    })).toEqual(['beauty', 'fitness', 'food', 'ecommerce', 'varejo', 'servicos', 'saude', 'educacao', 'financeiro', 'cobranca', 'padaria']);
  });

  it('infere food pelo contexto do tenant', () => {
    expect(inferWorkspaceKeyFromTenantContext({ ramo_atividade: 'Restaurante e delivery de marmitas' })).toBe('food');
    expect(inferWorkspaceKeyFromTenantContext({ ramo_atividade: 'Pizzaria com entrega' })).toBe('food');
  });

  it('infere padaria pelo contexto do tenant', () => {
    expect(inferWorkspaceKeyFromTenantContext({ ramo_atividade: 'Padaria e confeitaria artesanal' })).toBe('padaria');
    expect(inferWorkspaceKeyFromTenantContext({ ramo_atividade: 'Panificadora bakery' })).toBe('padaria');
  });

  it('resolve padaria por settings do tenant (segment ou vertical bakery)', () => {
    expect(inferWorkspaceKeyFromTenantProfile({
      tenant: { settings: { segment: 'padaria' } },
      context: null,
    })).toBe('padaria');
    expect(inferWorkspaceKeyFromTenantProfile({
      tenant: { settings: { vertical: 'bakery' } },
      context: null,
    })).toBe('padaria');
  });
});

describe('QA & RPA navigation structure', () => {
  const plataforma = navigationMenu.find((n) => n.id === 'plataforma');
  const superAdmin = plataforma.children.find((n) => n.id === 'super-admin');
  const qualidade = plataforma.children.find((n) => n.id === 'qualidade');

  it('agrupa as ferramentas de QA/RPA no subgrupo dev-qa-rpa dentro de Super Admin', () => {
    const grupo = superAdmin.children.find((n) => n.id === 'dev-qa-rpa');
    expect(grupo).toBeTruthy();
    expect(flattenNavigationLeaves([grupo]).map((l) => l.path)).toEqual([
      '/dev/qa-waves',
      '/dev/qa-audit',
      '/dev/qa-waves/operational-health',
      '/dev/qa-waves/enterprise-governance',
      '/dev/qa-gaps',
      '/dev/rpa-test',
      '/rpa-replays',
      '/dev/rpa-seeds',
    ]);
  });

  it('não deixa ferramentas de QA/RPA soltas no nível direto de Super Admin', () => {
    const soltas = flattenNavigationLeaves(superAdmin.children.filter((n) => n.id !== 'dev-qa-rpa'))
      .map((l) => l.path)
      .filter((p) => p.startsWith('/dev/qa') || p.startsWith('/dev/rpa'));
    expect(soltas).toEqual([]);
  });

  it('mantém as páginas de negócio de QA na seção Qualidade (fora de /dev)', () => {
    expect(flattenNavigationLeaves([qualidade]).map((l) => l.path)).toEqual(['/qa', '/qa/stability', '/qa-mesh']);
  });
});

describe('itens de menu: inbox, chamados e replays', () => {
  const leaves = flattenNavigationLeaves(navigationMenu);

  it('Caixa de Entrada usa o recurso inbox (não tickets)', () => {
    const inbox = leaves.find((l) => l.id === 'inbox');
    expect(inbox).toBeTruthy();
    expect(inbox.path).toBe('/inbox');
    expect(inbox.permission).toEqual({ resource: 'inbox', action: 'read' });
  });

  it('Chamados (/cases) existe e é gated pela capability caseManagement', () => {
    const cases = leaves.find((l) => l.id === 'cases');
    expect(cases).toBeTruthy();
    expect(cases.path).toBe('/cases');
    expect(cases.label).toBe('Chamados');
    expect(cases.permission).toEqual({ resource: 'tickets', action: 'read' });
    expect(cases.capability).toBe('caseManagement');
  });

  it('Central de Atendimento legada (/support) é gated pela capability caseManagement', () => {
    const support = leaves.find((l) => l.id === 'support');
    expect(support).toBeTruthy();
    expect(support.path).toBe('/support');
    expect(support.label).toBe('Central de Atendimento');
    expect(support.permission).toEqual({ resource: 'tickets', action: 'read' });
    expect(support.capability).toBe('caseManagement');
  });

  it('/rpa-replays usa classifications SUPPORT/DEVELOPMENT (sem gate por roles)', () => {
    const replays = leaves.find((l) => l.id === 'rpa-replays');
    expect(replays).toBeTruthy();
    expect(replays.roles).toBeUndefined();
    expect(replays.classifications).toEqual(['SUPPORT', 'DEVELOPMENT']);
  });

  it('/platform-support existe com classifications SUPPORT/DEVELOPMENT', () => {
    const platformSupport = leaves.find((l) => l.id === 'platform-support');
    expect(platformSupport).toBeTruthy();
    expect(platformSupport.path).toBe('/platform-support');
    expect(platformSupport.classifications).toEqual(['SUPPORT', 'DEVELOPMENT']);
  });
});