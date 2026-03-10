'use strict';

const { PlaybookRegistry } = require('../PlaybookRegistry');

describe('PlaybookRegistry', () => {
  test('registra e resolve playbooks por id e sinal', () => {
    const registry = new PlaybookRegistry({
      playbooks: [
        {
          id: 'pb-1',
          triggerSignal: 'followup_overdue',
          name: 'PB 1',
          steps: [{ type: 'notify_operator', title: 'Notificar' }],
        },
      ],
    });

    const byId = registry.getPlaybook('pb-1');
    const bySignal = registry.getPlaybookForSignal('followup_overdue');

    expect(byId).toBeTruthy();
    expect(bySignal).toBeTruthy();
    expect(byId.id).toBe('pb-1');
    expect(bySignal.id).toBe('pb-1');
    expect(Array.isArray(byId.steps)).toBe(true);
    expect(byId.steps[0].id).toBe('step-1');
  });

  test('ignora payload inválido ao registrar', () => {
    const registry = new PlaybookRegistry({ playbooks: [] });

    const out = registry.register({ id: '', triggerSignal: '', steps: [] });

    expect(out.ok).toBe(false);
    expect(registry.listPlaybooks()).toHaveLength(0);
  });
});
