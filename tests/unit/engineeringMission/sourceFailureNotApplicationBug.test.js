'use strict';

/**
 * tests/unit/engineeringMission/sourceFailureNotApplicationBug.test.js
 *
 * "STALE CANDIDATE NÃO É BUG DE APLICAÇÃO" — prova nas duas camadas: na decisão pura da camada de
 * fonte E na classificação que decide se uma fix task de aplicação é aberta.
 *
 * DEFEITO ELIMINADO (2026-10-03): qualquer não-GREEN abria finding com `source:'EXCEPTION'`;
 * `inferCategory` mapeia EXCEPTION → BUG e `requiresApplicationFix('BUG')` é verdadeiro. Então um
 * candidate STALE — "a fonte da missão avançou enquanto a task codava" — virava uma fix task de
 * APLICAÇÃO e queimava um ciclo autônomo inteiro de coder+review+regressão perseguindo um defeito
 * que não existe no produto. `classifyStaleCandidateDisposition` já descrevia o caso e nunca estava
 * ligada ao hook.
 */

const missionSource = require('../../../engine/engineeringMission/missionSource');
const classification = require('../../../engine/engineeringMission/bugFinding/classification');
const { FINDING_CATEGORIES } = require('../../../engine/engineeringMission/bugFinding/constants');

describe('classifySourceFailure (decisão pura da camada de fonte)', () => {
  test('SRC_FAIL_01 candidate STALE é SOURCE_STALE com replan e SEM bug de aplicação', () => {
    const verdict = missionSource.classifySourceFailure({ reasonCode: 'STALE_CANDIDATE' });

    expect(verdict.isSourceFailure).toBe(true);
    expect(verdict.disposition).toBe('SOURCE_STALE');
    expect(verdict.requiresReplan).toBe(true);
    expect(verdict.createsApplicationBug).toBe(false);
    expect(verdict.category).toBe('MISSION_SOURCE');
    expect(verdict.strategy).toBe('REANCHOR_AND_REAPPLY');
  });

  test('SRC_FAIL_02 divergência de fonte exige REPLAN', () => {
    const verdict = missionSource.classifySourceFailure({ reasonCode: 'MISSION_SOURCE_DIVERGENCE' });

    expect(verdict.isSourceFailure).toBe(true);
    expect(verdict.disposition).toBe('REPLAN_REQUIRED');
    expect(verdict.requiresReplan).toBe(true);
    expect(verdict.createsApplicationBug).toBe(false);
    expect(verdict.category).toBe('MISSION_SOURCE');
  });

  test('SRC_FAIL_03 replan explícito e conflito na fonte também são falha de fonte', () => {
    for (const code of ['MISSION_SOURCE_REPLAN_REQUIRED', 'MISSION_SOURCE_IN_CONFLICT']) {
      const verdict = missionSource.classifySourceFailure({ reasonCode: code });
      expect(verdict.isSourceFailure).toBe(true);
      expect(verdict.requiresReplan).toBe(true);
      expect(verdict.createsApplicationBug).toBe(false);
    }
  });

  test('SRC_FAIL_04 falha REAL de aplicação continua seguindo o caminho normal', () => {
    // Controle negativo: se isto virasse "falha de fonte", bugs de verdade seriam silenciados.
    for (const code of ['EXCEPTION', 'STACK_TRACE', 'RELEASE_GATE']) {
      const verdict = missionSource.classifySourceFailure({ reasonCode: code });
      expect(verdict.isSourceFailure).toBe(false);
      expect(verdict.requiresReplan).toBe(false);
      expect(verdict.createsApplicationBug).toBe(true);
      expect(verdict.category).toBeNull();
    }
  });

  test('SRC_FAIL_05 PRECONDITION_FAILED fica FORA (não silencia trabalho real)', () => {
    // É um wrapper que também carrega condições de QUALIDADE (sem test run, sem review, sem
    // regressão). Tratá-lo como "não é problema de código" esconderia trabalho que precisa
    // acontecer de verdade.
    for (const code of ['PRECONDITION_FAILED', 'NO_TEST_RUN', 'NO_REVIEW', 'NO_REGRESSION']) {
      const verdict = missionSource.classifySourceFailure({ reasonCode: code });
      expect(verdict.isSourceFailure).toBe(false);
      expect(verdict.createsApplicationBug).toBe(true);
    }
  });

  test('SRC_FAIL_06 códigos de fonte que NÃO são falha não pedem replan', () => {
    for (const code of ['MISSION_SOURCE_UNCHANGED', 'ALREADY_INTEGRATED']) {
      const verdict = missionSource.classifySourceFailure({ reasonCode: code });
      expect(verdict.isSourceFailure).toBe(false);
      expect(verdict.requiresReplan).toBe(false);
    }
  });

  test('SRC_FAIL_07 sem código de falha não se afirma que a origem é a fonte', () => {
    const verdict = missionSource.classifySourceFailure({});
    expect(verdict.isSourceFailure).toBe(false);
    expect(verdict.createsApplicationBug).toBe(true);
    expect(verdict.reason).toMatch(/sem código/i);
  });

  test('SRC_FAIL_08 com commits, a decisão é DELEGADA à função pura existente', () => {
    const verdict = missionSource.classifySourceFailure({
      reasonCode: 'STALE_CANDIDATE',
      candidateBaseCommit: 'aaa111',
      missionCurrentCommit: 'bbb222',
      reapplyConflicts: true,
    });

    // Aqui a reaplicação conflitou: exige task EXPLÍCITA de replan, nunca resolução silenciosa.
    expect(verdict.disposition).toBe('REPLAN_REQUIRED');
    expect(verdict.code).toBe('MISSION_SOURCE_REPLAN_REQUIRED');
    expect(verdict.createsApplicationBug).toBe(false);
  });

  test('SRC_FAIL_09 sem staleness o candidato é integrável (controle da delegação)', () => {
    const verdict = missionSource.classifySourceFailure({
      reasonCode: 'MISSION_SOURCE_NEW_COMMIT_REQUIRED',
      candidateBaseCommit: 'same111',
      missionCurrentCommit: 'same111',
    });

    // Não é stale: a função pura devolve APPLICABLE e o veredito cai no caminho de fonte genérico
    // (replan), sem jamais declarar bug de aplicação.
    expect(verdict.createsApplicationBug).toBe(false);
    expect(verdict.requiresReplan).toBe(true);
  });
});

