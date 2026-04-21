import { describe, expect, it } from 'vitest';
import { getWorkspaceKeysForPath, inferWorkspaceKeyFromTenantContext, inferWorkspaceKeyFromTenantProfile } from './menu';

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