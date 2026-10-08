'use strict';

/**
 * Testes do planejador de correção (puro).
 *
 * Provas centrais:
 *   - Sem versão corrigida publicada ⇒ NO_PATCH + ação humana (nunca "ir para a
 *     última").
 *   - Escolhe a MENOR corrigida acima da instalada (menor risco introduzido).
 *   - Classifica risco de atualização PATCH/MINOR/MAJOR por semver e PEP 440.
 *   - MAJOR e runtime exigem autorização (Nível C); o resto é Nível B.
 *   - Transitiva, imagem e runtime têm caminhos distintos — não um "bump" único.
 *   - Nunca planeja downgrade.
 */

const {
  PATCH_KINDS,
  UPDATE_RISK,
  AUTONOMY,
  minimumFixedVersion,
  classifyUpdateRisk,
  planPatch,
  buildPatchMissionSpec,
  consolidatePlansByPackage,
  rankPlans,
  summarizePlans,
} = require('../../../engine/securityIntel/patchPlanner');

function finding(overrides = {}) {
  return {
    findingKey: 'GHSA-x|npm:left@1.2.3#RESOLVED#api',
    advisoryId: 'GHSA-x',
    severity: 'HIGH',
    applicability: 'CONFIRMED_APPLICABLE',
    packageName: 'left',
    installedVersion: '1.2.3',
    ecosystem: 'npm',
    service: 'api',
    fixedVersions: ['1.2.9', '2.0.0'],
    kev: false,
    dev: false,
    ...overrides,
  };
}

describe('patchPlanner — versão de destino', () => {
  test('escolhe a MENOR corrigida acima da instalada', () => {
    expect(minimumFixedVersion({ currentVersion: '1.2.3', fixedVersions: ['2.0.0', '1.2.9'], ecosystem: 'npm' })).toBe('1.2.9');
  });

  test('ignora versões corrigidas anteriores ou iguais à instalada (sem downgrade)', () => {
    expect(minimumFixedVersion({ currentVersion: '1.5.0', fixedVersions: ['1.2.9'], ecosystem: 'npm' })).toBeNull();
    expect(minimumFixedVersion({ currentVersion: '1.5.0', fixedVersions: ['1.5.0'], ecosystem: 'npm' })).toBeNull();
  });

  test('sem versões corrigidas devolve null (não inventa destino)', () => {
    expect(minimumFixedVersion({ currentVersion: '1.0.0', fixedVersions: [], ecosystem: 'npm' })).toBeNull();
    expect(minimumFixedVersion({ currentVersion: null, fixedVersions: ['1.0.1'], ecosystem: 'npm' })).toBeNull();
  });

  test('versão não comparável não entra no plano', () => {
    expect(minimumFixedVersion({ currentVersion: 'latest', fixedVersions: ['1.0.1'], ecosystem: 'npm' })).toBeNull();
  });
});

describe('patchPlanner — risco da atualização', () => {
  test('npm: patch/minor/major', () => {
    expect(classifyUpdateRisk({ from: '1.2.3', to: '1.2.9', ecosystem: 'npm' })).toBe(UPDATE_RISK.PATCH);
    expect(classifyUpdateRisk({ from: '1.2.3', to: '1.5.0', ecosystem: 'npm' })).toBe(UPDATE_RISK.MINOR);
    expect(classifyUpdateRisk({ from: '1.2.3', to: '2.0.0', ecosystem: 'npm' })).toBe(UPDATE_RISK.MAJOR);
  });

  test('pypi: patch/minor/major e epoch', () => {
    expect(classifyUpdateRisk({ from: '4.57.6', to: '4.57.7', ecosystem: 'pypi' })).toBe(UPDATE_RISK.PATCH);
    expect(classifyUpdateRisk({ from: '4.57.6', to: '4.58.0', ecosystem: 'pypi' })).toBe(UPDATE_RISK.MINOR);
    expect(classifyUpdateRisk({ from: '4.57.6', to: '5.0.0', ecosystem: 'pypi' })).toBe(UPDATE_RISK.MAJOR);
    expect(classifyUpdateRisk({ from: '1!1.0', to: '2.0', ecosystem: 'pypi' })).toBe(UPDATE_RISK.MAJOR);
  });

  test('versão não comparável ⇒ UNKNOWN (não afirma risco baixo)', () => {
    expect(classifyUpdateRisk({ from: 'latest', to: '1.0.0', ecosystem: 'npm' })).toBe(UPDATE_RISK.UNKNOWN);
    expect(classifyUpdateRisk({ from: '1.0.0', to: null, ecosystem: 'npm' })).toBe(UPDATE_RISK.UNKNOWN);
  });
});

