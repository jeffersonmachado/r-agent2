'use strict';

jest.mock('../../operational-state', () => ({
  signalStateStoreV2: {
    upsertSignals: jest.fn(),
    listSignals: jest.fn(),
  },
}));

jest.mock('../../../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { signalStateStoreV2 } = require('../../operational-state');
const registry = require('../OperationalSignalRegistry');

function createSignalFixture(id, tenantId) {
  const now = new Date().toISOString();
  return {
    id,
    tenant_id: tenantId,
    contact_id: null,
    type: 'channel_attention',
    status: 'open',
    severity: 'medium',
    confidence: 0.7,
    source_module: 'operational_agent',
    context_json: {},
    detected_at: now,
    resolved_at: null,
    created_at: now,
    updated_at: now,
  };
}

describe('OperationalSignalRegistry v2 integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    signalStateStoreV2.upsertSignals.mockResolvedValue({ ok: true, upserted: 0 });
    signalStateStoreV2.listSignals.mockResolvedValue({ ok: true, items: [], total: 0, limit: 200 });
  });

  test('upsertDetectedSignals persiste no estado v2', async () => {
    signalStateStoreV2.listSignals
      .mockResolvedValueOnce({ ok: true, items: [], total: 0, limit: 1000 })
      .mockResolvedValueOnce({ ok: true, items: [createSignalFixture('sig-1', 'tenant-1')], total: 1, limit: 1000 });

    const out = await registry.upsertDetectedSignals({
      tenantId: 'tenant-1',
      signals: [createSignalFixture('sig-1', 'tenant-1')],
    });

    expect(out.ok).toBe(true);
    expect(signalStateStoreV2.upsertSignals).toHaveBeenCalledTimes(1);
    expect(signalStateStoreV2.upsertSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        items: expect.arrayContaining([
          expect.objectContaining({ id: 'sig-1', tenant_id: 'tenant-1' }),
        ]),
      }),
    );
  });

  test('listSignals retorna dados diretamente do estado v2', async () => {
    signalStateStoreV2.listSignals.mockResolvedValue({
      ok: true,
      items: [createSignalFixture('sig-v2-1', 'tenant-1')],
      total: 1,
      limit: 200,
    });

    const out = await registry.listSignals({ tenantId: 'tenant-1', activeOnly: false, limit: 200 });

    expect(out.ok).toBe(true);
    expect(out.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'sig-v2-1' })]));
    expect(signalStateStoreV2.listSignals).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contactId: null,
      statuses: null,
      activeOnly: false,
      limit: 200,
    });
  });

  test('updateSignalStatus atualiza status no estado v2', async () => {
    const existing = createSignalFixture('sig-2', 'tenant-1');
    signalStateStoreV2.listSignals.mockResolvedValue({ ok: true, items: [existing], total: 1, limit: 1000 });

    const out = await registry.updateSignalStatus({
      tenantId: 'tenant-1',
      signalId: 'sig-2',
      status: 'resolved',
    });

    expect(out.ok).toBe(true);
    expect(out.item).toEqual(expect.objectContaining({ id: 'sig-2', status: 'resolved' }));
    expect(signalStateStoreV2.upsertSignals).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      items: [expect.objectContaining({ id: 'sig-2', status: 'resolved' })],
    });
  });
});
