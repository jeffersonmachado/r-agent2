/**
 * Testes unitários: Segmentação persiste alterações (tags + ações visíveis).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('SegmentationService - persistência', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('addTagToTicket chama updateTicket e registra ticket_tags (best-effort)', () => {
    const ticket = {
      id: 't-1',
      tenantId: 'tenant-1',
      tags: [],
      messages: [],
    };

    const updateTicket = jest.fn().mockImplementation((_id, patch) => {
      Object.assign(ticket, patch);
      return ticket;
    });

    const recordTagActionBestEffort = jest.fn();

    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ticket),
      updateTicket,
    }));
    jest.doMock('../../api/services/ticketTagService', () => ({
      recordTagActionBestEffort,
    }));

    // eslint-disable-next-line global-require
    const { addTagToTicket } = require('../../api/services/segmentationService');

    const out = addTagToTicket('t-1', 'Cobrança');
    expect(out.success).toBe(true);
    expect(ticket.tags).toContain('cobrança');
    expect(updateTicket).toHaveBeenCalled();
    expect(recordTagActionBestEffort).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      ticketId: 't-1',
      tag: 'cobrança',
      action: 'add',
    }));
    expect(ticket.messages.some((m) => m.sender === 'system' && String(m.text).includes('Tag adicionada'))).toBe(true);
  });

  test('removeTagFromTicket chama updateTicket e registra ticket_tags (best-effort)', () => {
    const ticket = {
      id: 't-1',
      tenantId: 'tenant-1',
      tags: ['cobrança'],
      messages: [],
    };

    const updateTicket = jest.fn().mockImplementation((_id, patch) => {
      Object.assign(ticket, patch);
      return ticket;
    });

    const recordTagActionBestEffort = jest.fn();

    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ticket),
      updateTicket,
    }));
    jest.doMock('../../api/services/ticketTagService', () => ({
      recordTagActionBestEffort,
    }));

    // eslint-disable-next-line global-require
    const { removeTagFromTicket } = require('../../api/services/segmentationService');

    const out = removeTagFromTicket('t-1', 'cobrança');
    expect(out.success).toBe(true);
    expect(ticket.tags).not.toContain('cobrança');
    expect(updateTicket).toHaveBeenCalled();
    expect(recordTagActionBestEffort).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      ticketId: 't-1',
      tag: 'cobrança',
      action: 'remove',
    }));
    expect(ticket.messages.some((m) => m.sender === 'system' && String(m.text).includes('Tag removida'))).toBe(true);
  });
});

