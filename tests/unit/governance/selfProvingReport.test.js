'use strict';

/**
 * FASE 16 — Self-proving report deriva de resultados reais dos validadores.
 *
 * Falhas cobertas (falhariam antes da correção):
 * 1. `autonomousReady` era computado por heurística de substring
 *    (`d.includes('_GO') && !d.includes('NO_GO') && ...`) — decisões de
 *    estágio intermediário como 'PRODLIKE_GO' contavam como prontidão
 *    autônoma, e qualquer vocabulário NO_GO novo não listado nas exclusões
 *    passava despercebido. Agora há vocabulário fechado de GO por engine.
 * 2. O CLI saía com `process.exit(0)` incondicional — falha de validador
 *    obrigatório não mudava o exit code. Agora exit 1 quando há falhas.
 */

const {
  deriveAutonomousReady,
  collectMandatoryFailures,
  isEngineGo,
  ENGINE_GO_DECISIONS,
  generateSelfProvingReport,
} = require('../../../governance/generate-self-proving-report');

function allGoDecisions() {
  return {
    replayHardening: 'REPLAY_HARDENING_GO',
    replayConsistency: 'REPLAY_CONSISTENCY_GO',
    contamination: 'NO_CONTAMINATION',
    packageIntegrity: 'PACKAGE_INTEGRITY_GO',
    finalGovernance: 'AUTONOMOUS_READY_GO',
    readiness: 'AUTONOMOUS_READY_GO',
    readinessDrift: 'READINESS_NO_DRIFT',
    finalConsistencyGate: 'FINAL_CONSISTENCY_GO',
  };
}

describe('generate-self-proving-report — vocabulário fechado de GO', () => {
  test('todos os engines com decisão GO explícita → autonomousReady true', () => {
    expect(deriveAutonomousReady(allGoDecisions())).toBe(true);
  });

  test('estágio intermediário PRODLIKE_GO NÃO conta como autonomous (regressão da heurística *_GO)', () => {
    const decisions = { ...allGoDecisions(), readiness: 'PRODLIKE_GO' };
    // Heurística antiga ('_GO' substring) retornaria true aqui.
    expect(deriveAutonomousReady(decisions)).toBe(false);
  });

  test('decisão NO_GO em qualquer engine → autonomousReady false', () => {
    const decisions = { ...allGoDecisions(), replayHardening: 'REPLAY_HARDENING_NO_GO' };
    expect(deriveAutonomousReady(decisions)).toBe(false);
  });

  test('vocabulário NO_GO novo (não listado em exclusões antigas) → false', () => {
    const decisions = { ...allGoDecisions(), readinessDrift: 'READINESS_DRIFT_NO_GO:FINGERPRINT_STALE' };
    expect(deriveAutonomousReady(decisions)).toBe(false);
  });

  test('UNKNOWN (relatório ausente) não conta como prova', () => {
    const decisions = { ...allGoDecisions(), finalConsistencyGate: 'UNKNOWN' };
    expect(deriveAutonomousReady(decisions)).toBe(false);
  });

  test('isEngineGo valida contra o vocabulário declarado', () => {
    expect(isEngineGo('readinessDrift', 'READINESS_NO_DRIFT')).toBe(true);
    expect(isEngineGo('readinessDrift', 'READINESS_DRIFT_GO')).toBe(false);
    expect(isEngineGo('engineInexistente', 'GO')).toBe(false);
    expect(Object.keys(ENGINE_GO_DECISIONS)).toHaveLength(8);
  });
});

describe('generate-self-proving-report — falhas obrigatórias e exit code', () => {
  test('falha de validador obrigatório é listada (base do exit não-zero)', () => {
    const decisions = { ...allGoDecisions(), packageIntegrity: 'PACKAGE_INTEGRITY_NO_GO' };
    const failures = collectMandatoryFailures(decisions, false);
    expect(failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ engine: 'packageIntegrity' }),
    ]));
    expect(failures.length).toBeGreaterThan(0);
  });

  test('tudo GO + pacote íntegro → sem falhas (exit 0)', () => {
    expect(collectMandatoryFailures(allGoDecisions(), true)).toEqual([]);
  });

  test('relatório mantém contrato JSON legado e adiciona ok/mandatoryFailures', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    // Nunca escrever no artefato governado versionado — worktree sujo quebra
    // a proveniência de release (source_commit_provenance).
    const report = generateSelfProvingReport({
      reportPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'self-proving-')), 'report.json'),
    });
    // Contrato legado preservado (consumido por rebind-to-current-package)
    for (const field of [
      'generatedAt', 'engine', 'zipName', 'zipHash', 'manifestHash',
      'engineDecisions', 'packageIntegrityOk', 'allEnginesBlockedOrUnknown',
      'autonomousReady', 'summary',
    ]) {
      expect(report).toHaveProperty(field);
    }
    // Novos campos de fail-closed
    expect(report).toHaveProperty('mandatoryFailures');
    expect(report).toHaveProperty('ok');
    expect(report.ok).toBe(report.mandatoryFailures.length === 0);
    expect(typeof report.autonomousReady).toBe('boolean');
  });
});
