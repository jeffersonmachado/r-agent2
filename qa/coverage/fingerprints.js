'use strict';

/**
 * Fingerprints determinísticos (SHA-256) para itens de inventário/cobertura.
 *
 * A serialização é canônica: chaves de objetos ordenadas recursivamente,
 * arrays preservam ordem, `undefined` em objetos é ignorado (como JSON).
 * Nunca incluir timestamps nos objetos fingerprintados.
 */

const crypto = require('crypto');

function canonicalStringify(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => {
      const serialized = canonicalStringify(entry);
      return serialized === undefined ? 'null' : serialized;
    }).join(',')}]`;
  }
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    const serialized = canonicalStringify(value[key]);
    if (serialized === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${parts.join(',')}}`;
}

function sha256(content) {
  return crypto.createHash('sha256').update(String(content), 'utf8').digest('hex');
}

function fingerprintObject(obj) {
  return sha256(canonicalStringify(obj));
}

module.exports = { canonicalStringify, sha256, fingerprintObject };
