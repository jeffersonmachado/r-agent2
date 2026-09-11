'use strict';

/**
 * Helpers comuns da camada de integração.
 *
 * `isUniqueViolation`: violação de UNIQUE (23505) é tratada como idempotência
 * (convenção do projeto — ver docs/PROD_HARDENING.md), nunca como erro fatal.
 */

const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}

function dbAvailable() {
  return Boolean(getSequelize());
}

/** @returns {boolean} true para SequelizeUniqueConstraintError / código 23505 */
function isUniqueViolation(error) {
  if (!error) return false;
  if (error.name === 'SequelizeUniqueConstraintError') return true;
  const code = error.original && error.original.code ? error.original.code : error.code;
  return String(code || '').toLowerCase() === '23505';
}

/** Hash determinístico (nunca reversível): usado para fingerprint/hint/idempotência. */
function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

/** Chave determinística de idempotência a partir de partes estáveis. */
function deterministicKey(...parts) {
  return sha256Hex(parts.filter((p) => p !== undefined && p !== null).map((p) => String(p)).join('|'));
}

/** Normaliza string opcional (nunca lança). */
function optionalString(value, maxLength = null) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!str) return null;
  return maxLength ? str.slice(0, maxLength) : str;
}

/** Coage um valor para Date válido ou null. */
function optionalDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

module.exports = {
  makeId,
  dbAvailable,
  isUniqueViolation,
  sha256Hex,
  deterministicKey,
  optionalString,
  optionalDate,
};
