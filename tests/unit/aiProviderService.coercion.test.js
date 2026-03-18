'use strict';

/**
 * Coercion-guard tests for aiProviderService.js
 * Verifies hostile err.message and tenantId toString don't crash provider init/load.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/config', () => ({
  get: jest.fn((key, def) => def),
}));
jest.mock('../../engine/aiProviderManager', () => ({
  registerAiProvider: jest.fn(),
  setTenantAiConfig: jest.fn(),
  getAiProviderForTenant: jest.fn(),
}));
jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));
jest.mock('../../api/services/superAdminService', () => ({
  listAllTenants: jest.fn(async () => [{ tenant_key: 't1' }]),
}));
jest.mock('../../api/services/tenantAIService', () => ({
  getDecryptedAPIKey: jest.fn(),
  getAIConfig: jest.fn(async () => { throw (() => {
    const e = new Error('real');
    Object.defineProperty(e, 'message', { get() { throw new Error('hostile message'); } });
    return e;
  })(); }),
}));

const { initializeAiProviders, ensureTenantAiConfigLoaded } = require('../../api/services/aiProviderService');
const { getAIConfig } = require('../../api/services/tenantAIService');

const hostileToString = () => {
  const o = Object.create(null);
  Object.defineProperty(o, 'toString', { get() { throw new Error('hostile toString'); } });
  Object.defineProperty(o, 'valueOf', { get() { throw new Error('hostile valueOf'); } });
  return o;
};

describe('aiProviderService – coercion guards', () => {
  test('initializeAiProviders: hostile err.message during config load does not throw', async () => {
    await expect(initializeAiProviders()).resolves.toBeUndefined();
  });

  test('ensureTenantAiConfigLoaded: hostile tenantId toString does not throw', async () => {
    await expect(ensureTenantAiConfigLoaded(hostileToString())).resolves.toEqual(
      expect.objectContaining({ loaded: false })
    );
  });

  test('initializeAiProviders: hostile err.message and toString during config load does not throw', async () => {
    const hostileErr = {
      get message() {
        throw new Error('hostile message getter');
      },
      toString() {
        throw new Error('hostile toString');
      },
    };

    getAIConfig.mockImplementationOnce(async () => {
      throw hostileErr;
    });

    await expect(initializeAiProviders()).resolves.toBeUndefined();
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/aiProviderService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
