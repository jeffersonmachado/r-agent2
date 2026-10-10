'use strict';

/**
 * tests/unit/engineeringMission/bugFindingRootCauseDerivation.test.js
 *
 * PROVA que a causa raiz do problema conhecido — exigida pela Engineering Memory
 * (`KNOWN_PROBLEM_REQUIRED_FIELDS`) e PRÉ-CONDIÇÃO do fechamento de um finding de SELF_MODIFICATION
 * (`closeFinding` via `assertPreventionBeforeClose`) — é ASSERTADA a partir de evidência real desta
 * ocorrência quando ninguém a declarou.
 *
 * DEFEITO QUE ISTO ELIMINA (medido em 2026-10-10 no `governanceApprovalFullWorkerE2E`): o finding era
 * reproduzido, a correção executada de verdade, a task chegava a GREEN com promoção confirmada e a
 * regressão era validada — e o fechamento era recusado com
 * `KNOWN_PROBLEM_INCOMPLETE (faltando: rootCause)`. NENHUM produtor de finding escrevia
 * `root_cause`; o ciclo autônomo travava no último passo e o finding ficava órfão em
 * REGRESSION_VALIDATED. O teste de integração do laço não pegava isso porque a fixture declarava um
 * `rootCause` à mão: a capacidade existia no teste e não existia em produção.
 *
 * Também prova o LIMITE: sem declaração e sem evidência real, a derivação devolve `null` e o
 * registro continua INCOMPLETO — fail-closed preservado, ausência de dado nunca vira dado.
 */

const {
  deriveRootCauseStatement,
} = require('../../../engine/engineeringMission/bugFinding/routing');

const {
  buildKnownProblem,
  canActivate,
  KNOWN_PROBLEM_REQUIRED_FIELDS,
  PREVENTIVE_RULE_FAILURE_CODES,
} = require('../../../engine/engineeringMission/bugFinding/preventiveRules');

/** Finding REAL como o `hookMissionFailure` o registra — sem `root_cause` (o defeito medido). */
const FINDING_FROM_HOOK = Object.freeze({
  id: '6fee6146-f6fd-47cb-942b-79b1134f5de6',
  fingerprint: 'fp-abc123',
  source: 'EXCEPTION',
  category: 'BUG',
  classification: 'BUG',
  status: 'REGRESSION_VALIDATED',
  fix_task_id: 'a8482e37-583c-4ad1-a4c6-df0e2290424f',
  title: 'Missão c0b8ead9: task a8482e37 terminou em RED',
  expected_behavior: 'a task da missão conclui em GREEN pelos seus próprios gates',
  observed_behavior: 'status=RED reasonCode=PATCH_INVALID_FORMAT',
  reproduction: { command: 'npx jest tests/fixtures/mathUtils.test.js --no-coverage', expect: 'FAIL' },
  evidence_refs: [{ type: 'ARTIFACT', ref: 'engineering_task:a8482e37' }],
  affected_files: ['tests/fixtures/engineering-router-sandbox/mathUtils.js'],
  first_seen_at: '2026-10-10T02:54:05.516Z',
  resolved_at: '2026-10-10T02:54:58.000Z',
  root_cause: null,
});

