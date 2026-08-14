'use strict';

const { resolveSuperAdminBootstrapConfig } = require('../../api/db/seed');

const ENV_KEYS = [
  'SUPERADMIN_EMAIL',
  'SUPERADMIN_USERNAME',
  'SUPERADMIN_NAME',
  'SUPERADMIN_PASSWORD',
  'SYSTEMADMIN_EMAIL',
  'SYSTEMADMIN_USERNAME',
  'SYSTEMADMIN_NAME',
  'SYSTEMADMIN_PASSWORD',
];

describe('superadmin seed environment precedence', () => {
  const original = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  test('inherits every SYSTEMADMIN value when SUPERADMIN is absent', () => {
    process.env.SYSTEMADMIN_EMAIL = 'system@example.test';
    process.env.SYSTEMADMIN_USERNAME = 'system-root';
    process.env.SYSTEMADMIN_NAME = 'System Root';
    process.env.SYSTEMADMIN_PASSWORD = 'system-password';

    expect(resolveSuperAdminBootstrapConfig()).toEqual({
      email: 'system@example.test',
      username: 'system-root',
      name: 'System Root',
      password: 'system-password',
    });
  });

  test('SUPERADMIN values override their SYSTEMADMIN counterparts', () => {
    process.env.SYSTEMADMIN_PASSWORD = 'system-password';
    process.env.SUPERADMIN_PASSWORD = 'super-password';

    expect(resolveSuperAdminBootstrapConfig().password).toBe('super-password');
  });
});
