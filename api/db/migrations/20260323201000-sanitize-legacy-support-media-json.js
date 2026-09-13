'use strict';

const logger = require('../../utils/logger');

const REMOVE = Symbol('remove');

function isLegacySupportMediaUrl(value) {
  if (typeof value !== 'string') return false;
  return value.toLowerCase().includes('/public/support-media/');
}

function sanitizeJson(value, stats) {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value
      .map((item) => {
        const out = sanitizeJson(item, stats);
        if (out === REMOVE) {
          changed = true;
          return null;
        }
        if (out !== item) changed = true;
        return out;
      })
      .filter((item) => item !== null);
    return changed ? next : value;
  }

  if (value && typeof value === 'object') {
    let changed = false;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      const out = sanitizeJson(item, stats);
      if (out === REMOVE) {
        changed = true;
        stats.removedKeys += 1;
        continue;
      }
      if (out !== item) changed = true;
      next[key] = out;
    }
    return changed ? next : value;
  }

  if (isLegacySupportMediaUrl(value)) {
    stats.removedUrls += 1;
    return REMOVE;
  }

  return value;
}

async function sanitizeTableJsonb(queryInterface, { tableName, idColumn, jsonColumn }) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT ${idColumn} AS id, ${jsonColumn} AS payload FROM ${tableName}`,
  );

  const stats = {
    tableName,
    rowsScanned: 0,
    rowsUpdated: 0,
    removedUrls: 0,
    removedKeys: 0,
  };

  for (const row of rows || []) {
    stats.rowsScanned += 1;
    const payload = row && row.payload;
    const sanitized = sanitizeJson(payload, stats);
    if (sanitized === payload) continue;

    await queryInterface.sequelize.query(
      `UPDATE ${tableName} SET ${jsonColumn} = :payload::jsonb, updated_at = NOW() WHERE ${idColumn} = :id`,
      {
        replacements: {
          payload: JSON.stringify(sanitized || {}),
          id: row.id,
        },
      },
    );

    stats.rowsUpdated += 1;
  }

  return stats;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const reports = [];

    reports.push(await sanitizeTableJsonb(queryInterface, {
      tableName: 'channel_messages',
      idColumn: 'id',
      jsonColumn: 'body',
    }));

    reports.push(await sanitizeTableJsonb(queryInterface, {
      tableName: 'outbound_queue',
      idColumn: 'id',
      jsonColumn: 'message',
    }));

    reports.push(await sanitizeTableJsonb(queryInterface, {
      tableName: 'tickets',
      idColumn: 'id',
      jsonColumn: 'messages',
    }));

    reports.push(await sanitizeTableJsonb(queryInterface, {
      tableName: 'tickets',
      idColumn: 'id',
      jsonColumn: 'context',
    }));

    for (const r of reports) {
      // eslint-disable-next-line no-console
      logger.info(
        `[migration:sanitize-legacy-support-media-json] ${r.tableName} scanned=${r.rowsScanned} updated=${r.rowsUpdated} removedUrls=${r.removedUrls} removedKeys=${r.removedKeys}`,
      );
    }
  },

  async down() {
    // No-op: this migration removes legacy URL references and is not reversible.
  },
};
