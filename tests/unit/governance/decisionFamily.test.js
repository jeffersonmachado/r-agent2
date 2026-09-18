'use strict';

/**
 * §P1 — FAMÍLIA de decisão: concordância semântica, divergência real recusada.
 *
 * CONTEXTO (defeito medido 2026-09-18): as fontes canônicas nomeiam o mesmo
 * bloqueio de formas diferentes:
 *
 *   readiness  → `NO_GO:MANDATORY_GATE_BLOCKED [governance=NO_GO]`
 *   governance → `NO_GO`
 *
 * A comparação por IGUALDADE TEXTUAL acusava `canonical_divergence` onde as duas
 * CONCORDAM. Consequência em cadeia: o produtor de projeções recusava projetar,
 * a projeção do ciclo anterior permanecia no disco e
 * `docs/architecture/RAP_MASTER_SCORECARD.md` exibia `10/10: 78 / Below 10: 0`
 * enquanto a canônica dizia NO_GO — o falso verde que o produtor existe para
 * impedir.
 *
 * O afinamento é LIMITADO: comparar família aceita rótulos diferentes do MESMO
 * veredito e continua recusando aprovação de um lado e bloqueio do outro.
 */

const {
  DECISION_FAMILY,
  decisionFamily,
  decisionsAgree,
} = require('../../../governance/decision-family');

describe('decisionFamily', () => {
  test('NO_GO em qualquer forma é BLOQUEIO', () => {
    expect(decisionFamily('NO_GO')).toBe(DECISION_FAMILY.BLOCKED);
    expect(decisionFamily('NO_GO:BLOCKING_GAPS')).toBe(DECISION_FAMILY.BLOCKED);
    expect(decisionFamily('NO_GO:MANDATORY_GATE_BLOCKED [governance=NO_GO]')).toBe(DECISION_FAMILY.BLOCKED);
    expect(decisionFamily('PENDING')).toBe(DECISION_FAMILY.BLOCKED);
  });

  test('decisões de aprovação são da família GO', () => {
    expect(decisionFamily('AUTONOMOUS_READY_GO')).toBe(DECISION_FAMILY.GO_FAMILY);
    expect(decisionFamily('GO')).toBe(DECISION_FAMILY.GO_FAMILY);
    expect(decisionFamily('PASS')).toBe(DECISION_FAMILY.GO_FAMILY);
    expect(decisionFamily('PASS_WITH_DEFERRED_PACKAGE_GATE')).toBe(DECISION_FAMILY.GO_FAMILY);
  });

  test('ausência/valor vazio é UNKNOWN (não vira GO nem BLOQUEIO)', () => {
    expect(decisionFamily(null)).toBe(DECISION_FAMILY.UNKNOWN);
    expect(decisionFamily(undefined)).toBe(DECISION_FAMILY.UNKNOWN);
    expect(decisionFamily('   ')).toBe(DECISION_FAMILY.UNKNOWN);
  });
});

describe('decisionsAgree', () => {
  test('rótulos diferentes do MESMO bloqueio CONCORDAM', () => {
    const result = decisionsAgree('NO_GO:MANDATORY_GATE_BLOCKED [governance=NO_GO]', 'NO_GO');
    expect(result.agree).toBe(true);
    expect(result.left).toBe(DECISION_FAMILY.BLOCKED);
    expect(result.right).toBe(DECISION_FAMILY.BLOCKED);
    expect(result.reason).toBeNull();
  });

  test('divergência REAL é recusada: aprovado de um lado, bloqueado do outro', () => {
    const goVsNoGo = decisionsAgree('AUTONOMOUS_READY_GO', 'NO_GO');
    expect(goVsNoGo.agree).toBe(false);
    expect(goVsNoGo.reason).toBe('decision_family_divergence');

    const noGoVsGo = decisionsAgree('NO_GO:BLOCKING_GAPS', 'AUTONOMOUS_READY_GO');
    expect(noGoVsGo.agree).toBe(false);
    expect(noGoVsGo.reason).toBe('decision_family_divergence');

    // Gate diferido É aprovação de fase: contra NO_GO é divergência real.
    expect(decisionsAgree('PASS_WITH_DEFERRED_PACKAGE_GATE', 'NO_GO').agree).toBe(false);
  });

  test('decisão ausente não concorda com nada (fail closed)', () => {
    expect(decisionsAgree(null, 'NO_GO').agree).toBe(false);
    expect(decisionsAgree(null, 'NO_GO').reason).toBe('decision_missing');
    expect(decisionsAgree('AUTONOMOUS_READY_GO', '').agree).toBe(false);
  });

  test('duas aprovações de rótulos diferentes concordam', () => {
    expect(decisionsAgree('AUTONOMOUS_READY_GO', 'GO').agree).toBe(true);
    expect(decisionsAgree('AUTONOMOUS_READY_GO', 'PASS').agree).toBe(true);
  });
});
