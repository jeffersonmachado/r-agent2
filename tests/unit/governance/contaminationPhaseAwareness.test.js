'use strict';

/**
 * GUARDA do gate de contaminação com autoridade de fase.
 *
 * DEFEITO MEDIDO (ciclo C, 2026-10-05): o cleaner reprovava a governança
 * (`GOVERNANCE_CONTAMINATION_NO_GO`) por 5 artefatos da cadeia FINAL/DELIVERED
 * (`final-consistency`, `package-integrity`, `replay-integrity`, `self-proving`,
 * `tamper-detection`) que ainda carregavam o runId do run ANTERIOR. Mas esses
 * artefatos são exatamente os que a política de fase DEFERE: eles não podem ter
 * o runId corrente antes do empacotamento. Era o mesmo falso bloqueio que já
 * atingia o ensure (8.7), o stamp (9) e o gate temporal.
 *
 * A guarda prova os dois sentidos com a autoridade compartilhada
 * (`producerDueNow`): antes da fase é PENDING_PHASE (fora da decisão); na fase
 * devida é contaminação CRITICAL (fail-closed).
 */

const { checkForeignRun } = require('../../../governance/report-contamination-cleaner');

const RUN = 'rap-governed-20261005155912964-90b91404';
const OTHER_RUN = 'rap-governed-20261005023044918-48ad43cf';
const FINAL_CHAIN = 'governance/final-consistency-report.json'; // producer.phase = FINAL
const ALWAYS_DUE = 'governance/mutable-json-state-validation-report.json'; // sem fase: sempre devido

afterEach(() => {
  delete process.env.ARTIFACT_REFRESH_PHASE;
});

describe('contamination gate — PENDING_PHASE antes da fase, CRITICAL na fase devida', () => {
  test('em CONVERGE, artefato de fase posterior NÃO é contaminação', () => {
    process.env.ARTIFACT_REFRESH_PHASE = 'CONVERGE';
    const finding = checkForeignRun({ runId: OTHER_RUN }, FINAL_CHAIN, RUN);

    expect(finding).toBeTruthy();
    expect(finding.type).toBe('PENDING_PHASE_FOREIGN_RUN');
    expect(finding.severity).toBe('INFO');
    expect(finding.producerPhase).toBe('FINAL');
  });

  test('na fase FINAL, o MESMO artefato é contaminação CRITICAL (fail-closed)', () => {
    process.env.ARTIFACT_REFRESH_PHASE = 'FINAL';
    const finding = checkForeignRun({ runId: OTHER_RUN }, FINAL_CHAIN, RUN);

    expect(finding.type).toBe('FOREIGN_RUN_ARTIFACT');
    expect(finding.severity).toBe('CRITICAL');
    expect(finding.expected).toBe(RUN);
  });

  test('artefato sem fase declarada é contaminação em QUALQUER fase', () => {
    for (const phase of ['CONVERGE', 'FINAL', 'DELIVERED']) {
      process.env.ARTIFACT_REFRESH_PHASE = phase;
      const finding = checkForeignRun({ runId: OTHER_RUN }, ALWAYS_DUE, RUN);
      expect(finding.type).toBe('FOREIGN_RUN_ARTIFACT');
      expect(finding.severity).toBe('CRITICAL');
    }
  });

  test('artefato do PRÓPRIO run nunca é contaminação', () => {
    process.env.ARTIFACT_REFRESH_PHASE = 'CONVERGE';
    expect(checkForeignRun({ runId: RUN }, FINAL_CHAIN, RUN)).toBeNull();
    process.env.ARTIFACT_REFRESH_PHASE = 'FINAL';
    expect(checkForeignRun({ runId: RUN }, FINAL_CHAIN, RUN)).toBeNull();
  });
});
