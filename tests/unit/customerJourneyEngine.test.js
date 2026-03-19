'use strict';

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => ({})),
}));

jest.mock('../../api/db/models', () => ({
  VerticalJourneyEvent: jest.fn(() => mockVerticalJourneyEvent),
}));

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: jest.fn(async () => ({ id: 'ledger-1' })),
}));

const mockVerticalJourneyEvent = {
  findOne: jest.fn(),
  create: jest.fn(),
  findAll: jest.fn(),
};

const { appendEventV1 } = require('../../api/services/eventLedgerService');
const { getSequelize } = require('../../api/db/sequelize');
const { VerticalJourneyEvent: mockVerticalJourneyEventFactory } = require('../../api/db/models');
const {
  emitJourneyEvent,
  listJourneyEvents,
  getSubjectTimeline,
} = require('../../api/services/vertical/customerJourneyEngine');

const BASE_PARAMS = {
  tenantId: 'tenant-a',
  vertical: 'beauty',
  eventType: 'confirmation_sent',
  subjectId: 'sub-1',
  customerId: 'cust-1',
  membershipId: 'mem-1',
  channel: 'whatsapp',
  triggeredBy: 'scheduler',
  correlationId: 'corr-1',
  idempotencyKey: 'idem-key-1',
  payload: { message: 'test' },
};

describe('customerJourneyEngine', () => {
  beforeEach(() => {
    // resetMocks: true wipes all implementations — restore them here
    jest.clearAllMocks();
    getSequelize.mockReturnValue({});
    mockVerticalJourneyEventFactory.mockReturnValue(mockVerticalJourneyEvent);
    appendEventV1.mockResolvedValue({ id: 'ledger-1' });
    mockVerticalJourneyEvent.findOne.mockResolvedValue(null);
    mockVerticalJourneyEvent.create.mockImplementation(async (data) => ({ ...data, id: 'vje-1' }));
    mockVerticalJourneyEvent.findAll.mockResolvedValue([]);
  });

  describe('emitJourneyEvent', () => {
    it('cria evento e escreve no event_ledger', async () => {
      const result = await emitJourneyEvent(BASE_PARAMS);

      expect(mockVerticalJourneyEvent.create).toHaveBeenCalledTimes(1);
      const created = mockVerticalJourneyEvent.create.mock.calls[0][0];
      expect(created.tenant_key).toBe('tenant-a');
      expect(created.vertical).toBe('beauty');
      expect(created.event_type).toBe('confirmation_sent');
      expect(created.idempotency_key).toBe('idem-key-1');
      expect(appendEventV1).toHaveBeenCalledTimes(1);
    });

    it('retorna evento existente (idempotência) sem criar duplicata', async () => {
      const existing = { id: 'vje-existing', idempotency_key: 'idem-key-1', event_type: 'confirmation_sent' };
      mockVerticalJourneyEvent.findOne.mockResolvedValueOnce(existing);

      const result = await emitJourneyEvent(BASE_PARAMS);

      expect(mockVerticalJourneyEvent.create).not.toHaveBeenCalled();
      expect(appendEventV1).not.toHaveBeenCalled();
      expect(result.id).toBe('vje-existing');
    });

    it('rejeita eventType inválido', async () => {
      await expect(emitJourneyEvent({ ...BASE_PARAMS, eventType: 'invalid_event_type' }))
        .rejects.toMatchObject({ code: 'invalid_event_type' });
    });

    it('rejeita chamada sem tenantId', async () => {
      await expect(emitJourneyEvent({ ...BASE_PARAMS, tenantId: '' }))
        .rejects.toBeDefined();
    });

    it('faz fallback in-memory quando DB indisponível', async () => {
      const { getSequelize } = require('../../api/db/sequelize');
      getSequelize.mockReturnValueOnce(null);

      const result = await emitJourneyEvent({ ...BASE_PARAMS, idempotencyKey: 'idem-key-no-db' });
      expect(result).toBeDefined();
      expect(result.event_type).toBe('confirmation_sent');
      // No DB = no ledger write
      expect(appendEventV1).not.toHaveBeenCalled();
    });

    it('isolação multi-tenant: não reutiliza idempotencyKey de outro tenant', async () => {
      await emitJourneyEvent({ ...BASE_PARAMS, tenantId: 'tenant-b', idempotencyKey: 'idem-key-1' });

      expect(mockVerticalJourneyEvent.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenant_key: 'tenant-b' }) }),
      );
    });
  });

  describe('listJourneyEvents', () => {
    it('lista eventos por tenant e vertical', async () => {
      const rows = [
        { id: 'vje-1', tenant_key: 'tenant-a', vertical: 'beauty', event_type: 'confirmation_sent' },
      ];
      mockVerticalJourneyEvent.findAll.mockResolvedValueOnce(rows);

      const result = await listJourneyEvents({ tenantId: 'tenant-a', vertical: 'beauty' });
      expect(result.items).toHaveLength(1);
      expect(mockVerticalJourneyEvent.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenant_key: 'tenant-a', vertical: 'beauty' }) }),
      );
    });

    it('retorna array vazio quando DB indisponível', async () => {
      const { getSequelize } = require('../../api/db/sequelize');
      getSequelize.mockReturnValueOnce(null);

      const result = await listJourneyEvents({ tenantId: 'tenant-a', vertical: 'beauty' });
      expect(result.items).toEqual([]);
    });

    it('filtra por subjectId e eventType quando fornecidos', async () => {
      mockVerticalJourneyEvent.findAll.mockResolvedValueOnce([]);

      await listJourneyEvents({ tenantId: 'tenant-a', vertical: 'fitness', subjectId: 'sub-1', eventType: 'welcome_sent' });

      const callArgs = mockVerticalJourneyEvent.findAll.mock.calls[0][0];
      expect(callArgs.where).toMatchObject({ subject_id: 'sub-1', event_type: 'welcome_sent' });
    });
  });

  describe('getSubjectTimeline', () => {
    it('retorna timeline ordenada do subject', async () => {
      const rows = [
        { id: 'vje-1', tenantKey: 'tenant-a', event_type: 'confirmation_sent', occurred_at: new Date() },
        { id: 'vje-2', tenantKey: 'tenant-a', event_type: 'no_show_detected', occurred_at: new Date() },
      ];
      mockVerticalJourneyEvent.findAll.mockResolvedValueOnce(rows);

      const result = await getSubjectTimeline({ tenantId: 'tenant-a', subjectId: 'sub-1' });
      expect(result.items).toHaveLength(2);
    });
  });
});
