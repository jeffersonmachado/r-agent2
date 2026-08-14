'use strict';

/**
 * Evidence Store append-only com hash chain — backend Postgres.
 *
 * Mesma semântica do `evidenceStore.js` (JSONL): registros append-only com
 * hash chain SHA-256 (`hash`/`prevHash`) e redaction recursiva obrigatória.
 * A diferença é o backend: persiste em `coverage_evidence` (JSONB) em vez de
 * arquivo JSONL. Interface assíncrona.
 */

const {
  redactSensitive,
  validateEvidence,
  computeRecordHash,
  GENESIS,
} = require('./evidenceStore');

function createPostgresEvidenceStore({ model } = {}) {
  function getModel() {
    if (model) return model;
    return require('../../api/db/models/CoverageEvidence')();
  }

  /**
   * Ordena os registros seguindo o encadeamento prevHash → hash a partir de
   * GENESIS, em vez de confiar em `created_at` (empates de timestamp com
   * desempate por UUID aleatório não refletem a ordem de append). Registros
   * fora da cadeia principal (bifurcação/órfaos) vão ao final, na ordem de
   * leitura, para que `verify()` os reporte como quebra.
   */
  function orderByChain(records) {
    const byPrevHash = new Map();
    for (const record of records) {
      const bucket = byPrevHash.get(record.prevHash) || [];
      bucket.push(record);
      byPrevHash.set(record.prevHash, bucket);
    }
    const ordered = [];
    const seen = new Set();
    let current = GENESIS;
    for (;;) {
      const next = (byPrevHash.get(current) || []).find((record) => !seen.has(record.hash));
      if (!next) break;
      ordered.push(next);
      seen.add(next.hash);
      current = next.hash;
    }
    for (const record of records) {
      if (!seen.has(record.hash)) ordered.push(record);
    }
    return ordered;
  }

  async function readAll() {
    const rows = await getModel().findAll();
    const records = rows.map((row) => {
      const record = row.record && typeof row.record === 'object' ? row.record : {};
      return { ...record, hash: row.hash, prevHash: row.prev_hash };
    });
    return orderByChain(records);
  }

  async function lastHash(transaction) {
    const options = { order: [['created_at', 'DESC'], ['id', 'DESC']] };
    if (transaction) options.transaction = transaction;
    const last = await getModel().findOne(options);
    return last && last.hash ? last.hash : GENESIS;
  }

  async function appendChained(record, transaction) {
    const chained = { ...record, prevHash: await lastHash(transaction) };
    chained.hash = computeRecordHash(chained);
    const values = {
      record: chained,
      hash: chained.hash,
      prev_hash: chained.prevHash,
    };
    if (transaction) {
      await getModel().create(values, { transaction });
    } else {
      await getModel().create(values);
    }
    return chained;
  }

  async function appendRecord(record) {
    const sequelize = getModel().sequelize;
    if (!sequelize || typeof sequelize.transaction !== 'function') {
      // Model injetado em testes (sem sequelize real): caminho sem lock.
      return appendChained(record, null);
    }
    // Serializa appends concorrentes: sem o lock, dois appends leriam o mesmo
    // prevHash e bifurcariam a cadeia. pg_advisory_xact_lock é liberado no
    // commit/rollback, então o append anterior já é visível ao adquirir.
    return sequelize.transaction(async (transaction) => {
      await sequelize.query('SELECT pg_advisory_xact_lock(894737271)', { transaction });
      return appendChained(record, transaction);
    });
  }

  async function append(evidence) {
    if (!evidence || typeof evidence !== 'object') {
      throw new Error('evidence_record_required');
    }
    validateEvidence(evidence);
    return appendRecord(redactSensitive(evidence));
  }

  async function appendRaw(record) {
    if (!record || typeof record !== 'object') {
      throw new Error('evidence_record_required');
    }
    if (!record.type || typeof record.type !== 'string') {
      throw new Error('evidence_raw_type_required');
    }
    if (!record.timestamp) {
      throw new Error('evidence_raw_timestamp_required');
    }
    return appendRecord(redactSensitive(record));
  }

  async function markStale(evidenceId, reason) {
    if (!evidenceId) throw new Error('evidence_stale_marker_id_required');
    return appendRecord({
      type: 'stale-marker',
      staleOf: evidenceId,
      reason: reason || 'unspecified',
      timestamp: new Date().toISOString(),
    });
  }

  async function verify() {
    const records = await readAll();
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
    backend: 'postgres',
    append,
    appendRaw,
    markStale,
    verify,
    readAll,
  });
}

module.exports = {
  createPostgresEvidenceStore,
};
