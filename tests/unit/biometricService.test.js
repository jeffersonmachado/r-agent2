/**
 * Testes unitários do BiometricService (biometricRef v1)
 */

describe('biometricService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('signBiometricRef + verifyBiometricRef validam assinatura e binding', () => {
    // eslint-disable-next-line global-require
    const { signBiometricRef, verifyBiometricRef } = require('../../api/services/biometricService');

    const secret = 's1';
    const payload = {
      v: 1,
      ts: Date.now(),
      nonce: 'n-123456',
      tokenId: 'pat-1',
      locationId: 'loja-1',
      mode: 'verify-1to1',
      subjectId: 'cust:11999999999',
    };
    const ref = signBiometricRef({ secret, payload });
    const verified = verifyBiometricRef({
      secret,
      ref,
      expectedTokenId: 'pat-1',
      expectedLocationId: 'loja-1',
      allowedModes: ['verify-1to1'],
      maxAgeSec: 120,
    });

    expect(verified.mode).toBe('verify-1to1');
    expect(verified.subjectId).toBe('cust:11999999999');
  });

  test('verifyBiometricRef rejeita assinatura inválida', () => {
    // eslint-disable-next-line global-require
    const { verifyBiometricRef } = require('../../api/services/biometricService');

    expect(() => verifyBiometricRef({
      secret: 's1',
      ref: 'v1.eyJ2IjoxfQ.deadbeef',
      expectedTokenId: 'pat-1',
      expectedLocationId: null,
    })).toThrow('invalid_biometric_ref_signature');
  });

  test('verifyBiometricRef rejeita expirado (maxAgeSec)', () => {
    // eslint-disable-next-line global-require
    const { signBiometricRef, verifyBiometricRef } = require('../../api/services/biometricService');

    const secret = 's1';
    const payload = {
      v: 1,
      ts: Date.now() - 10_000,
      nonce: 'n-123456',
      tokenId: 'pat-1',
      locationId: null,
      mode: 'dedupe-only',
      subjectId: 'anon:1',
    };
    const ref = signBiometricRef({ secret, payload });

    expect(() => verifyBiometricRef({
      secret,
      ref,
      expectedTokenId: 'pat-1',
      expectedLocationId: null,
      maxAgeSec: 1,
    })).toThrow('biometric_ref_expired');
  });
});

