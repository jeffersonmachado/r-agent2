'use strict';

/**
 * Coercion-guard tests for ticketMediaService.js
 */

jest.mock('../../api/db/models/TicketMedia', () => jest.fn());

const getTicketMediaModel = require('../../api/db/models/TicketMedia');
const { storeTicketMedia, getTicketMediaById } = require('../../api/services/ticketMediaService');

function hostileToString() {
  const o = Object.create(null);
  Object.defineProperty(o, 'toString', {
    get() {
      throw new Error('hostile toString');
    },
  });
  Object.defineProperty(o, 'valueOf', {
    get() {
      throw new Error('hostile valueOf');
    },
  });
  return o;
}

describe('ticketMediaService coercion guards', () => {
  let model;

  beforeEach(() => {
    model = {
      sync: jest.fn(async () => true),
      create: jest.fn(async () => true),
      findOne: jest.fn(),
    };
    getTicketMediaModel.mockReturnValue(model);
  });

  test('storeTicketMedia: hostile tenant/file/mime/createdBy do not throw', async () => {
    const out = await storeTicketMedia({
      tenantId: hostileToString(),
      fileName: hostileToString(),
      mimeType: hostileToString(),
      sizeBytes: hostileToString(),
      buffer: Buffer.from('abc'),
      createdBy: hostileToString(),
    });
    expect(typeof out.id).toBe('string');
    expect(typeof out.fileName).toBe('string');
    expect(typeof out.mimeType).toBe('string');
  });

  test('getTicketMediaById: hostile id/tenant do not throw', async () => {
    model.findOne.mockResolvedValue(null);
    await expect(getTicketMediaById(hostileToString(), hostileToString())).resolves.toBeNull();
  });
});
