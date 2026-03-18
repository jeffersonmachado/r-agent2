'use strict';

describe('biometricService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('parseBiometricRef rejeita ref hostil com erro controlado', () => {
    const { _internal } = require('../../api/services/biometricService');
    const hostileRef = { toString() { throw new Error('boom-ref'); } };

    expect(() => _internal.parseBiometricRef(hostileRef)).toThrow('invalid_biometric_ref_format');
  });

  test('verifyBiometricRef não explode com expectedTokenId hostil', () => {
    const { signBiometricRef, verifyBiometricRef } = require('../../api/services/biometricService');

    const ref = signBiometricRef({
      secret: 's1',
      payload: {
        v: 1,
        ts: Date.now(),
        nonce: 'n-123456',
        tokenId: 'pat-1',
        locationId: null,
        mode: 'dedupe-only',
        subjectId: 'anon:1',
      },
    });

    const hostileTokenId = { toString() { throw new Error('boom-token-id'); } };
    expect(() => verifyBiometricRef({
      secret: 's1',
      ref,
      expectedTokenId: hostileTokenId,
      expectedLocationId: null,
    })).toThrow('invalid_biometric_ref_binding');
  });

  test('verifyBiometricRef não explode com expectedLocationId hostil', () => {
    const { signBiometricRef, verifyBiometricRef } = require('../../api/services/biometricService');

    const ref = signBiometricRef({
      secret: 's1',
      payload: {
        v: 1,
        ts: Date.now(),
        nonce: 'n-123456',
        tokenId: 'pat-1',
        locationId: 'loc-1',
        mode: 'verify-1to1',
        subjectId: 'cust:1',
      },
    });

    const hostileLocationId = { toString() { throw new Error('boom-location-id'); } };
    expect(() => verifyBiometricRef({
      secret: 's1',
      ref,
      expectedTokenId: 'pat-1',
      expectedLocationId: hostileLocationId,
      allowedModes: ['verify-1to1'],
    })).toThrow('invalid_biometric_ref_location');
  });

  test('signBiometricRef e verifyBiometricRef toleram secret hostil sem travar fora do contrato', () => {
    const { signBiometricRef, verifyBiometricRef } = require('../../api/services/biometricService');
    const hostileSecret = { toString() { throw new Error('boom-secret'); } };

    const ref = signBiometricRef({
      secret: hostileSecret,
      payload: {
        v: 1,
        ts: Date.now(),
        nonce: 'n-123456',
        tokenId: 'pat-1',
        locationId: null,
        mode: 'dedupe-only',
        subjectId: 'anon:1',
      },
    });

    expect(() => verifyBiometricRef({
      secret: hostileSecret,
      ref,
      expectedTokenId: 'pat-1',
      expectedLocationId: null,
    })).not.toThrow();
  });
});