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
    })).toEqual(['beauty', 'fitness', 'ecommerce', 'varejo', 'servicos', 'saude', 'educacao', 'financeiro', 'cobranca']);
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
      '/dev/rpa-replays',
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