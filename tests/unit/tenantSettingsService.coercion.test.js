'use strict';

/**
 * Coercion-guard tests for tenantSettingsService.js
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(),
}));

jest.mock('../../api/db/models', () => ({
  TenantSetting: jest.fn(),
}));

const { getSequelize } = require('../../api/db/sequelize');
const { TenantSetting } = require('../../api/db/models');
const { getSetting, upsertSetting } = require('../../api/services/tenantSettingsService');

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

function hostileErr() {
  const e = new Error('real');
  Object.defineProperty(e, 'message', {
    get() {
      throw new Error('hostile message getter');
    },
  });
  return e;
}

function hostileErrFull() {
  return {
    get message() {
      throw new Error('hostile message getter');
    },
    toString() {
      throw new Error('hostile toString');
    },
  };
}

describe('tenantSettingsService coercion guards', () => {
  let model;

  beforeEach(() => {
    model = {
      findOne: jest.fn(),
      create: jest.fn(),
    };
    getSequelize.mockReturnValue({});
    TenantSetting.mockReturnValue(model);
  });

  test('getSetting: hostile tenantId/key do not throw', async () => {
    model.findOne.mockResolvedValue(null);
    const out = await getSetting({ tenantId: hostileToString(), key: hostileToString() });
    expect(out.ok).toBe(true);
  });

  test('getSetting: hostile err.message in catch does not throw', async () => {
    model.findOne.mockRejectedValue(hostileErr());
    const out = await getSetting({ tenantId: 't1', key: 'k1' });
    expect(out.ok).toBe(false);
    expect(typeof out.details).toBe('string');
  });

  test('getSetting: hostile err.message and toString in catch does not throw', async () => {
    model.findOne.mockRejectedValue(hostileErrFull());
    const out = await getSetting({ tenantId: 't1', key: 'k1' });
    expect(out.ok).toBe(false);
    expect(out.details).toBe('');
  });

  test('upsertSetting: hostile tenantId/key do not throw', async () => {
    model.findOne.mockResolvedValue(null);
    model.create.mockResolvedValue({ toJSON: () => ({ value: {} }) });
    const out = await upsertSetting({ tenantId: hostileToString(), key: hostileToString(), value: {} });
    expect(out.ok).toBe(true);
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/tenantSettingsService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
