'use strict';

/**
 * HARD-023 — Regressão dos gaps de prova semântica do platform-readiness:
 *
 * 1. step_confirm_membership_payment observava mutação (payment_status_changed)
 *    mas zero side effects → blocker post_state_mutation_without_side_effect.
 *    Causa: CANONICAL_SIDE_EFFECT_RULES não tinha regra de notification_sent
 *    para esse step, embora o webhook de confirmação incremente
 *    events.notifications.count/sent (recibo ao membro).
 *
 * 2. Steps de asserção (step_assert_ticket_ui) declaram expectedMutations
 *    cumulativas da jornada no snapshotDiff, mas o twin materializado não
 *    carregava observedMutations → snapshot_expected_mutations_missing.
 *    O materializador agora preenche observedMutations com as observações
 *    REAIS acumuladas dos steps anteriores da mesma jornada.
 */

const {
  deriveObservedSideEffects,
  deriveObservedMutations,
} = require('../../../qa/evidence/postStateProofValidator');
const { getOperationalStepContract } = require('../../../qa/contracts/operationalStepRegistry');
const { buildDigitalTwinSnapshots } = require('../../../governance/materialize-proof-artifacts');

describe('HARD-023 — side effect notification_sent no confirm_payment', () => {
  test('regra canônica deriva notification_sent do diff incremental', () => {
    const diff = {
      changed: true,
      details: [
        { field: 'state', before: 'payment_created', after: 'payment_confirmed' },
        { field: 'db.billing.status', before: 'pending', after: 'confirmed' },
        { field: 'events.notifications.count', before: 1, after: 2 },
        { field: 'events.notifications.sent', before: 1, after: 2 },
      ],
    };
    const sideEffects = deriveObservedSideEffects(diff, { id: 'step_confirm_membership_payment' });
    expect(sideEffects).toContain('notification_sent');

    const mutations = deriveObservedMutations(diff, { id: 'step_confirm_membership_payment' });
    expect(mutations).toContain('payment_status_changed');
  });

  test('contrato do registry declara notification_sent como side effect esperado', () => {
    const contract = getOperationalStepContract('step_confirm_membership_payment');
    expect(contract).toBeTruthy();
    expect(contract.expectedSideEffects).toContain('notification_sent');
  });

  test('sem incremento de notificação, side effect NÃO é derivado (fail-closed)', () => {
    const diff = {
      changed: true,
      details: [
        { field: 'db.billing.status', before: 'pending', after: 'confirmed' },
      ],
    };
    const sideEffects = deriveObservedSideEffects(diff, { id: 'step_confirm_membership_payment' });
    expect(sideEffects).not.toContain('notification_sent');
  });
});

describe('HARD-023 — digital twin com observação cumulativa da jornada', () => {
  const finalSmoke = {
    flows: [
      {
        journeyId: 'support_ticket_flow',
        browserResult: {
          steps: [
            {
              id: 'step_takeover_ticket',
              observedMutations: ['ticket_status_changed'],
              observedSideEffects: ['audit_log_created'],
              snapshotDiff: { changed: true, valid: true, details: [] },
            },
            {
              id: 'step_reply_ticket',
              observedMutations: ['message_created'],
              observedSideEffects: ['audit_log_created'],
              snapshotDiff: { changed: true, valid: true, details: [] },
            },
            {
              id: 'step_assert_ticket_ui',
              observedMutations: [],
              observedSideEffects: [],
              snapshotDiff: {
                expectedMutations: ['ticket_status_changed', 'message_created'],
                expectedSideEffects: ['audit_log_created'],
              },
            },
          ],
        },
      },
    ],
  };

  test('assert step recebe observedMutations cumulativas REAIS dos steps anteriores', () => {
    const snapshots = buildDigitalTwinSnapshots(finalSmoke);
    const assertSnapshot = snapshots.find((s) => s.stepId === 'step_assert_ticket_ui');
    expect(assertSnapshot).toBeTruthy();
    expect(assertSnapshot.diff.observedMutations).toEqual(
      expect.arrayContaining(['ticket_status_changed', 'message_created']),
    );
    expect(assertSnapshot.diff.observedSideEffects).toContain('audit_log_created');
    expect(assertSnapshot.diff.cumulativeObservation).toBe(true);
  });

  test('expectativa cumulativa NÃO satisfeita permanece descoberta (fail-closed)', () => {
    const broken = JSON.parse(JSON.stringify(finalSmoke));
    broken.flows[0].browserResult.steps[2].snapshotDiff.expectedMutations.push('payment_created');
    const snapshots = buildDigitalTwinSnapshots(broken);
    const assertSnapshot = snapshots.find((s) => s.stepId === 'step_assert_ticket_ui');
    expect(assertSnapshot.diff.observedMutations).not.toContain('payment_created');
  });

  test('steps replicados (browserResult/stepResults/replay) são deduplicados', () => {
    const replicated = JSON.parse(JSON.stringify(finalSmoke));
    replicated.flows[0].replay = { steps: replicated.flows[0].browserResult.steps };
    const snapshots = buildDigitalTwinSnapshots(replicated);
    const assertSnapshots = snapshots.filter((s) => s.stepId === 'step_assert_ticket_ui');
    expect(assertSnapshots).toHaveLength(1);
  });
});
