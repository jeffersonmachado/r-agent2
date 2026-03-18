'use strict';

/**
 * Coercion-guard tests for segmentationService.js
 * Verifies hostile toString() on category does not crash setTicketCategory.
 */

jest.mock('../../api/services/queueService', () => ({
  listAllTickets: jest.fn(() => ({ tickets: [{ id: 't1', tags: [], category: null }] })),
  getTicket: jest.fn(() => ({ id: 't1', tags: [], category: null })),
  updateTicket: jest.fn(),
}));

const { setTicketCategory } = require('../../api/services/segmentationService');
const { getTicket, updateTicket } = require('../../api/services/queueService');

const hostileToString = () => {
  const o = Object.create(null);
  Object.defineProperty(o, 'toString', { get() { throw new Error('hostile toString'); } });
  Object.defineProperty(o, 'valueOf', { get() { throw new Error('hostile valueOf'); } });
  return o;
};

describe('segmentationService – coercion guards', () => {
  beforeEach(() => {
    getTicket.mockReturnValue({ id: 't1', tags: [], category: null });
    updateTicket.mockImplementation(() => true);
  });

  test('setTicketCategory: hostile category does not throw', () => {
    expect(() => setTicketCategory('t1', hostileToString())).not.toThrow();
  });

  test('setTicketCategory: hostile category yields fallback string', () => {
    const out = setTicketCategory('t1', hostileToString());
    expect(out.success).toBe(true);
    expect(typeof out.ticket.category).toBe('string');
  });
});
