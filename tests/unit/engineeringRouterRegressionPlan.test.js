'use strict';

/**
 * ER-V1-FINAL-006 — RegressionPlan (unidade, módulo puro).
 *
 * Prova a política determinística de escopo proporcional ao risco, isolada de I/O real:
 * LOW = só targeted; MEDIUM = +related (nome de arquivo tocado); HIGH = +subsystem
 * (diretório pai comum); CRITICAL = superset do HIGH.
 *
 * DEPRECAÇÃO DO ROUTER V1 (2026-10-08): o CRITICAL embutia o gate de selagem global
 * (`node scripts/governance/validate-engineering-router-v1.js`). O plano roda com cwd = workspace
 * isolado da tentativa e o gate escreve `reports/` relativo ao cwd -> EACCES -> FAIL medido na
 * task 99ce6a35 com o patch aprovado nos 3 test runs do contrato. Nenhuma cobertura foi perdida:
 * o MESMO gate continua sendo executado em toda task pela fase GOVERNANCE com cwd = ROOT.
 */

const {
  buildRegressionPlan,
  findRelatedTestFiles,
  findSubsystemTestFiles,
  basenameNoExt,
  subsystemOf,
} = require('../../engine/engineeringRouter/regressionPlan');

const AVAILABLE = [
  'tests/integration/engineeringPromotionService.test.js',
  'tests/unit/engineeringRouterModelSelector.test.js',
  'tests/unit/engineeringRouterPathBoundary.test.js',
  'tests/integration/engineeringRouterFullLoopE2E.test.js',
  'tests/unit/mathUtils.test.js',
];