describe('patchPlanner — plano', () => {
  test('dependência direta com correção ⇒ DIRECT_BUMP, Nível B', () => {
    const plan = planPatch({ finding: finding(), component: { direct: true, ecosystem: 'npm', service: 'api' } });
    expect(plan.kind).toBe(PATCH_KINDS.DIRECT_BUMP);
    expect(plan.targetVersion).toBe('1.2.9');
    expect(plan.updateRisk).toBe(UPDATE_RISK.PATCH);
    expect(plan.autonomy).toBe(AUTONOMY.LEVEL_B);
    expect(plan.requiresHumanApproval).toBe(false);
  });

  test('dependência transitiva ⇒ TRANSITIVE_OVERRIDE (não bump cego)', () => {
    const plan = planPatch({ finding: finding(), component: { direct: false, ecosystem: 'npm', service: 'api' } });
    expect(plan.kind).toBe(PATCH_KINDS.TRANSITIVE_OVERRIDE);
    expect(plan.rationale.join(' ')).toMatch(/ancestral direto/);
  });

  test('sem correção publicada ⇒ NO_PATCH, exige humano e propõe waiver formal', () => {
    const plan = planPatch({ finding: finding({ fixedVersions: [] }), component: { direct: true } });
    expect(plan.kind).toBe(PATCH_KINDS.NO_PATCH);
    expect(plan.autonomy).toBe(AUTONOMY.LEVEL_C);
    expect(plan.requiresHumanApproval).toBe(true);
    expect(plan.preconditions.join(' ')).toMatch(/controle compensatório|waiver/);
  });

  test('achado não aplicável não gera plano de correção', () => {
    const plan = planPatch({ finding: finding({ applicability: 'NOT_AFFECTED' }), component: {} });
    expect(plan.kind).toBe(PATCH_KINDS.NOT_APPLICABLE);
    expect(plan.targetVersion).toBeNull();
  });

  test('MAJOR exige autorização explícita (Nível C)', () => {
    const plan = planPatch({
      finding: finding({ fixedVersions: ['2.0.0'] }),
      component: { direct: true, ecosystem: 'npm', service: 'api' },
    });
    expect(plan.updateRisk).toBe(UPDATE_RISK.MAJOR);
    expect(plan.autonomy).toBe(AUTONOMY.LEVEL_C);
    expect(plan.requiresHumanApproval).toBe(true);
    expect(plan.rationale.join(' ')).toMatch(/MAJOR/);
  });

  test('imagem com tag comparável ⇒ IMAGE_REBUILD apontando a tag corrigida', () => {
    const plan = planPatch({
      finding: finding({ packageName: 'pgvector/pgvector', installedVersion: 'pg16', ecosystem: 'docker', fixedVersions: ['pg17'] }),
      component: { ecosystem: 'docker', service: 'postgres', builtLocally: false },
    });
    expect(plan.kind).toBe(PATCH_KINDS.IMAGE_REBUILD);
    expect(plan.targetVersion).toBe('pg17');
  });

  test('imagem construída localmente SEM versão comparável ⇒ ainda é IMAGE_REBUILD (não "sem patch")', () => {
    const plan = planPatch({
      finding: finding({ packageName: 'r-agent2-api', installedVersion: 'latest', ecosystem: 'docker', fixedVersions: [] }),
      component: { builtLocally: true, ecosystem: 'docker', service: 'api' },
    });
    expect(plan.kind).toBe(PATCH_KINDS.IMAGE_REBUILD);
    expect(plan.targetVersion).toBeNull();
    expect(plan.requiresHumanApproval).toBe(true);
    expect(plan.preconditions.join(' ')).toMatch(/reconstruir a imagem/);
  });

  test('componente de runtime ⇒ Nível C e pré-condição de latência', () => {
    const plan = planPatch({
      finding: finding({ packageName: 'node', ecosystem: 'generic', installedVersion: '20.0.0', fixedVersions: ['22.12.0'] }),
      component: { ecosystem: 'generic', service: 'api-host', versionClass: 'RUNNING' },
    });
    expect(plan.kind).toBe(PATCH_KINDS.RUNTIME_UPGRADE);
    expect(plan.autonomy).toBe(AUTONOMY.LEVEL_C);
    expect(plan.preconditions.join(' ')).toMatch(/latência/);
  });

  test('serviço de RAG ganha pré-condições de ranking híbrido e índice', () => {
    const plan = planPatch({
      finding: finding({ packageName: 'transformers', ecosystem: 'pypi', installedVersion: '4.57.6', fixedVersions: ['4.57.7'] }),
      component: { direct: true, ecosystem: 'pypi', service: 'rag-service', versionClass: 'RESOLVED' },
    });
    expect(plan.preconditions.join(' ')).toMatch(/ranking híbrido/);
    expect(plan.preconditions.join(' ')).toMatch(/security:vector-index/);
  });

  test('KEV marca prioridade máxima no plano', () => {
    const plan = planPatch({ finding: finding({ kev: true }), component: { direct: true, ecosystem: 'npm', service: 'api' } });
    expect(plan.kev).toBe(true);
    expect(plan.blockedWhen).toMatch(/exploração conhecida/);
  });

  test('dev-only é sinalizado sem esconder o plano', () => {
    const plan = planPatch({ finding: finding({ dev: true }), component: { direct: true, dev: true, ecosystem: 'npm', service: 'frontend' } });
    expect(plan.devOnly).toBe(true);
    expect(plan.kind).toBe(PATCH_KINDS.DIRECT_BUMP);
  });
});

