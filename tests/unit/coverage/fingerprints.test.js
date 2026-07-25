'use strict';

const { canonicalStringify, sha256, fingerprintObject } = require('../../../qa/coverage/fingerprints');

describe('coverage/fingerprints', () => {
  test('stringify canônico é determinístico e insensível à reordenação de chaves', () => {
    const a = { b: 2, a: 1, nested: { y: [3, 1], x: 'z' } };
    const b = { nested: { x: 'z', y: [3, 1] }, a: 1, b: 2 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
    expect(fingerprintObject(a)).toBe(fingerprintObject(b));
  });

  test('arrays preservam a ordem', () => {
    expect(canonicalStringify({ a: [1, 2] })).not.toBe(canonicalStringify({ a: [2, 1] }));
  });

  test('undefined é omitido', () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe(canonicalStringify({ a: 1 }));
  });

  test('fingerprint é sensível a mudança de conteúdo', () => {
    const base = { journey: 'j1', steps: ['a', 'b'] };
    const changed = { journey: 'j1', steps: ['a', 'c'] };
    expect(fingerprintObject(base)).not.toBe(fingerprintObject(changed));
  });

  test('fingerprint retorna hex SHA-256 de 64 chars', () => {
    expect(fingerprintObject({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  test('sha256 de string conhecida', () => {
    // SHA-256 de "abc" é valor público bem conhecido.
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
