'use strict';

/**
 * Evidence Store append-only com hash chain.
 *
 * - Registros JSONL, um por linha, em modo estritamente append (flag 'a').
 * - Redaction recursiva obrigatória antes de persistir (ver SENSITIVE_KEY_PATTERN).
 * - Cada registro recebe `hash` = SHA-256 do conteúdo canônico (excluindo
 *   `hash`/`prevHash`) e `prevHash` do registro anterior → cadeia imutável.
 * - Nunca sobrescreve/trunca arquivo existente; não há API de reescrita.
 */

const fs = require('fs');
const path = require('path');
const { fingerprintObject } = require('./fingerprints');

const REQUIRED_FIELDS = Object.freeze([
  'evidenceId',
  'executionId',
  'waveId',
  'journeyId',
  'journeyFingerprint',
  'commit',
  'environment',
  'status',
  'assertions',
  'observedElements',
  'expectedElements',
  'timestamp',
]);

const SENSITIVE_KEY_PATTERN = /password|senha|token|secret|authorization|apikey|api_key|credential|cookie|session|cpf|ssn/i;

const REDACTED = '[REDACTED]';
const GENESIS = 'GENESIS';

/**
 * Redaction recursiva: qualquer chave sensível (case-insensitive) tem o valor
 * substituído por '[REDACTED]', em qualquer profundidade (objetos e arrays).
 */
function redactSensitive(value) {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactSensitive(child);
    }
    return result;
  }
  return value;
}

function validateEvidence(evidence) {
  const missing = REQUIRED_FIELDS.filter((field) => evidence[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`evidence_missing_required_fields: ${missing.join(',')}`);
  }
}

function computeRecordHash(record) {
  const { hash, prevHash, ...content } = record;
  return fingerprintObject(content);
}

/**
 * Cria (ou reabre) um Evidence Store em `filePath`.
 * Se o arquivo não existir, o diretório pai é criado; o arquivo só é criado
 * no primeiro append. Se existir, novos registros continuam a cadeia.
 */
function createEvidenceStore({ filePath }) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('evidence_store_file_path_required');
  }

  function readAll() {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  }

  function lastHash() {
    const records = readAll();
    if (records.length === 0) return GENESIS;
    return records[records.length - 1].hash;
  }

  function appendRecord(record) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const chained = { ...record, prevHash: lastHash() };
    chained.hash = computeRecordHash(chained);
    fs.appendFileSync(filePath, `${JSON.stringify(chained)}\n`, { encoding: 'utf8', flag: 'a' });
    return chained;
  }

  /**
   * Anexa uma evidência validada (campos obrigatórios) e redigida.
   * @returns o registro persistido (com prevHash/hash)
   */
  function append(evidence) {
    if (!evidence || typeof evidence !== 'object') {
      throw new Error('evidence_record_required');
    }
    validateEvidence(evidence);
    return appendRecord(redactSensitive(evidence));
  }

  /**
   * Marca uma evidência como STALE sem editar o registro original:
   * anexa um novo registro `stale-marker` na cadeia.
   */
  function markStale(evidenceId, reason) {
    if (!evidenceId) throw new Error('evidence_stale_marker_id_required');
    return appendRecord({
      type: 'stale-marker',
      staleOf: evidenceId,
      reason: reason || 'unspecified',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Relê o arquivo e valida toda a cadeia (hashes e linkage prevHash).
   * @returns {{valid: boolean, brokenAt: number|null}} brokenAt = índice (0-based)
   *   do primeiro registro quebrado, ou null se válido.
   */
  function verify() {
    const records = readAll();
    let expectedPrev = GENESIS;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record.prevHash !== expectedPrev) {
        return { valid: false, brokenAt: index };
      }
      if (record.hash !== computeRecordHash(record)) {
        return { valid: false, brokenAt: index };
      }
      expectedPrev = record.hash;
    }
    return { valid: true, brokenAt: null };
  }

  return Object.freeze({
    filePath,
    append,
    markStale,
    verify,
    readAll,
  });
}

module.exports = {
  createEvidenceStore,
  redactSensitive,
  REQUIRED_FIELDS,
  SENSITIVE_KEY_PATTERN,
  REDACTED,
};
