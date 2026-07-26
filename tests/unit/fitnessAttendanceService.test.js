'use strict';
'use strict';

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => ({})),
}));

jest.mock('../../api/db/models', () => ({
  VerticalAttendance: jest.fn(() => mockVerticalAttendance),
}));

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: jest.fn(async () => ({ id: 'ledger-1' })),
}));

jest.mock('../../api/services/vertical/customerJourneyEngine', () => {
  const actual = jest.requireActual('../../api/services/vertical/customerJourneyEngine');
  return {
    ...actual,
    emitJourneyEvent: jest.fn(async () => ({ id: 'vje-1' })),
  };
});

const mockVerticalAttendance = {
  create: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  findAll: jest.fn(),
};

// Hold references to mock functions so beforeEach can restore them after resetMocks
const { getSequelize } = require('../../api/db/sequelize');
const { VerticalAttendance: mockVerticalAttendanceFactory } = require('../../api/db/models');
const { appendEventV1 } = require('../../api/services/eventLedgerService');
const { emitJourneyEvent } = require('../../api/services/vertical/customerJourneyEngine');
const {
  recordCheckIn,
  recordCheckOut,
  markAbsent,
  getAttendanceHistory,
  listOpenAttendances,
} = require('../../api/services/vertical/fitnessAttendanceService');

