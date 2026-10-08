'use strict';

/**
 * Indisponibilidade de PROVIDER é infraestrutura: não pode degradar a prioridade de um modelo.
 * Achado medido em 2026-10-07 (ver AI_MEMORY/evidence/2026-10-07-pool-audit-controlado.json).
 */

const assert = require('node:assert');
const {
  isInfrastructureFailure,
  meritFailureKindOf,
} = require('../../engine/engineeringRouter/executionFailurePolicy');

describe('engineeringRouter/executionFailurePolicy', () => {
  describe('isInfrastructureFailure', () => {
    it('reconhece as classes de falha de provider medidas', () => {
      assert.strictEqual(isInfrastructureFailure('PROVIDER_TIMEOUT'), true);
      assert.strictEqual(isInfrastructureFailure('PROVIDER_UNAVAILABLE'), true);
      assert.strictEqual(isInfrastructureFailure('PROVIDER_QUOTA'), true);
      assert.strictEqual(isInfrastructureFailure('PROVIDER_RATE_LIMITED'), true);
    });

    it('reconhece o motivo quando a classe vem nula', () => {
      assert.strictEqual(isInfrastructureFailure(null, 'PROVIDER_UNAVAILABLE'), true);
      assert.strictEqual(isInfrastructureFailure(null, 'PROVIDER_EXHAUSTED'), true);
      assert.strictEqual(isInfrastructureFailure(undefined, 'PROVIDER_TIMEOUT'), true);
    });

    it('NÃO trata falha de mérito como infraestrutura', () => {
      // Uma falha que revela incapacidade do modelo precisa continuar reduzindo sua prioridade.
      assert.strictEqual(isInfrastructureFailure('PATCH_NOT_APPLICABLE'), false);
      assert.strictEqual(isInfrastructureFailure('CODER_PATCH_NOT_APPLICABLE'), false);
      assert.strictEqual(isInfrastructureFailure('TEST_FAIL'), false);
      assert.strictEqual(isInfrastructureFailure('MERIT_REPEATED'), false);
      assert.strictEqual(isInfrastructureFailure(null, 'TEST_FAIL'), false);
    });

    it('sem informação de falha não classifica como infraestrutura', () => {
      assert.strictEqual(isInfrastructureFailure(null), false);
      assert.strictEqual(isInfrastructureFailure(undefined), false);
      assert.strictEqual(isInfrastructureFailure(''), false);
      assert.strictEqual(isInfrastructureFailure(null, null), false);
    });
  });

  describe('meritFailureKindOf', () => {
    it('rotula o tipo de falha de mérito de forma estável', () => {
      assert.strictEqual(meritFailureKindOf('PROVIDER_TIMEOUT'), 'timeout');
      assert.strictEqual(meritFailureKindOf('PATCH_NOT_APPLICABLE'), 'provider');
      assert.strictEqual(meritFailureKindOf(null), 'unknown');
    });
  });
});
