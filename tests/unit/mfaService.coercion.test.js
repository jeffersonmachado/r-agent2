'use strict';
'use strict';

/**
 * Coercion-guard tests for mfaService.js
 * Verifies hostile toString() on token/label/issuer don't crash via public API.
 */

jest.mock('../../api/utils/crypto', () => ({
  encrypt: jest.fn((v) => `enc:${String(v)}`),
  decrypt: jest.fn((v) => String(v).replace('enc:', '')),
}));
jest.mock('../../api/db/sequelize', () => ({ getSequelize: jest.fn() }));
jest.mock('../../api/db/models', () => ({
  User: { findByPk: jest.fn(), update: jest.fn() },
}));

const { setupMfa, verifyMfa } = require('../../api/services/mfaService');
const { getSequelize } = require('../../api/db/sequelize');
const { User } = require('../../api/db/models');

const hostileToString = () => {
  const o = Object.create(null);
  Object.defineProperty(o, 'toString', { get() { throw new Error('hostile toString'); } });
  Object.defineProperty(o, 'valueOf', { get() { throw new Error('hostile valueOf'); } });
  return o;
};

const mockUser = () => ({
  mfa_enabled: false,
  mfa_temp_secret_encrypted: null,
  email: 'test@example.com',
  username: 'testuser',
  update: jest.fn().mockResolvedValue(true),
});

describe('mfaService – coercion guards', () => {
  beforeEach(() => {
    getSequelize.mockReturnValue({});
    User.findByPk.mockResolvedValue(mockUser());
  });

  test('setupMfa: hostile issuer/label do not throw', async () => {
    const result = await setupMfa({
      agentId: 'user1',
      issuer: hostileToString(),
      label: hostileToString(),
    });
    expect(result.ok).toBe(true);
    expect(typeof result.otpauthUrl).toBe('string');
  });

  test('verifyMfa: hostile token does not throw', async () => {
    const user = mockUser();
    user.mfa_temp_secret_encrypted = 'enc:JBSWY3DPEHPK3PXP';
    user.mfa_temp_expires_at = null;
    User.findByPk.mockResolvedValue(user);
    const result = await verifyMfa({ agentId: 'user1', token: hostileToString() });
    // Token verification should fail gracefully but not throw
    expect(typeof result.ok).toBe('boolean');
  });
});
