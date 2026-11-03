'use strict';

/**
 * Classificação da poda de branches de missão.
 *
 * Contexto medido (2026-10-20): 3.017 branches `engineering/missions/*` residuais no
 * repositório, sem NENHUMA poda em código de produção. A poda é DESTRUTIVA, então o critério
 * precisa ser provado por teste: branch de missão de USUÁRIO viva nunca pode ser candidata.
 *
 * Estes casos são puros (sem banco, sem git) porque a decisão é o que importa — a remoção só
 * acontece depois, com `--apply` explícito.
 */

const { classifyBranch, isTestFixture, PREFIX } = require('../../../scripts/prune-engineering-mission-branches');

describe('prune-engineering-mission-branches — critério de segurança', () => {
  test('missão inexistente no banco é órfã (candidata)', () => {
    const c = classifyBranch({ branch: `${PREFIX}abc`, mission: null });
    expect(c.decision).toBe('orphan');
    expect(c.missionId).toBe('abc');
  });

  test('missão de usuário viva NUNCA é candidata', () => {
    const c = classifyBranch({
      branch: `${PREFIX}abc`,
      mission: { status: 'EXECUTING', created_by: 'usuario-real-123' },
    });
    expect(c.decision).toBe('keep');
    expect(c.reason).toContain('missão de usuário');
  });

  test('missão de usuário em estado terminal também é mantida', () => {
    for (const status of ['DONE', 'COMPLETED', 'FAILED', 'CANCELLED']) {
      const c = classifyBranch({
        branch: `${PREFIX}abc`,
        mission: { status, created_by: 'usuario-real-123' },
      });
      expect(c.decision).toBe('keep');
    }
  });

  test('fixture de teste é candidata mesmo com missão viva', () => {
    for (const createdBy of ['jest-reroute-e2e', 'verify-something', 'sanity', 'measure-coletor', 'timeout-architecture-e2e']) {
      const c = classifyBranch({ branch: `${PREFIX}abc`, mission: { status: 'GREEN', created_by: createdBy } });
      expect(c.decision).toBe('test_fixture');
    }
  });

  test('created_by vazio ou nulo NÃO é tratado como teste (fail-safe)', () => {
    expect(isTestFixture('')).toBe(false);
    expect(isTestFixture(null)).toBe(false);
    expect(isTestFixture(undefined)).toBe(false);
    const c = classifyBranch({ branch: `${PREFIX}abc`, mission: { status: 'GREEN', created_by: null } });
    expect(c.decision).toBe('keep');
  });

  test('marcador de teste dentro de nome de usuário não vira fixture por substring solta', () => {
    // "jest-" é prefixo de fixture; um created_by como "user-jest-manager" não casa com /^jest-/i
    expect(isTestFixture('user-jest-manager')).toBe(false);
    expect(isTestFixture('jest-manager')).toBe(true);
  });
});