describe('ER-V1-FINAL-006 — regressionPlan (módulo puro)', () => {
  test('basenameNoExt extrai o nome do arquivo sem extensão/sufixo .test', () => {
    expect(basenameNoExt('api/services/engineeringRouter/promotionService.js')).toBe('promotionService');
    expect(basenameNoExt('tests/unit/engineeringRouterPathBoundary.test.js')).toBe('engineeringRouterPathBoundary');
  });

  test('subsystemOf extrai o diretório pai imediato', () => {
    expect(subsystemOf('api/services/engineeringRouter/promotionService.js')).toBe('engineeringRouter');
    expect(subsystemOf('engine/engineeringRouter/pathBoundary.js')).toBe('engineeringRouter');
    expect(subsystemOf('package.json')).toBeNull();
  });

  test('findRelatedTestFiles encontra testes cujo nome contém o basename do arquivo tocado', () => {
    const related = findRelatedTestFiles(['api/services/engineeringRouter/promotionService.js'], AVAILABLE);
    expect(related).toContain('tests/integration/engineeringPromotionService.test.js');
    expect(related).not.toContain('tests/unit/mathUtils.test.js');
  });

  test('findRelatedTestFiles sem caminhos tocados retorna vazio (nunca "tudo é relacionado")', () => {
    expect(findRelatedTestFiles([], AVAILABLE)).toEqual([]);
  });

  test('findSubsystemTestFiles encontra testes cujo caminho contém o subsistema do arquivo tocado', () => {
    // Achado real ao rodar este teste pela primeira vez: "engineeringPromotionService.test.js"
    // NÃO contém a substring "engineeringrouter" (é "engineeringPromotionService", não
    // "engineeringRouterPromotionService") — corretamente pego por findRelatedTestFiles (nome
    // do arquivo tocado), não por findSubsystemTestFiles (nome do diretório pai).
    const related = findSubsystemTestFiles(['api/services/engineeringRouter/promotionService.js'], AVAILABLE);
    expect(related).toEqual(expect.arrayContaining([
      'tests/unit/engineeringRouterModelSelector.test.js',
      'tests/unit/engineeringRouterPathBoundary.test.js',
      'tests/integration/engineeringRouterFullLoopE2E.test.js',
    ]));
    expect(related).not.toContain('tests/unit/mathUtils.test.js');
  });

  test('LOW: plano é exatamente targetedCommands, nunca mais', () => {
    const plan = buildRegressionPlan({
      touchedPaths: ['api/services/engineeringRouter/promotionService.js'],
      targetedCommands: ['npm test'],
      risk: 'LOW',
      availableTestFiles: AVAILABLE,
    });
    expect(plan.tier).toBe('LOW');
    expect(plan.commands).toEqual(['npm test']);
  });

  test('MEDIUM: plano inclui targeted + testes relacionados por nome de arquivo', () => {
    const plan = buildRegressionPlan({
      touchedPaths: ['api/services/engineeringRouter/promotionService.js'],
      targetedCommands: ['npm test'],
      risk: 'MEDIUM',
      availableTestFiles: AVAILABLE,
    });
    expect(plan.tier).toBe('MEDIUM');
    expect(plan.commands).toContain('npm test');
    expect(plan.commands).toContain('npx jest tests/integration/engineeringPromotionService.test.js');
    expect(plan.commands).not.toContain('npx jest tests/unit/mathUtils.test.js');
  });

  test('HIGH: plano inclui targeted + related + suíte inteira do subsistema afetado', () => {
    const plan = buildRegressionPlan({
      touchedPaths: ['api/services/engineeringRouter/promotionService.js'],
      targetedCommands: ['npm test'],
      risk: 'HIGH',
      availableTestFiles: AVAILABLE,
    });
    expect(plan.tier).toBe('HIGH');
    expect(plan.commands).toContain('npx jest tests/unit/engineeringRouterModelSelector.test.js');
    expect(plan.commands).toContain('npx jest tests/unit/engineeringRouterPathBoundary.test.js');
    expect(plan.commands).toContain('npx jest tests/integration/engineeringRouterFullLoopE2E.test.js');
  });

  test('CRITICAL: plano nunca embute gate de selagem global e mantém tudo do HIGH', () => {
    const params = {
      touchedPaths: ['api/services/engineeringRouter/promotionService.js'],
      targetedCommands: ['npm test'],
      availableTestFiles: AVAILABLE,
    };
    const high = buildRegressionPlan({ ...params, risk: 'HIGH' });
    const critical = buildRegressionPlan({ ...params, risk: 'CRITICAL' });

    expect(critical.tier).toBe('CRITICAL');
    // Superset do HIGH: a proporcionalidade ao risco continua valendo.
    for (const cmd of high.commands) expect(critical.commands).toContain(cmd);

    // Gate de selagem global é PROIBIDO em qualquer tier: ele certifica o repositório (cwd=ROOT,
    // executado na fase GOVERNANCE), não o delta da tentativa. Dentro do workspace isolado ele
    // reprova por EACCES ao gravar `reports/` — RED falso medido ao vivo, não mérito do patch.
    for (const tier of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
      const plan = buildRegressionPlan({ ...params, risk: tier });
      expect(plan.commands.filter((c) => c.includes('scripts/governance/'))).toEqual([]);
    }
  });

  test('nunca duplica comando (targeted que também aparece via related/subsystem entra uma única vez)', () => {
    const plan = buildRegressionPlan({
      touchedPaths: ['api/services/engineeringRouter/promotionService.js'],
      targetedCommands: ['npx jest tests/integration/engineeringPromotionService.test.js'],
      risk: 'HIGH',
      availableTestFiles: AVAILABLE,
    });
    const occurrences = plan.commands.filter((c) => c === 'npx jest tests/integration/engineeringPromotionService.test.js');
    expect(occurrences).toHaveLength(1);
  });

  test('declara a COMPOSIÇÃO do plano e sinaliza plano degenerado (achado medido: 3 vs 43 comandos)', () => {
    // Caso degenerado REAL: tier CRITICAL que executa SOMENTE os testCommands do contrato porque
    // os caminhos tocados não casam nenhum teste. Aconteceu ao vivo (3 comandos) enquanto outro
    // task, no mesmo código, executou 43 — e a evidência não distinguia os dois.
    const degenerado = buildRegressionPlan({
      touchedPaths: ['docs/sem-teste/inexistente.md'],
      targetedCommands: ['npm test'],
      risk: 'CRITICAL',
      availableTestFiles: AVAILABLE,
    });
    expect(degenerado.breakdown).toEqual({ targeted: 1, related: 0, subsystem: 0 });
    expect(degenerado.degraded).toBe(true);

    // Com caminho que casa teste, o plano é amplo e `degraded` é falso.
    const amplo = buildRegressionPlan({
      touchedPaths: ['api/services/engineeringRouter/promotionService.js'],
      targetedCommands: ['npm test'],
      risk: 'CRITICAL',
      availableTestFiles: AVAILABLE,
    });
    expect(amplo.breakdown.targeted).toBe(1);
    expect(amplo.breakdown.related).toBeGreaterThan(0);
    expect(amplo.degraded).toBe(false);

    // Tiers que NÃO prometem amplitude além do contrato nunca são "degradados" por isso.
    const low = buildRegressionPlan({
      touchedPaths: ['docs/sem-teste/inexistente.md'],
      targetedCommands: ['npm test'],
      risk: 'LOW',
      availableTestFiles: AVAILABLE,
    });
    expect(low.degraded).toBe(false);
    expect(low.breakdown).toEqual({ targeted: 1, related: 0, subsystem: 0 });
  });

  test('composição conta o comando DEDUPLICADO uma única vez (breakdown soma = commands)', () => {
    const plan = buildRegressionPlan({
      touchedPaths: ['api/services/engineeringRouter/promotionService.js'],
      targetedCommands: ['npx jest tests/integration/engineeringPromotionService.test.js'],
      risk: 'HIGH',
      availableTestFiles: AVAILABLE,
    });
    const soma = plan.breakdown.targeted + plan.breakdown.related + plan.breakdown.subsystem;
    expect(soma).toBe(plan.commands.length);
  });

  test('risk desconhecido/ausente cai em LOW (fail-closed conservador, nunca escopo maior por engano)', () => {
    const plan = buildRegressionPlan({
      touchedPaths: ['api/services/engineeringRouter/promotionService.js'],
      targetedCommands: ['npm test'],
      risk: 'NOT_A_REAL_RISK',
      availableTestFiles: AVAILABLE,
    });
    expect(plan.tier).toBe('LOW');
    expect(plan.commands).toEqual(['npm test']);
  });
});