describe('patchPlanner — payload de missão (puro)', () => {
  const plan = planPatch({ finding: finding(), component: { direct: true, ecosystem: 'npm', service: 'api' } });

  test('gera texto com contexto, restrições e pré-condições', () => {
    const spec = buildPatchMissionSpec({ plan });
    expect(spec.mission).toContain('GHSA-x');
    expect(spec.mission).toContain('1.2.3');
    expect(spec.mission).toContain('1.2.9');
    expect(spec.mission).toMatch(/NÃO reduzir cobertura/);
    expect(spec.options.acceptanceCriteria).toHaveLength(3);
    expect(spec.options.testCommands).toEqual(['npm run test:unit']);
    expect(spec.options.risk).toBe('medium');
  });

  test('MAJOR e CRITICAL elevam o risco da missão; serviço de RAG usa pytest', () => {
    const major = planPatch({
      finding: finding({ severity: 'CRITICAL', fixedVersions: ['2.0.0'] }),
      component: { direct: true, ecosystem: 'npm', service: 'api' },
    });
    expect(buildPatchMissionSpec({ plan: major }).options.risk).toBe('high');

    const rag = planPatch({
      finding: finding({ packageName: 'transformers', ecosystem: 'pypi', installedVersion: '4.57.6', fixedVersions: ['4.57.7'] }),
      component: { direct: true, ecosystem: 'pypi', service: 'rag-service' },
    });
    expect(buildPatchMissionSpec({ plan: rag }).options.testCommands).toEqual(['./venv/bin/python -m pytest tests -q']);
  });

  test('serviço sem comando de teste declarado não inventa comando', () => {
    const unknown = planPatch({ finding: finding(), component: { direct: true, ecosystem: 'npm', service: 'servico-novo' } });
    expect(buildPatchMissionSpec({ plan: unknown }).options.testCommands).toEqual([]);
  });

  test('sem plano é erro explícito', () => {
    expect(() => buildPatchMissionSpec({})).toThrow(/patch_plan_required/);
  });
});

