'use strict';

/**
 * Classificação de comandos de teste por CATEGORIA.
 *
 * Defeito medido (auditoria 2026-10-10): em `missionReviewService.deriveGates`, os
 * gates `unit` e `integration` eram alimentados pela MESMA condição
 * (`testsAllPass`). Um único `engineering_test_runs` verde marcava as duas
 * categorias como PASS — a missão afirmava cobertura de integração com base em
 * evidência genérica, e ninguém conseguia ver isso no parecer.
 *
 * O classificador NÃO decide o que é obrigatório (isso é política de execução:
 * exigir integração sem garantir que a missão RODE integração transforma correção
 * legítima em BLOCKED). Ele torna a cobertura VISÍVEL — o gate `integration`
 * declara `hasDistinctIntegrationEvidence: false` quando combinou com `unit`.
 */

const {
  CATEGORIES,
  classifyTestCommand,
  summarizeTestCoverage,
} = require('../../../engine/engineeringMission/testSuiteClassifier');

describe('testSuiteClassifier — categoria do comando', () => {
  test('unit: suítes isoladas do projeto', () => {
    for (const command of [
      'npx jest tests/unit',
      'npm run test:unit',
      'node --test engine/__tests__/runner.test.js',
      'npx jest --testPathPattern=tests/unit',
    ]) {
      expect([command, classifyTestCommand(command)]).toEqual([command, CATEGORIES.UNIT]);
    }
  });

  test('integration: fluxo, integração de API e suíte de sistema', () => {
    for (const command of [
      'npx jest tests/integration',
      'npm run test:flow',
      'npm run test:system',
      'npx jest tests/integration/engineeringMissionFullE2E.test.js',
    ]) {
      expect([command, classifyTestCommand(command)]).toEqual([command, CATEGORIES.INTEGRATION]);
    }
  });

  test('e2e: Playwright/browser é distinto de integração de API', () => {
    for (const command of ['npm run frontend:test:e2e', 'npx playwright test', 'npm run test:e2e']) {
      expect([command, classifyTestCommand(command)]).toEqual([command, CATEGORIES.E2E]);
    }
  });

  test('comando genérico é UNKNOWN — não se presume categoria', () => {
    for (const command of ['npx jest DR-ENGINEERING_MEMORY_REUSE --no-coverage', 'node scripts/verify.js', '']) {
      expect([command, classifyTestCommand(command)]).toEqual([command, CATEGORIES.UNKNOWN]);
    }
    expect(classifyTestCommand(null)).toBe(CATEGORIES.UNKNOWN);
  });

  test('um comando de integração NÃO é rebaixado a unit por citar arquivo .test.js', () => {
    // A ordem das regras importa: integração vence quando o caminho é de integração.
    expect(classifyTestCommand('npx jest tests/integration/x.test.js')).toBe(CATEGORIES.INTEGRATION);
  });
});

describe('testSuiteClassifier — cobertura agregada', () => {
  test('separa o que rodou por categoria e só conta PASS', () => {
    const coverage = summarizeTestCoverage([
      { command: 'npx jest tests/unit', status: 'PASS', exit_code: 0 },
      { command: 'npx jest tests/unit', status: 'FAIL', exit_code: 1 },
      { command: 'npx jest tests/flow', status: 'PASS', exit_code: 0 },
      { command: 'npx jest ALGO', status: 'PASS', exit_code: 0 },
    ]);

    expect(coverage.byCategory[CATEGORIES.UNIT]).toMatchObject({ passed: 1, failed: 1 });
    expect(coverage.byCategory[CATEGORIES.INTEGRATION]).toMatchObject({ passed: 1, failed: 0 });
    expect(coverage.categories).toEqual(
      expect.arrayContaining([CATEGORIES.UNIT, CATEGORIES.INTEGRATION, CATEGORIES.UNKNOWN]),
    );
    expect(coverage.unknownCommands).toEqual(['npx jest ALGO']);
    expect(coverage.hasIntegrationEvidence).toBe(true);
  });

  test('evidência genérica NÃO conta como integração (é o defeito que isto expõe)', () => {
    const coverage = summarizeTestCoverage([
      { command: 'npx jest DR-ENGINEERING_MEMORY_REUSE --no-coverage', status: 'PASS', exit_code: 0 },
    ]);
    expect(coverage.hasIntegrationEvidence).toBe(false);
    expect(coverage.byCategory[CATEGORIES.INTEGRATION].commands).toEqual([]);
  });

  test('exit code não-zero reprova mesmo com status PASS inconsistente', () => {
    const coverage = summarizeTestCoverage([
      { command: 'npm run test:flow', status: 'PASS', exit_code: 3 },
    ]);
    expect(coverage.byCategory[CATEGORIES.INTEGRATION]).toMatchObject({ passed: 0, failed: 1 });
  });

  test('lista vazia/inválida não lança (fail-safe)', () => {
    const coverage = summarizeTestCoverage(null);
    expect(coverage.categories).toEqual([]);
    expect(coverage.hasIntegrationEvidence).toBe(false);
  });
});

describe('missionReviewService — gates declaram a categoria da evidência', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(
    path.join(__dirname, '../../../api/services/engineeringMission/missionReviewService.js'),
    'utf8',
  );

  test('o bundle de revisão expõe a cobertura executada', () => {
    expect(source).toMatch(/testCoverage:\s*summarizeTestCoverage\(testRuns\)/);
  });

  test('o gate de integração não finge cobertura distinta quando ela não existe', () => {
    expect(source).toMatch(/hasDistinctIntegrationEvidence/);
    expect(source).toMatch(/sem evidência de integração distinta/);
  });
});
