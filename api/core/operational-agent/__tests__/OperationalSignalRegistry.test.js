'use strict';

jest.mock('../../operational-state', () => ({
  signalStateStoreV2: {
    upsertSignals: jest.fn(),
    listSignals: jest.fn(),
  },
}));

const { signalStateStoreV2 } = require('../../operational-state');
const registry = require('../OperationalSignalRegistry');

describe('OperationalSignalRegistry', () => {
  let storeByTenant;

  beforeEach(() => {
    jest.clearAllMocks();
    storeByTenant = new Map();

    signalStateStoreV2.listSignals.mockImplementation(async ({ tenantId, contactId = null, statuses = null, activeOnly = false, limit = 200 }) => {
      const tenantKey = String(tenantId);
      const allItems = Array.isArray(storeByTenant.get(tenantKey)) ? storeByTenant.get(tenantKey) : [];

      const filtered = allItems.filter((item) => {
        if (String(item.tenant_id) !== tenantKey) return false;
        if (contactId && String(item.contact_id || '') !== String(contactId)) return false;
        if (activeOnly) {
          return item.status === 'open' || item.status === 'acknowledged';
        }
        if (Array.isArray(statuses) && statuses.length > 0) {
          return statuses.includes(item.status);
        }
        return true;
      });

      return {
        ok: true,
        items: filtered.slice(0, Math.max(1, Number(limit) || 200)),
        total: filtered.length,
        limit: Math.max(1, Number(limit) || 200),
      };
    });

    signalStateStoreV2.upsertSignals.mockImplementation(async ({ tenantId, items = [] }) => {
      const tenantKey = String(tenantId);
      const current = Array.isArray(storeByTenant.get(tenantKey)) ? [...storeByTenant.get(tenantKey)] : [];

      for (const next of items) {
        const index = current.findIndex((item) => String(item.id) === String(next.id));
        if (index >= 0) {
          current[index] = { ...current[index], ...next };
        } else {
          current.push(next);
        }
      }

      storeByTenant.set(tenantKey, current);
      return { ok: true, upserted: items.length };
    });
  });

  test('deduplica sinais equivalentes dentro da janela e faz merge de severidade', async () => {
    const first = await registry.upsertDetectedSignals({
      tenantId: 'tenant-1',
      signals: [{
        type: 'support_backlog_risk',
        contactId: 'contact-1',
        severity: 'medium',
        confidence: 0.5,
        sourceModule: 'queue_service',
      }],
      dedupWindowMinutes: 240,
    });

    expect(first.ok).toBe(true);
    expect(first.opened).toHaveLength(1);
    expect(first.merged).toHaveLength(0);

    const second = await registry.upsertDetectedSignals({
      tenantId: 'tenant-1',
      signals: [{
        type: 'support_backlog_risk',
        contactId: 'contact-1',
        severity: 'high',
        confidence: 0.9,
        sourceModule: 'queue_service',
      }],
      dedupWindowMinutes: 240,
    });

    expect(second.ok).toBe(true);
    expect(second.opened).toHaveLength(0);
    expect(second.merged).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].severity).toBe('high');
    expect(second.items[0].confidence).toBe(0.9);
  });

  test('lista sinais ativos e atualiza status para resolvido', async () => {
    const upsert = await registry.upsertDetectedSignals({
      tenantId: 'tenant-1',
      signals: [
        { type: 'followup_overdue', contactId: 'contact-1', severity: 'high', confidence: 0.8 },
        { type: 'customer_reactivation', contactId: 'contact-2', severity: 'medium', confidence: 0.7 },
      ],
    });

    const firstSignalId = upsert.items[0].id;
    const updated = await registry.updateSignalStatus({
      tenantId: 'tenant-1',
      signalId: firstSignalId,
      status: 'resolved',
    });

    expect(updated.ok).toBe(true);
    expect(updated.item.status).toBe('resolved');
    expect(updated.item.resolved_at).toBeTruthy();

    const active = await registry.listSignals({ tenantId: 'tenant-1', activeOnly: true, limit: 50 });
    expect(active.ok).toBe(true);
    expect(active.items).toHaveLength(1);
    expect(active.items[0].status).toBe('open');
  });
});
