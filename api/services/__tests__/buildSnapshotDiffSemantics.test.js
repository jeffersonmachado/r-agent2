'use strict';

/**
 * HARD-021 — semântica de validade do snapshotDiff.
 *
 * Regressão: buildSnapshotDiff marcava `valid = Boolean(changed)`, o que
 * tornava steps read-only/navegação (sem mudança esperada) inválidos
 * (ex.: step_access_support_module / step_wait_ticket_list do
 * support_ticket_flow) e derrubava o Operational Digital Twin no proof
 * engine com `snapshot_diff_invalid`, mesmo sem nenhuma violação real.
 *
 * Semântica correta (FASE 16): um diff é inválido apenas quando viola
 * expectativa — mutação esperada ausente ou mutação indevida observada.
 */

const { buildSnapshotDiff } = require('../qa/operationalStepExecutor');

describe('buildSnapshotDiff — validade semântica (HARD-021)', () => {
  test('step read-only sem mudança (changed=false) deve ser válido', () => {
    const diff = buildSnapshotDiff(
      { id: 'step_access_support_module' },
      { incrementalDiff: { changed: false, diff: { details: [] }, observedMutations: [], mutationCount: 0 } },
    );

    expect(diff.changed).toBe(false);
    expect(diff.valid).toBe(true);
    expect(diff.unexpectedMutations).toEqual([]);
  });

  test('step com mutação esperada e observada deve ser válido', () => {
    const stepId = 'step_submit_checkin';
    const registry = require('../../../qa/contracts/operationalStepRegistry');
    const expected = registry.getExpectedMutationsForStep(stepId);
    expect(expected.length).toBeGreaterThan(0);

    const diff = buildSnapshotDiff(
      { id: stepId },
      { incrementalDiff: { changed: true, diff: { details: [] }, observedMutations: [...expected], mutationCount: expected.length } },
    );

    expect(diff.valid).toBe(true);
    expect(diff.unexpectedMutations).toEqual([]);
  });

  test('step com mutação esperada NÃO observada deve ser inválido', () => {
    const stepId = 'step_submit_checkin';

    const diff = buildSnapshotDiff(
      { id: stepId },
      { incrementalDiff: { changed: false, diff: { details: [] }, observedMutations: [], mutationCount: 0 } },
    );

    expect(diff.valid).toBe(false);
  });

  test('mutação observada fora do contrato (unexpected) deve ser inválida', () => {
    const diff = buildSnapshotDiff(
      { id: 'step_access_support_module' },
      { incrementalDiff: { changed: true, diff: { details: [] }, observedMutations: ['mutation:nao_contratada'], mutationCount: 1 } },
    );

    expect(diff.valid).toBe(false);
    expect(diff.unexpectedMutations).toEqual(['mutation:nao_contratada']);
  });

  test('snapshotDiff explícito é preservado sem recomputar', () => {
    const explicit = { changed: false, valid: false, details: [] };
    const diff = buildSnapshotDiff({ id: 'step_x', snapshotDiff: explicit }, {});
    expect(diff).toBe(explicit);
  });
});