describe('classificação: MISSION_SOURCE não abre fix task de aplicação', () => {
  test('SRC_FAIL_10 a categoria MISSION_SOURCE é canônica (não é categoria inventada)', () => {
    expect(FINDING_CATEGORIES).toContain('MISSION_SOURCE');
  });

  test('SRC_FAIL_11 PROVA PRINCIPAL: requiresApplicationFix(MISSION_SOURCE) é FALSO', () => {
    // Sem isto, o laço autônomo abriria task de coder+review+regressão para um problema de fonte.
    expect(classification.requiresApplicationFix('MISSION_SOURCE')).toBe(false);
    expect(classification.NON_APPLICATION_CATEGORIES).toContain('MISSION_SOURCE');
  });

  test('SRC_FAIL_12 a origem da falha de fonte determina a categoria', () => {
    expect(classification.inferCategory({ source: 'MISSION_SOURCE' })).toBe('MISSION_SOURCE');
  });

  test('SRC_FAIL_13 REGRESSÃO DO DEFEITO: sem o guard, EXCEPTION viraria BUG de aplicação', () => {
    // Documenta por que o guard é necessário: é exatamente este par que produzia o ciclo perdido.
    expect(classification.inferCategory({ source: 'EXCEPTION' })).toBe('BUG');
    expect(classification.requiresApplicationFix('BUG')).toBe(true);
  });

  test('SRC_FAIL_14 severidade de falha de fonte não exige revisor de segurança', () => {
    const assessment = classification.assessSeverity({ source: 'MISSION_SOURCE' });

    expect(assessment.category).toBe('MISSION_SOURCE');
    expect(assessment.severity).toBe('MEDIUM');
    expect(classification.requiresSecurityReview(assessment.category, assessment.severity)).toBe(false);
  });

  test('SRC_FAIL_15 texto NÃO sobrepõe a origem (a origem é um fato)', () => {
    // Mesmo com texto que sugere código, o rótulo de fonte manda — e o caminho de aplicação
    // permanece fechado.
    const category = classification.inferCategory({
      source: 'MISSION_SOURCE',
      title: 'falha de código no módulo X',
      description: 'a função Y lançou exceção',
    });

    expect(category).toBe('MISSION_SOURCE');
    expect(classification.requiresApplicationFix(category)).toBe(false);
  });
});
