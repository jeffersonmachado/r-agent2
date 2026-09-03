'use strict';

/**
 * Testes da política de decisão canônica monotônica.
 *
 * Regra absoluta: nenhuma fase posterior do pipeline pode promover NO_GO → GO.
 * A decisão só é preservada ou degradada.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeDecision,
  combineDecision,
  reduceDecisions,
  readCanonicalDecision,
  assertDerivedDecisionMatches,
  CANONICAL_REPORT_REL_PATH,
} = require('../../../governance/canonical-decision');

describe('canonical-decision — normalizeDecision', () => {
  test('vocabulário GO é reconhecido', () => {
    for (const d of ['GO', 'AUTONOMOUS_READY_GO', 'AUTONOMOUS_READY', 'PASS', 'DELIVERED_RELEASE_VERIFIED']) {
      expect(normalizeDecision(d)).toBe('GO');
    }
  });

  test('qualquer outra decisão é NO_GO (fail-closed)', () => {
    for (const d of ['NO_GO', 'NO_GO:GOVERNANCE_BLOCKED', 'FAIL', 'PASS_WITH_DEFERRED_PACKAGE_GATE', 'DEFERRED', '', null, undefined, 42]) {
      expect(normalizeDecision(d)).toBe('NO_GO');
    }
  });

  test('PASS_WITH_DEFERRED_PACKAGE_GATE não é GO (estado transitório pré-package)', () => {
    expect(normalizeDecision('PASS_WITH_DEFERRED_PACKAGE_GATE')).toBe('NO_GO');
  });
});

describe('canonical-decision — combineDecision monotônica', () => {
  test('GO + GO = GO', () => {
    expect(combineDecision('GO', 'GO')).toBe('GO');
    expect(combineDecision('AUTONOMOUS_READY_GO', 'PASS')).toBe('GO');
  });

  test('GO + NO_GO = NO_GO', () => {
    expect(combineDecision('GO', 'NO_GO')).toBe('NO_GO');
    expect(combineDecision('AUTONOMOUS_READY_GO', 'NO_GO:PACKAGE')).toBe('NO_GO');
  });

  test('NO_GO + GO = NO_GO (proibido promover)', () => {
    expect(combineDecision('NO_GO', 'GO')).toBe('NO_GO');
    expect(combineDecision('NO_GO:GOVERNANCE_BLOCKED', 'AUTONOMOUS_READY_GO')).toBe('NO_GO');
  });

  test('NO_GO + NO_GO = NO_GO', () => {
    expect(combineDecision('NO_GO', 'NO_GO')).toBe('NO_GO');
  });

  test('reduceDecisions: um único NO_GO derruba a cadeia inteira', () => {
    expect(reduceDecisions(['GO', 'GO', 'GO'])).toBe('GO');
    expect(reduceDecisions(['GO', 'NO_GO', 'GO'])).toBe('NO_GO');
    expect(reduceDecisions(['NO_GO', 'GO', 'GO', 'GO'])).toBe('NO_GO');
    expect(reduceDecisions([])).toBe('GO');
  });
});

describe('canonical-decision — readCanonicalDecision', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgd-test-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('relatório canônico ausente → NO_GO MISSING_CANONICAL_GOVERNANCE', () => {
    const result = readCanonicalDecision(dir);
    expect(result.decision).toBe('NO_GO');
    expect(result.reason).toContain('MISSING_CANONICAL_GOVERNANCE');
  });

  test('relatório canônico GO → GO com lineage exposto', () => {
    fs.mkdirSync(path.join(dir, 'governance'), { recursive: true });
    fs.writeFileSync(path.join(dir, CANONICAL_REPORT_REL_PATH), JSON.stringify({
      finalDecision: 'AUTONOMOUS_READY_GO',
      runId: 'run-1',
      sourceFingerprint: 'f'.repeat(64),
    }));
    const result = readCanonicalDecision(dir);
    expect(result.decision).toBe('GO');
    expect(result.rawDecision).toBe('AUTONOMOUS_READY_GO');
    expect(result.runId).toBe('run-1');
    expect(result.sourceFingerprint).toBe('f'.repeat(64));
  });

  test('relatório canônico NO_GO → NO_GO (nunca promovido)', () => {
    fs.mkdirSync(path.join(dir, 'governance'), { recursive: true });
    fs.writeFileSync(path.join(dir, CANONICAL_REPORT_REL_PATH), JSON.stringify({
      finalDecision: 'NO_GO:GOVERNANCE_BLOCKED',
    }));
    expect(readCanonicalDecision(dir).decision).toBe('NO_GO');
  });

  test('JSON corrompido → NO_GO (fail-closed)', () => {
    fs.mkdirSync(path.join(dir, 'governance'), { recursive: true });
    fs.writeFileSync(path.join(dir, CANONICAL_REPORT_REL_PATH), '{not json');
    expect(readCanonicalDecision(dir).decision).toBe('NO_GO');
  });
});

describe('canonical-decision — assertDerivedDecisionMatches', () => {
  test('envelope GO + payload GO → ok', () => {
    expect(assertDerivedDecisionMatches('AUTONOMOUS_READY_GO', 'GO').ok).toBe(true);
  });

  test('envelope GO + payload NO_GO → GOVERNANCE_DECISION_MISMATCH', () => {
    const r = assertDerivedDecisionMatches('NO_GO:GOVERNANCE_BLOCKED', 'GO');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('GOVERNANCE_DECISION_MISMATCH');
  });

  test('envelope NO_GO + payload GO → mismatch (cópia degradada também diverge)', () => {
    expect(assertDerivedDecisionMatches('GO', 'NO_GO').ok).toBe(false);
  });

  test('envelope NO_GO + payload NO_GO → ok (decisão propagada corretamente)', () => {
    expect(assertDerivedDecisionMatches('NO_GO:X', 'NO_GO:Y').ok).toBe(true);
  });
});