describe('patchPlanner — consolidação por pacote', () => {
  const plans = [
    { packageName: 'transformers', ecosystem: 'pypi', service: 'rag-service', currentVersion: '4.57.6', severity: 'HIGH', kev: false, devOnly: false, kind: PATCH_KINDS.DIRECT_BUMP, advisoryId: 'A1', targetVersion: '4.57.7' },
    { packageName: 'transformers', ecosystem: 'pypi', service: 'rag-service', currentVersion: '4.57.6', severity: 'CRITICAL', kev: false, devOnly: false, kind: PATCH_KINDS.DIRECT_BUMP, advisoryId: 'A2', targetVersion: '4.60.0' },
    { packageName: 'transformers', ecosystem: 'pypi', service: 'rag-service', currentVersion: '4.57.6', severity: 'HIGH', kev: false, devOnly: false, kind: PATCH_KINDS.NO_PATCH, advisoryId: 'A3', targetVersion: null },
    { packageName: 'ws', ecosystem: 'npm', service: 'api', currentVersion: '8.20.0', severity: 'HIGH', kev: true, devOnly: false, kind: PATCH_KINDS.DIRECT_BUMP, advisoryId: 'B1', targetVersion: '8.21.0' },
  ];

  test('RECOMMENDED_VERSION é o maior dos mínimos (limpa todos os advisories)', () => {
    const group = consolidatePlansByPackage(plans).find((item) => item.packageName === 'transformers');
    expect(group.minimumFixedVersion).toBe('4.57.7');
    expect(group.recommendedVersion).toBe('4.60.0');
    expect(group.advisoriesTotal).toBe(3);
    expect(group.advisoriesWithoutFix).toBe(1);
  });

  test('advisory sem correção ⇒ NÃO é limpo por bump e exige humano', () => {
    const group = consolidatePlansByPackage(plans).find((item) => item.packageName === 'transformers');
    expect(group.fullyClearable).toBe(false);
    expect(group.autonomy).toBe(AUTONOMY.LEVEL_C);
    expect(group.requiresHumanApproval).toBe(true);
  });

  test('pacote limpo por bump fica em Nível B e vem por último na ordenação', () => {
    const consolidated = consolidatePlansByPackage(plans);
    expect(consolidated[consolidated.length - 1].packageName).toBe('ws');
    expect(consolidated.find((item) => item.packageName === 'ws')).toMatchObject({
      recommendedVersion: '8.21.0', fullyClearable: true, autonomy: AUTONOMY.LEVEL_B, kev: true,
    });
  });

  test('not applicable não entra na consolidação', () => {
    const consolidated = consolidatePlansByPackage([
      { packageName: 'x', ecosystem: 'npm', kind: PATCH_KINDS.NOT_APPLICABLE, advisoryId: 'N', targetVersion: null, currentVersion: '1.0.0' },
    ]);
    expect(consolidated).toEqual([]);
  });

  test('sem alvo em nenhum advisory ⇒ recommendedVersion null e risco NONE', () => {
    const consolidated = consolidatePlansByPackage([
      { packageName: 'y', ecosystem: 'npm', service: 'api', currentVersion: '1.0.0', kind: PATCH_KINDS.NO_PATCH, advisoryId: 'Z', targetVersion: null, severity: 'HIGH' },
    ]);
    expect(consolidated[0]).toMatchObject({ recommendedVersion: null, updateRisk: UPDATE_RISK.NONE, fullyClearable: false });
  });
});

describe('patchPlanner — ordenação e resumo', () => {
  test('KEV e severidade vêm antes; menor risco desempata', () => {
    const plans = [
      { packageName: 'c', kind: PATCH_KINDS.DIRECT_BUMP, kev: false, severity: 'MEDIUM', updateRisk: UPDATE_RISK.PATCH },
      { packageName: 'b', kind: PATCH_KINDS.DIRECT_BUMP, kev: false, severity: 'HIGH', updateRisk: UPDATE_RISK.MAJOR },
      { packageName: 'a', kind: PATCH_KINDS.DIRECT_BUMP, kev: true, severity: 'MEDIUM', updateRisk: UPDATE_RISK.PATCH },
    ];
    expect(rankPlans(plans).map((plan) => plan.packageName)).toEqual(['a', 'b', 'c']);
  });

  test('não aplicável vai para o fim', () => {
    const plans = [
      { packageName: 'na', kind: PATCH_KINDS.NOT_APPLICABLE, kev: false, severity: 'LOW', updateRisk: UPDATE_RISK.NONE },
      { packageName: 'ac', kind: PATCH_KINDS.DIRECT_BUMP, kev: false, severity: 'CRITICAL', updateRisk: UPDATE_RISK.MAJOR },
    ];
    expect(rankPlans(plans)[0].packageName).toBe('ac');
  });

  test('resumo conta kind/risco/autonomia e o que exige humano', () => {
    const plans = [
      planPatch({ finding: finding(), component: { direct: true, ecosystem: 'npm', service: 'api' } }),
      planPatch({ finding: finding({ fixedVersions: [] }), component: { direct: true } }),
      planPatch({ finding: finding({ applicability: 'NOT_AFFECTED' }), component: {} }),
    ];
    const summary = summarizePlans(plans);
    expect(summary.total).toBe(3);
    expect(summary.actionable).toBe(1);
    expect(summary.withoutPatch).toBe(1);
    expect(summary.requiringHumanApproval).toBe(1);
    expect(summary.byAutonomy[AUTONOMY.LEVEL_B]).toBe(1);
  });
});
