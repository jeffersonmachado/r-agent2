'use strict';

/**
 * V2-28 — "PostgreSQL ausente não vira PASS em release-authoritative."
 *
 * O requisito é sobre o CLASSIFICADOR e a PORTA DE INFRAESTRUTURA, não sobre derrubar o banco:
 * uma suíte que não conseguiu falar com a infraestrutura obrigatória precisa terminar em estado
 * explícito que NÃO é PASS, e no modo autoritativo precisa FALHAR (INFRA_ERROR).
 *
 * Defeito histórico que este teste trava: 22 arquivos faziam `skipIfNoDatabase() { return true }`
 * e a suíte terminava VERDE com o banco fora — "passou" e "não rodou" ficavam indistinguíveis.
 */

const { mapSuiteResult } = require('../../../scripts/governance/run-release-suites');
const infraGate = require('../../helpers/infraGate');

describe('V2-28 — infraestrutura obrigatória ausente nunca vira PASS', () => {
  const originalFlag = process.env.RELEASE_AUTHORITATIVE;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.RELEASE_AUTHORITATIVE;
    else process.env.RELEASE_AUTHORITATIVE = originalFlag;
    infraGate.resetSkips();
  });

  test('classificador: suíte que falha por infraestrutura é INFRA_ERROR, nunca PASS', () => {
    const mapped = mapSuiteResult({
      status: 'failed',
      message: 'Error: POSTGRES_UNAVAILABLE em modo release-authoritative — INFRA_ERROR',
      assertionResults: [
        { status: 'failed', failureMessages: ['Error: POSTGRES_UNAVAILABLE ... INFRA_ERROR'] },
      ],
    });
    expect(mapped.state).toBe('INFRA_ERROR');
    expect(mapped.state).not.toBe('PASS');
  });

  test('classificador: suíte inteiramente pulada é NOT_EXECUTED (pulo não é cobertura)', () => {
    const mapped = mapSuiteResult({
      status: 'passed',
      assertionResults: [
        { status: 'pending', failureMessages: [] },
        { status: 'pending', failureMessages: [] },
      ],
    });
    expect(mapped.state).toBe('NOT_EXECUTED');
    expect(mapped.state).not.toBe('PASS');
  });

  test('classificador: suíte que não executa teste nenhum é FAIL (gate vacuoso não passa)', () => {
    const mapped = mapSuiteResult({ status: 'passed', assertionResults: [] });
    expect(mapped.state).toBe('FAIL');
  });

  test('modo dev: infra ausente pula REGISTRADO como NOT_EXECUTED (evidência, não silêncio)', () => {
    delete process.env.RELEASE_AUTHORITATIVE;
    const shouldSkip = infraGate.skipOrFail({
      suite: 'jest-guard-probe',
      available: false,
      reason: 'sem postgres local',
      requirement: 'postgres',
    });
    expect(shouldSkip).toBe(true);
    const skips = infraGate.recordedSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0]).toMatchObject({
      suite: 'jest-guard-probe',
      requirement: 'postgres',
      state: 'NOT_EXECUTED',
      mode: 'developer',
    });
  });

  test('release-authoritative: infra ausente LANÇA INFRA_ERROR — não existe pulo silencioso', () => {
    process.env.RELEASE_AUTHORITATIVE = '1';
    let thrown = null;
    try {
      infraGate.skipOrFail({
        suite: 'jest-guard-probe',
        available: false,
        reason: 'sem postgres',
        requirement: 'postgres',
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('INFRA_ERROR');
    expect(thrown.state).toBe('INFRA_ERROR');
    // O pulo NÃO é registrado: falhou, não pulou.
    expect(infraGate.recordedSkips()).toHaveLength(0);
  });
});
