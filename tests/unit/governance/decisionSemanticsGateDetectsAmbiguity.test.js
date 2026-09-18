'use strict';

/**
 * §P1 — Prova de que o gate de SEMÂNTICA DE DECISÕES sabe FALHAR.
 *
 * Gate sem prova de falha é enfeite: ele pode estar PASSando por vacuidade. Aqui
 * o gate é exercitado nos DOIS sentidos:
 *
 *   1. detecção — um artefato com `NO_GO:AUTONOMOUS_READY_GO` produz violação
 *      nominal;
 *   2. ausência de falso positivo — as decisões bloqueadas que NOMEIAM a causa
 *      (`NO_GO:BLOCKING_GAPS`, `NO_GO:MANDATORY_GATE_BLOCKED [...]`) continuam
 *      aceitas;
 *   3. egress de pesquisa — os módulos reais do Core passam nas verificações de
 *      provider governado.
 *
 * O fixture é escrito em `reports/` (diretório varrido pelo gate) e REMOVIDO no
 * fim; o teste falha se a limpeza não ocorrer.
 */

const fs = require('fs');
const path = require('path');

const {
  checkDecisionSemantics,
  checkResearchEgress,
  AMBIGUOUS_BLOCKED_GO,
  ALLOWED_BLOCKED_SUFFIXES,
} = require('../../../scripts/governance/validate-decision-semantics');

const ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_NAME = '__decision-semantics-fixture.json';
const FIXTURE_PATH = path.join(ROOT, 'reports', FIXTURE_NAME);

function writeFixture(payload) {
  fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

afterEach(() => {
  if (fs.existsSync(FIXTURE_PATH)) fs.unlinkSync(FIXTURE_PATH);
});

describe('detecção da decisão ambígua (NO_GO carregando maturidade GO)', () => {
  test('`NO_GO:AUTONOMOUS_READY_GO` é detectado como violação nominal', () => {
    writeFixture({ finalDecision: 'NO_GO:AUTONOMOUS_READY_GO', blockingGaps: 1 });
    const result = checkDecisionSemantics();

    const found = result.violations.filter(
      (violation) => violation.code === 'AMBIGUOUS_BLOCKED_DECISION_CARRIES_GO_MATURITY',
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((violation) => violation.file === `reports/${FIXTURE_NAME}`)).toBe(true);
    expect(found.some((violation) => violation.value === 'NO_GO:AUTONOMOUS_READY_GO')).toBe(true);
  });

  test('a violação é detectada em QUALQUER profundidade do artefato', () => {
    writeFixture({ nested: { proofReport: { finalDecision: 'NO_GO:AUTONOMOUS_READY_GO' } } });
    const result = checkDecisionSemantics();
    const found = result.violations.filter((violation) => violation.file === `reports/${FIXTURE_NAME}`);
    expect(found).toHaveLength(1);
    expect(found[0].path).toContain('finalDecision');
  });
});

describe('controle negativo — decisões bloqueadas legítimas NÃO são violação', () => {
  test('`NO_GO:BLOCKING_GAPS` e `NO_GO:MANDATORY_GATE_BLOCKED [...]` são aceitos', () => {
    writeFixture({
      finalDecision: 'NO_GO:BLOCKING_GAPS',
      productionReadiness: { status: 'NO_GO:MANDATORY_GATE_BLOCKED [qa-mesh=NO_GO]' },
      blockingReasons: ['STALE_QA_EVIDENCE'],
    });
    const result = checkDecisionSemantics();
    expect(result.violations.filter((violation) => violation.file === `reports/${FIXTURE_NAME}`)).toEqual([]);
  });

  test('decisões da família GO permanecem intactas', () => {
    writeFixture({
      finalDecision: 'AUTONOMOUS_READY_GO',
      candidateMaturityLevel: 'AUTONOMOUS_READY_GO',
      status: 'PASS_WITH_DEFERRED_PACKAGE_GATE',
    });
    const result = checkDecisionSemantics();
    expect(result.violations.filter((violation) => violation.file === `reports/${FIXTURE_NAME}`)).toEqual([]);
  });

  test('o classificador distingue causa nomeada de maturidade', () => {
    expect(AMBIGUOUS_BLOCKED_GO.test('NO_GO:AUTONOMOUS_READY_GO')).toBe(true);
    expect(AMBIGUOUS_BLOCKED_GO.test('NO_GO:STAGE_GO')).toBe(true);
    expect(AMBIGUOUS_BLOCKED_GO.test('NO_GO:BLOCKING_GAPS')).toBe(false);
    expect(AMBIGUOUS_BLOCKED_GO.test('NO_GO:MANDATORY_GATE_BLOCKED [qa-mesh=NO_GO]')).toBe(false);

    expect(ALLOWED_BLOCKED_SUFFIXES.test('NO_GO:BLOCKING_GAPS')).toBe(true);
    expect(ALLOWED_BLOCKED_SUFFIXES.test('NO_GO:MANDATORY_GATE_BLOCKED [x]')).toBe(true);
    expect(ALLOWED_BLOCKED_SUFFIXES.test('NO_GO:AUTONOMOUS_READY_GO')).toBe(false);
  });
});

describe('egress de pesquisa governado (módulos REAIS do Core)', () => {
  test('os módulos de rotas e o resolvedor governado passam nas verificações', () => {
    const result = checkResearchEgress();
    expect(result.violations).toEqual([]);
  });
});
