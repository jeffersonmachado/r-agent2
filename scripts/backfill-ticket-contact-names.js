#!/usr/bin/env node
/**
 * Backfill de nomes de contato em tickets antigos.
 *
 * Objetivo:
 * - Preencher `ticket.context.metadata.contactName` quando vazio,
 *   usando CRM (`crm_contacts`) via telefone do ticket.
 * - Quando possível, recuperar nome real do histórico omnichannel
 *   (`channel_messages`) antes de cair para placeholders.
 *
 * Uso:
 *   node scripts/backfill-ticket-contact-names.js [--dry-run] [--tenant=<tenantKey>] [--include-closed] [--limit=1000] [--create-missing]
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
    includeClosed: args.includes('--include-closed'),
    createMissing: args.includes('--create-missing'),
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
    Ticket: typeof modelsModule.Ticket === 'function' ? modelsModule.Ticket() : modelsModule.Ticket,
    CrmContact: typeof modelsModule.CrmContact === 'function' ? modelsModule.CrmContact() : modelsModule.CrmContact,
    ChannelConversation: typeof modelsModule.ChannelConversation === 'function' ? modelsModule.ChannelConversation() : modelsModule.ChannelConversation,
    ChannelMessage: typeof modelsModule.ChannelMessage === 'function' ? modelsModule.ChannelMessage() : modelsModule.ChannelMessage,
  };
}

function safeString(v) {
  return v == null ? '' : String(v).trim();
}

function isPlaceholderName(name, normalizedPhone) {
  const value = safeString(name);
  if (!value) return true;

  const lowered = value.toLowerCase();
  if (lowered === 'cliente') return true;
  if (lowered === 'unknown') return true;
  if (lowered.startsWith('contato ')) return true;

  if (normalizedPhone) {
    const digitsValue = value.replace(/\D/g, '');
    const digitsPhone = String(normalizedPhone).replace(/\D/g, '');
    if (digitsValue && digitsPhone && digitsValue === digitsPhone) return true;
  }

  return false;
}

function isLikelyHumanName(name, normalizedPhone) {
  const value = safeString(name);
  if (!value) return false;
  if (isPlaceholderName(value, normalizedPhone)) return false;
  if (value.includes('@')) return false;
  if (/^[+\d\s().-]+$/.test(value)) return false;
  if (value.length < 2) return false;
  return true;
}

function pickContactName(context = {}, normalizedPhone) {
  const metadataName = safeString(context?.metadata?.contactName);
  const variablesName = safeString(context?.variables?.customerName || context?.variables?.name || context?.variables?.nome);

  if (metadataName && !isPlaceholderName(metadataName, normalizedPhone)) return metadataName;
  if (variablesName && !isPlaceholderName(variablesName, normalizedPhone)) return variablesName;
  return '';
}

function normalizePhoneForCrm(rawPhone) {
  let raw = safeString(rawPhone);
  if (!raw) return '';

  if (raw.includes('@')) raw = raw.split('@')[0];
  if (raw.startsWith('waid:')) raw = raw.slice(5);

  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('55')) return `+${digits}`;
  if (digits.length <= 11) return `+55${digits}`;
  return `+${digits}`;
}

function buildContactName(context, normalizedPhone) {
  const preferred = pickContactName(context, normalizedPhone);
  const fallback = normalizedPhone ? `Contato ${normalizedPhone}` : 'Cliente';
  return preferred || fallback;
}

function normalizePhoneCandidates(rawPhone) {
  let raw = safeString(rawPhone);
  if (!raw) return [];

  if (raw.includes('@')) raw = raw.split('@')[0];
  if (raw.startsWith('waid:')) raw = raw.slice(5);

  const digits = raw.replace(/\D/g, '');
  if (!digits) return [];

  const extra = [];
  if (digits.length > 11) {
    extra.push(digits.slice(-11));
    extra.push(digits.slice(-10));
  }

  const set = new Set();
  const pushCandidates = (value) => {
    if (!value) return;
    set.add(`+${value}`);
    if (value.startsWith('55') && value.length >= 12) {
      set.add(`+${value.slice(2)}`);
    }
    if (!value.startsWith('55')) {
      set.add(`+55${value}`);
    }
  };

  pushCandidates(digits);
  for (const alt of extra) pushCandidates(alt);

  return Array.from(set);
}

function collectProfileNames(node, out, depth = 0) {
  if (!node || depth > 7) return;
  if (Array.isArray(node)) {
    for (const item of node) collectProfileNames(item, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;

  const profileName = safeString(node?.profile?.name);
  if (profileName) out.add(profileName);

  const senderName = safeString(node?.sender?.name);
  if (senderName) out.add(senderName);

  const contactName = safeString(node?.contact?.name);
  if (contactName) out.add(contactName);

  const explicitContactName = safeString(node?.contactName || node?.customer_name);
  if (explicitContactName) out.add(explicitContactName);

  const values = Object.values(node);
  for (const v of values) collectProfileNames(v, out, depth + 1);
}

function extractNameCandidatesFromBody(body) {
  const out = new Set();
  if (!body || typeof body !== 'object') return [];

  const directCandidates = [
    safeString(body?.meta?.contactName),
    safeString(body?.contactName),
    safeString(body?.sender?.name),
    safeString(body?.customer_name),
  ];
  for (const candidate of directCandidates) {
    if (candidate) out.add(candidate);
  }

  collectProfileNames(body, out, 0);
  return Array.from(out);
}

async function findConversationIdsForTicket(ChannelConversation, ticket, phoneRaw) {
  const ids = new Set();
  if (ticket?.conversation_id) ids.add(String(ticket.conversation_id));

  if (!ChannelConversation || ids.size > 0 || !phoneRaw) {
    return Array.from(ids);
  }

  const phoneCandidates = normalizePhoneCandidates(phoneRaw)
    .map((v) => String(v).replace(/^\+/, ''))
    .filter(Boolean);

  if (phoneCandidates.length === 0) return [];

  const rows = await ChannelConversation.findAll({
    where: {
      tenant_key: ticket.tenant_key,
      channel_type: 'whatsapp',
      external_id: { [Op.in]: phoneCandidates },
    },
    attributes: ['id'],
    order: [['updated_at', 'DESC']],
    limit: 10,
  });

  for (const row of rows) {
    const id = safeString(row?.id);
    if (id) ids.add(id);
  }

  return Array.from(ids);
}

async function findHistoricalContactName(ChannelMessage, ChannelConversation, ticket) {
  if (!ChannelMessage || !ticket) return '';

  const conversationIds = await findConversationIdsForTicket(ChannelConversation, ticket, ticket?.phone_number);
  if (conversationIds.length === 0) return '';

  const normalizedPhone = normalizePhoneForCrm(ticket?.phone_number);

  for (const conversationId of conversationIds) {
    const messages = await ChannelMessage.findAll({
      where: {
        tenant_key: ticket.tenant_key,
        conversation_id: conversationId,
        direction: 'in',
      },
      attributes: ['body', 'created_at'],
      order: [['created_at', 'DESC']],
      limit: 60,
    });

    for (const message of messages) {
      const candidates = extractNameCandidatesFromBody(message?.body || {});
      const match = candidates.find((c) => isLikelyHumanName(c, normalizedPhone));
      if (match) return match;
    }
  }

  return '';
}

async function findCrmContactByPhone(CrmContact, tenantKey, phoneRaw) {
  const candidates = normalizePhoneCandidates(phoneRaw);
  if (candidates.length === 0) return null;

  const row = await CrmContact.findOne({
    where: {
      tenant_key: tenantKey,
      phone: { [Op.in]: candidates },
      status: { [Op.ne]: 'deleted' },
    },
    order: [['updated_at', 'DESC']],
  });

  return row || null;
}

async function runBackfill(options) {
  const sequelize = getSequelize();
  if (!sequelize) throw new Error('Sequelize não inicializado.');
  await sequelize.authenticate();

  const { Ticket, CrmContact, ChannelConversation, ChannelMessage } = getModels();

  const where = {};
  if (!options.includeClosed) where.status = { [Op.ne]: 'closed' };
  if (options.tenantKey) where.tenant_key = options.tenantKey;

  const query = {
    where,
    order: [['updated_at', 'DESC']],
  };
  if (options.limit > 0) query.limit = options.limit;

  const tickets = await Ticket.findAll(query);

  let scanned = 0;
  let alreadyNamed = 0;
  let withoutPhone = 0;
  let crmMiss = 0;
  let updated = 0;
  let created = 0;
  let crmUpdated = 0;
  let historicalNamed = 0;
  const createdCache = new Map();

  logger.info('[BackfillContactName] Iniciando', {
    totalTickets: tickets.length,
    dryRun: options.dryRun,
    includeClosed: options.includeClosed,
    tenantKey: options.tenantKey || null,
    limit: options.limit || null,
  });

  for (const ticket of tickets) {
    scanned += 1;

    const context = ticket?.context && typeof ticket.context === 'object' ? { ...ticket.context } : {};
    const metadata = context.metadata && typeof context.metadata === 'object' ? { ...context.metadata } : {};

    const phone = safeString(ticket?.phone_number);
    if (!phone) {
      withoutPhone += 1;
      continue;
    }

    const normalizedPhone = normalizePhoneForCrm(phone);
    const preferredName = pickContactName(context, normalizedPhone);
    const historicalName = preferredName
      ? ''
      : await findHistoricalContactName(ChannelMessage, ChannelConversation, ticket);
    const bestAvailableName = preferredName || historicalName;

    if (historicalName) {
      historicalNamed += 1;
    }

    if (bestAvailableName && metadata.contactName !== bestAvailableName) {
      metadata.contactName = bestAvailableName;
      context.metadata = metadata;
      if (!options.dryRun) {
        await ticket.update({ context });
      }
      updated += 1;
    }

    if (bestAvailableName) {
      alreadyNamed += 1;
    }

    const crmContact = await findCrmContactByPhone(CrmContact, ticket.tenant_key, phone);
    const crmNameRaw = safeString(crmContact?.name);
    const crmName = crmNameRaw || null;

    if (crmContact && bestAvailableName && isPlaceholderName(crmNameRaw, normalizedPhone)) {
      if (!options.dryRun) {
        await crmContact.update({ name: bestAvailableName });
      }
      crmUpdated += 1;
    }

    if (!crmContact) {
      if (options.createMissing) {
        if (normalizedPhone) {
          const cacheKey = `${ticket.tenant_key}::${normalizedPhone}`;
          let createdName = createdCache.get(cacheKey) || '';

          if (!createdName) {
            const existing = await CrmContact.findOne({
              where: {
                tenant_key: ticket.tenant_key,
                phone: normalizedPhone,
                status: { [Op.ne]: 'deleted' },
              },
            });

            createdName = safeString(existing?.name);

            if (!createdName) {
              createdName = buildContactName(context, normalizedPhone);
              if (!options.dryRun) {
                await CrmContact.create({
                  id: `crmctt-${Date.now()}-${scanned}`,
                  tenant_key: ticket.tenant_key,
                  name: createdName,
                  phone: normalizedPhone,
                  status: 'active',
                  attributes: { source: 'ticket-backfill' },
                });
              }
              created += 1;
            }

            createdCache.set(cacheKey, createdName || '');
          }

          if (createdName && (!metadata.contactName || isPlaceholderName(metadata.contactName, normalizedPhone))) {
            metadata.contactName = createdName;
            context.metadata = metadata;
            if (!options.dryRun) {
              await ticket.update({ context });
            }
            updated += 1;
            continue;
          }
        }
      }

      crmMiss += 1;
      continue;
    }

    if (!metadata.contactName || isPlaceholderName(metadata.contactName, normalizedPhone)) {
      metadata.contactName = bestAvailableName || crmName;
    }
    context.metadata = metadata;

    if (!options.dryRun) {
      await ticket.update({ context });
    }

    updated += 1;
  }

  logger.info('[BackfillContactName] Concluído', {
    scanned,
    alreadyNamed,
    withoutPhone,
    crmMiss,
    updated,
    created,
    crmUpdated,
    historicalNamed,
    dryRun: options.dryRun,
  });

  return { scanned, alreadyNamed, withoutPhone, crmMiss, updated, created, crmUpdated, historicalNamed, dryRun: options.dryRun };
}

async function main() {
  const options = parseArgs(process.argv);

  try {
    await connect();
    await runMigrations();
    defineRelationships();

    const result = await runBackfill(options);
    console.log('\nResumo:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    logger.error('[BackfillContactName] Erro fatal', { message: err?.message || String(err) });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runBackfill, normalizePhoneCandidates };
