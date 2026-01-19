/**
 * Serviço de trilha de tags (ticket_tags) - best-effort.
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { TicketTag: TicketTagGetter } = require('../db/models');

function dbAvailable() {
  return !!getSequelize();
}

function newId() {
  return `tt-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function recordTagActionBestEffort({ tenantId, ticketId, tag, action, actorUserId = null }) {
  if (!dbAvailable()) return;
  if (!tenantId || !ticketId || !tag || !action) return;

  const Model = typeof TicketTagGetter === 'function' ? TicketTagGetter() : TicketTagGetter;
  const now = new Date();
  setImmediate(() => {
    Model.create({
      id: newId(),
      tenant_key: tenantId,
      ticket_id: ticketId,
      tag: String(tag),
      action: String(action),
      actor_user_id: actorUserId || null,
      created_at: now,
    }).catch((err) => {
      logger.debug('[TicketTag] Falha ao registrar ticket_tag (ignorado)', { error: err.message });
    });
  });
}

module.exports = {
  recordTagActionBestEffort,
};

