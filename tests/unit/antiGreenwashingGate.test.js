'use strict';

/**
 * Anti-greenwashing — porta de infraestrutura e gate (§11, §12, §13).
 *
 * O defeito real: `if (skipIfNoDatabase()) return;` fazia o Jest reportar VERDE com o banco fora do
 * ar, e o relatório agregado contava como cobertura. Um gate de release não pode aceitar isso.
 *
 * Aqui a prova é direta: o modo autoritativo LANÇA `INFRA_ERROR` (a suite falha), o modo dev
 * registra `NOT_EXECUTED` (nunca PASS), e o validador recusa mecanismos de pulo silencioso —
 * inclusive quando o padrão aparece como DADO de fixture (falso positivo real encontrado).
 */

const infraGate = require('../helpers/infraGate');
const validator = require('../../scripts/governance/validate-anti-greenwashing');

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env.RELEASE_AUTHORITATIVE = ORIGINAL_ENV.RELEASE_AUTHORITATIVE;
  if (ORIGINAL_ENV.RELEASE_AUTHORITATIVE === undefined) delete process.env.RELEASE_AUTHORITATIVE;
  infraGate.resetSkips();
});

describe('infraGate — dois regimes, nenhum verde falso', () => {
  test('AUTORITATIVO + infra ausente ⇒ LANÇA INFRA_ERROR (a suite FALHA, não passa)', () => {
    process.env.RELEASE_AUTHORITATIVE = '1';
    let thrown = null;
    try {
      infraGate.skipOrFail({ suite: 'suite-x', available: false, reason: 'postgres_unreachable', requirement: 'postgres' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeTruthy();
    expect(thrown.code).toBe('INFRA_ERROR');
    expect(thrown.state).toBe('INFRA_ERROR');
    expect(thrown.message).toMatch(/não pode passar com infraestrutura ausente/);
    expect(infraGate.recordedSkips()).toHaveLength(0); // não é pulo: é falha
  });

  test('AUTORITATIVO + infra presente ⇒ segue executando (nunca pula)', () => {
    process.env.RELEASE_AUTHORITATIVE = '1';
    expect(infraGate.skipOrFail({ suite: 'suite-x', available: true, requirement: 'postgres' })).toBe(false);
  });

  test('DEV + infra ausente ⇒ pula, mas REGISTRA NOT_EXECUTED com motivo', () => {
    delete process.env.RELEASE_AUTHORITATIVE;
    const shouldSkip = infraGate.skipOrFail({ suite: 'suite-y', available: false, reason: 'ECONNREFUSED 5432', requirement: 'postgres' });
    expect(shouldSkip).toBe(true);
    const [record] = infraGate.recordedSkips();
    expect(record).toMatchObject({
      suite: 'suite-y', requirement: 'postgres', reason: 'ECONNREFUSED 5432', state: 'NOT_EXECUTED', mode: 'developer',
    });
    expect(record.at).toEqual(expect.any(String));
  });

  test('DEV + infra presente ⇒ não registra nada', () => {
    delete process.env.RELEASE_AUTHORITATIVE;
    expect(infraGate.skipOrFail({ suite: 'suite-z', available: true })).toBe(false);
    expect(infraGate.recordedSkips()).toHaveLength(0);
  });

  test('evidência de execução NUNCA declara PASS pleno quando algo não rodou', () => {
    delete process.env.RELEASE_AUTHORITATIVE;
    infraGate.skipOrFail({ suite: 'suite-w', available: false, reason: 'sem banco' });
    const evidence = infraGate.buildExecutionEvidence({ suite: 'suite-w', exitState: 'PASS' });
    expect(evidence.verdict).toBe('PASS_WITH_NOT_EXECUTED');
    expect(evidence.notExecutedCount).toBe(1);
    expect(evidence.notExecuted[0].state).toBe('NOT_EXECUTED');

    infraGate.resetSkips();
    const clean = infraGate.buildExecutionEvidence({ suite: 'suite-w', exitState: 'PASS' });
    expect(clean.verdict).toBe('PASS');
    expect(clean.notExecutedCount).toBe(0);
  });

  test('o vocabulário de estados é explícito (nada de booleano ambíguo)', () => {
    const states = ['PASS', 'FAIL', 'BLOCKED', 'INFRA_ERROR', 'NOT_APPLICABLE', 'NOT_EXECUTED'];
    // `state` do erro e da evidência pertencem ao vocabulário declarado pelo gate.
    expect(states).toContain('INFRA_ERROR');
    expect(states).toContain('NOT_EXECUTED');
    process.env.RELEASE_AUTHORITATIVE = '1';
    try {
      infraGate.skipOrFail({ suite: 's', available: false });
    } catch (error) {
      expect(states).toContain(error.state);
    }
  });
});

describe('validate-anti-greenwashing — detecção e falso positivo', () => {
  test('o relatório REAL do repositório não tem violação (suítes migradas)', () => {
    delete process.env.RELEASE_AUTHORITATIVE;
    const report = validator.evaluate();
    expect(report.violationCount).toBe(0);
    expect(report.status).toBe('PASS');
    expect(report.authoritativeSuites).toBeGreaterThanOrEqual(17);
  });

  test('modo autoritativo com infra ausente ⇒ estado INFRA_ERROR (jamais PASS)', () => {
    process.env.RELEASE_AUTHORITATIVE = '1';
    process.env.ANTI_GREENWASHING_INFRA = 'down';
    const report = validator.evaluate();
    delete process.env.ANTI_GREENWASHING_INFRA;
    expect(report.state).toBe('INFRA_ERROR');
    expect(report.status).toBe('INFRA_ERROR');
    expect(report.status).not.toBe('PASS');
  });

  test('mecanismos proibidos são reconhecidos em CÓDIGO de teste', () => {
    const { FORBIDDEN_SKIP_PATTERNS } = validator;
    const ids = FORBIDDEN_SKIP_PATTERNS.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['TEST_SKIP', 'IT_SKIP', 'DESCRIBE_SKIP', 'XIT', 'XDESCRIBE', 'ONLY', 'ENV_GATE']));
    const byId = Object.fromEntries(FORBIDDEN_SKIP_PATTERNS.map((p) => [p.id, p.re]));
    expect(byId.TEST_SKIP.test('test.skip("x", () => {})')).toBe(true);
    expect(byId.ONLY.test('describe.only("x", () => {})')).toBe(true);
    expect(byId.XIT.test('xit("x")')).toBe(true);
    expect(byId.ENV_GATE.test("process.env.SKIP_GATE === '1'")).toBe(true);
    // Não confundir texto legítimo: `test.skipped`, `onlyOnce`, nome com "skip" no meio.
    expect(byId.TEST_SKIP.test('expect(test.skippedCount).toBe(0)')).toBe(false);
    expect(byId.ONLY.test('const onlyWhen = compute()')).toBe(false);
  });

  test('FALSO POSITIVO real: token dentro de fixture/string NÃO é mecanismo de skip', () => {
    // Caso do repositório: patch que o Meta Reviewer deve reprovar, usado como DADO.
    expect(validator.isFixtureOrStringLine("      '+  test.skip(\\'ignora\\', () => {});',")).toBe(true);
    expect(validator.isFixtureOrStringLine("      '+  describe.only(\\'só este\\', () => {});',")).toBe(true);
    expect(validator.isFixtureOrStringLine('+  test.skip("x", () => {});')).toBe(true);
    // ...mas código real continua sendo detectado.
    expect(validator.isFixtureOrStringLine('  test.skip("x", () => {});')).toBe(false);
    expect(validator.isFixtureOrStringLine('  it.only("x", () => {});')).toBe(false);
  });
});
