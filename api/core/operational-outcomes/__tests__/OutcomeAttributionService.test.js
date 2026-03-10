'use strict';

const { OutcomeAttributionService } = require('../OutcomeAttributionService');

describe('OutcomeAttributionService', () => {
  test('resolve vínculos a partir de referenceType de sinal', () => {
    const service = new OutcomeAttributionService();
    const out = service.resolveFromEvent({
      type: 'operational_signal_resolved',
      referenceType: 'operational_signal',
      referenceId: 'sig-1',
      contactId: 'contact-1',
    });

    expect(out).toMatchObject({
      contactId: 'contact-1',
      signalId: 'sig-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
    });
  });

  test('prioriza playbook quando evento aponta execução de playbook', () => {
    const service = new OutcomeAttributionService();
    const out = service.resolveFromEvent({
      type: 'operational_playbook_completed',
      referenceType: 'playbook_run',
      referenceId: 'run-9',
      payload: {
        signalId: 'sig-9',
        recommendationId: 'rec-9',
      },
    });

    expect(out).toMatchObject({
      playbookExecutionId: 'run-9',
      signalId: 'sig-9',
      recommendationId: 'rec-9',
      sourceType: 'playbook',
      sourceId: 'run-9',
    });
  });

  test('usa recommendation como source quando não há playbook', () => {
    const service = new OutcomeAttributionService();
    const out = service.resolveFromEvent({
      type: 'booking_created',
      payload: {
        recommendationId: 'rec-2',
        actionId: 'schedule_callback',
      },
    });

    expect(out).toMatchObject({
      recommendationId: 'rec-2',
      sourceType: 'recommendation',
      sourceId: 'rec-2',
      actionType: 'schedule_callback',
    });
  });
});
