#!/usr/bin/env node
/**
 * Normalize CRM contact phone numbers in the database.
 *
 * Usage:
 *   node scripts/normalize-crm-contact-phones.js [--dry-run] [--tenant=<tenantKey>] [--limit=1000]
 */

const { Op } = require('sequelize');
const { connect, getSequelize } = require('../api/db/sequelize');
const { runMigrations } = require('../api/db/migrate');
const { defineRelationships } = require('../api/db/models');
const modelsModule = require('../api/db/models');

let logger;
try {
  logger = require('../api/utils/logger');
} catch (_) {
  logger = {
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    dryRun: args.includes('--dry-run'),
    tenantKey: null,
    limit: 0,
  };

  for (const arg of args) {
    if (arg.startsWith('--tenant=')) out.tenantKey = String(arg.split('=').slice(1).join('=') || '').trim() || null;
    if (arg.startsWith('--limit=')) {
      const n = Number(arg.split('=').slice(1).join('='));
      out.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }
  }

  return out;
}

function getModels() {
  return {
    CrmContact: typeof modelsModule.CrmContact === 'function' ? modelsModule.CrmContact() : modelsModule.CrmContact,
  };
}

function safeString(v) {
  return v == null ? '' : String(v).trim();
}

function normalizePhone(rawPhone) {
  let raw = safeString(rawPhone);
  if (!raw) return null;

  if (raw.includes('@')) raw = raw.split('@')[0];
  if (raw.startsWith('waid:')) raw = raw.slice(5);

  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('55')) return `+${digits}`;
  if (digits.length <= 11) return `+55${digits}`;

  return `+${digits}`;
}

async function runNormalize(options) {
  const sequelize = getSequelize();
  if (!sequelize) throw new Error('Sequelize not initialized.');
  await sequelize.authenticate();

  const { CrmContact } = getModels();

  const where = { status: { [Op.ne]: 'deleted' } };
  if (options.tenantKey) where.tenant_key = options.tenantKey;

  const query = { where, order: [['updated_at', 'DESC']] };
  if (options.limit > 0) query.limit = options.limit;

  const contacts = await CrmContact.findAll(query);

  let scanned = 0;
  let unchanged = 0;
  let invalid = 0;
  let updated = 0;

  logger.info('[NormalizeCrmPhones] Starting', {
    totalContacts: contacts.length,
    dryRun: options.dryRun,
    tenantKey: options.tenantKey || null,
    limit: options.limit || null,
  });

  for (const contact of contacts) {
    scanned += 1;
    const current = safeString(contact.phone);
    const normalized = normalizePhone(current);

    if (!normalized) {
      invalid += 1;
      continue;
    }

    if (normalized === current) {
      unchanged += 1;
      continue;
    }

    if (!options.dryRun) {
      await contact.update({ phone: normalized });
    }

    updated += 1;
  }

  logger.info('[NormalizeCrmPhones] Done', {
    scanned,
    unchanged,
    invalid,
    updated,
    dryRun: options.dryRun,
  });

  return { scanned, unchanged, invalid, updated, dryRun: options.dryRun };
}

async function main() {
  const options = parseArgs(process.argv);

  try {
    await connect();
    await runMigrations();
    defineRelationships();

    const result = await runNormalize(options);
    console.log('\nSummary:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    logger.error('[NormalizeCrmPhones] Fatal error', { message: err?.message || String(err) });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { normalizePhone, runNormalize };
