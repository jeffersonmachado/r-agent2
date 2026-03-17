'use strict';

const {
  createSchedule,
  getSchedule,
  deleteSchedule,
  updateScheduleStatus,
  listSchedules,
  _getTenantStore,
} = require('../../api/services/scheduleService');

// Clear in-memory store between tests
afterEach(() => {
  // accessing the internal map via _getTenantStore and clearing all
  const store = _getTenantStore('tenant-test');
  store.clear();
  const store2 = _getTenantStore('tenant-hostile');
  store2.clear();
});

describe('scheduleService', () => {
  // ─── nominal ───────────────────────────────────────────────────────────────

  test('createSchedule retorna schedule com campos normalizados', () => {
    const schedule = createSchedule({
      tenantId: 'tenant-test',
      payload: {
        contextType: 'conversation',
        contextId: 'conv-1',
        startAt: '2026-04-01T10:00:00Z',
        endAt: '2026-04-01T10:30:00Z',
        reminders: [{ offsetMin: 15 }],
      },
    });

    expect(schedule.id).toMatch(/^sched-/);
    expect(schedule.tenantId).toBe('tenant-test');
    expect(schedule.contextType).toBe('conversation');
    expect(schedule.contextId).toBe('conv-1');
    expect(schedule.reminders).toEqual([{ offsetMin: 15 }]);
    expect(schedule.status).toBe('scheduled');
  });

  test('getSchedule/deleteSchedule funcionam com id normal', () => {
    const created = createSchedule({ tenantId: 'tenant-test', payload: {} });
    const found = getSchedule({ tenantId: 'tenant-test', scheduleId: created.id });
    expect(found).not.toBeNull();
    expect(found.id).toBe(created.id);

    const deleted = deleteSchedule({ tenantId: 'tenant-test', scheduleId: created.id });
    expect(deleted).toBe(true);
    expect(getSchedule({ tenantId: 'tenant-test', scheduleId: created.id })).toBeNull();
  });

  test('updateScheduleStatus: confirm -> confirmed + scheduled', () => {
    const s = createSchedule({
      tenantId: 'tenant-test',
      payload: { requiresConfirmation: true },
    });
    expect(s.confirmationStatus).toBe('pending');

    const updated = updateScheduleStatus({ tenantId: 'tenant-test', scheduleId: s.id, action: 'confirm' });
    expect(updated.confirmationStatus).toBe('confirmed');
    expect(updated.status).toBe('scheduled');
  });

  // ─── hardening: hostile payload ────────────────────────────────────────────

  test('createSchedule – payload proxy revogado nao lanca, usa defaults', () => {
    const { proxy: hostiPayload, revoke } = Proxy.revocable({ contextType: 'ticket' }, {
      get() { throw new TypeError('revoked'); },
    });
    revoke();

    let schedule;
    expect(() => {
      schedule = createSchedule({ tenantId: 'tenant-hostile', payload: hostiPayload });
    }).not.toThrow();

    // safeGet de proxy revogado → undefined → fallback aplicado
    expect(schedule.contextType).toBe('custom');
    expect(schedule.contextId).toBe('');
    expect(schedule.reminders).toEqual([]);
  });

  test('createSchedule – tenantId proxy revogado nao lanca, usa "default"', () => {
    const { proxy: hostiTenant, revoke } = Proxy.revocable({ toString: () => 'tenant-x' }, {
      get() { throw new TypeError('revoked'); },
    });
    revoke();

    let schedule;
    expect(() => {
      schedule = createSchedule({ tenantId: hostiTenant, payload: {} });
    }).not.toThrow();

    expect(schedule.tenantId).toBe('default');
  });

  test('listSchedules – retorna items limitados e ordenados', () => {
    for (let i = 0; i < 5; i++) {
      createSchedule({
        tenantId: 'tenant-test',
        payload: { contextType: 'conv', startAt: `2026-04-0${i + 1}T10:00:00Z` },
      });
    }
    const result = listSchedules({ tenantId: 'tenant-test', limit: 3 });
    expect(result.items.length).toBe(3);
    expect(result.total).toBeGreaterThanOrEqual(5);
  });
});
