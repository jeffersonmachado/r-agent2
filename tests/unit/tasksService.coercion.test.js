'use strict';

describe('tasksService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function mockSettings(initialTasks = []) {
    let store = { tasks: initialTasks };
    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async () => ({ ok: true, value: store })),
      upsertSetting: jest.fn(async ({ value }) => {
        store = value;
        return { ok: true, value: store };
      }),
    }));
  }

  test('createTask tolera título/descrição/prioridade hostis', async () => {
    mockSettings();
    const { createTask } = require('../../api/services/tasksService');
    const hostile = { toString() { throw new Error('boom-task'); } };

    const out = await createTask('tenant-1', {
      title: hostile,
      description: hostile,
      priority: hostile,
    });

    expect(out).toEqual(expect.objectContaining({ ok: true }));
    expect(out.task.title).toBe('');
    expect(out.task.description).toBe('');
    expect(out.task.priority).toBe('normal');
  });

  test('completeTask tolera taskId hostil e retorna not_found', async () => {
    mockSettings([{ id: 'task-1', title: 'A', status: 'open' }]);
    const { completeTask } = require('../../api/services/tasksService');
    const hostile = { toString() { throw new Error('boom-id'); } };

    const out = await completeTask('tenant-1', hostile);
    expect(out).toEqual({ ok: false, error: 'not_found' });
  });

  test('scheduleReminder tolera taskId hostil e retorna not_found', async () => {
    mockSettings([{ id: 'task-1', title: 'A', status: 'open' }]);
    const { scheduleReminder } = require('../../api/services/tasksService');
    const hostile = { toString() { throw new Error('boom-id'); } };

    const out = await scheduleReminder('tenant-1', hostile, '2026-03-18T10:00:00.000Z');
    expect(out).toEqual({ ok: false, error: 'not_found' });
  });
});
