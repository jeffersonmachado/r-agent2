'use strict';

/**
 * tests/unit/engineeringMission/preventiveRules.test.js
 *
 * Regressão do GAP de Engineering Memory medido na auditoria de 2026-10-08: o registro de bug já
 * tinha causa raiz/evidências/correção/teste de regressão, mas NÃO tinha (a) regra preventiva,
 * (b) versão de introdução/correção, (c) identidade estável desacoplada do fingerprint — e a
 * memória era puramente ADITIVA, então nada obrigava a registrar o que impede a volta da falha.
 */

const {
  PREVENTIVE_RULE_STATES,
  VERIFIED_FINDING_STATUSES,
  KNOWN_PROBLEM_REQUIRED_FIELDS,
  PREVENTIVE_RULE_FAILURE_CODES,
  computeKnownProblemId,
  buildKnownProblem,
  isExecutableRegressionTest,
  validateKnownProblem,
  canActivate,
  activate,
  activeRules,
  requiresActivePrevention,
  assertPreventionBeforeClose,
} = require('../../../engine/engineeringMission/bugFinding/preventiveRules');

const COMPLETO = Object.freeze({
  fingerprint: 'fp-abc',
  fingerprintVersion: 'bugfp-v1',
  rootCauseClass: 'GOVERNANCE',
  rootCause: 'gate de release afrouxado para passar',
  affectedComponents: ['scripts/governance/validate-x.js'],
  occurrenceEvidence: [{ type: 'LOG', ref: 'logs/x.log' }],
  fix: 'restaurou a checagem removida',
  preventiveRule: 'nenhum patch de missão pode alterar scripts/governance/** sem autorização humana',
  regressionTest: { path: 'tests/unit/engineeringRouterPatchValidator.test.js' },
  introducedIn: 'commit-abc123',
  fixedIn: 'commit-def456',
  verificationState: 'PENDING',
  provenance: { source: 'bug_loop', missionId: 'm-1' },
});