describe('causa raiz do problema conhecido — declarada ou derivada da ocorrência', () => {
  test('causa raiz DECLARADA vence e nunca é reescrita', () => {
    const declared = 'o validador aceitava hunk sem prefixo de corpo e o apply falhava depois';
    expect(deriveRootCauseStatement({ ...FINDING_FROM_HOOK, root_cause: declared })).toBe(declared);
    // Aceita também a grafia do contrato (camelCase) — a fronteira persistência→contrato aceita as duas.
    expect(deriveRootCauseStatement({ ...FINDING_FROM_HOOK, rootCause: '  declarada  ' })).toBe('declarada');
  });

  test('sem declaração, deriva da evidência medida desta ocorrência e MARCA que é derivada', () => {
    const derived = deriveRootCauseStatement(FINDING_FROM_HOOK);

    expect(typeof derived).toBe('string');
    expect(derived.trim()).not.toBe('');
    // Rastreável: quem lê sabe que não houve diagnóstico humano.
    expect(derived).toContain('derivada da evidência medida desta ocorrência');
    expect(derived).toContain('fonte EXCEPTION');
    expect(derived).toContain('categoria BUG');
    // Os dois dados REAIS da ocorrência que sustentam a afirmação.
    expect(derived).toContain('status=RED reasonCode=PATCH_INVALID_FORMAT');
    expect(derived).toContain('npx jest tests/fixtures/mathUtils.test.js --no-coverage');
  });

  test('só a reprodução executada (sem comportamento observado) já sustenta a derivação', () => {
    const derived = deriveRootCauseStatement({
      ...FINDING_FROM_HOOK,
      observed_behavior: null,
    });
    expect(derived).toContain('reprodução executada');
    expect(derived).toContain('expect=FAIL');
  });

  test('FAIL-CLOSED: sem declaração e sem NENHUMA evidência real devolve null (não inventa)', () => {
    expect(deriveRootCauseStatement({
      id: 'x', source: 'EXCEPTION', category: 'BUG', observed_behavior: '   ', reproduction: {},
    })).toBeNull();
    expect(deriveRootCauseStatement({ id: 'x' })).toBeNull();
    expect(deriveRootCauseStatement(null)).toBeNull();
  });

  test('o registro derivado é COMPLETO e ativável — é isto que destrava o fechamento', () => {
    const rootCause = deriveRootCauseStatement(FINDING_FROM_HOOK);
    const record = buildKnownProblem({
      fingerprint: FINDING_FROM_HOOK.fingerprint,
      fingerprintVersion: 'bugfp-v1',
      rootCauseClass: FINDING_FROM_HOOK.category,
      rootCause,
      affectedComponents: FINDING_FROM_HOOK.affected_files,
      occurrenceEvidence: FINDING_FROM_HOOK.evidence_refs,
      fix: 'fix task a8482e37 (status=REGRESSION_VALIDATED)',
      preventiveRule: 'impedir reincidência de BUG em tests/fixtures/...: manter a correção sob teste',
      // EXECUÇÃO registrada: sem ela a ativação é recusada (endurecimento 2026-10-10).
      regressionTest: {
        command: FINDING_FROM_HOOK.reproduction.command,
        execution: { status: 'PASS', exitCode: 0, sourceFingerprint: 'fp-tree-abc' },
      },
      introducedIn: FINDING_FROM_HOOK.first_seen_at,
      fixedIn: FINDING_FROM_HOOK.resolved_at,
      verificationState: 'VERIFIED',
      provenance: { source: 'test', rootCauseSource: 'DERIVED_FROM_OCCURRENCE' },
    });

    // Nenhum dos campos exigidos pela auditoria fica sem resposta verificável.
    for (const field of KNOWN_PROBLEM_REQUIRED_FIELDS) {
      expect(record[field]).toBeTruthy();
    }

    // E a ativação — pré-condição de `assertPreventionBeforeClose` — passa.
    const check = canActivate(record, { findingStatus: 'REGRESSION_VALIDATED' });
    expect(check.allowed).toBe(true);
    expect(check.missing || []).toEqual([]);
  });

  test('CONTROLE NEGATIVO: com rootCause ausente a ativação é recusada (o defeito original)', () => {
    const record = buildKnownProblem({
      fingerprint: FINDING_FROM_HOOK.fingerprint,
      fingerprintVersion: 'bugfp-v1',
      rootCauseClass: FINDING_FROM_HOOK.category,
      rootCause: null,
      affectedComponents: FINDING_FROM_HOOK.affected_files,
      occurrenceEvidence: FINDING_FROM_HOOK.evidence_refs,
      fix: 'fix task a8428e37',
      preventiveRule: 'impedir reincidência',
      regressionTest: {
        command: FINDING_FROM_HOOK.reproduction.command,
        execution: { status: 'PASS', exitCode: 0, sourceFingerprint: 'fp-tree-abc' },
      },
      introducedIn: FINDING_FROM_HOOK.first_seen_at,
      fixedIn: FINDING_FROM_HOOK.resolved_at,
      verificationState: 'VERIFIED',
      provenance: { source: 'test' },
    });

    const check = canActivate(record, { findingStatus: 'REGRESSION_VALIDATED' });
    expect(check.allowed).toBe(false);
    expect(check.code).toBe(PREVENTIVE_RULE_FAILURE_CODES.KNOWN_PROBLEM_INCOMPLETE);
    expect(check.missing).toContain('rootCause');
  });

  test('o serviço exporta o problema conhecido com a MESMA derivação (produção, não só o motor)', () => {
    const bugFindingService = require('../../../api/services/engineeringMission/bugFindingService');
    const PASSING_RUN = {
      result: 'PASS',
      passed: true,
      exitCodes: [0],
      sourceFingerprint: 'fp-tree-abc',
      completedAt: '2026-10-10T00:00:00.000Z',
    };
    const record = bugFindingService.buildKnownProblemFromFinding(FINDING_FROM_HOOK, {
      actor: 'TEST',
      regressionRuns: [PASSING_RUN],
    });

    expect(record.rootCause).toBe(deriveRootCauseStatement(FINDING_FROM_HOOK));
    expect(record.provenance.rootCauseSource).toBe('DERIVED_FROM_OCCURRENCE');
    expect(record.regressionTest.execution).toMatchObject({
      status: 'PASS',
      exitCode: 0,
      sourceFingerprint: 'fp-tree-abc',
    });
    expect(canActivate(record, { findingStatus: 'REGRESSION_VALIDATED' }).allowed).toBe(true);

    // ENDURECIMENTO (2026-10-10): SEM execução registrada a regra NÃO ativa — citar o
    // comando de reprodução não prova que o teste preventivo foi executado.
    const semExecucao = bugFindingService.buildKnownProblemFromFinding(FINDING_FROM_HOOK, { actor: 'TEST' });
    const semExecucaoCheck = canActivate(semExecucao, { findingStatus: 'REGRESSION_VALIDATED' });
    expect(semExecucaoCheck.allowed).toBe(false);
    expect(semExecucaoCheck.code).toBe(PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_TEST_NOT_EXECUTED);

    // Declarado ⇒ proveniência DECLARED.
    const declared = bugFindingService.buildKnownProblemFromFinding(
      { ...FINDING_FROM_HOOK, root_cause: 'causa declarada por humano' },
      { actor: 'TEST' },
    );
    expect(declared.rootCause).toBe('causa declarada por humano');
    expect(declared.provenance.rootCauseSource).toBe('DECLARED');
  });
});
