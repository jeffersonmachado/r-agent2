'use strict';

/**
 * FASE 16 — Proof Engine semântico: artefato presente ≠ artefato válido.
 *
 * Falhas cobertas (falhariam antes da correção):
 * 1. evaluateDigitalTwin usava lógica OR entre evidências — qualquer fonte
 *    parcialmente presente satisfazia o requisito. Agora é conjunção (AND).
 * 2. Snapshots com `diff.valid === false`, assertions `passed === false`,
 *    mutações indevidas (`unexpectedMutations`) ou mutações esperadas
 *    ausentes eram ignorados — presença contava como prova.
 * 3. Artefatos com `ok === false` / `status NO_GO` no payload eram tratados
 *    como válidos pela checagem de presença.
 */

const {
  evaluateDigitalTwin,
  semanticArtifactViolations,
  validateTwinSnapshotContent,
} = require('../../../governance/proof-engine');

function makeContext(overrides = {}) {
  return {
    omnichannel:  { status: 'VALIDATED', missing: [] },
    humanHandoff: { status: 'VALIDATED', missing: [] },
    pbx:          { status: 'VALIDATED', missing: [] },
    requiredArtifacts: [{ id: 'smoke_summary', domain: 'foundation', exists: true }],
    ...overrides,
  };
}

function makeSnapshotsArtifact(snapshots) {
  return {
    exists: true,
    path: 'qa/enterprise/digital-twin-snapshots.json',
    json: { snapshots },
  };
}

describe('proof-engine — evaluateDigitalTwin (conjunção AND)', () => {
  test('todos os requisitos válidos → VALIDATED', () => {
    const result = evaluateDigitalTwin(
      makeContext(),
      makeSnapshotsArtifact([{ stepId: 's1', diff: { valid: true } }]),
    );
    expect(result.status).toBe('VALIDATED');
    expect(result.missing).toEqual([]);
  });

  test('uma única fonte não-VALIDATED derruba replay (antes: OR deixava passar)', () => {
    const result = evaluateDigitalTwin(
      makeContext({ omnichannel: { status: 'PARTIAL', missing: [] } }),
      makeSnapshotsArtifact([{ stepId: 's1', diff: { valid: true } }]),
    );
    expect(result.status).not.toBe('VALIDATED');
    expect(result.missing).toContain('replay');
  });

  test('timeline ausente em apenas uma fonte derruba o requisito (AND)', () => {
    const result = evaluateDigitalTwin(
      makeContext({ pbx: { status: 'VALIDATED', missing: ['ivr_timeline'] } }),
      makeSnapshotsArtifact([{ stepId: 's1', diff: { valid: true } }]),
    );
    expect(result.missing).toContain('timeline');
  });

  test('mutations ausentes em uma fonte derrubam o requisito (AND)', () => {
    const result = evaluateDigitalTwin(
      makeContext({ omnichannel: { status: 'VALIDATED', missing: ['crm_mutations'] } }),
      makeSnapshotsArtifact([{ stepId: 's1', diff: { valid: true } }]),
    );
    expect(result.missing).toContain('mutations');
  });
});

describe('proof-engine — conteúdo semântico dos snapshots do twin', () => {
  test('diff.valid === false invalida o snapshot', () => {
    const result = evaluateDigitalTwin(
      makeContext(),
      makeSnapshotsArtifact([{ stepId: 's1', diff: { valid: false } }]),
    );
    expect(result.status).not.toBe('VALIDATED');
    expect(result.missing).toContain('semantic:snapshot_diff_invalid:s1');
  });

  test('assertion com passed === false invalida o snapshot', () => {
    const result = evaluateDigitalTwin(
      makeContext(),
      makeSnapshotsArtifact([{ stepId: 's1', diff: { valid: true }, assertions: [{ id: 'a1', passed: false }] }]),
    );
    expect(result.missing).toContain('semantic:snapshot_assertions_failed:s1');
  });

  test('mutação indevida presente (unexpectedMutations) invalida o snapshot', () => {
    const violations = validateTwinSnapshotContent(
      { stepId: 's2', diff: { valid: true, unexpectedMutations: ['crm.extra_field'] } },
      0,
    );
    expect(violations).toContain('snapshot_unexpected_mutations:s2(1)');
  });

  test('mutação esperada ausente invalida o snapshot', () => {
    const violations = validateTwinSnapshotContent(
      { stepId: 's3', diff: { valid: true, expectedMutations: ['ticket.status'], observedMutations: [] } },
      0,
    );
    expect(violations).toContain('snapshot_expected_mutations_missing:s3(1)');
  });

  test('snapshot limpo não gera violações', () => {
    expect(validateTwinSnapshotContent({ stepId: 's4', diff: { valid: true } }, 0)).toEqual([]);
  });
});

describe('proof-engine — semanticArtifactViolations', () => {
  const base = { exists: true, path: 'x.json' };

  test('ok === false no payload invalida o artefato', () => {
    expect(semanticArtifactViolations({ ...base, json: { ok: false } })).toContain('ok_false');
  });

  test('status NO_GO no payload invalida o artefato', () => {
    expect(semanticArtifactViolations({ ...base, json: { status: 'NO_GO' } })).toContain('status_no_go');
  });

  test('assertion falha em qualquer profundidade invalida o artefato', () => {
    const json = { flows: [{ assertions: [{ id: 'a', passed: false }] }] };
    expect(semanticArtifactViolations({ ...base, json })).toContain('assertions_failed(1)');
  });

  test('snapshot com valid === false invalida o artefato', () => {
    const json = { snapshots: [{ diff: { valid: false } }] };
    expect(semanticArtifactViolations({ ...base, json })).toContain('snapshot_invalid(1)');
  });

  test('artefato limpo não gera violações', () => {
    const json = { ok: true, status: 'GO', flows: [{ assertions: [{ id: 'a', passed: true }] }] };
    expect(semanticArtifactViolations({ ...base, json })).toEqual([]);
  });

  test('artefato ausente não é tratado aqui (coberto por checagem de existência)', () => {
    expect(semanticArtifactViolations({ exists: false, json: null })).toEqual([]);
  });
});
