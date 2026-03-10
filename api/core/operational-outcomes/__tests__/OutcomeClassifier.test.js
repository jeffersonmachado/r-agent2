'use strict';

const { OutcomeClassifier } = require('../OutcomeClassifier');

describe('OutcomeClassifier', () => {
  test('classifica playbook concluído como sucesso', () => {
    const classifier = new OutcomeClassifier();
    const out = classifier.classifyEvent({ type: 'operational_playbook_completed' });

    expect(out).toMatchObject({
      shouldRecord: true,
      outcomeType: 'playbook_completed',
      status: 'success',
    });
    expect(out.outcomeScore).toBeGreaterThan(0.8);
  });

  test('classifica resolução manual de sinal', () => {
    const classifier = new OutcomeClassifier();
    const out = classifier.classifyEvent({ type: 'operational_signal_resolved' });

    expect(out).toMatchObject({
      shouldRecord: true,
      outcomeType: 'manual_resolution',
      status: 'success',
    });
  });

  test('ignora quick action já rastreada para evitar duplicidade', () => {
    const classifier = new OutcomeClassifier();
    const out = classifier.classifyEvent({
      type: 'operational_quick_action_executed',
      payload: { outcomeTracked: true },
    });

    expect(out).toMatchObject({
      shouldRecord: false,
      reason: 'already_tracked',
    });
  });

  test('classifica recuperação de receita por padrão de evento', () => {
    const classifier = new OutcomeClassifier();
    const out = classifier.classifyEvent({ type: 'revenue_recovered_after_campaign' });

    expect(out).toMatchObject({
      shouldRecord: true,
      outcomeType: 'revenue_recovered',
      status: 'success',
    });
  });

  test('não classifica eventos não mapeados', () => {
    const classifier = new OutcomeClassifier();
    const out = classifier.classifyEvent({ type: 'unknown_event' });

    expect(out).toEqual({
      shouldRecord: false,
      reason: 'event_not_mapped',
    });
  });
});
