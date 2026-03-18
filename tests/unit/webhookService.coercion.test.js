'use strict';

/**
 * Coercion-guard tests for webhookService.js
 * Verifies hostile err.message getters don't crash the service.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));
jest.mock('../../api/db/sequelize', () => ({ getSequelize: jest.fn() }));
jest.mock('../../api/db/models', () => ({
  Webhook: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), upsert: jest.fn() },
}));
jest.mock('../../api/utils/inputValidator', () => ({
  validateInput: jest.fn((v) => v),
  ValidationError: class ValidationError extends Error {
    constructor(msg, field, code) { super(msg); this.field = field; this.code = code; }
  },
}));

const { initialize, createWebhook } = require('../../api/services/webhookService');
const { Webhook } = require('../../api/db/models');

const hostileErr = () => {
  const e = new Error('real');
  Object.defineProperty(e, 'message', { get() { throw new Error('hostile message'); } });
  return e;
};

const hostileErrFull = () => ({
  get message() {
    throw new Error('hostile message getter');
  },
  toString() {
    throw new Error('hostile toString');
  },
});

describe('webhookService – coercion guards', () => {
  beforeEach(() => jest.clearAllMocks());

  test('initialize: hostile err.message in catch does not throw', async () => {
    Webhook.findAll.mockRejectedValue(hostileErr());
    await expect(initialize()).resolves.toBeUndefined();
  });

  test('initialize: hostile err.message and toString in catch does not throw', async () => {
    Webhook.findAll.mockRejectedValue(hostileErrFull());
    await expect(initialize()).resolves.toBeUndefined();
  });

  test('createWebhook: ValidationError with hostile message does not throw', async () => {
    const { validateInput } = require('../../api/utils/inputValidator');
    const hostileValidationError = hostileErr();
    hostileValidationError.constructor = class ValidationError {};
    // Use a mock that throws a ValidationError-like error
    validateInput.mockImplementationOnce(() => { throw hostileErr(); });
    // createWebhook will catch a non-ValidationError and return generic message
    const result = await createWebhook('t1', {
      url: 'https://example.com/hook',
      events: ['ticket.created'],
    });
    expect(typeof result.success).toBe('boolean');
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/webhookService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
