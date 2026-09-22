'use strict';

/**
 * ER-V1-FINAL-006 — RegressionPlan (unidade, módulo puro).
 *
 * Prova a política determinística de escopo proporcional ao risco, isolada de I/O real:
 * LOW = só targeted; MEDIUM = +related (nome de arquivo tocado); HIGH = +subsystem
 * (diretório pai comum); CRITICAL = +gate de governança canônico.
 */

const {
  buildRegressionPlan,
  findRelatedTestFiles,
  findSubsystemTestFiles,
  basenameNoExt,
  subsystemOf,
  GOVERNANCE_GATE_COMMAND,
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

  test('CRITICAL: plano inclui tudo do HIGH + o gate de governança canônico', () => {
    const plan = buildRegressionPlan({
      touchedPaths: ['api/services/engineeringRouter/promotionService.js'],
      targetedCommands: ['npm test'],
      risk: 'CRITICAL',
      availableTestFiles: AVAILABLE,
    });
    expect(plan.tier).toBe('CRITICAL');
    expect(plan.commands).toContain(GOVERNANCE_GATE_COMMAND);
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