describe('engineeringMemory/preventiveRules — ciclo governado de problema conhecido', () => {
  test('o registro nasce PROPOSED — nunca obrigatório por omissão', () => {
    const kp = buildKnownProblem(COMPLETO);
    expect(kp.state).toBe('PROPOSED');
    expect(activeRules([kp])).toEqual([]);
  });

  test('o identificador é ESTÁVEL e não depende da versão do algoritmo de fingerprint', () => {
    const a = computeKnownProblemId({ fingerprint: 'fp-abc', fingerprintVersion: 'bugfp-v1', rootCauseClass: 'X' });
    const b = computeKnownProblemId({ fingerprint: 'fp-abc', fingerprintVersion: 'bugfp-v1', rootCauseClass: 'X' });
    expect(a).toBe(b);
    expect(a).toMatch(/^kp-[0-9a-f]{24}$/);
    // Mudar a VERSÃO do fingerprint produz outro id — de propósito: o registro guarda a versão
    // junto, para o histórico ser RE-MAPEADO em vez de perdido em silêncio.
    expect(computeKnownProblemId({ fingerprint: 'fp-abc', fingerprintVersion: 'bugfp-v2', rootCauseClass: 'X' })).not.toBe(a);
    expect(buildKnownProblem(COMPLETO).fingerprintVersion).toBe('bugfp-v1');
  });

  test('completude: TODOS os campos obrigatórios são exigidos', () => {
    expect(KNOWN_PROBLEM_REQUIRED_FIELDS.length).toBeGreaterThanOrEqual(11);
    const vazio = buildKnownProblem({});
    const v = validateKnownProblem(vazio);
    expect(v.ok).toBe(false);
    expect(v.code).toBe(PREVENTIVE_RULE_FAILURE_CODES.KNOWN_PROBLEM_INCOMPLETE);
    // `knownProblemId`, `fingerprintVersion` e `state` são derivados/estruturais, não declarados.
    const declarados = KNOWN_PROBLEM_REQUIRED_FIELDS.filter(
      (f) => !['knownProblemId', 'verificationState'].includes(f),
    );
    for (const campo of declarados) {
      expect(v.missing).toContain(campo);
    }
  });

  test('regra preventiva SEM teste executável é recusada (prosa não é prevenção)', () => {
    const semTeste = buildKnownProblem({ ...COMPLETO, regressionTest: { note: 'verificar depois' } });
    const v = validateKnownProblem(semTeste);
    expect(v.ok).toBe(false);
    expect(v.code).toBe(PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_NOT_EXECUTABLE);

    expect(isExecutableRegressionTest({ path: 'tests/unit/a.test.js' })).toBe(true);
    expect(isExecutableRegressionTest({ command: 'npx jest a' })).toBe(true);
    expect(isExecutableRegressionTest({})).toBe(false);
    expect(isExecutableRegressionTest(null)).toBe(false);
  });

  test('completo ⇒ válido', () => {
    expect(validateKnownProblem(buildKnownProblem(COMPLETO))).toEqual({ ok: true, missing: [] });
  });

  test('NÃO ativa enquanto a correção não foi provada por execução', () => {
    const kp = buildKnownProblem(COMPLETO);
    for (const status of ['SUSPECTED', 'CONFIRMED', 'FIXING', 'FIXED']) {
      const check = canActivate(kp, { findingStatus: status });
      expect(check.allowed).toBe(false);
      expect(check.code).toBe(PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_UNVERIFIED);
    }
    expect(() => activate(kp, { findingStatus: 'FIXED' }))
      .toThrow(expect.objectContaining({ code: PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_UNVERIFIED }));
  });

  test('ativa (e vira obrigatória) só após REGRESSION_VALIDATED/CLOSED', () => {
    const kp = buildKnownProblem(COMPLETO);
    for (const status of VERIFIED_FINDING_STATUSES) {
      const ativo = activate(kp, { findingStatus: status, now: '2026-10-08T12:00:00.000Z' });
      expect(ativo.state).toBe('ACTIVE');
      expect(ativo.verificationState).toBe('VERIFIED');
      expect(ativo.activatedAt).toBe('2026-10-08T12:00:00.000Z');
      expect(activeRules([ativo])).toHaveLength(1);
    }
    // `activate` é IMUTÁVEL: o registro original continua PROPOSED.
    expect(kp.state).toBe('PROPOSED');
  });

  test('estado inválido é recusado', () => {
    const kp = { ...buildKnownProblem(COMPLETO), state: 'QUALQUER_COISA' };
    expect(validateKnownProblem(kp).code).toBe(PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_INVALID_STATE);
    expect(PREVENTIVE_RULE_STATES).toEqual(['PROPOSED', 'ACTIVE', 'RETIRED']);
  });

  describe('enforcement de fechamento', () => {
    test('self-modification e reincidência EXIGEM prevenção ativa', () => {
      expect(requiresActivePrevention({ selfModification: true }).required).toBe(true);
      expect(requiresActivePrevention({ recurrenceCount: 2 }).required).toBe(true);
      expect(requiresActivePrevention({}).required).toBe(false);
      expect(requiresActivePrevention({ recurrenceCount: 0 }).required).toBe(false);
    });

    test('fechamento de self-modification sem registro é RECUSADO', () => {
      const r = assertPreventionBeforeClose({ record: null, selfModification: true });
      expect(r.allowed).toBe(false);
      expect(r.code).toBe(PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_MISSING);
    });

    test('fechamento com registro apenas PROPOSED é RECUSADO', () => {
      const r = assertPreventionBeforeClose({
        record: buildKnownProblem(COMPLETO), selfModification: true,
      });
      expect(r.allowed).toBe(false);
      expect(r.code).toBe(PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_UNVERIFIED);
    });

    test('fechamento com regra ACTIVE e completa é PERMITIDO', () => {
      const ativo = activate(buildKnownProblem(COMPLETO), { findingStatus: 'REGRESSION_VALIDATED', now: 'now' });
      const r = assertPreventionBeforeClose({ record: ativo, selfModification: true });
      expect(r.allowed).toBe(true);
      expect(r.knownProblemId).toBe(ativo.knownProblemId);
    });

    test('fechamento de reincidência sem registro é RECUSADO; finding comum NÃO é afetado', () => {
      expect(assertPreventionBeforeClose({ record: null, recurrenceCount: 1 }).allowed).toBe(false);
      const comum = assertPreventionBeforeClose({ record: null });
      expect(comum).toEqual({ required: false, allowed: true });
    });
  });
});
