'use strict';

/**
 * Classificador de falha pós-fix (puro).
 *
 * Guarda da regra que separa "o bug voltou" de "o coder não conseguiu entregar patch" — a distinção
 * que faltava quando o finding recém-fechado voltou a CONFIRMED com `recurrenceCount=1` por causa de
 * um `PATCH_CONTRACT_VIOLATION` na task substituta (run 40786037745).
 */

const {
  classifyPostFixFailure,
  CODER_CONTRACT_FAILURE_KINDS,
  CODER_CONTRACT_REASON_CODES,
  POST_FIX_FINDING_STATUSES,
} = require('../../../engine/engineeringMission/bugFinding/postFixFailure');

describe('classifyPostFixFailure — falha de contrato do coder × recorrência do bug', () => {
  const findingFechado = [{ id: 'f1', status: 'CLOSED' }];

  test('PATCH_CONTRACT_VIOLATION com finding fechado ⇒ NÃO é recorrência (escopo próprio)', () => {
    const r = classifyPostFixFailure({ failureKind: 'PATCH_CONTRACT_VIOLATION', findings: findingFechado });
    expect(r.isCoderContractFailure).toBe(true);
    expect(r.hasPostFixFinding).toBe(true);
    expect(r.isFalseRecurrence).toBe(true);
    expect(r.fingerprintScope).toBe('coder_contract');
    expect(r.reason).toContain('não é recorrência');
  });

  test('código de patch (PATCH_APPLY_FAILED) também é contrato do coder', () => {
    const r = classifyPostFixFailure({ reasonCode: 'PATCH_APPLY_FAILED', findings: findingFechado });
    expect(r.isCoderContractFailure).toBe(true);
    expect(r.isFalseRecurrence).toBe(true);
  });

  test('recorrência REAL (teste falhando) continua indo pelo caminho normal', () => {
    const r = classifyPostFixFailure({ failureKind: 'TEST_FAILED', reasonCode: 'REGRESSION_FAILED', findings: findingFechado });
    expect(r.isCoderContractFailure).toBe(false);
    expect(r.isFalseRecurrence).toBe(false);
    expect(r.fingerprintScope).toBe('application');
  });

  test('falha de contrato SEM finding pós-correção não é tratada como falso positivo', () => {
    for (const findings of [[], [{ id: 'f2', status: 'CONFIRMED' }], [{ id: 'f3', status: 'FIXING' }], null]) {
      const r = classifyPostFixFailure({ failureKind: 'PATCH_CONTRACT_VIOLATION', findings });
      expect(r.isCoderContractFailure).toBe(true);
      expect(r.isFalseRecurrence).toBe(false);
      expect(r.fingerprintScope).toBe('application');
    }
  });

  test('qualquer estado pós-correção habilitado conta (FIXED, REGRESSION_VALIDATED, CLOSED)', () => {
    for (const status of POST_FIX_FINDING_STATUSES) {
      const r = classifyPostFixFailure({ failureKind: 'PATCH_CONTRACT_VIOLATION', findings: [{ id: 'x', status }] });
      expect(r.isFalseRecurrence).toBe(true);
    }
  });

  test('a lista de modos/códigos de contrato é explícita (nunca "qualquer falha")', () => {
    expect(CODER_CONTRACT_FAILURE_KINDS).toEqual(expect.arrayContaining(['PATCH_CONTRACT_VIOLATION', 'PATCH_NOT_APPLICABLE']));
    expect(CODER_CONTRACT_REASON_CODES).toEqual(expect.arrayContaining([
      'PATCH_APPLY_FAILED', 'PATCH_INVALID_FORMAT',
      // contrato de execução da task (escopo não resolvido na retomada) e infra que impede tentativa
      'NO_PATCH_SCOPE', 'NO_QUALIFIED_CODER', 'PROVIDER_UNAVAILABLE',
    ]));
    // Falha de TESTE nunca é tratada como contrato: essa é a recorrência REAL.
    for (const code of ['REGRESSION_FAILED', 'GOVERNANCE_FAILED', 'ENGINEERING_TASK_EXHAUSTED']) {
      const r = classifyPostFixFailure({ reasonCode: code, findings: [{ id: 'x', status: 'CLOSED' }] });
      expect(r.isFalseRecurrence).toBe(false);
    }
  });
});

describe('classifyPostFixFailure — fontes múltiplas da mesma falha', () => {
  test('task EXHAUSTED com contract violation nas tentativas ⇒ ainda é falha de contrato do coder', () => {
    const r = classifyPostFixFailure({
      failureKinds: ['PATCH_CONTRACT_VIOLATION'],
      reasonCode: 'ENGINEERING_TASK_EXHAUSTED',
      findings: [{ id: 'f', status: 'CLOSED' }],
    });
    expect(r.isCoderContractFailure).toBe(true);
    expect(r.isFalseRecurrence).toBe(true);
  });

  test('código de última tentativa (failure_bundle.code) também conta', () => {
    const r = classifyPostFixFailure({
      reasonCodes: ['PATCH_APPLY_FAILED'],
      reasonCode: 'ENGINEERING_TASK_EXHAUSTED',
      findings: [{ id: 'f', status: 'REGRESSION_VALIDATED' }],
    });
    expect(r.isFalseRecurrence).toBe(true);
  });

  test('nenhuma fonte de contrato ⇒ caminho normal (recorrência real preservada)', () => {
    const r = classifyPostFixFailure({
      failureKinds: ['TEST_FAILED'],
      reasonCode: 'ENGINEERING_TASK_EXHAUSTED',
      findings: [{ id: 'f', status: 'CLOSED' }],
    });
    expect(r.isFalseRecurrence).toBe(false);
  });
});
