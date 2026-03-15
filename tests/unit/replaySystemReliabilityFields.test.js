'use strict';

const { ReplaySystem } = require('../../lib/replaySystem');

describe('ReplaySystem reliability fields', () => {
  test('persiste campos enriquecidos vindos de result', async () => {
    const replay = new ReplaySystem({
      enableScreenshots: false,
      enableActions: true,
      enableTimings: true,
      context: 'rpa',
    });

    replay.start('replay-reliability-result');

    await replay.recordAction(
      {
        type: 'click',
        selector: '.submit',
        metadata: { step: 'step-1' },
      },
      {
        success: false,
        error: 'selector not found',
        classification: { type: 'SELECTOR_NOT_FOUND', severity: 'HIGH' },
        owner: 'AUTOMATION',
        recoveryPlan: { strategySequence: ['REPAIR_SELECTOR', 'RETRY_STEP'] },
        strategiesAttempted: ['REPAIR_SELECTOR'],
        selectorRepairCandidates: ['[data-testid="submit"]'],
        finalDecision: 'FAIL_AUTOMATION_BUG',
        severity: 'HIGH',
        evidenceArtifacts: { jsonPath: 'tests/rpa/reports/bugs/example.json' },
      },
    );

    const action = replay.replayData.actions[0];
    expect(action).toEqual(
      expect.objectContaining({
        classification: expect.objectContaining({ type: 'SELECTOR_NOT_FOUND' }),
        owner: 'AUTOMATION',
        recoveryPlan: expect.objectContaining({ strategySequence: ['REPAIR_SELECTOR', 'RETRY_STEP'] }),
        strategiesAttempted: ['REPAIR_SELECTOR'],
        selectorRepairCandidates: ['[data-testid="submit"]'],
        finalDecision: 'FAIL_AUTOMATION_BUG',
        severity: 'HIGH',
        evidenceArtifacts: expect.objectContaining({ jsonPath: 'tests/rpa/reports/bugs/example.json' }),
      }),
    );
  });

  test('usa fallback de metadata quando result nao fornece campos enriquecidos', async () => {
    const replay = new ReplaySystem({
      enableScreenshots: false,
      enableActions: true,
      enableTimings: true,
      context: 'rpa',
    });

    replay.start('replay-reliability-metadata');

    await replay.recordAction(
      {
        type: 'assert',
        selector: 'body',
        metadata: {
          step: 'step-2',
          classification: { type: 'ASSERTION_FAILED', severity: 'MEDIUM' },
          owner: 'APPLICATION',
          recoveryPlan: { strategySequence: ['RETRY_STEP'] },
          strategiesAttempted: ['RETRY_STEP'],
          selectorRepairCandidates: [],
          finalDecision: 'FAIL_APPLICATION_BUG',
          severity: 'MEDIUM',
          evidenceArtifacts: { markdownPath: 'tests/rpa/reports/bugs/example.md' },
        },
      },
      {
        success: false,
        error: 'text mismatch',
      },
    );

    const action = replay.replayData.actions[0];
    expect(action).toEqual(
      expect.objectContaining({
        classification: expect.objectContaining({ type: 'ASSERTION_FAILED' }),
        owner: 'APPLICATION',
        recoveryPlan: expect.objectContaining({ strategySequence: ['RETRY_STEP'] }),
        strategiesAttempted: ['RETRY_STEP'],
        selectorRepairCandidates: [],
        finalDecision: 'FAIL_APPLICATION_BUG',
        severity: 'MEDIUM',
        evidenceArtifacts: expect.objectContaining({ markdownPath: 'tests/rpa/reports/bugs/example.md' }),
      }),
    );
  });
});
