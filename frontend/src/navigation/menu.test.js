import { describe, expect, it } from 'vitest';
import { findNavigationTrail, navigationMenu, flattenNavigationLeaves, getWorkspaceKeysForPath, inferWorkspaceKeyFromTenantContext, inferWorkspaceKeyFromTenantProfile } from './menu';

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
      '/dev/benchmark-research',
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

describe('área Dev (rail DEV)', () => {
  const plataforma = navigationMenu.find((n) => n.id === 'plataforma');

  it('mantém a superfície de engenharia FORA do grupo Super Admin', () => {
    const superAdmin = plataforma.children.find((n) => n.id === 'super-admin');
    expect(superAdmin.children.some((n) => n.id === 'dev-engineering')).toBe(false);
    expect(superAdmin.children.some((n) => n.id === 'dev')).toBe(false);
    expect(flattenNavigationLeaves([superAdmin]).map((l) => l.path)).not.toContain('/dev/engineering');
  });

  it('declara Central Dev e Engineering como nós da área Dev', () => {
    const devHub = plataforma.children.find((n) => n.id === 'dev-hub');
    const engineering = plataforma.children.find((n) => n.id === 'dev-engineering');
    expect(devHub).toBeTruthy();
    expect(engineering).toBeTruthy();
    expect(flattenNavigationLeaves([devHub]).map((l) => l.path)).toEqual(['/dev']);
    expect(flattenNavigationLeaves([engineering]).map((l) => l.path)).toEqual([
      '/dev/engineering',
      '/dev/engineering/tasks',
      '/dev/engineering/missions',
      '/dev/engineering/findings',
      '/dev/engineering/models',
      '/dev/engineering/release-closure',
      // Versões e Segurança: mesma área de engenharia (DEVELOPMENT), rota sob
      // /dev/security-intel para não colidir com o hub /dev/engineering.
      '/dev/security-intel',
    ]);
  });

  it('mantém a página de Versões e Segurança como DEVELOPMENT-only', () => {
    const engineering = plataforma.children.find((n) => n.id === 'dev-engineering');
    const seguranca = flattenNavigationLeaves([engineering])
      .find((l) => l.path === '/dev/security-intel');
    expect(seguranca).toBeTruthy();
    // A ocultação de menu não é o controle de acesso: a classificação declarada
    // precisa continuar DEVELOPMENT para casar com o guard da API.
    expect(seguranca.classifications).toEqual(['DEVELOPMENT']);
  });
});

describe('trilha de navegação (breadcrumb/H1)', () => {
  it('escolhe o item MAIS ESPECÍFICO, não o primeiro match por prefixo', () => {
    const trail = findNavigationTrail(navigationMenu, '/dev/engineering');
    expect(trail.map((node) => node.id)).toEqual([
      'plataforma',
      'dev-engineering',
      'dev-engineering-overview',
    ]);
  });

  it('resolve o detalhe de task para a lista de Tasks', () => {
    const trail = findNavigationTrail(navigationMenu, '/dev/engineering/tasks/abc-123');
    expect(trail[trail.length - 1].id).toBe('dev-engineering-tasks');
  });

  it('continua resolvendo /dev para Central Dev (não para Engineering)', () => {
    const trail = findNavigationTrail(navigationMenu, '/dev');
    expect(trail[trail.length - 1].id).toBe('dev');
  });

  it('não regride páginas fora de /dev (ex.: /qa/stability)', () => {
    const trail = findNavigationTrail(navigationMenu, '/qa/stability');
    expect(trail[trail.length - 1].id).toBe('qa-stability');
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

  it('/dev/benchmark-research é restrito à classificação DEVELOPMENT', () => {
    const benchmarkResearch = leaves.find((l) => l.id === 'dev-benchmark-research');
    expect(benchmarkResearch).toBeTruthy();
    expect(benchmarkResearch.path).toBe('/dev/benchmark-research');
    expect(benchmarkResearch.label).toBe('Pesquisa de Benchmark');
    expect(benchmarkResearch.roles).toBeUndefined();
    expect(benchmarkResearch.classifications).toEqual(['DEVELOPMENT']);
  });
});