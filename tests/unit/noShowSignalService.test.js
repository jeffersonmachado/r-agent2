'use strict';

/**
 * Vertical Beauty → Workspace: sinal de no-show por telefone
 * (noShowSignalService). Models mockados em memória.
 */

const { Op } = require('sequelize');

function buildSubjectModel(store) {
  return {
    findAll: jest.fn(async ({ where } = {}) => store.filter((item) => {
      if (where?.tenant_key && item.tenant_key !== where.tenant_key) return false;
      const profiles = where?.vertical_profile?.[Op.in];
      if (profiles && !profiles.includes(item.vertical_profile)) return false;
      return true;
    })),
  };
}

function buildEventModel(store) {
  return {
    findAll: jest.fn(async ({ where } = {}) => store
      .filter((item) => {
        if (where?.tenant_key && item.tenant_key !== where.tenant_key) return false;
        if (where?.vertical && item.vertical !== where.vertical) return false;
        if (where?.event_type && item.event_type !== where.event_type) return false;
        const subjectIds = where?.subject_id?.[Op.in];
        if (subjectIds && !subjectIds.includes(item.subject_id)) return false;
        const since = where?.occurred_at?.[Op.gte];
        if (since && new Date(item.occurred_at).getTime() < since.getTime()) return false;
        return true;
      })
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))),
  };
}

function loadService({ subjects = [], events = [] } = {}) {
  jest.resetModules();
  jest.doMock('../../api/db/models', () => ({
    AccessSubject: () => buildSubjectModel(subjects),
    VerticalJourneyEvent: () => buildEventModel(events),
  }));
  // eslint-disable-next-line global-require
  const service = require('../../api/services/vertical/noShowSignalService');
  return { service, subjects, events };
}

const beautySubject = {
  id: 'subj-1',
  tenant_key: 'tenant-a',
  vertical_profile: 'beauty',
  metadata: { name: 'Maria', phone: '+55 (11) 99888-7766' },
};

const noShowEvent = {
  tenant_key: 'tenant-a',
  vertical: 'beauty',
  event_type: 'no_show_detected',
  subject_id: 'subj-1',
  schedule_id: 'sched-1',
  occurred_at: new Date(Date.now() - 2 * 864e5).toISOString(),
  payload: { triggeredBy: 'scheduler' },
};

describe('noShowSignalService.recentNoShowsByPhone', () => {
  test('telefone formatado casa com subject e retorna faltas recentes', async () => {
    const { service } = loadService({ subjects: [beautySubject], events: [noShowEvent] });
    const out = await service.recentNoShowsByPhone({ tenantId: 'tenant-a', phone: '5511998887766' });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ scheduleId: 'sched-1', subjectId: 'subj-1' });
  });

  test('telefone sem subject correspondente retorna vazio', async () => {
    const { service } = loadService({ subjects: [beautySubject], events: [noShowEvent] });
    const out = await service.recentNoShowsByPhone({ tenantId: 'tenant-a', phone: '5511900000000' });
    expect(out).toEqual([]);
  });

  test('eventos de outro tipo/vertical não entram', async () => {
    const events = [
      noShowEvent,
      { ...noShowEvent, schedule_id: 'sched-2', event_type: 'confirmation_sent' },
      { ...noShowEvent, schedule_id: 'sched-3', vertical: 'fitness' },
      { ...noShowEvent, schedule_id: 'sched-4', subject_id: 'subj-outro' },
    ];
    const { service } = loadService({ subjects: [beautySubject], events });
    const out = await service.recentNoShowsByPhone({ tenantId: 'tenant-a', phone: '5511998887766' });

    expect(out).toHaveLength(1);
    expect(out[0].scheduleId).toBe('sched-1');
  });

  test('falta mais antiga que o lookback (45d) não entra', async () => {
    const old = { ...noShowEvent, occurred_at: new Date(Date.now() - 60 * 864e5).toISOString() };
    const { service } = loadService({ subjects: [beautySubject], events: [old] });
    const out = await service.recentNoShowsByPhone({ tenantId: 'tenant-a', phone: '5511998887766' });
    expect(out).toEqual([]);
  });

  test('tenant diferente não vê faltas (isolamento)', async () => {
    const { service } = loadService({ subjects: [beautySubject], events: [noShowEvent] });
    const out = await service.recentNoShowsByPhone({ tenantId: 'tenant-b', phone: '5511998887766' });
    expect(out).toEqual([]);
  });

  test('mais recente primeiro', async () => {
    const events = [
      { ...noShowEvent, schedule_id: 'sched-antigo', occurred_at: new Date(Date.now() - 10 * 864e5).toISOString() },
      { ...noShowEvent, schedule_id: 'sched-recente', occurred_at: new Date(Date.now() - 1 * 864e5).toISOString() },
    ];
    const { service } = loadService({ subjects: [beautySubject], events });
    const out = await service.recentNoShowsByPhone({ tenantId: 'tenant-a', phone: '5511998887766' });

    expect(out.map((e) => e.scheduleId)).toEqual(['sched-recente', 'sched-antigo']);
  });
});