describe('fitnessAttendanceService', () => {
  const tenantId = 'tenant-a';
  const subjectId = 'sub-1';

  beforeEach(() => {
    // jest.config.cjs has resetMocks: true - restore all implementations after every reset
    getSequelize.mockReturnValue({});
    mockVerticalAttendanceFactory.mockReturnValue(mockVerticalAttendance);
    appendEventV1.mockResolvedValue({ id: 'ledger-1' });
    mockVerticalAttendance.create.mockImplementation(async (data) => ({ ...data, id: 'va-1' }));
    mockVerticalAttendance.findOne.mockResolvedValue(null);
    mockVerticalAttendance.findAll.mockResolvedValue([]);
  });

  describe('recordCheckIn', () => {
    it('cria VerticalAttendance com status open', async () => {
      const result = await recordCheckIn({
        tenantId,
        subjectId,
        membershipId: 'mem-1',
        accessDecisionId: 'decision-1',
        unitId: 'unit-a',
        deviceId: 'dev-1',
      });

      expect(mockVerticalAttendance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_key: tenantId,
          subject_id: subjectId,
          status: 'open',
          access_decision_id: 'decision-1',
        }),
      );
      expect(appendEventV1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'FitnessCheckIn' }),
      );
    });

    it('funciona sem DB usando fallback in-memory', async () => {
      getSequelize.mockReturnValueOnce(null); // override for this test only

      const result = await recordCheckIn({ tenantId, subjectId });
      expect(result).toBeDefined();
      expect(result.status).toBe('open');
      expect(mockVerticalAttendance.create).not.toHaveBeenCalled();
    });

    it('usa idempotencyKey baseada em accessDecisionId', async () => {
      await recordCheckIn({ tenantId, subjectId, accessDecisionId: 'decision-42' });

      expect(appendEventV1).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'checkin:decision-42',
        }),
      );
    });

    it('emite evento de timeline checkin_recorded (regressão: timeline vazia no smoke prod-like)', async () => {
      await recordCheckIn({
        tenantId,
        subjectId,
        membershipId: 'mem-1',
        accessDecisionId: 'decision-1',
        deviceId: 'dev-1',
      });

      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          vertical: 'fitness',
          eventType: 'checkin_recorded',
          subjectId,
          membershipId: 'mem-1',
          triggeredBy: 'event',
          idempotencyKey: 'checkin:decision-1',
        }),
      );
    });

    it('falha na timeline não impede o check-in, mas o erro é logado', async () => {
      emitJourneyEvent.mockRejectedValueOnce(new Error('timeline_down'));

      const result = await recordCheckIn({ tenantId, subjectId, accessDecisionId: 'decision-1' });

      expect(result).toBeDefined();
      expect(result.status).toBe('open');
    });
  });

  describe('recordCheckOut', () => {
    it('fecha attendance aberta do subject', async () => {
      const openAttendance = {
        id: 'va-1',
        subject_id: subjectId,
        status: 'open',
        checked_in_at: new Date(Date.now() - 3600000), // 1h ago
        update: jest.fn(async (data) => ({ ...openAttendance, ...data })),
      };
      mockVerticalAttendance.findOne.mockResolvedValueOnce(openAttendance);

      const result = await recordCheckOut({ tenantId, subjectId });

      expect(openAttendance.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
      );
      expect(appendEventV1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'FitnessCheckOut' }),
      );
    });

    it('retorna null quando não há attendance aberta', async () => {
      mockVerticalAttendance.findOne.mockResolvedValueOnce(null);

      const result = await recordCheckOut({ tenantId, subjectId });
      expect(result).toBeNull();
    });

    it('retorna null quando DB indisponível', async () => {
      getSequelize.mockReturnValueOnce(null); // override for this test only

      const result = await recordCheckOut({ tenantId, subjectId });
      expect(result).toBeNull();
    });

    it('emite evento de timeline checkout_recorded ao fechar attendance', async () => {
      const openAttendance = {
        id: 'va-9',
        subject_id: subjectId,
        status: 'open',
        checked_in_at: new Date(Date.now() - 3600000),
        update: jest.fn(async (data) => ({ ...openAttendance, ...data })),
      };
      mockVerticalAttendance.findOne.mockResolvedValueOnce(openAttendance);

      await recordCheckOut({ tenantId, subjectId, accessDecisionId: 'decision-9' });

      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          vertical: 'fitness',
          eventType: 'checkout_recorded',
          subjectId,
          triggeredBy: 'event',
          idempotencyKey: 'checkout:decision-9',
        }),
      );
    });
  });

  describe('markAbsent', () => {
    it('atualiza attendance existente para status absent', async () => {
      const rowMock = {
        id: 'va-1', status: 'open', tenant_key: tenantId, metadata: {},
        update: jest.fn(async (data) => ({ ...rowMock, ...data })),
        toJSON: function() { return { ...this, update: undefined, toJSON: undefined }; },
      };
      mockVerticalAttendance.findOne.mockResolvedValueOnce(rowMock);

      const result = await markAbsent({ tenantId, attendanceId: 'va-1', subjectId });

      expect(mockVerticalAttendance.findOne).toHaveBeenCalled();
      expect(rowMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'absent' }),
      );
    });

    it('retorna null quando attendance não encontrada', async () => {
      mockVerticalAttendance.findOne.mockResolvedValueOnce(null);
      const result = await markAbsent({ tenantId, attendanceId: 'nao-existe', subjectId });
      expect(result).toBeNull();
    });
  });

  describe('getAttendanceHistory', () => {
    it('agrega frequency30d e frequency7d', async () => {
      const now = new Date();
      const rows = [
        { id: 'va-1', checked_in_at: new Date(now - 5 * 86400000), status: 'completed' },
        { id: 'va-2', checked_in_at: new Date(now - 2 * 86400000), status: 'completed' },
        { id: 'va-3', checked_in_at: new Date(now - 1 * 86400000), status: 'absent' },
      ];
      mockVerticalAttendance.findAll.mockResolvedValueOnce(rows);

      const result = await getAttendanceHistory({ tenantId, subjectId });

      expect(result.frequency30d).toBeGreaterThanOrEqual(2);
      expect(result.frequency7d).toBeGreaterThanOrEqual(2);
      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('retorna estrutura vazia quando nenhuma assiduidade', async () => {
      mockVerticalAttendance.findAll.mockResolvedValueOnce([]);

      const result = await getAttendanceHistory({ tenantId, subjectId });
      expect(result.frequency30d).toBe(0);
      expect(result.frequency7d).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('listOpenAttendances', () => {
    it('lista attendances abertas por tenant', async () => {
      mockVerticalAttendance.findAll.mockResolvedValueOnce([
        { id: 'va-open', status: 'open' },
      ]);

      const result = await listOpenAttendances({ tenantId });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockVerticalAttendance.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'open' }) }),
      );
    });
  });
});
