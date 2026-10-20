'use strict';

/**
 * Regra de produção: patch de missão não apaga casos de teste.
 *
 * Regressão da MUTILAÇÃO RECORRENTE de worktree (2026-10-20): 35 blocos
 * `it/describe` removidos para deixar a suíte verde. A barreira antiga cobria
 * só caminhos de integridade (scripts/governance, jest.config, .github), não o
 * conteúdo do arquivo de teste.
 */

const { validatePatch } = require('../../engine/engineeringRouter/patchValidator');
const { findRemovedTestCases } = require('../../engine/engineeringRouter/testRemovalPolicy');

const TEST_FILE = 'tests/unit/exemplo.test.js';

const DIFF_REMOVING_TESTS = `diff --git a/${TEST_FILE} b/${TEST_FILE}
index 1111111..2222222 100644
--- a/${TEST_FILE}
+++ b/${TEST_FILE}
@@ -1,4 +1,2 @@
-it('caso a', () => {});
-it('caso b', () => {});
 it('caso c', () => {});
`;

const DIFF_ADDING_TESTS = `diff --git a/${TEST_FILE} b/${TEST_FILE}
index 1111111..2222222 100644
--- a/${TEST_FILE}
+++ b/${TEST_FILE}
@@ -1,2 +1,4 @@
 it('caso a', () => {});
+it('caso b', () => {});
+it('caso c', () => {});
`;

describe('engineeringRouter/testRemovalPolicy', () => {
  test('detecta remoção de casos por arquivo', () => {
    const removals = findRemovedTestCases(DIFF_REMOVING_TESTS);
    expect(removals).toHaveLength(1);
    expect(removals[0]).toEqual({ path: TEST_FILE, removedTests: 2, addedTests: 0 });
  });

  test('adicionar testes não é violação', () => {
    expect(findRemovedTestCases(DIFF_ADDING_TESTS)).toEqual([]);
  });

  test('diff vazio não produz violação', () => {
    expect(findRemovedTestCases('')).toEqual([]);
  });
});

describe('patchValidator — não remoção de testes', () => {
  test('recusa patch que apaga casos de teste (fail-closed)', () => {
    const result = validatePatch(DIFF_REMOVING_TESTS, { contract: { allowedPaths: ['tests/**'] } });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PATCH_REMOVES_TESTS');
    const issue = result.issues.find((i) => i.code === 'PATCH_REMOVES_TESTS');
    expect(issue.testRemovals[0].removedTests).toBe(2);
  });

  test('aceita patch que adiciona testes', () => {
    const result = validatePatch(DIFF_ADDING_TESTS, { contract: { allowedPaths: ['tests/**'] } });
    expect(result.ok).toBe(true);
  });

  test('autorização explícita de contrato permite remoção (auditável)', () => {
    const result = validatePatch(DIFF_REMOVING_TESTS, {
      contract: { allowedPaths: ['tests/**'], allowTestRemovalAuthorization: true },
    });
    expect(result.ok).toBe(true);
  });
});
