'use strict';

const mockCreateOperationalEvent = jest.fn();
const mockAppendEventV1 = jest.fn();
const mockLoggerDebug = jest.fn();
const mockPublishEventBestEffort = jest.fn();

jest.mock('../CRMEventService', () => ({
  createOperationalEvent: (...args) => mockCreateOperationalEvent(...args),
}));

jest.mock('../../../services/eventLedgerService', () => ({
  appendEventV1: (...args) => mockAppendEventV1(...args),
}));

jest.mock('../../../utils/logger', () => ({
  debug: (...args) => mockLoggerDebug(...args),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../operational-agent/OperationalEventBus', () => ({
  operationalEventBus: {
    publishEventBestEffort: (...args) => mockPublishEventBestEffort(...args),
  },
}));

const { writeOperationalEvent } = require('../OperationalEventWriter');

describe('OperationalEventWriter', () => {
  beforeEach(() => {
    mockCreateOperationalEvent.mockReset();
    mockAppendEventV1.mockReset();
    mockLoggerDebug.mockReset();
    mockPublishEventBestEffort.mockReset();

    mockCreateOperationalEvent.mockResolvedValue({
      ok: true,
      event: {
        id: 'crm-evt-1',
        tenant_key: 'tenant-1',
        contact_id: 'contact-1',
        account_id: null,
        type: 'follow_up_scheduled',
        source_module: 'crm_service',
        reference_type: null,
        reference_id: null,
        actor_type: 'user',
        actor_id: 'u-1',
        payload: { any: true },
        created_at: new Date('2026-03-01T12:00:00.000Z'),
      },
    });
    mockAppendEventV1.mockResolvedValue({ id: 'ledger-1', type: 'CrmOperationalEvent' });
  });

  test('retorna erro quando campos obrigatórios ausentes', async () => {
    const out = await writeOperationalEvent({ tenantId: null, type: null });

    expect(out).toEqual({ ok: false, error: 'missing_required_fields' });
    expect(mockCreateOperationalEvent).not.toHaveBeenCalled();
    expect(mockAppendEventV1).not.toHaveBeenCalled();
  });

  test('grava evento CRM e faz ponte para event_ledger', async () => {
    const out = await writeOperationalEvent({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      type: 'follow_up_scheduled',
      sourceModule: 'crm_service',
      actorType: 'user',
      actorId: 'u-1',
      payload: { any: true },
    });

    expect(mockCreateOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      type: 'follow_up_scheduled',
    }));
    expect(mockAppendEventV1).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      type: 'CrmOperationalEvent',
      subject: { type: 'crm_contact', id: 'contact-1' },
      actor: { type: 'user', id: 'u-1' },
    }));
    expect(out.ok).toBe(true);
    expect(out.ledger).toEqual({ ok: true, id: 'ledger-1', type: 'CrmOperationalEvent' });
    expect(mockPublishEventBestEffort).toHaveBeenCalledTimes(1);
  });

  test('não quebra fluxo quando ponte do ledger falha', async () => {
    mockAppendEventV1.mockRejectedValueOnce(new Error('ledger_down'));

    const out = await writeOperationalEvent({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      type: 'follow_up_scheduled',
    });

    expect(out.ok).toBe(true);
    expect(out.ledger).toEqual({ ok: false, error: 'ledger_down' });
    expect(mockLoggerDebug).toHaveBeenCalled();
  });

  test('normaliza tipo de evento legado para tipo canônico', async () => {
    await writeOperationalEvent({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      type: 'support_ticket_created',
      payload: { any: true },
    });

    expect(mockCreateOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      type: 'ticket_created',
      payload: expect.objectContaining({
        metadata: expect.objectContaining({
          originalEventType: 'support_ticket_created',
        }),
      }),
    }));
  });
});
